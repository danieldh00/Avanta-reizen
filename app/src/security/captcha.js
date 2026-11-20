/**
 * Onzichtbare captcha (Google reCAPTCHA v3) op de openbare formulieren (contact en aanmelden), naast de honeypot, het
 * ondertekende tijdstempel en de limiet uit `security/form-guard.js`. Aanpak uit AquaTech (`beveiliging/captcha.js`):
 * - Alleen actief met de schakelaar aan, een geldige sitesleutel en het geheim (Beheer > Toegang en beveiliging >
 *   Captcha). Anders doet dit bestand niets: geen Google in de pagina, de CSP blijft gelijk.
 * - De browser krijgt alleen de sitesleutel; het geheim gaat alleen naar het vaste controleadres van Google.
 * - Is Google niet bereikbaar (of klopt het geheim niet), dan volgt de app de instelling: doorlaten (standaard; de
 *   andere beveiligingen blijven gelden) of blokkeren.
 * - De laatste uitkomsten staan in het geheugen voor het overzicht in Beheer (actie, uitkomst, score; nooit tokens of
 *   IP-adressen).
 */

const { html } = require('../site/html');

/** Het adres waar Google een token controleert (vast, nooit uit invoer: geen SSRF). */
const VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

/** Een sitesleutel van reCAPTCHA: begint met 6L en is 40 tekens lang. */
const SITE_KEY_PATTERN = /^6L[A-Za-z0-9_-]{38}$/;

/** Hoe lang op Google wordt gewacht (ms) voordat het "onbereikbaar" heet. */
const VERIFY_TIMEOUT_MS = 4000;

/** De acties van de formulieren (Google geeft de actienaam terug; die moet kloppen). */
const ACTIONS = ['contact', 'aanmelden'];

/** Paden met een formulier met captcha (alleen daar wordt de CSP uitgebreid). */
const FORM_PATHS = ['/contact/', '/aanmelden/'];

/** Foutcodes van Google die aan onze kant liggen (verkeerd of ontbrekend geheim). */
const CONFIGURATION_ERRORS = ['missing-input-secret', 'invalid-input-secret'];

/** Hoeveel uitkomsten het overzicht onthoudt. */
const RECENT_LIMIT = 20;

/** Meldingen voor de bezoeker. */
const MESSAGES = {
  missing: 'De beveiligingscontrole is niet uitgevoerd. Zet JavaScript aan, schakel een eventuele adblocker voor deze pagina uit en probeer het opnieuw.',
  failed: 'De beveiligingscontrole is mislukt of verlopen. Probeer het opnieuw.',
  wrong_action: 'De beveiligingscontrole hoort niet bij dit formulier. Laad de pagina opnieuw en probeer het nog eens.',
  low_score: 'We konden niet vaststellen dat je geen robot bent. Probeer het later opnieuw of neem telefonisch contact met ons op.',
  unavailable: 'De beveiligingscontrole is nu niet beschikbaar. Probeer het over enkele minuten opnieuw.',
};

/**
 * De Content-Security-Policy met de adressen van reCAPTCHA erbij.
 * @param {string} baseCsp De policy (richtlijnen gescheiden door "; ").
 * @returns {string} De uitgebreide policy.
 */
function cspWith(baseCsp) {
  const additions = {
    'script-src': ['https://www.google.com/recaptcha/', 'https://www.gstatic.com/recaptcha/'],
    'connect-src': ['https://www.google.com/recaptcha/'],
    'frame-src': ['https://www.google.com/recaptcha/', 'https://recaptcha.google.com/recaptcha/'],
  };
  const directives = baseCsp.split('; ');
  for (const [name, sources] of Object.entries(additions)) {
    const index = directives.findIndex((directive) => directive.split(' ')[0] === name);
    if (index === -1) directives.push(`${name} 'self' ${sources.join(' ')}`);
    else directives[index] = `${directives[index]} ${sources.join(' ')}`;
  }
  return directives.join('; ');
}

/**
 * Of een pad een formulier met captcha heeft (hoofdletterongevoelig, zoals Express routeert).
 * @param {string} path Pad van het verzoek.
 * @returns {boolean} Waar voor de formulierpagina's.
 */
function isFormPath(path) {
  return FORM_PATHS.includes(String(path).toLowerCase());
}

/**
 * Het verborgen veld voor het token in een formulier, alleen als de captcha actief is.
 * @param {(object|undefined)} captcha De captcha-dienst (of niets).
 * @param {string} action Actie van het formulier (uit `ACTIONS`).
 * @returns {(object|string)} HTML, of leeg.
 */
function captchaField(captcha, action) {
  const siteKey = captcha ? captcha.siteKey() : '';
  return siteKey ? html`<input type="hidden" name="captchaToken" value="" data-site-key="${siteKey}" data-captcha-action="${action}">` : '';
}

/**
 * Leest het antwoord van Google als gegevens, of niets als het geen bruikbaar JSON is.
 * @param {object} response Antwoord van fetch.
 * @returns {Promise<(object|null)>} De gegevens.
 */
async function readJson(response) {
  try {
    const body = await response.json();
    return body && typeof body === 'object' ? body : null;
  } catch (_) {
    return null;
  }
}

/**
 * Maakt de captcha-dienst.
 * @param {{settings: object, fetchImpl?: Function, now?: () => number}} options De instellingen en (voor tests) fetch en klok.
 * @returns {{active: Function, siteKey: Function, check: Function, checkSecret: Function, recent: Function}} De dienst.
 */
function createCaptcha(options) {
  const { settings } = options;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = options.now || Date.now;
  /** Laatste uitkomsten, nieuwste eerst. */
  const events = [];

  /**
   * Legt een uitkomst vast (zonder token of IP-adres).
   * @param {string} action Actie van het formulier.
   * @param {string} outcome Uitkomst (`ok`, `missing`, `failed`, `wrong_action`, `low_score`, `unreachable`, `misconfigured`).
   * @param {(number|null)} [score] Score van Google.
   * @returns {void}
   */
  const record = (action, outcome, score = null) => {
    events.unshift({ at: new Date(now()), action, outcome, score });
    events.length = Math.min(events.length, RECENT_LIMIT);
  };

  /**
   * De bruikbare instelling: alleen met de schakelaar aan, een geldige sitesleutel en het geheim.
   * @returns {({siteKey: string, secret: string, minScore: number, onUnreachable: string}|null)} De instelling, of null.
   */
  const active = () => {
    if (!settings.get('captchaEnabled')) return null;
    const siteKey = settings.get('captchaSiteKey');
    if (!SITE_KEY_PATTERN.test(siteKey)) return null;
    const secret = settings.get('captchaSecret');
    if (!secret) return null;
    return { siteKey, secret, minScore: Number(settings.get('captchaMinScore')), onUnreachable: settings.get('captchaOnUnreachable') };
  };

  /**
   * De sitesleutel voor de browser, of leeg als de captcha niet actief is.
   * @returns {string} De sitesleutel.
   */
  const siteKey = () => {
    const current = active();
    return current ? current.siteKey : '';
  };

  /**
   * Vraagt Google om een token te controleren.
   * @param {string} secret Het geheim.
   * @param {string} token Het token van de browser.
   * @param {string} [remoteIp] Adres van de bezoeker (helpt Google; mag leeg).
   * @returns {Promise<(object|null)>} Het antwoord, of null als Google onbereikbaar of onbruikbaar was.
   */
  const askGoogle = async (secret, token, remoteIp) => {
    const form = new URLSearchParams({ secret, response: token });
    if (remoteIp) form.set('remoteip', remoteIp);
    try {
      const response = await fetchImpl(VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      return await readJson(response);
    } catch (_) {
      return null;
    }
  };

  /**
   * De uitkomst als Google niet te bereiken is of het geheim niet klopt: volgens de instelling doorlaten of blokkeren.
   * @param {object} current De actieve instelling.
   * @param {string} action Actie.
   * @param {string} reason `unreachable` of `misconfigured`.
   * @returns {{ok: boolean, reason: string, message?: string, unavailable?: boolean}} De uitkomst.
   */
  const degraded = (current, action, reason) => {
    record(action, reason);
    if (current.onUnreachable === 'block') return { ok: false, reason, unavailable: true, message: MESSAGES.unavailable };
    return { ok: true, reason };
  };

  /**
   * Controleert het token van een formulier. Zonder actieve captcha geslaagd zonder iets te vragen.
   * @param {{token: *, action: string, remoteIp?: string}} input Token uit het formulier, verwachte actie en adres.
   * @returns {Promise<{ok: boolean, skipped?: boolean, reason?: string, message?: string, unavailable?: boolean}>} De uitkomst.
   */
  const check = async (input) => {
    const current = active();
    if (!current) return { ok: true, skipped: true };
    const action = ACTIONS.includes(input.action) ? input.action : 'onbekend';
    const token = typeof input.token === 'string' ? input.token.trim() : '';
    if (!token || token.length > 4096) {
      record(action, 'missing');
      return { ok: false, reason: 'missing', message: MESSAGES.missing };
    }
    const body = await askGoogle(current.secret, token, input.remoteIp);
    if (!body) return degraded(current, action, 'unreachable');
    const errors = Array.isArray(body['error-codes']) ? body['error-codes'].map(String) : [];
    if (errors.some((code) => CONFIGURATION_ERRORS.includes(code))) return degraded(current, action, 'misconfigured');
    if (body.success !== true) {
      record(action, 'failed');
      return { ok: false, reason: 'failed', message: MESSAGES.failed };
    }
    if (body.action !== action) {
      record(action, 'wrong_action');
      return { ok: false, reason: 'wrong_action', message: MESSAGES.wrong_action };
    }
    const score = Number(body.score);
    if (!Number.isFinite(score) || score < current.minScore) {
      record(action, 'low_score', Number.isFinite(score) ? score : null);
      return { ok: false, reason: 'low_score', message: MESSAGES.low_score };
    }
    record(action, 'ok', score);
    return { ok: true, score };
  };

  /**
   * Controleert of het ingestelde geheim bij Google bekend is, met een neptoken: Google antwoordt dan met
   * `invalid-input-response` als het geheim klopt en met `invalid-input-secret` als het niet klopt.
   * @returns {Promise<'ok'|'invalid'|'unreachable'|'not_set'>} De uitkomst.
   */
  const checkSecret = async () => {
    const secret = settings.get('captchaSecret');
    if (!secret) return 'not_set';
    const body = await askGoogle(secret, 'avanta-sleutelcontrole');
    if (!body) return 'unreachable';
    const errors = Array.isArray(body['error-codes']) ? body['error-codes'].map(String) : [];
    return errors.some((code) => CONFIGURATION_ERRORS.includes(code)) ? 'invalid' : 'ok';
  };

  /**
   * De laatste uitkomsten, nieuwste eerst.
   * @returns {Array<{at: Date, action: string, outcome: string, score: (number|null)}>} Kopie van de lijst.
   */
  const recent = () => events.map((event) => ({ ...event }));

  return { active, siteKey, check, checkSecret, recent };
}

module.exports = { createCaptcha, captchaField, cspWith, isFormPath, SITE_KEY_PATTERN, VERIFY_URL, ACTIONS, MESSAGES };
