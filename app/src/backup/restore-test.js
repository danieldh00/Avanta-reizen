/**
 * Hersteltests van de back-ups (Beheer > Back-ups en herstel > Hersteltest, pakket C3).
 *
 * 1. **Op de server** (wekelijks): de app voert die niet zelf uit. Het hostscript `deploy/apps01/restore-test.sh` zet
 *    de nieuwste back-up terug in een wegwerpdatabase (eigen container, intern netwerk zonder uitgang), start daarop een
 *    wegwerp-app en vergelijkt de rijen per tabel met de echte database. De uitslag komt via
 *    `node src/backup/cli.js restore-test-result` (JSON op stdin) in `restore-test.json` in de back-upmap; alles wordt
 *    hier opnieuw gecontroleerd en begrensd. *Nu testen* zet het bestand `restore-test-now` neer; een systemd-path-unit
 *    op de host start dan het script (dat het bestand meteen weghaalt).
 * 2. **Google Drive-kopie** (in de app, wekelijks en op verzoek): de nieuwste back-up op Drive downloaden, volledig
 *    ontsleutelen en controleren (tag + PostgreSQL-dump) en vergelijken met de lokale back-up met dezelfde naam. Uitslag
 *    in `drive-restore-test.json`.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { isBackupName, verifyBackup } = require('./backups');

const HOST_FILE = 'restore-test.json';
const DRIVE_FILE = 'drive-restore-test.json';
const REQUEST_FILE = 'restore-test-now';
const STATES = ['bezig', 'geslaagd', 'waarschuwing', 'mislukt'];
const TRIGGERS = ['schema', 'handmatig'];
const MAX_RUNS = 12;
/** Een verschil in rijen boven dit percentage (en boven ROW_TOLERANCE_MIN rijen) geeft een waarschuwing. */
const ROW_TOLERANCE_PCT = 25;
const ROW_TOLERANCE_MIN = 20;
/** Een run die zo lang "bezig" is, telt als afgebroken. */
const RUNNING_MAX_MS = 60 * 60 * 1000;
/** De Drive-kopie wordt automatisch eens per zoveel tijd getest. */
const DRIVE_TEST_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Een tijdstip als ISO-tekst, of leeg.
 * @param {*} value Invoer.
 * @returns {string} ISO-tekst.
 */
function isoOrEmpty(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : '';
}

/**
 * Korte tekst zonder stuurtekens.
 * @param {*} value Invoer.
 * @param {number} [max] Hoogste lengte.
 * @returns {string} Tekst.
 */
function cleanText(value, max = 300) {
  // eslint-disable-next-line no-control-regex
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
}

/**
 * Leest rijtellingen in de vorm `tabel=aantal,tabel=aantal` (uitvoer van psql in het hostscript).
 * @param {*} text Invoer.
 * @returns {Object<string, number>} Aantal per tabel (alleen geldige namen en getallen, hoogstens 200 tabellen).
 */
function parseCounts(text) {
  const counts = {};
  for (const part of String(text || '').split(',').slice(0, 200)) {
    const match = /^([a-z_][a-z0-9_]{0,62})=(\d{1,12})$/.exec(part.trim());
    if (match) counts[match[1]] = Number(match[2]);
  }
  return counts;
}

/**
 * De gecontroleerde basisgegevens van een run uit de invoer van het hostscript, nog zonder uitslag.
 * @param {object} input Invoer (al gecontroleerd op een object).
 * @param {number} now Huidig tijdstip in ms.
 * @returns {object} De run met state `mislukt`, zonder tabellen of verschillen.
 */
function baseRun(input, now) {
  return {
    state: 'mislukt',
    trigger: TRIGGERS.includes(input.trigger) ? input.trigger : 'schema',
    startedAt: isoOrEmpty(input.startedAt) || new Date(now).toISOString(),
    finishedAt: '',
    backup: isBackupName(input.backup) ? input.backup : '',
    schemaVersion: Number.isInteger(input.schemaVersion) && input.schemaVersion >= 0 ? input.schemaVersion : null,
    tables: 0,
    rows: 0,
    differences: [],
    appOk: input.appOk === true,
    message: cleanText(input.message),
  };
}

/**
 * Vergelijkt de aantallen rijen per tabel van de teruggezette database met die van nu. Een tabel die maar aan één
 * kant bestaat, telt altijd als verschil; anders alleen een afwijking boven beide toleranties.
 * @param {Object<string, number>} restored Aantallen in de teruggezette database.
 * @param {Object<string, number>} live Aantallen nu.
 * @returns {Array<{table: string, restored: (number|null), live: (number|null)}>} Hoogstens tien verschillen.
 */
function rowDifferences(restored, live) {
  const differences = [];
  for (const table of Object.keys({ ...live, ...restored }).sort()) {
    const before = restored[table];
    const current = live[table];
    if (before === undefined || current === undefined) {
      differences.push({ table, restored: before ?? null, live: current ?? null });
      continue;
    }
    const difference = Math.abs(current - before);
    if (difference > ROW_TOLERANCE_MIN && difference > (Math.max(current, before) * ROW_TOLERANCE_PCT) / 100) {
      differences.push({ table, restored: before, live: current });
    }
  }
  return differences.slice(0, 10);
}

/**
 * Bepaalt de uitslag van een hersteltest op de server uit wat het hostscript aanlevert.
 * @param {object} raw Invoer van het hostscript: `state` (`bezig`/`mislukt`) of de metingen (`restored`, `live`, `appOk`).
 * @param {number} [now] Huidig tijdstip in ms.
 * @returns {object} De run: state, trigger, tijden, back-up, schemaversie, tabellen, verschillen, appOk, melding.
 */
function evaluateRun(raw, now = Date.now()) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const run = baseRun(input, now);
  if (input.state === 'bezig') return { ...run, state: 'bezig', message: run.message || 'Hersteltest loopt.' };
  run.finishedAt = new Date(now).toISOString();
  if (input.state === 'mislukt') return { ...run, message: run.message || 'Hersteltest mislukt.' };
  const restored = parseCounts(input.restored);
  const live = parseCounts(input.live);
  run.tables = Object.keys(restored).length;
  run.rows = Object.values(restored).reduce((sum, count) => sum + count, 0);
  if (!run.tables) return { ...run, message: 'Er staan geen tabellen in de teruggezette database.' };
  if (!run.appOk) {
    // De reden komt van het hostscript (geheugenlimiet, eigen foutmelding van de app, geen antwoord), zonder gegevens.
    const reason = run.message ? `: ${run.message}` : '.';
    return { ...run, message: `De app start niet op de teruggezette database${reason}` };
  }
  run.differences = rowDifferences(restored, live);
  run.state = run.differences.length ? 'waarschuwing' : 'geslaagd';
  run.message = run.differences.length
    ? 'Teruggezet en de app start, maar het aantal rijen wijkt sterk af van nu (zie verschillen).'
    : 'Teruggezet, de app start en de aantallen kloppen.';
  return run;
}

/**
 * Leest een lijst runs uit een bestand in de back-upmap, opnieuw gecontroleerd.
 * @param {string} dir Back-upmap.
 * @param {string} file Bestandsnaam.
 * @param {number} [now] Huidig tijdstip in ms (een te lang lopende run telt als afgebroken).
 * @returns {object[]} Runs, nieuwste eerst.
 */
function readRuns(dir, file, now = Date.now()) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  } catch (_) {
    return [];
  }
  return (Array.isArray(parsed && parsed.runs) ? parsed.runs : []).slice(0, MAX_RUNS).filter((run) => run && STATES.includes(run.state) && isoOrEmpty(run.startedAt)).map((run) => {
    const clean = {
      state: run.state,
      trigger: TRIGGERS.includes(run.trigger) ? run.trigger : 'schema',
      startedAt: isoOrEmpty(run.startedAt),
      finishedAt: isoOrEmpty(run.finishedAt),
      backup: isBackupName(run.backup) ? run.backup : '',
      schemaVersion: Number.isInteger(run.schemaVersion) ? run.schemaVersion : null,
      tables: Math.max(0, Math.floor(Number(run.tables) || 0)),
      rows: Math.max(0, Math.floor(Number(run.rows) || 0)),
      differences: (Array.isArray(run.differences) ? run.differences : []).slice(0, 10)
        .filter((entry) => entry && /^[a-z_][a-z0-9_]{0,62}$/.test(entry.table))
        .map((entry) => ({ table: entry.table, restored: Number.isInteger(entry.restored) ? entry.restored : null, live: Number.isInteger(entry.live) ? entry.live : null })),
      appOk: run.appOk === true,
      message: cleanText(run.message),
    };
    if (clean.state === 'bezig' && now - Date.parse(clean.startedAt) > RUNNING_MAX_MS) {
      return { ...clean, state: 'mislukt', message: 'Afgebroken (duurde langer dan een uur).' };
    }
    return clean;
  });
}

/**
 * Voegt een run toe (of vervangt de lopende run met hetzelfde begintijdstip) en schrijft het bestand in één keer.
 * @param {string} dir Back-upmap.
 * @param {string} file Bestandsnaam.
 * @param {object} run De run.
 * @returns {void}
 */
function saveRun(dir, file, run) {
  const runs = readRuns(dir, file).filter((existing) => existing.startedAt !== run.startedAt);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temporary = path.join(dir, `.${file}.${process.pid}.tmp`);
  fs.writeFileSync(temporary, JSON.stringify({ runs: [run, ...runs].slice(0, MAX_RUNS) }), { mode: 0o600 });
  fs.renameSync(temporary, path.join(dir, file));
}

/**
 * Legt een uitslag van het hostscript vast.
 * @param {string} dir Back-upmap.
 * @param {object} raw Invoer van het hostscript.
 * @param {number} [now] Huidig tijdstip in ms.
 * @returns {object} De vastgelegde run.
 */
function recordHostRun(dir, raw, now = Date.now()) {
  const run = evaluateRun(raw, now);
  saveRun(dir, HOST_FILE, run);
  return run;
}

/**
 * Hash van een bestand.
 * @param {string} file Pad.
 * @returns {Promise<string>} SHA-256 (hex).
 */
async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/**
 * Maakt de hersteltests voor de app.
 * @param {{dir: string, masterKey: Buffer, previousKeys?: Buffer[], drive?: object, now?: () => number}} options Back-upmap, hoofdsleutel (en vorige sleutels voor oudere back-ups), de
 *   Drive-koppeling (`backup/drive.js`) en de klok (tests).
 * @returns {object} `hostRuns`, `requestHostTest`, `hostRequested`, `driveRuns`, `runDriveTest`, `driveTestIfDue`,
 *   `startTimer`, `driveRunning`.
 */
function createRestoreTests(options) {
  const { dir, masterKey, drive } = options;
  const now = options.now || Date.now;
  let driveRunning = null;

  /**
   * Test de nieuwste back-up op Google Drive: downloaden, volledig ontsleutelen en controleren, en vergelijken met de
   * lokale back-up met dezelfde naam. Het gedownloade bestand wordt altijd weer verwijderd.
   * @param {{trigger?: string}} [context] Aanleiding (`schema` of `handmatig`).
   * @returns {Promise<object>} De run.
   */
  const runDriveTest = (context = {}) => {
    if (driveRunning) return driveRunning;
    driveRunning = (async () => {
      const run = {
        state: 'mislukt', trigger: TRIGGERS.includes(context.trigger) ? context.trigger : 'schema', startedAt: new Date(now()).toISOString(),
        finishedAt: '', backup: '', schemaVersion: null, tables: 0, rows: 0, differences: [], appOk: false, message: '',
      };
      const target = path.join(dir, `.drive-hersteltest-${crypto.randomBytes(6).toString('hex')}.part`);
      try {
        if (!drive || !drive.connected()) throw new Error('Google Drive is niet gekoppeld.');
        const [newest] = await drive.listRemote();
        if (!newest) throw new Error('Er staat nog geen back-up op Google Drive.');
        run.backup = newest.name;
        await drive.download(newest.name, target);
        const { bytes } = await verifyBackup(target, [masterKey, ...(options.previousKeys || [])]);
        const local = path.join(dir, newest.name);
        let same = '';
        if (fs.existsSync(local)) same = (await sha256(local)) === (await sha256(target)) ? ' en is identiek aan de back-up op de server' : '';
        if (fs.existsSync(local) && !same) {
          run.state = 'waarschuwing';
          run.message = 'De Drive-kopie is leesbaar, maar wijkt af van de back-up met dezelfde naam op de server.';
        } else {
          run.state = 'geslaagd';
          run.message = `De Drive-kopie is te ontsleutelen, bevat een volledige database-dump (${Math.round(bytes / 1024)} kB)${same}.`;
        }
      } catch (error) {
        run.message = cleanText(error.message);
      } finally {
        fs.rmSync(target, { force: true });
        run.finishedAt = new Date(now()).toISOString();
        saveRun(dir, DRIVE_FILE, run);
      }
      return run;
    })().finally(() => { driveRunning = null; });
    return driveRunning;
  };

  /**
   * Test de Drive-kopie als de vorige test langer dan een week geleden is (alleen als Drive aan staat en gekoppeld is).
   * @param {boolean} enabled Of de kopie naar Drive aan staat.
   * @returns {Promise<(object|null)>} De run, of null als het niet nodig was.
   */
  const driveTestIfDue = async (enabled) => {
    if (!enabled || !drive || !drive.connected()) return null;
    const [last] = readRuns(dir, DRIVE_FILE, now());
    if (last && now() - Date.parse(last.startedAt) < DRIVE_TEST_EVERY_MS) return null;
    return runDriveTest({ trigger: 'schema' });
  };

  return {
    hostRuns: () => readRuns(dir, HOST_FILE, now()),
    driveRuns: () => readRuns(dir, DRIVE_FILE, now()),
    /**
     * Vraagt een hersteltest op de server aan (de path-unit op de host start het script).
     * @returns {void}
     */
    requestHostTest: () => {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(dir, REQUEST_FILE), new Date(now()).toISOString(), { mode: 0o600 });
    },
    hostRequested: () => fs.existsSync(path.join(dir, REQUEST_FILE)),
    driveRunning: () => Boolean(driveRunning),
    runDriveTest,
    driveTestIfDue,
    /**
     * Start de planner voor de Drive-test: elke zes uur kijken of de wekelijkse test aan de beurt is.
     * @param {() => boolean} isEnabled Of de kopie naar Drive aan staat.
     * @returns {NodeJS.Timeout} De timer.
     */
    startTimer: (isEnabled) => setInterval(() => driveTestIfDue(isEnabled()).catch(() => {}), 6 * 60 * 60 * 1000).unref(),
  };
}

module.exports = { createRestoreTests, evaluateRun, parseCounts, recordHostRun, readRuns, HOST_FILE, DRIVE_FILE, REQUEST_FILE };
