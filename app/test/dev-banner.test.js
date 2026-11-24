/**
 * Tests voor de balk "Deze website is in ontwikkeling": de instellingen, de opbouw in de site-instellingen en de pagina
 * (zonder database), en daarna via de echte routes tegen PostgreSQL (eigen schema): standaard aan, uitzetten en tekst
 * wijzigen in Beheer, nooit in het CRM, en zonder recht `systeem` geen toegang.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { siteSettingsOf } = require('../src/site/site-settings');
const { renderPage } = require('../src/site/layout');
const { html } = require('../src/site/html');
const { SETTING_FIELDS, validateValue, SettingsError } = require('../src/beheer/settings');
const { findSection, filterGroups } = require('../src/beheer/indeling');
const { COOKIE_NAME } = require('../src/crm/auth');
const { loginWithTwoFactor, csrfFrom } = require('./helpers/two-factor');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'dev_banner_test';
const SETUP_CODE = 'ABCDE-FGHJK-LMNPQ-RSTUV';
const ADMIN_PASSWORD = 'correct paard batterij';
const BANNER_PATTERN = /<div class="dev-banner" role="note">/;

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
 * Een nagebootste instellingenlaag met de standaardwaarden en eigen afwijkingen.
 * @param {object} overrides Waarden per instelling.
 * @returns {{get: Function}} Instellingen.
 */
function fakeSettings(overrides = {}) {
  return { get: (key) => (Object.hasOwn(overrides, key) ? overrides[key] : SETTING_FIELDS[key].default) };
}

test('balk in ontwikkeling: instellingen, site-instellingen en pagina', () => {
  assert.equal(SETTING_FIELDS.devBannerEnabled.default, true, 'standaard aan zolang de site in ontwikkeling is');
  assert.equal(SETTING_FIELDS.devBannerEnabled.type, 'bool');
  assert.deepEqual(findSection('ontwikkeling').fields, ['devBannerEnabled', 'devBannerText']);
  assert.ok(filterGroups('banner', SETTING_FIELDS).some((group) => group.sections.some((section) => section.id === 'ontwikkeling')), 'vindbaar via zoeken');

  const check = (value) => validateValue('devBannerText', SETTING_FIELDS.devBannerText, value);
  assert.equal(check('  Testsite  '), 'Testsite');
  assert.throws(() => check(''), SettingsError, 'tekst is verplicht');
  assert.throws(() => check('regel een\nregel twee'), SettingsError, 'één regel');
  assert.throws(() => check('x'.repeat(201)), SettingsError, 'maximaal 200 tekens');

  const defaults = siteSettingsOf(fakeSettings());
  assert.equal(defaults.devBanner, SETTING_FIELDS.devBannerText.default);
  assert.equal(siteSettingsOf(fakeSettings({ devBannerEnabled: false })).devBanner, '', 'uit = geen tekst');

  const page = renderPage({ title: 'Test', body: html`<p>inhoud</p>`, site: { ...defaults, devBanner: '<script>x</script> & meer' } });
  assert.match(page, /<div class="dev-banner" role="note">&lt;script&gt;x&lt;\/script&gt; &amp; meer<\/div>/, 'tekst ge-escaped');
  assert.ok(page.indexOf('dev-banner') < page.indexOf('<header'), 'boven de kop');
  assert.doesNotMatch(renderPage({ title: 'Test', body: html`<p>inhoud</p>`, site: { ...defaults, devBanner: '' } }), BANNER_PATTERN);
  assert.doesNotMatch(renderPage({ title: 'Test', body: html`<p>inhoud</p>` }), BANNER_PATTERN, 'zonder site-instellingen geen balk');
});

test('balk in ontwikkeling: Beheer-route en effect op de site', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (testContext) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();

  const app = createApp({ db, masterKey: Buffer.alloc(32, 7), setupCode: SETUP_CODE, siteUrl: 'https://start.example.nl' });
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
    const headers = {};
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

  const installed = await request('/app/installatie/', { form: { code: SETUP_CODE, name: 'Daniël', email: 'beheer@example.nl', password: ADMIN_PASSWORD, password2: ADMIN_PASSWORD } });
  const cookie = installed.cookie;
  const csrf = csrfFrom((await request('/app/', { cookie })).text);

  await testContext.test('standaard aan op de site, ook op een 404, nooit in het CRM', async () => {
    assert.match((await request('/')).text, BANNER_PATTERN);
    assert.match((await request('/bestaat-niet/')).text, BANNER_PATTERN);
    assert.doesNotMatch((await request('/app/inloggen/')).text, BANNER_PATTERN);
    assert.doesNotMatch((await request('/app/', { cookie })).text, BANNER_PATTERN);
    const section = await request('/app/beheer/ontwikkeling/', { cookie });
    assert.equal(section.status, 200);
    assert.match(section.text, /name="devBannerEnabled"/);
    assert.match(section.text, /name="devBannerText"/);
  });

  await testContext.test('tekst wijzigen en uitzetten, met audit', async () => {
    const invalid = await request('/app/beheer/ontwikkeling/', { cookie, form: { _csrf: csrf, devBannerEnabled: 'ja', devBannerText: '' } });
    assert.equal(invalid.status, 422, 'lege tekst kan niet');
    const changed = await request('/app/beheer/ontwikkeling/', { cookie, form: { _csrf: csrf, devBannerEnabled: 'ja', devBannerText: 'Proefversie <b>van</b> de site' } });
    assert.equal(changed.status, 303);
    assert.match((await request('/reis/')).text, /<div class="dev-banner" role="note">Proefversie &lt;b&gt;van&lt;\/b&gt; de site<\/div>/);

    const off = await request('/app/beheer/ontwikkeling/', { cookie, form: { _csrf: csrf, devBannerText: 'Proefversie <b>van</b> de site' } });
    assert.equal(off.status, 303);
    assert.doesNotMatch((await request('/')).text, BANNER_PATTERN, 'uit = geen balk');
    const audit = await db.query("SELECT entity_id FROM audit_log WHERE action = 'instelling.gewijzigd' ORDER BY id");
    assert.deepEqual(audit.map((row) => row.entity_id), ['devBannerText', 'devBannerEnabled']);
  });

  await testContext.test('zonder recht systeem geen toegang', async () => {
    const created = await request('/app/gebruikers/nieuw/', { cookie, form: { _csrf: csrf, name: 'Kantoor', email: 'kantoor@example.nl', role: 'kantoor', password: 'kantoor wachtwoord 1' } });
    assert.equal(created.status, 303);
    const office = await loginWithTwoFactor(request, 'kantoor@example.nl', 'kantoor wachtwoord 1', { admin: { cookie, csrf } });
    const officeCsrf = csrfFrom((await request('/app/', { cookie: office.cookie })).text);
    assert.equal((await request('/app/beheer/ontwikkeling/', { cookie: office.cookie })).status, 403);
    const sneaky = await request('/app/beheer/ontwikkeling/', { cookie: office.cookie, form: { _csrf: officeCsrf, devBannerEnabled: 'ja', devBannerText: 'Gehackt' } });
    assert.equal(sneaky.status, 403);
    assert.doesNotMatch((await request('/')).text, /Gehackt/);
  });
});
