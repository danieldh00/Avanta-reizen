/**
 * Gedeelde bescherming voor openbare formulieren (aanmelden, contact): controle op herkomst, een limiet per bezoeker,
 * een honeypot-veld en een ondertekend tijdstempel dat te snel of te laat insturen tegenhoudt.
 */
const crypto = require('node:crypto');
const { html } = require('../site/html');
const { clientKey, createRateLimiter } = require('./rate-limit');

/** Minimale invultijd: sneller is vrijwel zeker een bot. */
const MIN_FILL_MS = 3000;

/** Maximale leeftijd van een formuliertoken. */
const MAX_FILL_MS = 3 * 60 * 60 * 1000;

/** Melding als het token ongeldig, verlopen of te snel is: de bezoeker kan het formulier gewoon opnieuw versturen. */
const TOKEN_MESSAGE = 'Het formulier is verlopen of te snel verstuurd. Controleer je gegevens en verstuur het opnieuw.';

/**
 * Of een verzoek van een andere site komt, volgens `Sec-Fetch-Site` of `Origin`. Ontbreken beide (oude browser,
 * script), dan telt het niet als andere site; formulieren hebben daarnaast hun eigen token.
 * @param {object} req Express-verzoek.
 * @returns {boolean} Waar als het verzoek van een andere site komt.
 */
function isCrossSite(req) {
  const site = req.get('sec-fetch-site');
  const origin = req.get('origin');
  return Boolean((site && !['same-origin', 'none'].includes(site)) || (origin && origin !== `${req.protocol}://${req.get('host')}`));
}

/**
 * Maakt de bescherming voor één formulier.
 * @param {{purpose: string, formKey: Buffer, limit: number, windowMs: number, limitMessage: string, now?: () => number}} options
 *   Doel (scheidt de tokens per formulier), sleutel voor het token, limiet per venster, tekst bij 429 en (voor tests) de klok.
 * @returns {{signToken: Function, checkToken: Function, hiddenFields: Function, isBot: Function, tokenProblem: Function, protect: Function}} De bescherming.
 */
function createFormGuard(options) {
  const now = options.now || Date.now;
  const limiter = createRateLimiter({ limit: options.limit, windowMs: options.windowMs, now });
  const retryAfterSeconds = String(Math.ceil(options.windowMs / 1000));

  /**
   * Maakt een ondertekend token met het tijdstip waarop het formulier is getoond.
   * @param {number} issuedAt Tijdstip in ms.
   * @returns {string} Token.
   */
  const signToken = (issuedAt) => `${issuedAt}.${crypto.createHmac('sha256', options.formKey).update(`${options.purpose}:${issuedAt}`).digest('base64url')}`;

  /**
   * Controleert het formuliertoken: echt, niet te snel ingevuld en niet te oud.
   * @param {string} token Token uit het formulier.
   * @returns {boolean} Waar als het token geldig is.
   */
  const checkToken = (token) => {
    const [issued] = String(token || '').split('.');
    const issuedAt = Number(issued);
    if (!Number.isSafeInteger(issuedAt)) return false;
    const expected = Buffer.from(signToken(issuedAt));
    const given = Buffer.from(String(token));
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return false;
    const age = now() - issuedAt;
    return age >= MIN_FILL_MS && age <= MAX_FILL_MS;
  };

  /**
   * De verborgen velden voor in het formulier: het token en de honeypot.
   * @returns {object} HTML.
   */
  const hiddenFields = () => html`<input type="hidden" name="token" value="${signToken(now())}">
        <div class="honeypot" aria-hidden="true"><label>Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>`;

  /**
   * Of de honeypot is ingevuld. Alleen dan wordt een inzending stil genegeerd (met de gewone bedanktmelding);
   * een mens ziet dat verborgen veld niet.
   * @param {object} body Ingezonden velden.
   * @returns {boolean} Waar als de inzending van een bot komt.
   */
  const isBot = (body) => Boolean(body.website);

  /**
   * Controleert het token van een inzending en geeft bij een probleem een melding voor de bezoeker. Een ongeldig,
   * verlopen of te snel token kan ook een mens overkomen (formulier lang open laten staan, automatisch invullen):
   * dan toont de route het formulier opnieuw (422) met de ingevulde waarden en een nieuw token.
   * @param {object} body Ingezonden velden.
   * @returns {string} Lege tekst als het token geldig is, anders de melding.
   */
  const tokenProblem = (body) => (checkToken(body.token) ? '' : TOKEN_MESSAGE);

  /**
   * Express-middleware: weigert verzoeken van een andere site (403) en bezoekers boven de limiet (429).
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @param {Function} next Volgende stap.
   * @returns {void}
   */
  const protect = (req, res, next) => {
    if (isCrossSite(req)) return res.status(403).type('text').send('Verzoek geweigerd.');
    if (!limiter.hit(clientKey(req))) {
      return res.status(429).set('Retry-After', retryAfterSeconds).type('text').send(options.limitMessage);
    }
    return next();
  };

  return { signToken, checkToken, hiddenFields, isBot, tokenProblem, protect };
}

module.exports = { createFormGuard, isCrossSite, MIN_FILL_MS, MAX_FILL_MS, TOKEN_MESSAGE };
