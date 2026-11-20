/**
 * Kopie van de back-ups naar Google Drive (Beheer > Back-ups en herstel > Google Drive, pakket C2). Zelfde opzet als in
 * Aquatech:
 * - OAuth 2.0 met een eigen Google-app (client-ID en -secret uit de Google Cloud Console), scope `drive.file`: de app
 *   ziet en wijzigt alleen de map en bestanden die ze zelf aanmaakte, nooit de rest van de Drive.
 * - Wat naar Google gaat is al versleuteld met de hoofdsleutel (`backup/backups.js`): Google kan de inhoud niet lezen.
 * - Instellingen in `SETTING_FIELDS`: `driveEnabled`, `driveClientId`, `driveClientSecret` (geheim), `driveFolderName`,
 *   `driveKeepCount` en `driveRefreshToken` (geheim, in geen enkel formulier; alleen via koppelen/ontkoppelen).
 * - De stand (map-id, account, wat er al op Drive staat, laatste gebeurtenissen) staat in `drive-state.json` in de
 *   back-upmap; nooit een token. Na elke back-up en elk uur worden ontbrekende back-ups geüpload (hervatbare upload,
 *   als stroom) en wordt de bewaartermijn op Drive toegepast.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { isBackupName, listBackups } = require('./backups');

/** Adressen van Google. */
const GOOGLE = {
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  revoke: 'https://oauth2.googleapis.com/revoke',
  api: 'https://www.googleapis.com/drive/v3',
  upload: 'https://www.googleapis.com/upload/drive/v3',
};
/** Alleen bestanden die de app zelf aanmaakt. */
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
/** Pad waar Google na het koppelen naar terugkeert (achter het basisadres van de site). */
const CALLBACK_PATH = '/app/beheer/google-drive/terug/';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const STATE_FILE = 'drive-state.json';
const STATE_TTL_MS = 15 * 60 * 1000;
const RETRY_AFTER_MS = 15 * 60 * 1000;
const SYNC_INTERVAL_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 30 * 1000;
const UPLOAD_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_EVENTS = 20;
const MAX_UPLOADED = 400;

/**
 * Fout van de koppeling met een leesbare melding (nooit een token of geheim).
 */
class DriveError extends Error {
  /**
   * @param {string} code Foutcode, bijv. `reconnect` (opnieuw koppelen nodig) of `google`.
   * @param {string} message Melding voor de beheerder.
   */
  constructor(code, message) {
    super(message);
    this.name = 'DriveError';
    this.code = code;
  }
}

/**
 * Maakt tekst kort en zonder stuurtekens.
 * @param {*} value Invoer.
 * @param {number} [max] Hoogste lengte.
 * @returns {string} Schone tekst.
 */
function cleanText(value, max = 200) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
}

/**
 * Een tijdstip als ISO-tekst, of leeg.
 * @param {*} value Invoer.
 * @returns {string} ISO-tekst.
 */
function isoOrEmpty(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : '';
}

/**
 * Een id van Google (map of bestand): alleen letters, cijfers, `-` en `_`.
 * @param {*} value Invoer.
 * @returns {string} Het id, of leeg.
 */
function cleanId(value) {
  const text = String(value || '');
  return /^[A-Za-z0-9_-]{1,200}$/.test(text) ? text : '';
}

/**
 * Leest en schoont de stand van de koppeling op.
 * @param {string} dir Back-upmap.
 * @returns {{folderId: string, folderName: string, account: string, uploaded: object[], events: object[], lastOkAt: string, lastFailAt: string, needsReconnect: boolean}} De stand.
 */
function readState(dir) {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, STATE_FILE), 'utf8'));
  } catch (_) {
    raw = {};
  }
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    folderId: cleanId(input.folderId),
    folderName: cleanText(input.folderName, 100),
    account: cleanText(input.account, 200),
    uploaded: (Array.isArray(input.uploaded) ? input.uploaded : [])
      .filter((entry) => entry && isBackupName(entry.name) && cleanId(entry.driveId))
      .slice(0, MAX_UPLOADED)
      .map((entry) => ({ name: entry.name, driveId: cleanId(entry.driveId), size: Math.max(0, Math.floor(Number(entry.size) || 0)), at: isoOrEmpty(entry.at) })),
    events: (Array.isArray(input.events) ? input.events : [])
      .filter((entry) => entry && typeof entry === 'object' && isoOrEmpty(entry.at))
      .slice(0, MAX_EVENTS)
      .map((entry) => ({ at: isoOrEmpty(entry.at), ok: entry.ok === true, message: cleanText(entry.message, 300) })),
    lastOkAt: isoOrEmpty(input.lastOkAt),
    lastFailAt: isoOrEmpty(input.lastFailAt),
    needsReconnect: input.needsReconnect === true,
  };
}

/**
 * Schrijft de stand in één keer weg (tijdelijk bestand + hernoemen).
 * @param {string} dir Back-upmap.
 * @param {object} state De stand.
 * @returns {void}
 */
function writeState(dir, state) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temporary = path.join(dir, `.${STATE_FILE}.${process.pid}.tmp`);
  fs.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(temporary, path.join(dir, STATE_FILE));
}

/**
 * Maakt de koppeling met Google Drive.
 * @param {{settings: object, dir: string, fetchImpl?: Function, now?: () => number, audit?: Function}} options
 *   Instellingen, back-upmap, fetch (tests vervangen Google hiermee), klok en een functie die een auditregel schrijft
 *   (`{userId, action}`).
 * @returns {object} `configured`, `connected`, `redirectUri`, `startAuthorization`, `finishAuthorization`,
 *   `disconnect`, `sync`, `syncIfDue`, `startTimer`, `state`, `download`, `listRemote`.
 */
function createDrive(options) {
  const { settings, dir } = options;
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || Date.now;
  /** Lopende koppelverzoeken: state → {userId, expires}. */
  const pending = new Map();
  /** Toegangstoken in het geheugen (nooit op schijf): {token, expires}. */
  let access = null;
  let syncing = null;

  /**
   * Of client-ID en -secret zijn ingevuld.
   * @returns {boolean} Waar als koppelen mogelijk is.
   */
  const configured = () => Boolean(settings.get('driveClientId') && settings.get('driveClientSecret'));

  /**
   * Of er een geldige koppeling is (refresh-token aanwezig).
   * @returns {boolean} Waar als gekoppeld.
   */
  const connected = () => configured() && Boolean(settings.get('driveRefreshToken'));

  /**
   * Het adres waar Google na het koppelen naar terugkeert (uit het basisadres in Beheer, nooit uit het verzoek).
   * @returns {string} Volledig adres.
   */
  const redirectUri = () => `${String(settings.get('siteUrl')).replace(/\/+$/, '')}${CALLBACK_PATH}`;

  /**
   * Voegt een gebeurtenis toe aan de stand.
   * @param {object} state De stand.
   * @param {boolean} ok Gelukt of niet.
   * @param {string} message Melding (zonder tokens).
   * @returns {void}
   */
  const addEvent = (state, ok, message) => {
    const at = new Date(now()).toISOString();
    state.events = [{ at, ok, message: cleanText(message, 300) }, ...state.events].slice(0, MAX_EVENTS);
    if (ok) state.lastOkAt = at;
    else state.lastFailAt = at;
  };

  /**
   * Een verzoek aan Google met een tijdslimiet; een fout wordt een DriveError zonder geheimen.
   * @param {string} url Adres.
   * @param {object} init Fetch-opties.
   * @param {number} [timeoutMs] Tijdslimiet.
   * @returns {Promise<Response>} Antwoord (alleen 2xx).
   * @throws {DriveError} Bij een netwerkfout of een foutstatus.
   */
  const call = async (url, init, timeoutMs = TIMEOUT_MS) => {
    let response;
    try {
      response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      throw new DriveError('network', `Google is niet bereikbaar (${cleanText(error.message, 100)}).`);
    }
    if (response.ok) return response;
    let detail = '';
    try {
      const body = await response.json();
      detail = typeof body.error === 'string' ? body.error : cleanText(body.error && body.error.message, 150);
    } catch (_) {
      detail = '';
    }
    if (response.status === 401 || detail === 'invalid_grant') throw new DriveError('reconnect', 'Google weigert de koppeling; koppel opnieuw.');
    throw new DriveError('google', `Google gaf fout ${response.status}${detail ? `: ${detail}` : ''}.`);
  };

  /**
   * Een toegangstoken, zo nodig vernieuwd met het refresh-token.
   * @returns {Promise<string>} Token.
   */
  const accessToken = async () => {
    if (access && access.expires > now() + 60 * 1000) return access.token;
    const response = await call(GOOGLE.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: settings.get('driveClientId'),
        client_secret: settings.get('driveClientSecret'),
        refresh_token: settings.get('driveRefreshToken'),
        grant_type: 'refresh_token',
      }).toString(),
    });
    const body = await response.json();
    if (typeof body.access_token !== 'string') throw new DriveError('google', 'Google gaf geen toegangstoken.');
    access = { token: body.access_token, expires: now() + (Number(body.expires_in) || 3600) * 1000 };
    return access.token;
  };

  /**
   * Een verzoek aan de Drive-API met het toegangstoken.
   * @param {string} url Adres.
   * @param {object} [init] Fetch-opties.
   * @param {number} [timeoutMs] Tijdslimiet.
   * @returns {Promise<Response>} Antwoord.
   */
  const api = async (url, init = {}, timeoutMs = TIMEOUT_MS) => call(url, { ...init, headers: { ...(init.headers || {}), authorization: `Bearer ${await accessToken()}` } }, timeoutMs);

  /**
   * Begint het koppelen: een eenmalige `state` (15 minuten, gebonden aan de gebruiker) en het adres bij Google.
   * @param {number} userId Wie koppelt.
   * @returns {string} Adres van het toestemmingsscherm van Google.
   * @throws {DriveError} Zonder client-ID en -secret.
   */
  const startAuthorization = (userId) => {
    if (!configured()) throw new DriveError('not_configured', 'Vul eerst het client-ID en het client-secret in en sla ze op.');
    for (const [key, entry] of pending) if (entry.expires < now()) pending.delete(key);
    const state = crypto.randomBytes(24).toString('base64url');
    pending.set(state, { userId, expires: now() + STATE_TTL_MS });
    const params = new URLSearchParams({
      client_id: settings.get('driveClientId'),
      redirect_uri: redirectUri(),
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'false',
      state,
    });
    return `${GOOGLE.authorize}?${params}`;
  };

  /**
   * Rondt het koppelen af na de terugkeer van Google: `state` controleren (eenmalig), de code inwisselen, het
   * refresh-token versleuteld opslaan en het account en de map opzoeken.
   * @param {{state: string, code?: string, error?: string}} input Parameters van Google.
   * @returns {Promise<{userId: number, account: string}>} Wie koppelde en met welk Google-account.
   * @throws {DriveError} Bij een onbekende of verlopen state, een weigering of een fout van Google.
   */
  const finishAuthorization = async (input) => {
    const entry = typeof input.state === 'string' ? pending.get(input.state) : undefined;
    if (!entry || entry.expires < now()) throw new DriveError('state', 'Deze koppelpoging is onbekend of verlopen. Begin opnieuw vanuit Beheer.');
    pending.delete(input.state);
    if (input.error || typeof input.code !== 'string' || !input.code) throw new DriveError('denied', 'Er is geen toestemming gegeven bij Google.');
    const response = await call(GOOGLE.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: input.code.slice(0, 2000),
        client_id: settings.get('driveClientId'),
        client_secret: settings.get('driveClientSecret'),
        redirect_uri: redirectUri(),
        grant_type: 'authorization_code',
      }).toString(),
    });
    const body = await response.json();
    if (typeof body.refresh_token !== 'string' || !body.refresh_token) throw new DriveError('google', 'Google gaf geen refresh-token. Haal de toegang van de app weg in je Google-account en koppel opnieuw.');
    await settings.update({ values: { driveRefreshToken: body.refresh_token } }, {
      userId: entry.userId,
      inTransaction: async (client) => options.audit && options.audit({ userId: entry.userId, action: 'drive.gekoppeld' }, client),
    });
    access = typeof body.access_token === 'string' ? { token: body.access_token, expires: now() + (Number(body.expires_in) || 3600) * 1000 } : null;
    const state = readState(dir);
    state.needsReconnect = false;
    state.folderId = '';
    try {
      const about = await (await api(`${GOOGLE.api}/about?fields=user(emailAddress)`)).json();
      state.account = cleanText(about && about.user && about.user.emailAddress, 200);
    } catch (_) {
      state.account = '';
    }
    addEvent(state, true, `Gekoppeld${state.account ? ` met ${state.account}` : ''}.`);
    writeState(dir, state);
    return { userId: entry.userId, account: state.account };
  };

  /**
   * Ontkoppelt: het refresh-token bij Google intrekken (als dat lukt) en uit de instellingen wissen.
   * @param {number} userId Wie ontkoppelt.
   * @returns {Promise<void>}
   */
  const disconnect = async (userId) => {
    const token = settings.get('driveRefreshToken');
    if (token) {
      await call(GOOGLE.revoke, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }).toString() }).catch(() => {});
    }
    await settings.update({ clear: ['driveRefreshToken'] }, {
      userId,
      inTransaction: async (client) => options.audit && options.audit({ userId, action: 'drive.ontkoppeld' }, client),
    });
    access = null;
    const state = readState(dir);
    Object.assign(state, { folderId: '', account: '', uploaded: [], needsReconnect: false });
    addEvent(state, true, 'Ontkoppeld; de bestanden op Google Drive blijven staan.');
    writeState(dir, state);
  };

  /**
   * Zoekt of maakt de back-upmap op Drive.
   * @param {object} state De stand (wordt bijgewerkt).
   * @returns {Promise<string>} Id van de map.
   */
  const ensureFolder = async (state) => {
    const name = settings.get('driveFolderName');
    if (state.folderId && state.folderName === name) {
      try {
        const folder = await (await api(`${GOOGLE.api}/files/${state.folderId}?fields=id,trashed`)).json();
        if (folder && folder.id && !folder.trashed) return state.folderId;
      } catch (error) {
        if (error.code === 'reconnect' || error.code === 'network') throw error;
      }
    }
    const query = `name = '${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' and mimeType = '${FOLDER_MIME}' and trashed = false`;
    const found = await (await api(`${GOOGLE.api}/files?${new URLSearchParams({ q: query, fields: 'files(id)', pageSize: '1', spaces: 'drive' })}`)).json();
    let folderId = cleanId(found && found.files && found.files[0] && found.files[0].id);
    if (!folderId) {
      const created = await (await api(`${GOOGLE.api}/files?fields=id`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER_MIME }),
      })).json();
      folderId = cleanId(created && created.id);
      if (!folderId) throw new DriveError('google', 'Google gaf geen id voor de nieuwe map.');
    }
    if (folderId !== state.folderId) state.uploaded = [];
    state.folderId = folderId;
    state.folderName = name;
    return folderId;
  };

  /**
   * De back-ups in de map op Drive, nieuwste eerst.
   * @param {string} folderId Id van de map.
   * @returns {Promise<Array<{id: string, name: string, size: number}>>} Bestanden met een back-upnaam.
   */
  const listFolder = async (folderId) => {
    const files = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({ q: `'${folderId}' in parents and trashed = false`, fields: 'nextPageToken,files(id,name,size)', pageSize: '200', orderBy: 'name desc' });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await (await api(`${GOOGLE.api}/files?${params}`)).json();
      for (const file of (page && page.files) || []) {
        if (isBackupName(file.name) && cleanId(file.id)) files.push({ id: file.id, name: file.name, size: Number(file.size) || 0 });
      }
      pageToken = page && typeof page.nextPageToken === 'string' ? page.nextPageToken : '';
    } while (pageToken && files.length < 2000);
    return files.sort((left, right) => right.name.localeCompare(left.name));
  };

  /**
   * Uploadt één back-up met een hervatbare upload (als stroom).
   * @param {string} folderId Map op Drive.
   * @param {{name: string, size: number}} backup De back-up.
   * @returns {Promise<string>} Id van het bestand op Drive.
   */
  const upload = async (folderId, backup) => {
    const start = await api(`${GOOGLE.upload}/files?uploadType=resumable&fields=id`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': 'application/octet-stream', 'x-upload-content-length': String(backup.size) },
      body: JSON.stringify({ name: backup.name, parents: [folderId], mimeType: 'application/octet-stream' }),
    });
    const location = start.headers.get('location') || '';
    if (!location.startsWith(`${GOOGLE.upload}/`)) throw new DriveError('google', 'Google gaf geen uploadadres.');
    const response = await api(location, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream', 'content-length': String(backup.size) },
      body: Readable.toWeb(fs.createReadStream(path.join(dir, backup.name))),
      duplex: 'half',
    }, UPLOAD_TIMEOUT_MS);
    const body = await response.json();
    const id = cleanId(body && body.id);
    if (!id) throw new DriveError('google', 'Google gaf geen id voor het geüploade bestand.');
    return id;
  };

  /**
   * Synchroniseert: ontbrekende back-ups uploaden (oudste eerst) en oude bestanden op Drive verwijderen (alleen
   * bestanden met een back-upnaam in de eigen map; de nieuwste `driveKeepCount` blijven).
   * @returns {Promise<{skipped?: string, uploaded?: string[], removed?: string[]}>} Uitkomst.
   */
  const sync = () => {
    if (syncing) return syncing;
    syncing = (async () => {
      await settings.ready();
      if (!settings.get('driveEnabled')) return { skipped: 'uit' };
      if (!connected()) return { skipped: 'niet gekoppeld' };
      const state = readState(dir);
      try {
        const folderId = await ensureFolder(state);
        const remote = await listFolder(folderId);
        const remoteNames = new Set(remote.map((file) => file.name));
        const keep = settings.get('driveKeepCount');
        // Alleen back-ups die na het uploaden binnen de bewaartermijn op Drive vallen.
        const wanted = listBackups(dir).slice(0, keep).filter((backup) => !remoteNames.has(backup.name)).reverse();
        const uploaded = [];
        for (const backup of wanted) {
          const driveId = await upload(folderId, backup);
          uploaded.push(backup.name);
          remote.push({ id: driveId, name: backup.name, size: backup.size });
          state.uploaded = [{ name: backup.name, driveId, size: backup.size, at: new Date(now()).toISOString() }, ...state.uploaded].slice(0, MAX_UPLOADED);
        }
        remote.sort((left, right) => right.name.localeCompare(left.name));
        const removed = [];
        for (const file of remote.slice(keep)) {
          await api(`${GOOGLE.api}/files/${file.id}`, { method: 'DELETE' });
          removed.push(file.name);
        }
        const removedSet = new Set(removed);
        state.uploaded = state.uploaded.filter((entry) => !removedSet.has(entry.name));
        state.needsReconnect = false;
        addEvent(state, true, uploaded.length || removed.length
          ? `${uploaded.length} geüpload, ${removed.length} oude verwijderd.`
          : 'Alles stond al op Google Drive.');
        return { uploaded, removed };
      } catch (error) {
        if (error.code === 'reconnect') {
          state.needsReconnect = true;
          access = null;
        }
        addEvent(state, false, error instanceof DriveError ? error.message : `Onverwachte fout: ${cleanText(error.message, 150)}`);
        throw error;
      } finally {
        writeState(dir, state);
      }
    })().finally(() => { syncing = null; });
    return syncing;
  };

  /**
   * Synchroniseert vanuit de planner: niet als het uit staat, niet gekoppeld is, opnieuw koppelen nodig is of de
   * laatste fout korter dan een kwartier geleden was.
   * @returns {Promise<(object|null)>} Uitkomst, of null als het niet nodig was.
   */
  const syncIfDue = async () => {
    await settings.ready();
    if (!settings.get('driveEnabled') || !connected()) return null;
    const state = readState(dir);
    if (state.needsReconnect) return null;
    const failedLast = state.lastFailAt && (!state.lastOkAt || state.lastFailAt > state.lastOkAt);
    if (failedLast && now() - Date.parse(state.lastFailAt) < RETRY_AFTER_MS) return null;
    return sync();
  };

  /**
   * Start de planner: elk uur synchroniseren (ook na een eerdere fout). Houdt het proces niet open.
   * @returns {NodeJS.Timeout} De timer.
   */
  const startTimer = () => setInterval(() => syncIfDue().catch((error) => console.error(`Google Drive: ${cleanText(error.message, 200)}`)), SYNC_INTERVAL_MS).unref();

  /**
   * Downloadt een back-up van Drive naar een bestand (voor de hersteltest van de Drive-kopie).
   * @param {string} name Naam van de back-up.
   * @param {string} target Pad van het nieuwe bestand.
   * @returns {Promise<{name: string, size: number}>} Naam en grootte.
   * @throws {DriveError} Als het bestand niet op Drive staat.
   */
  const download = async (name, target) => {
    const state = readState(dir);
    const folderId = await ensureFolder(state);
    writeState(dir, state);
    const file = (await listFolder(folderId)).find((entry) => entry.name === name);
    if (!file) throw new DriveError('missing', `${name} staat niet op Google Drive.`);
    const response = await api(`${GOOGLE.api}/files/${file.id}?alt=media`, {}, UPLOAD_TIMEOUT_MS);
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(target, { mode: 0o600 }));
    return { name, size: fs.statSync(target).size };
  };

  /**
   * De back-ups op Drive (voor de hersteltest).
   * @returns {Promise<Array<{id: string, name: string, size: number}>>} Bestanden, nieuwste eerst.
   */
  const listRemote = async () => {
    const state = readState(dir);
    const folderId = await ensureFolder(state);
    writeState(dir, state);
    return listFolder(folderId);
  };

  return {
    configured, connected, redirectUri, startAuthorization, finishAuthorization, disconnect, sync, syncIfDue, startTimer,
    state: () => readState(dir), download, listRemote,
  };
}

module.exports = { createDrive, DriveError, readState, GOOGLE, SCOPE, CALLBACK_PATH };
