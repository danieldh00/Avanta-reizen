/**
 * Updates vanuit de app (Beheer > Systeem > Updates), naar het voorbeeld van Aquatech. De app rolt zelf niets uit: ze
 * heeft geen Docker-socket en geen rootrechten. Ze praat met het hostscript `deploy/apps01/update.sh` via twee
 * gedeelde mappen (bind mounts uit `deploy/apps01/docker-compose.yml`):
 *
 * - statusmap (`UPDATE_STATUS_DIR`, in de container alleen-lezen): het hostscript schrijft hier `status.json`
 *   (draaiende en beschikbare versie + commit, laatst gecontroleerd), `run.json` (stand van de laatste uitrol),
 *   `changelog.md` (de changelog van de beschikbare commit) en `maintenance.json` (bestaat zolang de uitrol loopt).
 * - aanvraagmap (`UPDATE_REQUEST_DIR`, alleen deze map is voor de app schrijfbaar): de app schrijft hier
 *   `request.json` ("installeer commit X", of `check: true` = alleen controleren) en `policy.json` (automatisch
 *   bijwerken aan/uit, een kopie van de instelling `updateAuto`). Een systemd-path-unit op de host start het script
 *   zodra `request.json` verschijnt.
 *
 * De app vertrouwt de statusbestanden niet blind (alles wordt gesaneerd) en het hostscript vertrouwt de aanvraag niet:
 * het installeert alleen de commit die het zelf als nieuwste van de gevolgde branch heeft opgehaald.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATES = ['idle', 'bezig', 'geslaagd', 'mislukt', 'geweigerd'];
const STEPS = ['ophalen', 'onderhoud', 'back-up', 'herstarten', 'controleren', 'terugzetten', 'klaar'];
const MAX_FILE_BYTES = 256 * 1024;
/** Een onderhoudsbestand of lopende uitrol ouder dan dit telt niet meer (host vastgelopen of hard gestopt). */
const MAINTENANCE_MAX_MS = 45 * 60 * 1000;
/** Zo lang onthoudt de app de onderhoudsstand (elke schrijfactie vraagt erom). */
const CACHE_MS = 2000;
/** Minimale tijd tussen twee handmatige controles, en hoe lang een controle hoogstens "loopt". */
const CHECK_MIN_GAP_MS = 10 * 1000;
const CHECK_MAX_MS = 3 * 60 * 1000;
const LIMITS = { releases: 30, items: 20, title: 200, text: 1000, message: 300, name: 80 };

/**
 * Vergelijkt twee versienummers ('0.9.0' < '0.10.0').
 * @param {string} left Eerste versie.
 * @param {string} right Tweede versie.
 * @returns {number} Negatief, 0 of positief (zoals bij sort).
 */
function compareVersions(left, right) {
  const leftParts = String(left || '0').split('.').map(Number);
  const rightParts = String(right || '0').split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if ((leftParts[i] || 0) !== (rightParts[i] || 0)) return (leftParts[i] || 0) - (rightParts[i] || 0);
  return 0;
}

/**
 * Een versienummer als het geldig is, anders null.
 * @param {*} value Invoer.
 * @returns {(string|null)} Bijv. '0.5.1'.
 */
function cleanVersion(value) {
  return typeof value === 'string' && VERSION.test(value) ? value : null;
}

/**
 * Een volledige commit-hash (40 hex-tekens) als hij geldig is, anders null.
 * @param {*} value Invoer.
 * @returns {(string|null)} De commit.
 */
function cleanCommit(value) {
  return typeof value === 'string' && COMMIT.test(value) ? value : null;
}

/**
 * Een ISO-tijdstip als het geldig is, anders null.
 * @param {*} value Invoer.
 * @returns {(string|null)} Tijdstip als ISO-tekst.
 */
function cleanTime(value) {
  if (typeof value !== 'string' || value.length > 40) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/**
 * Korte tekst zonder stuurtekens, afgekapt.
 * @param {*} value Invoer.
 * @param {number} max Maximale lengte.
 * @returns {string} De tekst (leeg bij geen tekst).
 */
function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
}

/**
 * Leest een klein bestand uit een gedeelde map. Een symlink, map of te groot bestand telt als afwezig.
 * @param {string} dir De map.
 * @param {string} name Bestandsnaam.
 * @returns {(string|null)} De inhoud, of null.
 */
function readSmallFile(dir, name) {
  if (!dir) return null;
  try {
    const file = path.join(dir, name);
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.size > MAX_FILE_BYTES) return null;
    return fs.readFileSync(file, 'utf8');
  } catch (_) {
    return null;
  }
}

/**
 * Leest een klein JSON-bestand (een object) uit een gedeelde map; kapot of geen object telt als afwezig.
 * @param {string} dir De map.
 * @param {string} name Bestandsnaam.
 * @returns {(object|null)} De inhoud, of null.
 */
function readJsonFile(dir, name) {
  const text = readSmallFile(dir, name);
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

/**
 * Schrijft een JSON-bestand in één keer (eerst een tijdelijk bestand, dan hernoemen), zodat de host nooit een half
 * bestand leest; hernoemen vervangt een eventuele symlink zelf in plaats van zijn doel.
 * @param {string} dir De map.
 * @param {string} name Bestandsnaam.
 * @param {object} value De inhoud.
 * @returns {void}
 */
function writeJsonFile(dir, name, value) {
  const temp = path.join(dir, `.${name}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  fs.writeFileSync(temp, `${JSON.stringify(value)}\n`, { mode: 0o644, flag: 'wx' });
  try {
    fs.renameSync(temp, path.join(dir, name));
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

/**
 * Haalt de releasenotes uit de changelog (`app/CHANGELOG.md`): kopjes `## <versie> — <datum> — <titel>` met daaronder
 * opsommingstekens. Regels die inspringen horen bij het vorige punt.
 * @param {(string|null)} text De changelog.
 * @returns {Array<{version: string, date: string, title: string, items: string[]}>} Versies, in de volgorde van het bestand.
 */
function parseChangelog(text) {
  const releases = [];
  let current = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const heading = /^##\s+(\d{1,4}\.\d{1,4}\.\d{1,4})\s*(?:[—–-]\s*([0-9-]{10}))?\s*(?:[—–-]\s*(.*))?$/.exec(line);
    if (heading) {
      if (releases.length >= LIMITS.releases) break;
      current = { version: heading[1], date: cleanText(heading[2] || '', 10), title: cleanText(heading[3] || '', LIMITS.title), items: [] };
      releases.push(current);
      continue;
    }
    if (!current || /^#/.test(line)) { if (/^#/.test(line)) current = null; continue; }
    const item = /^[-*]\s+(.*)$/.exec(line);
    if (item) {
      if (current.items.length < LIMITS.items) current.items.push(cleanText(item[1], LIMITS.text));
    } else if (/^\s+\S/.test(line) && current.items.length && current.items.length <= LIMITS.items) {
      const last = current.items.length - 1;
      current.items[last] = cleanText(`${current.items[last]} ${line.trim()}`, LIMITS.text);
    }
  }
  for (const release of releases) release.items = release.items.filter(Boolean);
  return releases;
}

/**
 * Saneert de stand van de host (status.json en run.json samen).
 * @param {(object|null)} raw Inhoud van status.json met die van run.json eroverheen.
 * @returns {object} current, currentCommit, available, availableCommit, checkedAt, state, step, version, commit,
 *   requestId, startedAt, finishedAt, message, automatic.
 */
function sanitizeStatus(raw) {
  const source = raw || {};
  return {
    current: cleanVersion(source.current),
    currentCommit: cleanCommit(source.currentCommit),
    available: cleanVersion(source.available),
    availableCommit: cleanCommit(source.availableCommit),
    checkedAt: cleanTime(source.checkedAt),
    state: STATES.includes(source.state) ? source.state : 'idle',
    step: STEPS.includes(source.step) ? source.step : null,
    version: cleanVersion(source.version),
    commit: cleanCommit(source.commit),
    requestId: typeof source.requestId === 'string' && UUID.test(source.requestId) ? source.requestId : null,
    startedAt: cleanTime(source.startedAt),
    finishedAt: cleanTime(source.finishedAt),
    message: cleanText(source.message, LIMITS.message),
    automatic: source.automatic === true,
  };
}

/**
 * Maakt de koppeling met het hostscript.
 * @param {{statusDir?: string, requestDir?: string, currentVersion: string, now?: () => number}} options De gedeelde
 *   mappen (leeg = niet ingericht op deze server, bijv. lokaal), de draaiende versie (package.json) en de klok (tests).
 * @returns {object} configured, hostMaintenance, view, request, requestCheck, cancel, setAuto en finishedRun.
 */
function createSystemUpdate({ statusDir = '', requestDir = '', currentVersion, now = () => Date.now() }) {
  const configured = Boolean(statusDir && requestDir);
  let maintenanceCache = { at: -Infinity, value: { active: false } };
  /** Laatste handmatige controle (op de seconde afgerond, zoals checkedAt van de host). */
  let lastCheckAt = 0;

  /**
   * Wijzigingstijd van run.json (stabiel zolang de host het bestand niet herschrijft).
   * @returns {(string|null)} Tijdstip als ISO-tekst, of null zonder bestand.
   */
  function runFileTime() {
    try {
      return fs.lstatSync(path.join(statusDir, 'run.json')).mtime.toISOString();
    } catch (_) {
      return null;
    }
  }

  /**
   * Leest status.json en run.json van de host. Een uitrol die te lang "bezig" is (stroomuitval, reboot) telt als
   * onderbroken, anders zou elke nieuwe aanvraag voor altijd op "er loopt al een update" stuiten.
   * @returns {object} Zie sanitizeStatus.
   */
  function hostStatus() {
    const status = sanitizeStatus({ ...(readJsonFile(statusDir, 'status.json') || {}), ...(readJsonFile(statusDir, 'run.json') || {}) });
    const started = status.startedAt ? Date.parse(status.startedAt) : NaN;
    if (status.state === 'bezig' && !(now() - started < MAINTENANCE_MAX_MS)) {
      const finishedAt = Number.isFinite(started) ? new Date(started + MAINTENANCE_MAX_MS).toISOString() : runFileTime();
      return { ...status, state: 'mislukt', step: 'klaar', finishedAt, message: 'De update is onderbroken. Controleer de server.' };
    }
    return status;
  }

  /**
   * De onderhoudsmodus van de host: aan zolang maintenance.json bestaat (en niet te oud is). Twee seconden onthouden.
   * @returns {{active: boolean, since?: string, version?: (string|null)}} De stand.
   */
  function hostMaintenance() {
    if (!configured) return { active: false };
    const time = now();
    if (time - maintenanceCache.at < CACHE_MS) return maintenanceCache.value;
    const raw = readJsonFile(statusDir, 'maintenance.json');
    let value = { active: false };
    if (raw) {
      const since = cleanTime(raw.since);
      if (since && time - Date.parse(since) < MAINTENANCE_MAX_MS) value = { active: true, since, version: cleanVersion(raw.version) };
    }
    maintenanceCache = { at: time, value };
    return value;
  }

  /**
   * De openstaande aanvraag van de app (nog niet door de host opgepakt).
   * @returns {(object|null)} id, version, commit, check, requestedAt, byName; of null.
   */
  function pending() {
    if (!configured) return null;
    const raw = readJsonFile(requestDir, 'request.json');
    if (!raw) return null;
    return {
      id: typeof raw.id === 'string' && UUID.test(raw.id) ? raw.id : '',
      version: cleanVersion(raw.version),
      commit: cleanCommit(raw.commit),
      check: raw.check === true,
      requestedAt: cleanTime(raw.requestedAt),
      byName: cleanText(raw.byName, LIMITS.name),
    };
  }

  /**
   * Alles voor het scherm in Beheer.
   * @returns {object} configured, running, status, newer, releases, pending, maintenance en checking.
   */
  function view() {
    if (!configured) return { configured: false, running: currentVersion };
    const status = hostStatus();
    const newer = Boolean(status.availableCommit && status.availableCommit !== status.currentCommit);
    // Alleen de notes tussen de draaiende en de beschikbare versie (nieuwste eerst, zoals de changelog).
    const releases = newer
      ? parseChangelog(readSmallFile(statusDir, 'changelog.md')).filter((release) => compareVersions(release.version, currentVersion) > 0
        && (!status.available || compareVersions(release.version, status.available) <= 0))
      : [];
    const request = pending();
    const checkedAtMs = status.checkedAt ? Date.parse(status.checkedAt) : 0;
    const checking = Boolean(request && request.check) || (lastCheckAt > 0 && checkedAtMs < lastCheckAt && now() - lastCheckAt < CHECK_MAX_MS);
    return {
      configured: true, running: currentVersion, status, newer, releases,
      pending: request && !request.check ? request : null, maintenance: hostMaintenance(), checking,
    };
  }

  /**
   * Zet de aanvraag "installeer deze commit" klaar voor de host.
   * @param {{commit: string, byName: string}} input De commit uit het formulier (moet de beschikbare zijn) en wie.
   * @returns {({request: object}|{error: string, status: number, message: string})} De aanvraag of een fout.
   */
  function request({ commit, byName }) {
    if (!configured) return { error: 'not_configured', status: 501, message: 'Updaten vanuit de app is op deze server niet ingericht.' };
    const current = view();
    if (current.maintenance.active || current.status.state === 'bezig') return { error: 'busy', status: 409, message: 'Er loopt al een update.' };
    if (current.pending) return { error: 'pending', status: 409, message: 'De update is al aangevraagd en start zo.' };
    if (!current.newer) return { error: 'no_update', status: 409, message: 'Er is geen nieuwere versie beschikbaar.' };
    if (cleanCommit(commit) !== current.status.availableCommit) return { error: 'changed', status: 409, message: 'Er staat intussen een andere versie klaar. Vernieuw de pagina.' };
    const entry = {
      id: crypto.randomUUID(), commit: current.status.availableCommit, version: current.status.available,
      requestedAt: new Date(now()).toISOString(), byName: cleanText(byName, LIMITS.name),
    };
    writeJsonFile(requestDir, 'request.json', entry);
    return { request: entry };
  }

  /**
   * Vraagt de host om nu naar een nieuwe versie te kijken (er wordt niets geïnstalleerd). Een lopende of net
   * aangevraagde controle wordt hergebruikt, zodat niemand de host kan overspoelen.
   * @param {{byName: string}} input Wie.
   * @returns {({started: boolean}|{error: string, status: number, message: string})} Gestart of hergebruikt, of een fout.
   */
  function requestCheck({ byName }) {
    if (!configured) return { error: 'not_configured', status: 501, message: 'Updaten vanuit de app is op deze server niet ingericht.' };
    const current = view();
    if (current.maintenance.active || current.status.state === 'bezig') return { error: 'busy', status: 409, message: 'Er loopt al een update.' };
    if (current.pending) return { error: 'pending', status: 409, message: 'Er staat al een update aangevraagd.' };
    if (current.checking || (lastCheckAt > 0 && now() - lastCheckAt < CHECK_MIN_GAP_MS)) return { started: false };
    lastCheckAt = Math.floor(now() / 1000) * 1000;
    writeJsonFile(requestDir, 'request.json', { id: crypto.randomUUID(), check: true, requestedAt: new Date(now()).toISOString(), byName: cleanText(byName, LIMITS.name) });
    return { started: true };
  }

  /**
   * Trekt een update-aanvraag in die de host nog niet heeft opgepakt.
   * @returns {(object|null)} De ingetrokken aanvraag, of null als er geen was.
   */
  function cancel() {
    const current = configured ? pending() : null;
    if (!current || current.check) return null;
    fs.rmSync(path.join(requestDir, 'request.json'), { force: true });
    return current;
  }

  /**
   * Zet automatisch bijwerken aan of uit voor de host (policy.json, een kopie van de instelling `updateAuto`).
   * Schrijft alleen als de stand verschilt; een schrijffout komt in het log.
   * @param {boolean} enabled true = aan.
   * @returns {boolean} true als het bestand is (her)schreven.
   */
  function setAuto(enabled) {
    if (!configured) return false;
    const raw = readJsonFile(requestDir, 'policy.json');
    if (raw && raw.auto === (enabled === true)) return false;
    try {
      writeJsonFile(requestDir, 'policy.json', { auto: enabled === true });
      return true;
    } catch (error) {
      // Map niet schrijfbaar (verkeerde eigenaar): de host gaat dan uit van "aan"; zichtbaar in het log, nooit een crash.
      console.warn(`Updates: automatisch bijwerken niet door te geven aan de server (${error.code || 'fout'}).`);
      return false;
    }
  }

  /**
   * Een afgeronde uitrol die nog niet in het auditlog staat (één keer per afronding; de app onthoudt in de
   * aanvraagmap welke al is vastgelegd).
   * @returns {(object|null)} De status van die uitrol, of null.
   */
  function finishedRun() {
    if (!configured) return null;
    const status = hostStatus();
    if (!['geslaagd', 'mislukt', 'geweigerd'].includes(status.state) || !status.finishedAt) return null;
    const key = `${status.finishedAt}|${status.requestId || ''}`;
    const seen = readJsonFile(requestDir, 'audited.json');
    if (seen && seen.key === key) return null;
    try {
      writeJsonFile(requestDir, 'audited.json', { key });
    } catch (_) {
      return null; // niet kunnen onthouden: liever niet vastleggen dan bij elke vraag opnieuw
    }
    return status;
  }

  return { configured, hostMaintenance, view, request, requestCheck, cancel, setAuto, finishedRun };
}

module.exports = {
  createSystemUpdate, compareVersions, parseChangelog, sanitizeStatus, readJsonFile, readSmallFile, writeJsonFile,
  cleanTime, cleanText, MAINTENANCE_MAX_MS,
};
