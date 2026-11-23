/**
 * Controle op gelekte en veelgebruikte wachtwoorden (audit A09, ASVS 2.1.7) voor het CRM en het reizigersaccount.
 *
 * Een nieuw wachtwoord gaat door drie controles, in deze volgorde:
 * 1. De vaste regels uit `crm/passwords.js` (`passwordProblem`: lengte, niet het e-mailadres, genoeg verschillende tekens).
 * 2. Een lokale controle zonder netwerk (`commonPasswordProblem`): een veelgebruikt woord met alleen cijfers of tekens
 *    eromheen (`Wachtwoord2026!`), een toetsenbord- of telreeks (`1234567890ab`, `qwertyuiop12`) of de naam van de site.
 * 3. Als de instelling `passwordBreachCheck` aan staat: Have I Been Pwned met k-anonimiteit. Alleen de eerste 5 tekens
 *    van de SHA-1 van het wachtwoord gaan naar `api.pwnedpasswords.com`; de dienst geeft alle bekende hashes met dat
 *    begin terug (aangevuld met nepregels, `Add-Padding`), en de vergelijking gebeurt hier. Het wachtwoord en de volledige
 *    hash verlaten de server nooit.
 *
 * Is de dienst niet bereikbaar, dan geldt alleen de lokale controle: niemand kan dan zijn wachtwoord niet wijzigen
 * omdat een externe dienst plat ligt. Dat komt (hoogstens eens per kwartier) in het logboek onder bron
 * `wachtwoordcontrole`, en de laatste uitkomsten staan in Beheer > Toegang en beveiliging > Wachtwoorden. Uitkomsten
 * bewaren nooit het wachtwoord, de hash of wie het was.
 */
const crypto = require('node:crypto');
const { passwordProblem } = require('../crm/passwords');

/** Adres van de range-API van Have I Been Pwned (vast, door niemand in te vullen). */
const RANGE_URL = 'https://api.pwnedpasswords.com/range/';

/** Zo lang mag de controle duren; daarna geldt alleen de lokale controle. */
const BREACH_TIMEOUT_MS = 3000;

/** Grootste antwoord dat gelezen wordt (een normaal antwoord met opvulling is ongeveer 30 tot 40 kB). */
const MAX_RESPONSE_BYTES = 1024 * 1024;

/** Zoveel uitkomsten onthoudt Beheer (sinds de laatste herstart). */
const RECENT_LIMIT = 20;

/** Hoogstens één logregel over een onbereikbare dienst per zoveel milliseconden. */
const LOG_INTERVAL_MS = 15 * 60 * 1000;

/** Melding voor een gelekt of veelgebruikt wachtwoord. */
const MESSAGES = {
  breached: 'Dit wachtwoord komt voor in lijsten van gelekte wachtwoorden en is dus bij aanvallers bekend. Kies een ander wachtwoord.',
  common: 'Dit wachtwoord is te makkelijk te raden (een bekend woord of een reeks met wat cijfers). Kies een ander wachtwoord, bijvoorbeeld een zin van een paar losse woorden.',
};

/**
 * Woorden die als kern van een wachtwoord niet mogen: veelgebruikte wachtwoorden in het Nederlands en Engels en de naam
 * van de organisatie. Alleen kleine letters zonder spaties; de vergelijking haalt cijfers en tekens eromheen weg.
 */
const COMMON_WORDS = new Set([
  'wachtwoord', 'paswoord', 'password', 'passwort', 'welkom', 'welcome', 'geheim', 'secret', 'letmein', 'admin',
  'administrator', 'beheerder', 'qwerty', 'azerty', 'iloveyou', 'ikhouvanjou', 'zomer', 'winter', 'lente', 'herfst',
  'summer', 'autumn', 'spring', 'voorjaar', 'najaar', 'januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli',
  'augustus', 'september', 'oktober', 'november', 'december', 'football', 'voetbal', 'monkey', 'dragon', 'sunshine',
  'princess', 'starwars', 'master', 'changeme', 'veranderen', 'wijzigen', 'test', 'testen', 'gebruiker', 'user',
  'avanta', 'avantareizen', 'reizen', 'reis', 'vakantie', 'jezus', 'jesus', 'christus',
  'hallelujah', 'halleluja', 'amen', 'nederland', 'holland', 'amsterdam', 'rotterdam', 'utrecht',
]);

/** Reeksen op het toetsenbord en in het alfabet; een wachtwoord dat alleen een stuk daarvan is, is te raden. */
const SEQUENCES = [
  '0123456789012345678901234567890', 'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz',
  'qwertyuiopasdfghjklzxcvbnmqwertyuiopasdfghjklzxcvbnm', 'azertyuiopqsdfghjklmwxcvbnazertyuiopqsdfghjklmwxcvbn',
  '1qaz2wsx3edc4rfv5tgb6yhn7ujm8ik9ol0p', '1q2w3e4r5t6y7u8i9o0p', 'qazwsxedcrfvtgbyhnujmikolp',
];

/**
 * Of een tekst in een van de reeksen staat, vooruit of achteruit.
 * @param {string} text Tekst in kleine letters.
 * @returns {boolean} Waar als de tekst een stuk van een reeks is.
 */
function isSequence(text) {
  if (text.length < 4) return false;
  const reversed = [...text].reverse().join('');
  return SEQUENCES.some((sequence) => sequence.includes(text) || sequence.includes(reversed));
}

/**
 * Of een woord te raden is: een veelgebruikt woord, een reeks, of een herhaling daarvan of van een kort stukje
 * (`welkomwelkom`, `ababab`). Een woord van hoogstens 3 letters telt als te raden (`ab`, `zyx`).
 * @param {string} word Woord in kleine letters.
 * @returns {boolean} Waar als het woord te raden is.
 */
function isWeakWord(word) {
  if (word.length <= 3 || COMMON_WORDS.has(word) || isSequence(word)) return true;
  const repeated = /^(.+?)\1+$/u.exec(word);
  if (repeated) return repeated[1].length <= 3 || isWeakWord(repeated[1]);
  return isCommonCompound(word);
}

/**
 * Of een woord helemaal uit veelgebruikte woorden bestaat (`welkomwachtwoord`, `avantareizen`).
 * @param {string} word Woord in kleine letters.
 * @returns {boolean} Waar als het woord zo op te delen is.
 */
function isCommonCompound(word) {
  // reachable[i]: de eerste i letters zijn op te delen in veelgebruikte woorden.
  const reachable = [true];
  for (let end = 1; end <= word.length; end += 1) {
    reachable[end] = false;
    for (let start = 0; start < end && !reachable[end]; start += 1) {
      reachable[end] = reachable[start] && COMMON_WORDS.has(word.slice(start, end));
    }
  }
  return reachable[word.length];
}

/**
 * Lokale controle zonder netwerk: een veelgebruikt woord of een reeks, met hoogstens cijfers, tekens of een reeks eromheen.
 * Voorbeelden die worden geweigerd: `Wachtwoord2026!`, `Avantareizen1`, `1234567890ab`, `Qwertyuiop12!`, `Welkom01welkom`.
 * @param {string} password Het nieuwe wachtwoord (de vaste regels zijn al gecontroleerd).
 * @returns {string} Lege tekst als het goed is, anders de melding.
 */
function commonPasswordProblem(password) {
  const lower = String(password).normalize('NFKC').toLowerCase();
  const compact = lower.replace(/[\s._-]+/g, '');
  if (isSequence(compact)) return MESSAGES.common;
  // De letters, in stukken gesplitst door cijfers, spaties en tekens: `welkom01welkom` → `welkom`, `welkom`.
  const words = lower.split(/[^\p{L}]+/u).filter(Boolean);
  const digitsAndSigns = compact.replace(/\p{L}/gu, '');
  // Alleen cijfers en tekens: een reeks of herhaling is te raden (`123456789012`, `112233445566`).
  if (!words.length) return isSequence(digitsAndSigns) || new Set(digitsAndSigns).size <= 4 ? MESSAGES.common : '';
  const lettersAreCommon = words.every(isWeakWord);
  // Wat er naast de woorden staat, mag niet meer zijn dan een jaartal, een volgnummer of een uitroepteken.
  const restIsTrivial = digitsAndSigns.length <= 6 || isSequence(digitsAndSigns.replace(/[^0-9]/g, ''));
  return lettersAreCommon && restIsTrivial ? MESSAGES.common : '';
}

/**
 * Leest een antwoord als tekst, met een grens aan de grootte.
 * @param {object} response Antwoord van fetch.
 * @returns {Promise<(string|null)>} De tekst, of null als het antwoord te groot is.
 */
async function readLimitedText(response) {
  const declared = Number(response.headers && response.headers.get ? response.headers.get('content-length') : 0);
  if (declared > MAX_RESPONSE_BYTES) return null;
  const text = await response.text();
  return text.length > MAX_RESPONSE_BYTES ? null : text;
}

/**
 * Zoekt het staartstuk van een hash in een antwoord van de range-API.
 * @param {string} body Antwoord: regels `STAARTSTUK:AANTAL` (opvulregels hebben aantal 0).
 * @param {string} suffix De laatste 35 tekens van de SHA-1 in hoofdletters.
 * @returns {number} Hoe vaak het wachtwoord in lekken voorkomt (0 = niet).
 */
function breachCount(body, suffix) {
  for (const line of body.split('\n')) {
    const [candidate, count] = line.trim().split(':');
    if (candidate && candidate.toUpperCase() === suffix) return Number.parseInt(count, 10) || 0;
  }
  return 0;
}

/**
 * Maakt de wachtwoordcontrole.
 * @param {{settings: {get: Function}, appLog?: {warn: Function}, fetchImpl?: Function, now?: () => number}} options De
 *   instellingen (`passwordBreachCheck`), het logboek en voor tests een eigen fetch en klok.
 * @returns {{problem: Function, recent: Function, active: Function}} De controle.
 */
function createPasswordCheck(options) {
  const { settings, appLog } = options;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = options.now || Date.now;
  /** Laatste uitkomsten, nieuwste eerst (alleen tijdstip en uitkomst). */
  const events = [];
  let lastLoggedAt = -Infinity;

  /**
   * Legt een uitkomst vast.
   * @param {string} outcome `ok`, `lokaal` (lokaal geweigerd), `gelekt` of `onbereikbaar`.
   * @returns {void}
   */
  const record = (outcome) => {
    events.unshift({ at: new Date(now()), outcome });
    events.length = Math.min(events.length, RECENT_LIMIT);
  };

  /**
   * Of de controle bij Have I Been Pwned aan staat.
   * @returns {boolean} Waar als de instelling aan staat.
   */
  const active = () => settings.get('passwordBreachCheck') === true;

  /**
   * Vraagt Have I Been Pwned hoe vaak een wachtwoord in lekken voorkomt.
   * @param {string} password Het wachtwoord.
   * @returns {Promise<(number|null)>} Het aantal (0 = niet gevonden), of null als de dienst niet bruikbaar antwoordde.
   */
  const askBreachService = async (password) => {
    const hash = crypto.createHash('sha1').update(String(password), 'utf8').digest('hex').toUpperCase();
    try {
      const response = await fetchImpl(RANGE_URL + hash.slice(0, 5), {
        headers: { 'Add-Padding': 'true', 'User-Agent': 'avanta-reizen' },
        redirect: 'error',
        signal: AbortSignal.timeout(BREACH_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const body = await readLimitedText(response);
      return body === null ? null : breachCount(body, hash.slice(5));
    } catch (_) {
      return null;
    }
  };

  /**
   * Schrijft hoogstens eens per kwartier in het logboek dat de dienst niet bereikbaar was.
   * @returns {void}
   */
  const logUnreachable = () => {
    if (!appLog || now() - lastLoggedAt < LOG_INTERVAL_MS) return;
    lastLoggedAt = now();
    appLog.warn('wachtwoordcontrole', 'Have I Been Pwned was niet bereikbaar; nieuwe wachtwoorden zijn alleen lokaal gecontroleerd.');
  };

  /**
   * Controleert een nieuw wachtwoord: vaste regels, lokale lijst en (als het aan staat) Have I Been Pwned.
   * @param {*} password Het nieuwe wachtwoord uit het formulier.
   * @param {{email?: string}} [context] Gegevens van de gebruiker (het wachtwoord mag niet het e-mailadres zijn).
   * @returns {Promise<string>} Lege tekst als het goed is, anders de melding voor het formulier.
   */
  const problem = async (password, context = {}) => {
    const ruleProblem = passwordProblem(password, context);
    if (ruleProblem) return ruleProblem;
    const localProblem = commonPasswordProblem(password);
    if (localProblem) {
      record('lokaal');
      return localProblem;
    }
    if (!active()) return '';
    const count = await askBreachService(password);
    if (count === null) {
      record('onbereikbaar');
      logUnreachable();
      return '';
    }
    record(count > 0 ? 'gelekt' : 'ok');
    return count > 0 ? MESSAGES.breached : '';
  };

  return { problem, recent: () => events.slice(), active };
}

module.exports = { createPasswordCheck, commonPasswordProblem, breachCount, MESSAGES, RANGE_URL };
