/**
 * Tests voor de onzichtbare captcha (pakket B4): alleen actief met schakelaar, sitesleutel en geheim; de controle bij
 * Google (geslaagd, ontbrekend token, verkeerde actie, lage score, onbereikbaar: doorlaten of blokkeren, verkeerd
 * geheim); de CSP alleen op de formulierpagina's; het effect op het contact- en aanmeldformulier; en Beheer (rechten,
 * sleutelcontrole met limiet, overzicht zonder tokens). De databasetests draaien in een eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/database/db');
const { createApp, BASE_CSP } = require('../src/server');
const { createCaptcha, cspWith, isFormPath, VERIFY_URL } = require('../src/security/captcha');
const { COOKIE_NAME } = require('../src/crm/auth');
const { loginWithTwoFactor } = require('./helpers/two-factor');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'captcha_test';
const SETUP_CODE = 'ABCDE-FGHJK-LMNPQ-RSTUV';
const ADMIN_PASSWORD = 'correct paard batterij';
const SITE_KEY = `6L${'a'.repeat(38)}`;

/**
 * Voegt een verbindingsoptie toe die het zoekpad op het testschema zet.
 * @param {string} url Verbindings-URL.
 * @returns {string} URL met `options=-c search_path=…`.
 */
function withSchema(url) {
  const parsed = new URL(url);
  parsed.searchParams.set('options', `-c search_path=${SCHEMA}`);
  return parsed.toString();
}

/**
 * Een nep-Google: geeft per token een antwoord en bewaart de verzoeken.
 * @returns {{fetchImpl: Function, calls: object[], answers: Map, state: {down: boolean}}} Nep-fetch en wat er gebeurde.
 */
function fakeGoogle() {
  const calls = [];
  const answers = new Map();
  const state = { down: false };
  const fetchImpl = async (url, init) => {
    const form = new URLSearchParams(init.body);
    calls.push({ url, secret: form.get('secret'), token: form.get('response'), remoteip: form.get('remoteip') });
    if (state.down) throw new Error('offline');
    const answer = form.get('secret') !== 'goed-geheim'
      ? { success: false, 'error-codes': ['invalid-input-secret'] }
      : answers.get(form.get('response')) || { success: false, 'error-codes': ['invalid-input-response'] };
    return { ok: true, json: async () => answer };
  };
  return { fetchImpl, calls, answers, state };
}

/**
 * Instellingen in het geheugen voor de captcha.
 * @param {object} values Afwijkende waarden.
 * @returns {{get: Function}} Nep-instellingen.
 */
function fakeSettings(values) {
  const all = { captchaEnabled: true, captchaSiteKey: SITE_KEY, captchaSecret: 'goed-geheim', captchaMinScore: '0.5', captchaOnUnreachable: 'allow', ...values };
  return { get: (key) => all[key] };
}

test('captcha: alleen actief met schakelaar, geldige sitesleutel en geheim', async () => {
  const google = fakeGoogle();
  for (const values of [{ captchaEnabled: false }, { captchaSiteKey: '6Lkort' }, { captchaSecret: '' }]) {
    const captcha = createCaptcha({ settings: fakeSettings(values), fetchImpl: google.fetchImpl });
    assert.equal(captcha.active(), null);
    assert.equal(captcha.siteKey(), '');
    assert.deepEqual(await captcha.check({ token: '', action: 'contact' }), { ok: true, skipped: true });
  }
  assert.equal(google.calls.length, 0, 'niets naar Google');
  assert.equal(createCaptcha({ settings: fakeSettings({}), fetchImpl: google.fetchImpl }).siteKey(), SITE_KEY);
});

test('captcha: controle bij Google', async () => {
  const google = fakeGoogle();
  google.answers.set('goed', { success: true, action: 'contact', score: 0.9 });
  google.answers.set('laag', { success: true, action: 'contact', score: 0.2 });
  google.answers.set('ander', { success: true, action: 'aanmelden', score: 0.9 });
  const captcha = createCaptcha({ settings: fakeSettings({}), fetchImpl: google.fetchImpl });
  assert.deepEqual(await captcha.check({ token: 'goed', action: 'contact', remoteIp: '203.0.113.5' }), { ok: true, score: 0.9 });
  assert.equal(google.calls[0].url, VERIFY_URL);
  assert.equal(google.calls[0].remoteip, '203.0.113.5');
  const mapped = createCaptcha({ settings: fakeSettings({}), fetchImpl: google.fetchImpl });
  await mapped.check({ token: 'goed', action: 'contact', remoteIp: '::ffff:203.0.113.6' });
  assert.equal(google.calls.at(-1).remoteip, '203.0.113.6', 'IPv4 achter dual-stack zonder ::ffff:');
  await mapped.check({ token: 'goed', action: 'contact', remoteIp: '2001:db8::1' });
  assert.equal(google.calls.at(-1).remoteip, '2001:db8::1');
  assert.equal((await captcha.check({ token: '', action: 'contact' })).reason, 'missing');
  assert.equal((await captcha.check({ token: 'x'.repeat(5000), action: 'contact' })).reason, 'missing');
  assert.equal((await captcha.check({ token: 'onbekend', action: 'contact' })).reason, 'failed');
  assert.equal((await captcha.check({ token: 'ander', action: 'contact' })).reason, 'wrong_action');
  const low = await captcha.check({ token: 'laag', action: 'contact' });
  assert.equal(low.ok, false);
  assert.match(low.message, /geen robot/);
  google.state.down = true;
  assert.deepEqual(await captcha.check({ token: 'goed', action: 'contact' }), { ok: true, reason: 'unreachable' }, 'standaard doorlaten');
  const blocking = createCaptcha({ settings: fakeSettings({ captchaOnUnreachable: 'block' }), fetchImpl: google.fetchImpl });
  const blocked = await blocking.check({ token: 'goed', action: 'contact' });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.unavailable, true);
  google.state.down = false;
  const wrongSecret = createCaptcha({ settings: fakeSettings({ captchaSecret: 'fout', captchaOnUnreachable: 'block' }), fetchImpl: google.fetchImpl });
  assert.equal((await wrongSecret.check({ token: 'goed', action: 'contact' })).reason, 'misconfigured');
  assert.equal(await wrongSecret.checkSecret(), 'invalid');
  assert.equal(await captcha.checkSecret(), 'ok');
  assert.equal(await createCaptcha({ settings: fakeSettings({ captchaSecret: '' }), fetchImpl: google.fetchImpl }).checkSecret(), 'not_set');
  const outcomes = captcha.recent().map((event) => event.outcome);
  assert.deepEqual(outcomes, ['unreachable', 'low_score', 'wrong_action', 'failed', 'missing', 'missing', 'ok']);
  assert.doesNotMatch(JSON.stringify(captcha.recent()), /goed|203\.0\.113/, 'geen tokens of adressen in het overzicht');
});

test('captcha: CSP-uitbreiding en formulierpaden', () => {
  const csp = cspWith(BASE_CSP);
  assert.match(csp, /script-src 'self' https:\/\/www\.google\.com\/recaptcha\/ https:\/\/www\.gstatic\.com\/recaptcha\//);
  assert.match(csp, /frame-src 'self' https:\/\/www\.google\.com\/recaptcha\//);
  assert.match(csp, /connect-src 'self' https:\/\/www\.google\.com\/recaptcha\//);
  assert.equal(isFormPath('/contact/'), true);
  assert.equal(isFormPath('/AANMELDEN/'), true);
  assert.equal(isFormPath('/reis/'), false);
});

test('captcha op de formulieren en in Beheer', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (testContext) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  const departure = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  await db.query("INSERT INTO trips (legacy_id, slug, title, body_html, trip_code, departure_date, price_cents, fully_booked) VALUES (1001, '8-dagen-albanie', '8 dagen Albanië', '', '27-AKO-56', $1, 79900, false)", [departure]);
  await db.query("INSERT INTO pages (path, title, body_html) VALUES ('/contact/', 'Contact', '<p>Bel ons</p>'), ('/bedankt-voor-je-aanmelding/', 'Bedankt', '<p>Dank</p>')");

  let clock = Date.now();
  const google = fakeGoogle();
  google.answers.set('mens-contact', { success: true, action: 'contact', score: 0.9 });
  google.answers.set('mens-aanmelden', { success: true, action: 'aanmelden', score: 0.8 });
  google.answers.set('robot', { success: true, action: 'contact', score: 0.1 });
  const app = createApp({ db, masterKey: Buffer.alloc(32, 6), setupCode: SETUP_CODE, captchaFetch: google.fetchImpl, now: () => clock });
  const settings = app.locals.settings;
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  testContext.after(async () => { server.close(); await db.close(); });

  /**
   * Doet een verzoek zonder redirects te volgen.
   * @param {string} path Pad.
   * @param {{form?: object, cookie?: string}} [init] Formulier en sessiecookie.
   * @returns {Promise<{status: number, text: string, headers: Headers, cookie: string}>} Antwoord.
   */
  const request = async (path, init = {}) => {
    const headers = { 'sec-fetch-site': 'same-origin' };
    if (init.cookie) headers.cookie = `${COOKIE_NAME}=${init.cookie}`;
    let body;
    if (init.form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(init.form).toString();
    }
    const response = await fetch(base + path, { method: init.form ? 'POST' : 'GET', headers, body, redirect: 'manual' });
    const setCookie = response.headers.getSetCookie().find((value) => value.startsWith(`${COOKIE_NAME}=`)) || '';
    return { status: response.status, text: await response.text(), headers: response.headers, cookie: setCookie.split(';')[0].split('=')[1] || '' };
  };
  const tokenFrom = (text) => /name="token" value="([^"]+)"/.exec(text)[1];
  const csrfFrom = (text) => (text.match(/name="_csrf" value="([^"]+)"/) || [])[1];
  /**
   * Haalt het contactformulier op en vult het in.
   * @param {object} [extra] Extra velden.
   * @returns {Promise<object>} Velden.
   */
  const contactForm = async (extra = {}) => {
    const page = await request('/contact/');
    clock += 5000;
    return { token: tokenFrom(page.text), website: '', name: 'Test Persoon', phone: '', email: 'test@example.nl', subject: '', message: 'Hallo', consent: 'ja', ...extra };
  };
  const messages = async () => (await db.query('SELECT count(*)::int AS count FROM contact_messages'))[0].count;

  const installed = await request('/app/installatie/', { form: { code: SETUP_CODE, name: 'Daniël', email: 'beheer@example.nl', password: ADMIN_PASSWORD, password2: ADMIN_PASSWORD } });
  const cookie = installed.cookie;
  const csrf = csrfFrom((await request('/app/', { cookie })).text);

  await testContext.test('uit: niets van Google in de pagina, de CSP en de verwerking', async () => {
    const page = await request('/contact/');
    assert.doesNotMatch(page.text, /captchaToken|captcha\.js/);
    assert.doesNotMatch(page.headers.get('content-security-policy'), /google/);
    assert.equal((await request('/contact/', { form: await contactForm() })).status, 303);
    assert.equal(google.calls.length, 0);
  });

  await testContext.test('Beheer: rechten, opslaan en sleutelcontrole', async () => {
    const created = await request('/app/gebruikers/nieuw/', { cookie, form: { _csrf: csrf, name: 'Kantoor', email: 'kantoor@example.nl', role: 'kantoor', password: 'kantoor wachtwoord 1' } });
    assert.equal(created.status, 303);
    const office = await loginWithTwoFactor(request, 'kantoor@example.nl', 'kantoor wachtwoord 1', { admin: { cookie, csrf } });
    const officeCsrf = csrfFrom((await request('/app/', { cookie: office.cookie })).text);
    assert.equal((await request('/app/beheer/captcha/', { cookie: office.cookie })).status, 403);
    assert.equal((await request('/app/beheer/captcha/controleren/', { cookie: office.cookie, form: { _csrf: officeCsrf } })).status, 403);
    assert.equal((await request('/app/beheer/captcha/controleren/', { cookie, form: { _csrf: 'fout' } })).status, 403, 'CSRF');

    const form = { _csrf: csrf, captchaEnabled: 'ja', captchaSiteKey: SITE_KEY, captchaSecret: 'goed-geheim', captchaMinScore: '0.5', captchaOnUnreachable: 'allow' };
    assert.equal((await request('/app/beheer/captcha/', { cookie, form: { ...form, captchaSiteKey: 'geen-sleutel' } })).status, 422);
    assert.equal((await request('/app/beheer/captcha/', { cookie, form: { ...form, captchaMinScore: '0.9' } })).status, 422);
    assert.equal((await request('/app/beheer/captcha/', { cookie, form })).status, 303);
    const page = await request('/app/beheer/captcha/', { cookie });
    assert.match(page.text, /De captcha is actief/);
    assert.doesNotMatch(page.text, /goed-geheim/, 'het geheim gaat nooit naar de browser');
    const checked = await request('/app/beheer/captcha/controleren/', { cookie, form: { _csrf: csrf } });
    assert.equal(checked.status, 200);
    assert.match(checked.text, /Google kent deze geheime sleutel/);
    google.calls.length = 0;
  });

  await testContext.test('aan: veld en script op de formulierpagina, CSP alleen daar', async () => {
    const page = await request('/contact/');
    assert.match(page.text, new RegExp(`name="captchaToken" value="" data-site-key="${SITE_KEY}" data-captcha-action="contact"`));
    assert.match(page.text, /<script src="\/js\/captcha\.js/);
    assert.match(page.headers.get('content-security-policy'), /https:\/\/www\.google\.com\/recaptcha\//);
    assert.match(page.headers.get('content-security-policy'), /(^|; )style-src-elem 'self' 'unsafe-inline'(;|$)/, 'alleen hier mag het script van reCAPTCHA eigen opmaak plaatsen');
    const other = await request('/reis/');
    assert.doesNotMatch(other.headers.get('content-security-policy'), /google/, 'andere pagina\'s niet');
    assert.doesNotMatch(other.headers.get('content-security-policy'), /style-src-elem/);
    assert.match(other.headers.get('content-security-policy'), /(^|; )style-src 'self'(;|$)/);
    assert.doesNotMatch(other.text, /\/js\/captcha\.js/, 'script alleen op de formulierpagina\'s');
    assert.doesNotMatch((await request('/app/inloggen/')).headers.get('content-security-policy'), /google/, 'het CRM niet');
    assert.match((await request('/aanmelden/?id=1001')).text, /data-captcha-action="aanmelden"/);
    assert.doesNotMatch(page.text, /goed-geheim/);
  });

  await testContext.test('contact: zonder token of met lage score geweigerd, als mens opgeslagen', async () => {
    const before = await messages();
    const missing = await request('/contact/', { form: await contactForm() });
    assert.equal(missing.status, 422);
    assert.match(missing.text, /beveiligingscontrole is niet uitgevoerd/);
    assert.match(missing.text, /value="Test Persoon"/, 'ingevulde waarden blijven staan');
    assert.equal((await request('/contact/', { form: await contactForm({ captchaToken: 'robot' }) })).status, 422);
    assert.equal(await messages(), before);
    assert.equal((await request('/contact/', { form: await contactForm({ captchaToken: 'mens-contact' }) })).status, 303);
    assert.equal(await messages(), before + 1);
    assert.equal(google.calls.at(-1).remoteip, '127.0.0.1');
    const invalid = await request('/contact/', { form: await contactForm({ email: 'geen adres', captchaToken: 'mens-contact' }) });
    assert.equal(invalid.status, 422);
    assert.equal(google.calls.length, 2, 'zonder token of met een ongeldig formulier geen controle bij Google');
  });

  await testContext.test('Google onbereikbaar: blokkeren geeft 503, doorlaten slaat op', async () => {
    clock += 11 * 60 * 1000; // nieuw limietvenster van het contactformulier
    google.state.down = true;
    await settings.update({ values: { captchaOnUnreachable: 'block' } });
    const blocked = await request('/contact/', { form: await contactForm({ captchaToken: 'mens-contact' }) });
    assert.equal(blocked.status, 503);
    assert.match(blocked.text, /niet beschikbaar/);
    await settings.update({ values: { captchaOnUnreachable: 'allow' } });
    assert.equal((await request('/contact/', { form: await contactForm({ captchaToken: 'mens-contact' }) })).status, 303);
    google.state.down = false;
  });

  await testContext.test('aanmelden: geweigerd zonder token, opgeslagen als mens', async () => {
    /**
     * Haalt het aanmeldformulier op en vult het in.
     * @param {object} [extra] Extra velden.
     * @returns {Promise<object>} Velden.
     */
    const fill = async (extra = {}) => {
      const page = await request('/aanmelden/?id=1001');
      clock += 5000;
      return {
        id: '1001', reis: '', token: tokenFrom(page.text), website: '',
        gender: 'vrouw', first_names: 'Anna', call_name: 'Anna', last_name: 'Jansen', birth_date: '1999-05-04',
        mobile: '0612345678', email: 'anna@example.nl', email_confirm: 'anna@example.nl', street: 'Dorpsstraat 1',
        postal_code: '4331 ab', city: 'Middelburg', occupation: 'Verpleegkundige', church: 'PKN', consent_religion: 'ja', consent_health: 'ja', nationality: 'Nederlandse',
        document_type: 'paspoort', earlier_trip: 'nee', credit_card: 'ja', driver_interest: 'nee', driver_before: 'nee',
        payment_choice: 'aanbetaling', consent: 'ja', ...extra,
      };
    };
    const refused = await request('/aanmelden/', { form: await fill({ captchaToken: 'mens-contact' }) });
    assert.equal(refused.status, 422, 'een token van het contactformulier telt niet');
    assert.match(refused.text, /hoort niet bij dit formulier/);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM bookings'))[0].count, 0);
    assert.equal((await request('/aanmelden/', { form: await fill({ captchaToken: 'mens-aanmelden' }) })).status, 303);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM bookings'))[0].count, 1);
  });

  await testContext.test('Beheer: overzicht zonder tokens en limiet op de sleutelcontrole', async () => {
    const page = await request('/app/beheer/captcha/', { cookie });
    assert.match(page.text, /Geweigerd: score te laag/);
    assert.match(page.text, /<td>Aanmelden<\/td>\s*<td>Doorgelaten<\/td>\s*<td>0,8<\/td>/);
    assert.doesNotMatch(page.text, /mens-contact|mens-aanmelden|127\.0\.0\.1/);
    clock += 11 * 60 * 1000; // nieuw limietvenster, los van eerdere sleutelcontroles
    const statuses = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await request('/app/beheer/captcha/controleren/', { cookie, form: { _csrf: csrf } })).status);
    assert.equal(statuses[9], 200);
    assert.equal(statuses[10], 429, 'na 10 controles per tien minuten dicht');
  });
});
