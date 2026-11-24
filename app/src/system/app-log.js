/**
 * Logboek van de app (tabel `app_logs`, Beheer > Systeem > Logboek): één plek voor
 * fouten (met foutcode), trage verzoeken, waarschuwingen en fouten van achtergrondtaken (via de console) en later de
 * bewaking. Elk verzoek krijgt een request-id (kop `X-Request-Id`) waarmee alles van één verzoek terug te vinden is.
 *
 * - Schrijven gaat gebufferd (elke 2 seconden of bij 50 regels) en nooit in het verzoekpad; een databasefout breekt
 *   nooit een verzoek: de regels gaan dan alleen naar de console.
 * - Begrenzing: identieke regels in de buffer worden één regel met een teller, per bron hoogstens 300 regels per
 *   minuut, en een harde bovengrens aan het aantal rijen; oudere regels gaan weg na de bewaartermijn (`logRetentionDays`).
 * - Privacy: elke tekst gaat door `cleanText` (wachtwoorden in URL's, tokens, sleutels, e-mailadressen, IBAN's eruit);
 *   gevoelige sleutels krijgen nooit hun waarde mee; nooit lichamen, koppen, cookies of querystrings, en paden worden
 *   genormaliseerd (id's en tokens vervangen).
 */
const crypto = require('node:crypto');
const path = require('node:path');
const util = require('node:util');

const LEVELS = ['info', 'warn', 'error'];

/**
 * Leesbare namen van de bronnen in het logboek (Beheer > Logboek: kolom Bron en het filter). Wie een nieuwe bron gaat
 * schrijven, zet hem hier bij; een onbekende bron krijgt via `sourceLabel` een hoofdletter.
 */
const SOURCE_LABELS = {
  fout: 'Fout (foutcode)',
  traag: 'Traag verzoek',
  app: 'Achtergrond',
  proces: 'Proces',
  bewaking: 'Bewaking',
  fotobibliotheek: 'Fotobibliotheek',
  mail: 'Mail',
  menu: "Menu's",
  mollie: 'Online betalen',
  overzicht: 'Overzicht',
  wachtwoordcontrole: 'Wachtwoordcontrole',
};

/**
 * Leesbare naam van een bron in het logboek.
 * @param {string} source Bron zoals opgeslagen (kleine letters, cijfers en streepjes).
 * @returns {string} De naam uit `SOURCE_LABELS`, anders de bron met een hoofdletter en spaties voor streepjes.
 */
function sourceLabel(source) {
  if (Object.hasOwn(SOURCE_LABELS, source)) return SOURCE_LABELS[source];
  const text = String(source || '').replace(/-/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
const MAX_MESSAGE = 500;
const MAX_DATA = 4000;
const MAX_FRAMES = 12;
const MAX_ROWS = 100000;
const SOURCE_DIR = path.join(__dirname, '..');
const SENSITIVE_KEY = /pass|wachtwoord|token|secret|authorization|cookie|api[_-]?key|iban|email|e-mail|geboorte|paspoort|medisch/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g;
/** Bekende vormen van geheimen die in een foutmelding terecht kunnen komen. */
const SECRET_PATTERNS = [
  [/(\b[a-z][a-z0-9+.-]{0,30}:\/\/[^:/?#\s@]*:)[^@/\s]+@/gi, '$1***@'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, '$1 ***'],
  [/(password|passwd|wachtwoord|secret|token|api[_-]?key|access[_-]?code|client_secret|refresh_token)(["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi, '$1$2***'],
  [/\b[0-9a-f]{64}\b/gi, '***'],
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMBER = /^\d+$/;
const TOKEN = /^[A-Za-z0-9_.-]{20,}$/;

/**
 * Haalt geheimen, e-mailadressen en IBAN's uit een tekst, maakt stuurtekens spaties en kort hem in.
 * @param {*} value De tekst (andere waarden worden tekst).
 * @param {number} [maxLength] Maximale lengte.
 * @returns {string} De schone tekst.
 */
function cleanText(value, maxLength = MAX_MESSAGE) {
  let text = String(value ?? '').slice(0, maxLength * 4);
  for (const [pattern, replacement] of SECRET_PATTERNS) text = text.replace(pattern, replacement);
  // eslint-disable-next-line no-control-regex
  return text.replace(EMAIL, '***@***').replace(IBAN, 'IBAN-***').replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, maxLength);
}

/**
 * Maakt een object veilig voor het logboek: teksten door `cleanText`, gevoelige sleutels '***', diepte en lengte begrensd.
 * @param {*} value De waarde.
 * @param {number} [depth] Resterende diepte.
 * @returns {*} De schone kopie.
 */
function cleanData(value, depth = 3) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return cleanText(value, 300);
  if (depth <= 0) return '…';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => cleanData(item, depth - 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 30)) out[key] = SENSITIVE_KEY.test(key) ? '***' : cleanData(item, depth - 1);
    return out;
  }
  return cleanText(String(value), 100);
}

/**
 * Vervangt wat in een pad per bezoeker verschilt (id's, nummers, tokens, e-mailadressen) door een vaste aanduiding en
 * laat de querystring weg, zodat het logboek groepeert en geen persoonsgegevens of geheimen bevat.
 * @param {string} rawUrl Adres van het verzoek.
 * @returns {string} Bijvoorbeeld `/app/gebruikers/:id/`.
 */
function normalizePath(rawUrl) {
  const pathOnly = String(rawUrl || '').split('?')[0].split('#')[0].slice(0, 500);
  return pathOnly.split('/').map((segment) => {
    if (!segment) return segment;
    if (UUID.test(segment) || NUMBER.test(segment)) return ':id';
    if (/[@%]/.test(segment)) return ':waarde';
    if (TOKEN.test(segment) && (/\d/.test(segment) || segment.length >= 32)) return ':token';
    return segment.length > 60 ? ':waarde' : segment;
  }).join('/') || '/';
}

/**
 * De regels van een stacktrace die bij de eigen code horen, met paden vanaf `app/src` (zonder node_modules en Node zelf).
 * @param {string} stack Stacktrace.
 * @returns {string[]} Bijvoorbeeld `beheer/routes.js:120:9 (renderOverview)`.
 */
function ownFrames(stack) {
  const frames = [];
  for (const line of String(stack || '').split('\n')) {
    const match = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
    if (!match) continue;
    const [, functionName, file, lineNumber, column] = match;
    if (!file.startsWith(SOURCE_DIR + path.sep) || file.includes(`${path.sep}node_modules${path.sep}`)) continue;
    frames.push(`${path.relative(SOURCE_DIR, file).split(path.sep).join('/')}:${lineNumber}:${column}${functionName ? ` (${cleanText(functionName, 80)})` : ''}`);
    if (frames.length >= MAX_FRAMES) break;
  }
  return frames;
}

/**
 * Of een fout van PostgreSQL komt (`pg`): een SQLSTATE-code van vijf tekens met de velden die `pg` meegeeft.
 * @param {object} error De fout.
 * @returns {boolean} Waar bij een databasefout.
 */
function isDatabaseError(error) {
  return typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)
    && ['severity', 'detail', 'table', 'constraint', 'routine', 'where'].some((field) => field in error);
}

/**
 * De melding van een databasefout zonder de tekst: die kan veldwaarden bevatten (`Key (naam)=(Jansen)`, `invalid input
 * syntax for type date: "..."`). Alleen de code, de constraint, de tabel en de kolom blijven over.
 * @param {object} error Een fout van `pg`.
 * @returns {string} Bijvoorbeeld `Databasefout 23505 (constraint users_email_key, tabel users)`.
 */
function databaseMessage(error) {
  const name = (value) => (typeof value === 'string' && /^[a-z_][a-z0-9_]{0,62}$/i.test(value) ? value : '');
  const parts = [
    name(error.constraint) && `constraint ${name(error.constraint)}`,
    name(error.table) && `tabel ${name(error.table)}`,
    name(error.column) && `kolom ${name(error.column)}`,
  ].filter(Boolean);
  return `Databasefout ${error.code}${parts.length ? ` (${parts.join(', ')})` : ''}`;
}

/**
 * Beschrijft een fout zonder geheimen: soort, melding, databasecode en plek in de eigen code.
 * @param {*} error De fout.
 * @returns {{name: string, message: string, code: string, frames: string[]}} De beschrijving.
 */
function describeError(error) {
  const source = error && typeof error === 'object' ? error : { message: String(error) };
  return {
    name: cleanText(source.name || 'Error', 60),
    message: isDatabaseError(source) ? databaseMessage(source) : cleanText(source.message || '', MAX_MESSAGE),
    code: typeof source.code === 'string' ? cleanText(source.code, 20) : '',
    frames: ownFrames(source.stack),
  };
}

/**
 * Een nieuwe korte foutcode (8 hex-tekens).
 * @returns {string} De code.
 */
function newErrorCode() {
  return crypto.randomBytes(4).toString('hex');
}

/**
 * Een nieuwe request-id (12 hex-tekens). Een id van buiten wordt nooit overgenomen.
 * @returns {string} De id.
 */
function newRequestId() {
  return crypto.randomBytes(6).toString('hex');
}

/**
 * Maakt de details van een logregel schoon: duur begrensd tot een geheel aantal ms, gegevens als JSON zonder
 * gevoelige velden (te groot = alleen `afgekapt`), foutcode en verzoek-id alleen in hun vaste vorm.
 * @param {{requestId: string, errorCode: string, durationMs: number, data: (object|null)}} details Ruwe details.
 * @returns {{duration: number, json: string, cleanCode: string, cleanRequest: string}} Schone details.
 */
function cleanDetails({ requestId, errorCode, durationMs, data }) {
  const duration = Math.max(0, Math.min(2147483647, Math.round(Number(durationMs) || 0)));
  let json = data ? JSON.stringify(cleanData(data)) : '{}';
  if (json.length > MAX_DATA) json = JSON.stringify({ afgekapt: true });
  const cleanCode = /^[0-9a-f]{8}$/.test(errorCode) ? errorCode : '';
  const cleanRequest = /^[0-9a-f]{12}$/.test(requestId) ? requestId : '';
  return { duration, json, cleanCode, cleanRequest };
}

/**
 * Maakt het logboek.
 * @param {{db: object, settings?: object, flushMs?: number, batchSize?: number, perMinuteLimit?: number, now?: () => number, write?: Function}} options
 *   Database, instellingen (`logRetentionDays`), hoe vaak de buffer naar de database gaat (0 = alleen met `flush()`),
 *   bij hoeveel regels er meteen wordt weggeschreven, de grens per bron per minuut, de klok en de terugval als de
 *   database faalt (standaard de oorspronkelijke console.error).
 * @returns {object} `log`, `info`, `warn`, `error`, `flush`, `prune`, `start`, `stop`, `captureConsole`, `pending`.
 */
function createAppLog({ db, settings, flushMs = 2000, batchSize = 50, perMinuteLimit = 300, now = () => Date.now(), write }) {
  const fallback = write || console.error.bind(console);
  let buffer = [];
  const bySource = new Map();
  const timers = [];
  let flushing = null;
  let flushScheduled = false;
  let restoreConsole = null;

  /**
   * Of deze bron de grens per minuut al haalt (en telt mee). Fouten tellen apart, met een dubbele grens.
   * @param {string} source Bron.
   * @param {string} level Niveau.
   * @returns {boolean} true als de regel weg moet.
   */
  function limited(source, level) {
    const minute = Math.floor(now() / 60000);
    const key = `${source}|${level === 'error' ? 'error' : 'overig'}`;
    const state = bySource.get(key);
    if (!state || state.minute !== minute) {
      bySource.set(key, { minute, count: 1 });
      return false;
    }
    state.count += 1;
    return state.count > (level === 'error' ? perMinuteLimit * 2 : perMinuteLimit);
  }

  /**
   * Legt een regel vast (gebufferd). Gooit nooit.
   * @param {('info'|'warn'|'error')} level Niveau.
   * @param {string} source Bron, bijv. `fout`, `traag`, `app`, `proces`, `bewaking`.
   * @param {string} message Korte melding (wordt geschoond en afgekapt).
   * @param {{requestId?: string, errorCode?: string, durationMs?: number, data?: object}} [details] Details.
   * @returns {void}
   */
  function log(level, source, message, { requestId = '', errorCode = '', durationMs = 0, data = null } = {}) {
    try {
      const cleanLevel = LEVELS.includes(level) ? level : 'info';
      const cleanSource = String(source || 'app').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30) || 'app';
      if (limited(cleanSource, cleanLevel)) return;
      const text = cleanText(message) || '(geen melding)';
      const { duration, json, cleanCode, cleanRequest } = cleanDetails({ requestId, errorCode, durationMs, data });
      // Herhalingen zonder eigen foutcode of verzoek worden één regel met een teller.
      const key = cleanCode || cleanRequest ? null : `${cleanSource}|${cleanLevel}|${text}`;
      const same = key ? buffer.find((row) => row.key === key) : null;
      const at = new Date(now());
      if (same) {
        same.repeat += 1;
        same.at = at;
        same.durationMs = Math.max(same.durationMs, duration);
        return;
      }
      buffer.push({ key, first: at, at, level: cleanLevel, source: cleanSource, requestId: cleanRequest, errorCode: cleanCode, message: text, data: json, durationMs: duration, repeat: 1 });
      if (buffer.length >= batchSize && !flushScheduled) {
        flushScheduled = true;
        setImmediate(() => { flushScheduled = false; flush(); });
      }
    } catch (_) { /* het logboek mag nooit een verzoek of taak breken */ }
  }

  /**
   * Schrijft de buffer in één keer naar de database. Mislukt dat, dan gaan de regels naar de console (niet opnieuw).
   * @returns {Promise<number>} Aantal weggeschreven regels.
   */
  async function flush() {
    if (flushing) await flushing.catch(() => {});
    if (!buffer.length) return 0;
    const rows = buffer;
    buffer = [];
    const params = [];
    const values = rows.map((row) => {
      params.push(row.at, row.repeat > 1 ? row.first : null, row.level, row.source, row.requestId, row.errorCode, row.message, row.data, row.durationMs, row.repeat);
      const offset = params.length - 10;
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}::jsonb, $${offset + 9}, $${offset + 10})`;
    });
    flushing = db.query(`INSERT INTO app_logs (created_at, first_at, level, source, request_id, error_code, message, data, duration_ms, repeat_count) VALUES ${values.join(', ')}`, params);
    try {
      await flushing;
      return rows.length;
    } catch (error) {
      fallback(`Logboek: wegschrijven mislukt (${cleanText(error.message, 200)}); ${rows.length} regel(s) alleen in de console.`);
      for (const row of rows) fallback(`[${row.level}] [${row.source}] ${row.errorCode ? `foutcode ${row.errorCode} ` : ''}${row.message}`);
      return 0;
    } finally {
      flushing = null;
    }
  }

  /**
   * Ruimt op: regels ouder dan de bewaartermijn, en alles boven de harde bovengrens (oudste eerst).
   * @returns {Promise<void>}
   */
  async function prune() {
    const days = settings ? Number(settings.get('logRetentionDays')) || 30 : 30;
    await db.query('DELETE FROM app_logs WHERE created_at < now() - make_interval(days => $1)', [days]);
    await db.query('DELETE FROM app_logs WHERE id < (SELECT id FROM app_logs ORDER BY id DESC OFFSET $1 LIMIT 1)', [MAX_ROWS]);
  }

  /**
   * Start het wegschrijven (elke `flushMs`) en de dagelijkse opschoning.
   * @returns {void}
   */
  function start() {
    if (flushMs > 0) timers.push(setInterval(() => { flush(); }, flushMs).unref());
    const runPrune = () => prune().catch((error) => fallback(`Logboek opschonen mislukt: ${cleanText(error.message, 200)}`));
    runPrune();
    timers.push(setInterval(runPrune, 24 * 60 * 60 * 1000).unref());
  }

  /**
   * Stopt de timers, zet de console terug en schrijft de rest weg.
   * @returns {Promise<void>}
   */
  async function stop() {
    for (const timer of timers.splice(0)) clearInterval(timer);
    if (restoreConsole) restoreConsole();
    await flush();
  }

  /**
   * Stuurt `console.warn` en `console.error` ook naar het logboek (bron `app`), zodat fouten van achtergrondtaken
   * (back-ups, Google Drive, mail) zichtbaar zijn. De console zelf blijft werken; een fout van het logboek zelf gaat
   * niet opnieuw het logboek in.
   * @returns {Function} Zet de console terug.
   */
  function captureConsole() {
    if (restoreConsole) return restoreConsole;
    const original = { warn: console.warn, error: console.error };
    let inside = false;
    const wrap = (level, method) => (...args) => {
      method.apply(console, args);
      if (inside) return;
      inside = true;
      try { log(level, 'app', util.format(...args)); } finally { inside = false; }
    };
    console.warn = wrap('warn', original.warn);
    console.error = wrap('error', original.error);
    restoreConsole = () => {
      console.warn = original.warn;
      console.error = original.error;
      restoreConsole = null;
    };
    return restoreConsole;
  }

  return {
    log,
    info: (source, message, details) => log('info', source, message, details),
    warn: (source, message, details) => log('warn', source, message, details),
    error: (source, message, details) => log('error', source, message, details),
    flush, prune, start, stop, captureConsole,
    pending: () => buffer.length,
  };
}

module.exports = { createAppLog, cleanText, cleanData, normalizePath, ownFrames, describeError, newErrorCode, newRequestId, LEVELS, MAX_ROWS, SOURCE_LABELS, sourceLabel };
