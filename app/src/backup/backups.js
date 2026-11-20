/**
 * Versleutelde back-ups van de database (Beheer > Back-ups en herstel, pakket C).
 *
 * Een back-up is een `pg_dump` in het eigen formaat van PostgreSQL (`-Fc`: schema + gegevens, gecomprimeerd), als
 * stroom versleuteld met AES-256-GCM. De sleutel is afgeleid van de hoofdsleutel (`AVANTA_MASTER_KEY` of
 * `DATA_DIR/master-key`): zonder die sleutel is een back-up waardeloos, dus een kopie buiten de server (Google Drive)
 * is veilig. De onversleutelde dump komt nooit op schijf.
 *
 * Bestandsformaat: "AVBK" + versie (1 byte) + sleutel-id (8 bytes) + IV (12) + versleutelde dump + tag (16). Het
 * sleutel-id (een vingerafdruk van de hoofdsleutel, geen geheim) laat bij ontsleutelen meteen zien of de juiste
 * hoofdsleutel wordt gebruikt. Kop (magic, versie, sleutel-id) is de AAD van de versleuteling.
 *
 * Bestandsnamen: `avanta-JJJJMMDD-UUMMSS.dump.enc` (UTC). Terugzetten: zie `docs/DRAAIBOEK-VPS-VERHUIZING.md` en
 * `src/backup/cli.js`.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Writable } = require('node:stream');

const MAGIC = Buffer.from('AVBK');
const VERSION = 1;
const KEY_ID_LENGTH = 8;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const HEADER_LENGTH = MAGIC.length + 1 + KEY_ID_LENGTH + IV_LENGTH;
/** Patroon van een back-upbestand. */
const BACKUP_NAME = /^avanta-(\d{8})-(\d{6})\.dump\.enc$/;
/** Een dump in het eigen formaat van PostgreSQL begint met deze tekens. */
const DUMP_MAGIC = Buffer.from('PGDMP');
/** Zoveel back-ups blijven altijd staan, ook als ze ouder zijn dan de bewaartermijn. */
const KEEP_NEWEST = 3;
/** Hoogstens zo lang mag `pg_dump` duren. */
const DUMP_TIMEOUT_MS = 30 * 60 * 1000;
/** Na een mislukte automatische back-up wordt het pas na zoveel tijd opnieuw geprobeerd. */
const RETRY_AFTER_MS = 60 * 60 * 1000;
/** Hoe vaak de planner kijkt of er een back-up nodig is. */
const CHECK_INTERVAL_MS = 15 * 60 * 1000;
/** Naam van het statusbestand in de back-upmap. */
const STATUS_FILE = 'status.json';

/**
 * Leidt de sleutels voor back-ups af van de hoofdsleutel.
 * @param {Buffer} masterKey Hoofdsleutel van 32 bytes.
 * @returns {{key: Buffer, keyId: Buffer}} Versleutelsleutel (32 bytes) en sleutel-id (8 bytes, geen geheim).
 */
function backupKeys(masterKey) {
  const key = Buffer.from(crypto.hkdfSync('sha256', masterKey, Buffer.alloc(0), 'avanta-back-ups', 32));
  const keyId = crypto.createHmac('sha256', masterKey).update('avanta-back-up-sleutel-id').digest().subarray(0, KEY_ID_LENGTH);
  return { key, keyId };
}

/**
 * Tijdstempel voor de bestandsnaam (UTC).
 * @param {Date} date Het moment.
 * @returns {string} `JJJJMMDD-UUMMSS`.
 */
function stamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

/**
 * Het tijdstip uit de naam van een back-up.
 * @param {string} name Bestandsnaam.
 * @returns {(Date|null)} Het moment (UTC), of null bij een andere naam.
 */
function dateOfName(name) {
  const match = BACKUP_NAME.exec(String(name));
  if (!match) return null;
  const [date, time] = [match[1], match[2]];
  const parsed = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Of een naam de vorm van een back-upbestand heeft.
 * @param {string} name Bestandsnaam.
 * @returns {boolean} Waar bij `avanta-JJJJMMDD-UUMMSS.dump.enc`.
 */
function isBackupName(name) {
  return dateOfName(name) !== null;
}

/**
 * Zet een verbindings-URL om naar de omgevingsvariabelen van `pg_dump`, zodat het wachtwoord niet in de proceslijst
 * komt.
 * @param {string} connectionString Verbindings-URL (`postgres://gebruiker:wachtwoord@host:poort/database?sslmode=…`).
 * @returns {object} `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` en eventueel `PGSSLMODE`/`PGOPTIONS`.
 * @throws {Error} Bij een URL die geen PostgreSQL-adres is.
 */
function pgEnvironment(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch (_) {
    throw new Error('DATABASE_URL is geen geldig adres');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') throw new Error('DATABASE_URL is geen PostgreSQL-adres');
  const environment = {
    PGHOST: url.searchParams.get('host') || decodeURIComponent(url.hostname) || 'localhost',
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, '')),
  };
  if (url.searchParams.get('sslmode')) environment.PGSSLMODE = url.searchParams.get('sslmode');
  if (url.searchParams.get('options')) environment.PGOPTIONS = url.searchParams.get('options');
  return environment;
}

/**
 * Maakt van een foutmelding van een extern programma een korte, veilige tekst (geen regeleinden, ingekort).
 * @param {string} text Ruwe tekst.
 * @returns {string} Hoogstens 300 tekens.
 */
function shortMessage(text) {
  return String(text || '').replace(/[\r\n\t]+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(-300);
}

/**
 * Leest de kop van een back-upbestand.
 * @param {string} file Pad.
 * @returns {{size: number, keyId: Buffer, iv: Buffer, header: Buffer, tag: Buffer}} Grootte en onderdelen van de kop.
 * @throws {Error} Bij een bestand dat geen (ondersteunde) back-up is.
 */
function readHeader(file) {
  const { size } = fs.statSync(file);
  if (size < HEADER_LENGTH + TAG_LENGTH) throw new Error('Geen geldige back-up (te klein).');
  const handle = fs.openSync(file, 'r');
  const header = Buffer.alloc(HEADER_LENGTH);
  const tag = Buffer.alloc(TAG_LENGTH);
  try {
    fs.readSync(handle, header, 0, HEADER_LENGTH, 0);
    fs.readSync(handle, tag, 0, TAG_LENGTH, size - TAG_LENGTH);
  } finally {
    fs.closeSync(handle);
  }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Geen back-up van Avanta.');
  if (header[MAGIC.length] !== VERSION) throw new Error('Onbekende versie van de back-up.');
  const keyIdStart = MAGIC.length + 1;
  return {
    size,
    header,
    tag,
    keyId: header.subarray(keyIdStart, keyIdStart + KEY_ID_LENGTH),
    iv: header.subarray(keyIdStart + KEY_ID_LENGTH, HEADER_LENGTH),
  };
}

/**
 * Ontsleutelt een back-up als stroom naar `target`. Let op: de echtheid (tag) staat pas vast als de belofte slaagt;
 * schrijf daarom naar een tijdelijk bestand of een plek die bij een fout wordt weggegooid.
 * @param {string} file Pad van de back-up.
 * @param {Buffer} masterKey Hoofdsleutel.
 * @param {import('node:stream').Writable} target Waar de dump heen gaat.
 * @returns {Promise<void>}
 * @throws {Error} Bij een andere hoofdsleutel, een beschadigde of onbekende back-up.
 */
async function decryptTo(file, masterKey, target) {
  const parts = readHeader(file);
  const { key, keyId } = backupKeys(masterKey);
  if (!parts.keyId.equals(keyId)) throw new Error('Deze back-up is gemaakt met een andere hoofdsleutel.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, parts.iv);
  decipher.setAAD(parts.header.subarray(0, MAGIC.length + 1 + KEY_ID_LENGTH));
  decipher.setAuthTag(parts.tag);
  try {
    await pipeline(fs.createReadStream(file, { start: HEADER_LENGTH, end: parts.size - TAG_LENGTH - 1 }), decipher, target);
  } catch (error) {
    throw new Error(`Ontsleutelen mislukt (beschadigde back-up of verkeerde sleutel): ${shortMessage(error.message)}`);
  }
}

/**
 * Controleert een back-up volledig: ontsleutelen (met controle van de tag) en kijken of er een PostgreSQL-dump in zit.
 * Er komt niets op schijf.
 * @param {string} file Pad van de back-up.
 * @param {Buffer} masterKey Hoofdsleutel.
 * @returns {Promise<{bytes: number}>} Grootte van de ontsleutelde dump.
 * @throws {Error} Als de back-up niet te ontsleutelen is of geen dump bevat.
 */
async function verifyBackup(file, masterKey) {
  let bytes = 0;
  let start = Buffer.alloc(0);
  const sink = new Writable({
    write(chunk, encoding, callback) {
      if (start.length < DUMP_MAGIC.length) start = Buffer.concat([start, chunk.subarray(0, DUMP_MAGIC.length - start.length)]);
      bytes += chunk.length;
      callback();
    },
  });
  await decryptTo(file, masterKey, sink);
  if (!start.equals(DUMP_MAGIC)) throw new Error('De back-up bevat geen PostgreSQL-dump.');
  return { bytes };
}

/**
 * Het schema waarin de app werkt (normaal `public`; in de tests een eigen schema via het zoekpad).
 * @param {{query: Function}} db Database.
 * @returns {Promise<string>} Naam van het schema.
 */
async function currentSchema(db) {
  const [row] = await db.query('SELECT current_schema() AS name');
  if (!row || !/^[a-z_][a-z0-9_]{0,62}$/.test(row.name)) throw new Error('Onbekend databaseschema.');
  return row.name;
}

/**
 * Maakt een versleutelde back-up: `pg_dump` als stroom door de versleuteling naar `<naam>.part`, daarna volledig
 * gecontroleerd en pas dan hernoemd. Werkt terwijl de app draait (`pg_dump` leest uit één momentopname).
 * @param {{db: object, connectionString: string, dir: string, masterKey: Buffer, pgDumpPath?: string, now?: () => number, timeoutMs?: number}} options
 *   Database (voor het schema), verbindings-URL, back-upmap, hoofdsleutel, pad van `pg_dump` (standaard `PG_DUMP_PATH`
 *   of `pg_dump`), klok en maximale duur.
 * @returns {Promise<{name: string, size: number, createdAt: string}>} De nieuwe back-up.
 * @throws {Error} Als `pg_dump` mislukt of de controle afkeurt (er blijft dan niets staan).
 */
async function createBackup(options) {
  const { dir, masterKey } = options;
  const now = new Date(options.now ? options.now() : Date.now());
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const schema = await currentSchema(options.db);
  let name = `avanta-${stamp(now)}.dump.enc`;
  // Twee back-ups in dezelfde seconde: de tweede schuift een seconde op.
  for (let offset = 1; fs.existsSync(path.join(dir, name)) && offset < 60; offset += 1) name = `avanta-${stamp(new Date(now.getTime() + offset * 1000))}.dump.enc`;
  const partFile = path.join(dir, `.${name}.${crypto.randomBytes(6).toString('hex')}.part`);
  const { key, keyId } = backupKeys(masterKey);
  const iv = crypto.randomBytes(IV_LENGTH);
  const header = Buffer.concat([MAGIC, Buffer.from([VERSION]), keyId, iv]);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(header.subarray(0, MAGIC.length + 1 + KEY_ID_LENGTH));
  const pgDump = options.pgDumpPath || process.env.PG_DUMP_PATH || 'pg_dump';
  // Eerst alles wat synchroon kan gooien (verbindingsgegevens), dan de schrijfstroom; spawn pas binnen de try, zodat de
  // finally de stroom en het .part-bestand altijd opruimt.
  const env = { PATH: process.env.PATH, ...pgEnvironment(options.connectionString) };
  const output = fs.createWriteStream(partFile, { mode: 0o600 });
  let timer = null;
  try {
    const child = spawn(pgDump, ['--format=custom', '--no-owner', '--no-acl', `--schema=${schema}`], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let errors = '';
    child.stderr.on('data', (chunk) => { errors = (errors + chunk).slice(-2000); });
    const exited = new Promise((resolve) => {
      child.on('error', (error) => resolve({ code: -1, error }));
      child.on('close', (code) => resolve({ code }));
    });
    timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs || DUMP_TIMEOUT_MS);
    output.write(header);
    const [written, result] = await Promise.allSettled([pipeline(child.stdout, cipher, output, { end: false }), exited]);
    const exit = result.value || { code: -1 };
    if (exit.error) throw new Error(`pg_dump starten mislukt: ${shortMessage(exit.error.message)}`);
    if (exit.code !== 0) throw new Error(`pg_dump mislukt (code ${exit.code}): ${shortMessage(errors) || 'geen melding'}`);
    if (written.status === 'rejected') throw new Error(`Back-up schrijven mislukt: ${shortMessage(written.reason.message)}`);
    await new Promise((resolve, reject) => output.end(cipher.getAuthTag(), (error) => (error ? reject(error) : resolve())));
    await verifyBackup(partFile, masterKey);
    fs.renameSync(partFile, path.join(dir, name));
  } finally {
    if (timer) clearTimeout(timer);
    // Eerst de schrijfstroom echt sluiten: anders kan het bestand (bij een snelle fout) pas ná het opruimen ontstaan.
    if (!output.closed) await new Promise((resolve) => { output.once('close', resolve); output.destroy(); });
    fs.rmSync(partFile, { force: true });
  }
  const { size } = fs.statSync(path.join(dir, name));
  return { name, size, createdAt: dateOfName(name).toISOString() };
}

/**
 * De back-ups in een map, nieuwste eerst.
 * @param {string} dir Back-upmap.
 * @returns {Array<{name: string, size: number, createdAt: string}>} De back-ups (leeg als de map niet bestaat).
 */
function listBackups(dir) {
  let names;
  try {
    names = fs.readdirSync(dir).filter(isBackupName);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return names
    .map((name) => ({ name, size: fs.statSync(path.join(dir, name)).size, createdAt: dateOfName(name).toISOString() }))
    .sort((left, right) => right.name.localeCompare(left.name));
}

/**
 * Verwijdert back-ups ouder dan de bewaartermijn; de nieuwste drie blijven altijd staan.
 * @param {string} dir Back-upmap.
 * @param {number} keepDays Bewaartermijn in dagen.
 * @param {number} [now] Huidig tijdstip in ms.
 * @returns {string[]} Namen van de verwijderde back-ups.
 */
function pruneBackups(dir, keepDays, now = Date.now()) {
  const cutoff = now - keepDays * 86400000;
  const removed = [];
  for (const backup of listBackups(dir).slice(KEEP_NEWEST)) {
    if (Date.parse(backup.createdAt) < cutoff) {
      fs.rmSync(path.join(dir, backup.name), { force: true });
      removed.push(backup.name);
    }
  }
  return removed;
}

/**
 * Datum en uur van een moment in Nederlandse tijd.
 * @param {number} time Tijdstip in ms.
 * @returns {{date: string, hour: number}} Datum (`JJJJ-MM-DD`) en uur (0–23) in Europe/Amsterdam.
 */
function amsterdamParts(time) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(time)).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/**
 * Of de automatische back-up nu aan de beurt is: vandaag (Nederlandse tijd) is het ingestelde uur bereikt en er is
 * sinds dat uur nog geen back-up gemaakt, en de laatste mislukte poging is langer dan een uur geleden.
 * @param {{now: number, hour: number, backups: Array<{createdAt: string}>, lastFailAt?: string}} input Huidig tijdstip,
 *   ingesteld uur, bestaande back-ups en de laatste mislukte poging.
 * @returns {boolean} Waar als er nu een back-up gemaakt moet worden.
 */
function isDue({ now, hour, backups, lastFailAt }) {
  const today = amsterdamParts(now);
  if (today.hour < hour) return false;
  if (lastFailAt && now - Date.parse(lastFailAt) < RETRY_AFTER_MS) return false;
  return !backups.some((backup) => {
    const made = amsterdamParts(Date.parse(backup.createdAt));
    return made.date === today.date && made.hour >= hour;
  });
}

/**
 * Leest het statusbestand van de back-ups (laatste poging, laatste fout).
 * @param {string} dir Back-upmap.
 * @returns {{lastRun: (object|null), lastOkAt: string, lastFailAt: string}} De status (leeg als er nog geen is).
 */
function readStatus(dir) {
  const empty = { lastRun: null, lastOkAt: '', lastFailAt: '' };
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, STATUS_FILE), 'utf8'));
    const iso = (value) => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : '');
    const run = parsed.lastRun && typeof parsed.lastRun === 'object' ? parsed.lastRun : null;
    return {
      lastRun: run && iso(run.at) ? {
        at: iso(run.at),
        ok: run.ok === true,
        trigger: ['automatisch', 'handmatig', 'update'].includes(run.trigger) ? run.trigger : 'automatisch',
        name: isBackupName(run.name) ? run.name : '',
        message: shortMessage(run.message),
      } : null,
      lastOkAt: iso(parsed.lastOkAt),
      lastFailAt: iso(parsed.lastFailAt),
    };
  } catch (_) {
    return empty;
  }
}

/**
 * Legt de uitkomst van een poging vast in het statusbestand (in één keer: tijdelijk bestand + hernoemen).
 * @param {string} dir Back-upmap.
 * @param {{at: string, ok: boolean, trigger: string, name?: string, message?: string}} run De poging.
 * @returns {void}
 */
function writeStatus(dir, run) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const previous = readStatus(dir);
  const next = {
    lastRun: { at: run.at, ok: run.ok, trigger: run.trigger, name: run.name || '', message: shortMessage(run.message) },
    lastOkAt: run.ok ? run.at : previous.lastOkAt,
    lastFailAt: run.ok ? previous.lastFailAt : run.at,
  };
  const temporary = path.join(dir, `.${STATUS_FILE}.${process.pid}.tmp`);
  fs.writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 });
  fs.renameSync(temporary, path.join(dir, STATUS_FILE));
}

/**
 * Maakt de back-updienst van de app: één back-up tegelijk, bewaartermijn, status en de dagelijkse planner.
 * @param {{db: object, settings: object, dir: string, masterKey: Buffer, connectionString?: string, pgDumpPath?: string, now?: () => number, onCreated?: Function}} options
 *   Database, instellingen (`backupEnabled`, `backupHour`, `backupKeepDays`), back-upmap, hoofdsleutel, verbindings-URL
 *   (zonder: back-ups niet beschikbaar), pad van `pg_dump`, klok (tests) en een functie die na elke geslaagde back-up
 *   wordt aangeroepen (bijv. de kopie naar Google Drive).
 * @returns {object} `available`, `list`, `status`, `idle`, `run`, `runIfDue`, `startTimer`, `fileOf`, `keyId`, `dir`.
 */
function createBackupService(options) {
  const { db, settings, dir, masterKey } = options;
  const now = options.now || Date.now;
  let running = null;

  /**
   * Of back-ups mogelijk zijn (er is een verbindings-URL).
   * @returns {boolean} Waar als back-ups gemaakt kunnen worden.
   */
  const available = () => Boolean(options.connectionString);

  /**
   * Maakt nu een back-up (of wacht op de lopende), ruimt daarna oude back-ups op en schrijft een auditregel
   * `backup.gemaakt`: via `context.audit` (de route, met gebruiker en IP-voorvoegsel), anders zonder gebruiker
   * (automatisch, opdrachtregel). Het verzoek is dan al beantwoord; een mislukte auditregel wordt gelogd.
   * @param {{trigger?: string, audit?: (backup: object) => Promise<void>}} [context] Aanleiding (`automatisch`,
   *   `handmatig`, `update`) en de functie die de auditregel schrijft.
   * @returns {Promise<{name: string, size: number, createdAt: string}>} De back-up.
   * @throws {Error} Als de back-up mislukt (ook vastgelegd in de status).
   */
  const run = (context = {}) => {
    if (!available()) return Promise.reject(new Error('Back-ups zijn niet beschikbaar (geen DATABASE_URL).'));
    if (running) return running;
    const trigger = context.trigger || 'automatisch';
    running = (async () => {
      const at = new Date(now()).toISOString();
      let backup;
      try {
        backup = await createBackup({ db, connectionString: options.connectionString, dir, masterKey, pgDumpPath: options.pgDumpPath, now });
        writeStatus(dir, { at, ok: true, trigger, name: backup.name });
      } catch (error) {
        writeStatus(dir, { at, ok: false, trigger, message: error.message });
        running = null;
        throw error;
      }
      // Alleen het maken zelf bepaalt of de poging gelukt is; opruimen en het auditlog worden apart gelogd.
      try {
        pruneBackups(dir, settings.get('backupKeepDays'), now());
      } catch (error) {
        console.error(`Oude back-ups opruimen mislukt: ${shortMessage(error.message)}`);
      }
      try {
        if (context.audit) await context.audit(backup);
        else await db.query("INSERT INTO audit_log (user_id, action, entity, entity_id) VALUES (NULL, 'backup.gemaakt', 'backup', $1)", [backup.name]);
      } catch (error) {
        console.error(`Auditregel voor de back-up mislukt: ${shortMessage(error.message)}`);
      }
      running = null;
      if (options.onCreated) Promise.resolve().then(() => options.onCreated(backup, trigger)).catch(() => {});
      return backup;
    })();
    return running;
  };

  /**
   * Maakt een automatische back-up als die aan de beurt is (zie `isDue`).
   * @returns {Promise<(object|null)>} De back-up, of null als het niet nodig was.
   */
  const runIfDue = async () => {
    await settings.ready();
    if (!available() || !settings.get('backupEnabled')) return null;
    if (!isDue({ now: now(), hour: settings.get('backupHour'), backups: listBackups(dir), lastFailAt: readStatus(dir).lastFailAt })) return null;
    return run({ trigger: 'automatisch' });
  };

  /**
   * Start de planner: elk kwartier kijken of de dagelijkse back-up aan de beurt is. Houdt het proces niet open.
   * @returns {NodeJS.Timeout} De timer.
   */
  const startTimer = () => {
    const tick = () => runIfDue().catch((error) => console.error(`Automatische back-up mislukt: ${shortMessage(error.message)}`));
    setTimeout(tick, 60 * 1000).unref();
    return setInterval(tick, CHECK_INTERVAL_MS).unref();
  };

  /**
   * Het pad van een bestaande back-up, alleen voor een geldige naam.
   * @param {string} name Bestandsnaam.
   * @returns {(string|null)} Pad, of null als de naam ongeldig is of het bestand niet bestaat.
   */
  const fileOf = (name) => {
    if (!isBackupName(name)) return null;
    const file = path.join(dir, name);
    return fs.existsSync(file) ? file : null;
  };

  return {
    available,
    list: () => listBackups(dir),
    status: () => ({ ...readStatus(dir), running: Boolean(running) }),
    /**
     * Wacht tot een lopende back-up klaar is (gelukt of niet).
     * @returns {Promise<void>}
     */
    idle: () => (running ? running.then(() => {}, () => {}) : Promise.resolve()),
    run,
    runIfDue,
    startTimer,
    fileOf,
    keyId: () => backupKeys(masterKey).keyId.toString('hex'),
    dir,
  };
}

module.exports = {
  createBackup,
  createBackupService,
  listBackups,
  pruneBackups,
  verifyBackup,
  decryptTo,
  readHeader,
  isBackupName,
  dateOfName,
  isDue,
  amsterdamParts,
  pgEnvironment,
  backupKeys,
  readStatus,
  writeStatus,
  BACKUP_NAME,
};
