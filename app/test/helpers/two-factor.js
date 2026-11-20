/**
 * Testhulp (geen tests): inloggen in het CRM inclusief de tweede stap. Zonder bestaand geheim stelt de hulp
 * tweestapsverificatie in (zoals een nieuwe gebruiker bij de eerste keer inloggen); met een geheim vult hij de code in.
 * Werkt met de `request`-functie die elk testbestand zelf heeft: `request(pad, {form, cookie})` geeft
 * `{status, text, cookie, headers?}` terug.
 */
const assert = require('node:assert/strict');
const totp = require('../../src/crm/totp');

/**
 * Haalt het CSRF-token uit een pagina.
 * @param {string} page HTML.
 * @returns {string} Token.
 */
const csrfFrom = (page) => (page.match(/name="_csrf" value="([^"]+)"/) || [])[1] || '';

/**
 * Een geldige code voor een geheim op een moment.
 * @param {string} secret Geheim in base32.
 * @param {number} [now] Moment in milliseconden (standaard nu).
 * @param {number} [offset] Aantal stappen verschuiving (-1, 0 of 1), om dezelfde code niet twee keer te gebruiken.
 * @returns {string} Code van zes cijfers.
 */
const codeFor = (secret, now = Date.now(), offset = 0) => totp.codeAt(secret, totp.stepOf(now) + offset);

/**
 * Stelt met een halve sessie (of een volledige sessie) tweestapsverificatie in.
 * @param {Function} request De `request`-functie van het testbestand.
 * @param {string} cookie Sessiecookie.
 * @param {{now?: number}} [options] Moment voor de code.
 * @returns {Promise<{cookie: string, setCookie: string, secret: string, recoveryCodes: string[]}>} De nieuwe sessie (of
 *   dezelfde bij een volledige sessie), de `Set-Cookie`-kop (als de `request`-functie die geeft), het geheim en de
 *   herstelcodes.
 */
async function enableTwoFactor(request, cookie, options = {}) {
  const csrf = csrfFrom((await request('/app/tweestaps/', { cookie })).text);
  const started = await request('/app/tweestaps/instellen/', { cookie, form: { _csrf: csrf } });
  assert.equal(started.status, 303, 'instellen starten');
  const page = (await request('/app/tweestaps/instellen/', { cookie })).text;
  const secret = (page.match(/class="crm-secret">([A-Z2-7 ]+)</) || [])[1].replace(/ /g, '');
  const confirmed = await request('/app/tweestaps/bevestigen/', { cookie, form: { _csrf: csrf, code: codeFor(secret, options.now) } });
  assert.equal(confirmed.status, 200, 'instellen bevestigen');
  const recoveryCodes = [...confirmed.text.matchAll(/<li><code>([A-Z2-7]{5}-[A-Z2-7]{5})<\/code><\/li>/g)].map((match) => match[1]);
  return { cookie: confirmed.cookie || cookie, setCookie: confirmed.setCookie || '', secret, recoveryCodes };
}

/**
 * Logt in met wachtwoord en tweede stap.
 * @param {Function} request De `request`-functie van het testbestand.
 * @param {string} email E-mailadres.
 * @param {string} password Wachtwoord.
 * @param {{secret?: string, now?: number, offset?: number}} [options] Bestaand geheim (anders wordt 2FA ingesteld), het
 *   moment voor de code en de stapverschuiving.
 * @returns {Promise<{cookie: string, setCookie: string, csrf: string, secret: string, recoveryCodes: string[]}>} Volledige
 *   sessie, `Set-Cookie`-kop, CSRF-token van het overzicht, het geheim en (bij instellen) de herstelcodes.
 */
async function loginWithTwoFactor(request, email, password, options = {}) {
  const first = await request('/app/inloggen/', { form: { email, password } });
  assert.equal(first.status, 303, `inloggen ${email}`);
  let session;
  if (options.secret) {
    const csrf = csrfFrom((await request('/app/inloggen/code/', { cookie: first.cookie })).text);
    const second = await request('/app/inloggen/code/', { cookie: first.cookie, form: { _csrf: csrf, code: codeFor(options.secret, options.now, options.offset) } });
    assert.equal(second.status, 303, `code ${email}`);
    session = { cookie: second.cookie, setCookie: second.setCookie || '', secret: options.secret, recoveryCodes: [] };
  } else {
    session = await enableTwoFactor(request, first.cookie, options);
  }
  const overview = await request('/app/', { cookie: session.cookie });
  assert.equal(overview.status, 200, `overzicht ${email}`);
  return { ...session, csrf: csrfFrom(overview.text) };
}

module.exports = { loginWithTwoFactor, enableTwoFactor, codeFor, csrfFrom };
