/**
 * Testhulp (geen tests): inloggen in het CRM inclusief de tweede stap. Zonder bestaand geheim stelt de hulp
 * tweestapsverificatie in (zoals een nieuwe gebruiker bij de eerste keer inloggen); met een geheim vult hij de code in.
 * Werkt met de `request`-functie die elk testbestand zelf heeft: `request(pad, {form, cookie})` geeft
 * `{status, text, cookie, headers?}` terug. Een halve sessie heeft een activatiecode nodig: geef `activation` mee, of
 * `admin` (sessie van een beheerder) zodat de hulp er een maakt.
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
 * Laat een beheerder een activatiecode maken voor een gebruiker.
 * @param {Function} request De `request`-functie van het testbestand.
 * @param {{cookie: string, csrf: string}} admin Sessie van een beheerder.
 * @param {string} email E-mailadres van de gebruiker.
 * @returns {Promise<string>} De activatiecode.
 */
async function createActivation(request, admin, email) {
  const list = (await request('/app/gebruikers/', { cookie: admin.cookie })).text;
  const escaped = email.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const id = (list.match(new RegExp(`href="/app/gebruikers/(\\d+)/">[^<]*</a></td>\\s*<td>${escaped}</td>`)) || [])[1];
  assert.ok(id, `gebruiker ${email} in de lijst`);
  const page = await request(`/app/gebruikers/${id}/activatiecode/`, { cookie: admin.cookie, form: { _csrf: admin.csrf } });
  assert.equal(page.status, 200, 'activatiecode maken');
  return page.text.match(/class="crm-secret">([A-Z2-9-]+)</)[1];
}

/**
 * Stelt met een halve sessie (of een volledige sessie) tweestapsverificatie in.
 * @param {Function} request De `request`-functie van het testbestand.
 * @param {string} cookie Sessiecookie.
 * @param {{now?: number, activation?: string, admin?: {cookie: string, csrf: string}, email?: string}} [options] Moment voor
 *   de code, en voor een halve sessie de activatiecode of een beheerder die er een maakt (met het e-mailadres).
 * @returns {Promise<{cookie: string, setCookie: string, secret: string, recoveryCodes: string[]}>} De nieuwe sessie (of
 *   dezelfde bij een volledige sessie), de `Set-Cookie`-kop (als de `request`-functie die geeft), het geheim en de
 *   herstelcodes.
 */
async function enableTwoFactor(request, cookie, options = {}) {
  const overview = (await request('/app/tweestaps/', { cookie })).text;
  const csrf = csrfFrom(overview);
  if (overview.includes('action="/app/tweestaps/activeren/"')) {
    const activation = options.activation || await createActivation(request, options.admin, options.email);
    const activated = await request('/app/tweestaps/activeren/', { cookie, form: { _csrf: csrf, activation } });
    assert.equal(activated.status, 303, 'activatiecode');
  } else {
    const started = await request('/app/tweestaps/instellen/', { cookie, form: { _csrf: csrf } });
    assert.equal(started.status, 303, 'instellen starten');
  }
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
 * @param {{secret?: string, now?: number, offset?: number, activation?: string, admin?: object}} [options] Bestaand geheim
 *   (anders wordt 2FA ingesteld, met de activatiecode of een beheerder die er een maakt), het moment voor de code en de
 *   stapverschuiving.
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
    session = await enableTwoFactor(request, first.cookie, { ...options, email });
  }
  const overview = await request('/app/', { cookie: session.cookie });
  assert.equal(overview.status, 200, `overzicht ${email}`);
  return { ...session, csrf: csrfFrom(overview.text) };
}

module.exports = { loginWithTwoFactor, enableTwoFactor, createActivation, codeFor, csrfFrom };
