/**
 * Tests voor Google Analytics en Microsoft Clarity met cookiekeuze: het actieve meet-ID en Clarity-project, de pagina's
 * zonder Clarity, de uitgebreide Content-Security-Policy, het script `public/js/analytics.js` in een vm-sandbox met een
 * nagebootste DOM (niets van Google of Microsoft vóór Accepteren, alleen statistieken, formulieren gemaskeerd, cookies
 * wissen bij weigeren, opnieuw vragen als er een dienst bij komt) en het effect van de instellingen in Beheer op de site.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDatabase } = require('../src/database/db');
const { createApp, BASE_CSP } = require('../src/server');
const { COOKIE_NAME } = require('../src/crm/auth');
const { activeMeasurementId, activeClarityId, clarityAllowedOn, cspWith } = require('../src/site/analytics');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'beheer_analytics_test';
const SETUP_CODE = 'ABCDE-FGHJK-LMNPQ-RSTUV';
const ADMIN_PASSWORD = 'correct paard batterij';
const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'analytics.js'), 'utf8');

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
 * Een nagebootst element: genoeg voor het script (klasse, tekst, kenmerken, kinderen, klik).
 * @param {string} tag Tagnaam.
 * @param {object} owner Het nagebootste document.
 * @returns {object} Element.
 */
function fakeElement(tag, owner) {
  const element = {
    tagName: tag.toUpperCase(),
    attributes: {},
    children: [],
    parent: null,
    listeners: {},
    className: '',
    textContent: '',
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; },
    appendChild(child) { child.parent = this; this.children.push(child); return child; },
    addEventListener(type, listener) { (this.listeners[type] = this.listeners[type] || []).push(listener); },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = null; },
    closest(selector) {
      const name = selector.slice(1, -1);
      for (let node = this; node; node = node.parent) if (node.attributes && Object.hasOwn(node.attributes, name)) return node;
      return null;
    },
    click() { for (const listener of this.listeners.click || []) listener({ target: this }); owner.dispatch('click', this); },
  };
  return element;
}

/**
 * Bouwt een nagebootste browser met het script geladen.
 * @param {{measurementId?: string, clarityId?: string, stored?: string, cookies?: string[], forms?: number}} options
 *   Meet-ID en Clarity-project op <body>, eerdere keuze, cookies en het aantal formulieren op de pagina.
 * @returns {{window: object, document: object, storage: Map<string, string>, find: Function, scripts: Function, cookieWrites: string[], forms: object[], reloads: Function}}
 *   De sandbox.
 */
function loadScript(options = {}) {
  const storage = new Map(options.stored ? [['avanta_cookie_consent', options.stored]] : []);
  const cookieWrites = [];
  let cookieJar = (options.cookies || []).join('; ');
  const listeners = {};
  const document = {
    dispatch(type, target) { for (const listener of listeners[type] || []) listener({ target }); },
    createElement: (tag) => fakeElement(tag, document),
    addEventListener(type, listener) { (listeners[type] = listeners[type] || []).push(listener); },
    querySelector(selector) {
      const name = selector.slice(1, -1);
      const search = (node) => {
        if (node.attributes && Object.hasOwn(node.attributes, name)) return node;
        for (const child of node.children) { const found = search(child); if (found) return found; }
        return null;
      };
      return search(document.body);
    },
    querySelectorAll(selector) {
      const tag = selector.toUpperCase();
      const found = [];
      const search = (node) => {
        if (node.tagName === tag) found.push(node);
        for (const child of node.children) search(child);
      };
      search(document.body);
      return found;
    },
    get cookie() { return cookieJar; },
    set cookie(value) {
      cookieWrites.push(value);
      if (/expires=Thu, 01 Jan 1970/.test(value)) cookieJar = cookieJar.split('; ').filter((part) => part.split('=')[0] !== value.split('=')[0]).join('; ');
      else cookieJar = cookieJar ? `${cookieJar}; ${value}` : value;
    },
  };
  document.head = fakeElement('head', document);
  document.body = fakeElement('body', document);
  if (options.measurementId !== undefined) document.body.setAttribute('data-analytics', options.measurementId);
  if (options.clarityId !== undefined) document.body.setAttribute('data-clarity', options.clarityId);
  document.body.setAttribute('data-privacy-url', '/privacy/');
  const forms = Array.from({ length: options.forms || 0 }, () => document.body.appendChild(fakeElement('form', document)));
  let reloadCount = 0;
  const window = {
    document,
    location: { hostname: 'www.avantareizen.nl', reload: () => { reloadCount += 1; } },
    localStorage: { getItem: (key) => (storage.has(key) ? storage.get(key) : null), setItem: (key, value) => storage.set(key, String(value)) },
  };
  vm.runInNewContext(SCRIPT, { window, JSON, Date, encodeURIComponent, String });
  return {
    window,
    document,
    storage,
    cookieWrites,
    forms,
    reloads: () => reloadCount,
    find: (name) => document.querySelector(`[${name}]`),
    scripts: () => document.head.children.filter((child) => child.tagName === 'SCRIPT').map((child) => child.src),
  };
}

test('analytics: actief meet-ID en Content-Security-Policy', () => {
  assert.equal(activeMeasurementId(true, ' g-abc123xyz '), 'G-ABC123XYZ');
  assert.equal(activeMeasurementId(false, 'G-ABC123XYZ'), '', 'uit');
  assert.equal(activeMeasurementId(true, ''), '', 'zonder ID');
  assert.equal(activeMeasurementId(true, 'UA-1234-1'), '', 'oud formaat');
  assert.equal(activeMeasurementId(true, 'G-ABC"><script>'), '');
  assert.equal(activeMeasurementId('true', 'G-ABC123XYZ'), '', 'alleen een echte boolean');

  assert.equal(cspWith(BASE_CSP, ''), BASE_CSP, 'zonder meet-ID ongewijzigd');
  const extended = cspWith(BASE_CSP, 'G-ABC123XYZ');
  assert.match(extended, /script-src 'self' https:\/\/www\.googletagmanager\.com(;|$)/);
  assert.match(extended, /connect-src 'self' https:\/\/www\.googletagmanager\.com https:\/\/\*\.google-analytics\.com https:\/\/\*\.analytics\.google\.com/);
  assert.match(extended, /img-src 'self' data: https:\/\/\*\.google-analytics\.com https:\/\/\*\.googletagmanager\.com(;|$)/);
  assert.doesNotMatch(extended, /unsafe-inline'[^;]*script|script-src[^;]*unsafe/, 'geen inline scripts');
  assert.match(extended, /frame-ancestors 'none'/);
  // Geen inline `<style>`-blokken; alleen het style-attribuut mag nog (achtergrondfoto's op de site).
  assert.match(BASE_CSP, /(^|; )style-src 'self'(;|$)/);
  assert.match(BASE_CSP, /(^|; )style-src-attr 'unsafe-inline'(;|$)/);
  assert.match(extended, /(^|; )style-src 'self'(;|$)/, 'analytics voegt geen stijlbron toe');
});

test('analytics: script laadt niets van Google vóór Accepteren', () => {
  const none = loadScript({});
  assert.equal(none.window.AvantaAnalytics.tracker, null, 'zonder meet-ID niets');
  assert.equal(none.find('data-consent-banner'), null);
  assert.equal(none.window.dataLayer, undefined);
  assert.equal(loadScript({ measurementId: 'G-<b>' }).window.AvantaAnalytics.tracker, null, 'ongeldig meet-ID');

  const page = loadScript({ measurementId: 'G-ABC123XYZ' });
  assert.ok(page.find('data-consent-banner'), 'de balk staat er');
  assert.deepEqual(page.scripts(), [], 'nog geen Google-script');
  assert.equal(page.window.dataLayer.length, 1);
  assert.equal(page.window.dataLayer[0][0], 'consent');
  assert.equal(page.window.dataLayer[0][1], 'default');
  assert.equal(page.window.dataLayer[0][2].analytics_storage, 'denied');
  assert.equal(page.window.dataLayer[0][2].ad_storage, 'denied');

  const accept = page.find('data-consent-banner').children[1].children.find((button) => button.getAttribute('data-consent-choice') === 'granted');
  accept.click();
  assert.equal(page.find('data-consent-banner'), null, 'balk dicht');
  assert.deepEqual(page.scripts(), ['https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ']);
  const update = page.window.dataLayer.find((entry) => entry[0] === 'consent' && entry[1] === 'update');
  assert.deepEqual({ ...update[2] }, { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  const config = page.window.dataLayer.find((entry) => entry[0] === 'config');
  assert.equal(config[1], 'G-ABC123XYZ');
  assert.equal(config[2].allow_google_signals, false);
  assert.equal(JSON.parse(page.storage.get('avanta_cookie_consent')).analytics, true);
});

test('analytics: eerdere keuze, weigeren en intrekken', () => {
  const granted = loadScript({ measurementId: 'G-ABC123XYZ', stored: JSON.stringify({ v: 1, analytics: true, at: '2026-11-20T10:00:00Z' }) });
  assert.equal(granted.find('data-consent-banner'), null, 'geen balk na een keuze');
  assert.equal(granted.scripts().length, 1, 'meteen laden na eerdere toestemming');

  const denied = loadScript({ measurementId: 'G-ABC123XYZ', stored: JSON.stringify({ v: 1, analytics: false }), cookies: ['_ga=GA1.1.1', 'sessie=1'] });
  assert.equal(denied.find('data-consent-banner'), null);
  assert.deepEqual(denied.scripts(), []);
  assert.equal(denied.window['ga-disable-G-ABC123XYZ'], true, 'bewaarde weigering zet ga-disable');
  assert.ok(denied.cookieWrites.some((value) => /^_ga=; expires/.test(value)), 'achtergebleven _ga-cookie gewist');
  assert.ok(!denied.cookieWrites.some((value) => /^sessie=; expires/.test(value)));

  const oldVersion = loadScript({ measurementId: 'G-ABC123XYZ', stored: JSON.stringify({ v: 0, analytics: true }) });
  assert.ok(oldVersion.find('data-consent-banner'), 'andere versie: opnieuw vragen');
  assert.deepEqual(oldVersion.scripts(), []);

  // Intrekken via Cookie-instellingen: ga-disable en de _ga-cookies weg.
  const settingsButton = fakeElement('button', granted.document);
  settingsButton.setAttribute('data-consent-settings', '');
  granted.document.body.appendChild(settingsButton);
  for (const value of ['_ga=GA1.1.1', '_ga_ABC123XYZ=GS1.1', 'sessie=1']) granted.document.cookie = value;
  settingsButton.click();
  const banner = granted.find('data-consent-banner');
  assert.ok(banner, 'Cookie-instellingen opent de balk');
  assert.match(banner.children[0].children.map((child) => child.textContent).join(' '), /nu toegestaan/);
  banner.children[1].children.find((button) => button.getAttribute('data-consent-choice') === 'denied').click();
  assert.equal(granted.window['ga-disable-G-ABC123XYZ'], true);
  assert.ok(granted.cookieWrites.some((value) => /^_ga=; expires=Thu, 01 Jan 1970.*domain=\.avantareizen\.nl/.test(value)));
  assert.ok(granted.cookieWrites.some((value) => /^_ga_ABC123XYZ=; expires/.test(value)));
  assert.ok(!granted.cookieWrites.some((value) => /^sessie=; expires/.test(value)), 'andere cookies blijven');
  assert.equal(JSON.parse(granted.storage.get('avanta_cookie_consent')).analytics, false);
});

/**
 * Klikt in de open cookiebalk op een keuze.
 * @param {{find: Function}} page De sandbox.
 * @param {string} choice "granted" of "denied".
 * @returns {void}
 */
function chooseInBanner(page, choice) {
  page.find('data-consent-banner').children[1].children.find((button) => button.getAttribute('data-consent-choice') === choice).click();
}

test('clarity: actief project, pagina\'s zonder Clarity en Content-Security-Policy', () => {
  assert.equal(activeClarityId(' AbC123xyz9 '), 'abc123xyz9');
  assert.equal(activeClarityId(''), '', 'leeg = uit');
  assert.equal(activeClarityId('abc'), '', 'te kort');
  assert.equal(activeClarityId('abc12"><script>'), '');
  assert.equal(activeClarityId(undefined), '');

  for (const path of ['/', '/reis/', '/reis/ijsland/', '/contact/', '/privacy/', '/accountant/', '/betalingsvoorwaarden/']) assert.ok(clarityAllowedOn(path), path);
  for (const path of ['/app/', '/APP/beheer/', '/account', '/account/', '/Account/gegevens/', '/aanmelden/', '/aanmelden', '/betalen/abc/', '/betalen/abc/klaar/']) assert.ok(!clarityAllowedOn(path), path);

  assert.equal(cspWith(BASE_CSP, '', ''), BASE_CSP, 'zonder ID\'s ongewijzigd');
  const clarityOnly = cspWith(BASE_CSP, '', 'abc123xyz9');
  assert.match(clarityOnly, /script-src 'self' https:\/\/www\.clarity\.ms https:\/\/scripts\.clarity\.ms(;|$)/);
  assert.match(clarityOnly, /connect-src 'self' https:\/\/\*\.clarity\.ms(;|$)/);
  assert.match(clarityOnly, /img-src 'self' data: https:\/\/\*\.clarity\.ms(;|$)/);
  assert.doesNotMatch(clarityOnly, /googletagmanager|bing\.com/, 'geen Google en geen advertentiekoppeling van Microsoft');
  assert.doesNotMatch(clarityOnly, /script-src[^;]*unsafe/, 'geen inline scripts');
  const both = cspWith(BASE_CSP, 'G-ABC123XYZ', 'abc123xyz9');
  assert.match(both, /script-src 'self' https:\/\/www\.googletagmanager\.com https:\/\/www\.clarity\.ms https:\/\/scripts\.clarity\.ms(;|$)/);
  assert.equal(both.split('; ').filter((directive) => directive.startsWith('connect-src ')).length, 1, 'één connect-src');
});

test('clarity: script laadt niets van Microsoft vóór Accepteren, en maskeert formulieren', () => {
  assert.equal(loadScript({ clarityId: 'ABC"><b>' }).window.AvantaAnalytics.tracker, null, 'ongeldig project-ID');

  const page = loadScript({ clarityId: 'abc123xyz9', forms: 2 });
  const banner = page.find('data-consent-banner');
  assert.ok(banner, 'de balk staat er');
  assert.match(banner.children[0].children[1].textContent, /met Microsoft Clarity hoe de site wordt gebruikt/);
  assert.match(banner.children[0].children[1].textContent, /wat je in formulieren invult, wordt nooit vastgelegd/);
  assert.doesNotMatch(banner.children[0].children[1].textContent, /Google/);
  assert.deepEqual(page.scripts(), [], 'nog geen Clarity-script');
  assert.equal(page.window.clarity, undefined, 'geen Clarity-rij vóór toestemming');
  assert.equal(page.window.dataLayer, undefined, 'zonder meet-ID ook geen Google');
  assert.ok(page.forms.every((form) => form.getAttribute('data-clarity-mask') === null));

  chooseInBanner(page, 'granted');
  assert.deepEqual(page.scripts(), ['https://www.clarity.ms/tag/abc123xyz9']);
  assert.deepEqual(JSON.parse(JSON.stringify(page.window.clarity.q.map((entry) => [...entry]))), [['consentv2', { ad_Storage: 'denied', analytics_Storage: 'granted' }]], 'toestemming alleen voor statistieken');
  assert.ok(page.forms.every((form) => form.getAttribute('data-clarity-mask') === 'true'), 'elk formulier gemaskeerd vóór het laden');
  assert.deepEqual(JSON.parse(page.storage.get('avanta_cookie_consent')).tools, ['clarity'], 'de keuze noemt de dienst');
  page.window.AvantaAnalytics.tracker.grant();
  assert.equal(page.scripts().length, 1, 'maar één keer laden');
});

test('clarity: samen met Google, eerdere keuze, weigeren en intrekken', () => {
  const both = loadScript({ measurementId: 'G-ABC123XYZ', clarityId: 'abc123xyz9' });
  assert.match(both.find('data-consent-banner').children[0].children[1].textContent, /met Google Analytics en Microsoft Clarity/);
  chooseInBanner(both, 'granted');
  assert.deepEqual(both.scripts(), ['https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ', 'https://www.clarity.ms/tag/abc123xyz9']);
  assert.deepEqual(JSON.parse(both.storage.get('avanta_cookie_consent')).tools, ['ga', 'clarity']);

  // Toestemming van vóór Clarity (alleen Google): voor Clarity opnieuw vragen en tot dan niets laden.
  const older = loadScript({ measurementId: 'G-ABC123XYZ', clarityId: 'abc123xyz9', stored: JSON.stringify({ v: 1, analytics: true, at: '2026-11-20T10:00:00Z' }) });
  assert.ok(older.find('data-consent-banner'), 'opnieuw vragen');
  assert.deepEqual(older.scripts(), []);
  const gaOnly = loadScript({ measurementId: 'G-ABC123XYZ', stored: JSON.stringify({ v: 1, analytics: true, tools: ['ga'] }) });
  assert.equal(gaOnly.find('data-consent-banner'), null, 'op een pagina zonder Clarity geldt de oude toestemming');
  assert.equal(gaOnly.scripts().length, 1);

  const granted = loadScript({ clarityId: 'abc123xyz9', stored: JSON.stringify({ v: 1, analytics: true, tools: ['ga', 'clarity'] }) });
  assert.equal(granted.find('data-consent-banner'), null);
  assert.deepEqual(granted.scripts(), ['https://www.clarity.ms/tag/abc123xyz9'], 'meteen laden na eerdere toestemming');

  const denied = loadScript({ clarityId: 'abc123xyz9', stored: JSON.stringify({ v: 1, analytics: false, tools: ['ga'] }), cookies: ['_clck=abc', '_clsk=def', 'sessie=1'] });
  assert.equal(denied.find('data-consent-banner'), null, 'een weigering blijft gelden, ook voor een nieuwe dienst');
  assert.deepEqual(denied.scripts(), []);
  assert.equal(denied.window.clarity, undefined);
  assert.ok(denied.cookieWrites.some((value) => /^_clck=; expires/.test(value)));
  assert.ok(denied.cookieWrites.some((value) => /^_clsk=; expires/.test(value)));
  assert.ok(!denied.cookieWrites.some((value) => /^sessie=; expires/.test(value)), 'andere cookies blijven');
  assert.equal(denied.reloads(), 0, 'niet opnieuw laden als Clarity niet liep');

  // Intrekken terwijl Clarity loopt: toestemming intrekken, cookies weg en de pagina opnieuw laden.
  const settingsButton = fakeElement('button', granted.document);
  settingsButton.setAttribute('data-consent-settings', '');
  granted.document.body.appendChild(settingsButton);
  granted.document.cookie = '_clck=abc';
  settingsButton.click();
  assert.match(granted.find('data-consent-banner').children[0].children.map((child) => child.textContent).join(' '), /nu toegestaan/);
  chooseInBanner(granted, 'denied');
  assert.deepEqual(JSON.parse(JSON.stringify([...granted.window.clarity.q.at(-1)])), ['consentv2', { ad_Storage: 'denied', analytics_Storage: 'denied' }]);
  assert.ok(granted.cookieWrites.some((value) => /^_clck=; expires=Thu, 01 Jan 1970.*domain=\.avantareizen\.nl/.test(value)));
  assert.equal(granted.reloads(), 1, 'pagina opnieuw geladen zonder Clarity');
  assert.equal(JSON.parse(granted.storage.get('avanta_cookie_consent')).analytics, false);
});

test('analytics: instelling in Beheer en effect op de site', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (testContext) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  const app = createApp({ db, masterKey: Buffer.alloc(32, 4), setupCode: SETUP_CODE });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  testContext.after(async () => { server.close(); await db.close(); });

  /**
   * Doet een verzoek zonder redirects te volgen.
   * @param {string} url Pad.
   * @param {{form?: object, cookie?: string}} [init] Formulier en sessiecookie.
   * @returns {Promise<{status: number, text: string, headers: Headers, cookie: string}>} Antwoord.
   */
  const request = async (url, init = {}) => {
    const headers = {};
    if (init.cookie) headers.cookie = `${COOKIE_NAME}=${init.cookie}`;
    let body;
    if (init.form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(init.form).toString();
    }
    const response = await fetch(base + url, { method: init.form ? 'POST' : 'GET', headers, body, redirect: 'manual' });
    const setCookie = response.headers.getSetCookie().find((value) => value.startsWith(`${COOKIE_NAME}=`)) || '';
    return { status: response.status, text: await response.text(), headers: response.headers, cookie: setCookie.split(';')[0].split('=')[1] || '' };
  };

  const installed = await request('/app/installatie/', { form: { code: SETUP_CODE, name: 'Daniël', email: 'beheer@example.nl', password: ADMIN_PASSWORD, password2: ADMIN_PASSWORD } });
  const cookie = installed.cookie;
  const csrf = ((await request('/app/', { cookie })).text.match(/name="_csrf" value="([^"]+)"/) || [])[1];

  await testContext.test('standaard: niets in de pagina en de policy gelijk', async () => {
    const page = await request('/reis/');
    assert.equal(page.headers.get('content-security-policy'), BASE_CSP);
    assert.doesNotMatch(page.text, /data-analytics|analytics\.js|Cookie-instellingen|googletagmanager/);
  });

  await testContext.test('aan zonder meet-ID of met een ongeldig ID', async () => {
    assert.equal((await request('/app/beheer/analytics/', { cookie, form: { _csrf: csrf, analyticsEnabled: 'ja', analyticsMeasurementId: 'UA-1234-1' } })).status, 422);
    assert.equal((await request('/app/beheer/analytics/', { cookie, form: { _csrf: csrf, analyticsEnabled: 'ja', analyticsMeasurementId: '' } })).status, 303);
    const page = await request('/reis/');
    assert.equal(page.headers.get('content-security-policy'), BASE_CSP, 'zonder ID blijft alles uit');
    assert.doesNotMatch(page.text, /data-analytics/);
  });

  await testContext.test('aan met meet-ID: kenmerk, script, knop en policy; CRM blijft gelijk', async () => {
    const saved = await request('/app/beheer/analytics/', { cookie, form: { _csrf: csrf, analyticsEnabled: 'ja', analyticsMeasurementId: 'g-abc123xyz' } });
    assert.equal(saved.status, 303);
    const page = await request('/reis/');
    assert.match(page.text, /<body class="[^"]*" data-analytics="G-ABC123XYZ" data-privacy-url="\/privacy\/">/);
    assert.match(page.text, /<script src="\/js\/analytics\.js\?v=[^"]+"><\/script>/);
    assert.match(page.text, /data-consent-settings>Cookie-instellingen<\/button>/);
    assert.doesNotMatch(page.text, /googletagmanager/, 'Google staat niet in de HTML');
    assert.equal(page.headers.get('content-security-policy'), cspWith(BASE_CSP, 'G-ABC123XYZ'));
    const missing = await request('/bestaat-niet/');
    assert.match(missing.text, /data-analytics="G-ABC123XYZ"/, 'ook op een 404');
    assert.equal((await request('/app/inloggen/')).headers.get('content-security-policy'), BASE_CSP, 'het CRM nooit');
    assert.equal((await request('/APP/inloggen/')).headers.get('content-security-policy'), BASE_CSP);
    assert.doesNotMatch((await request('/app/beheer/', { cookie })).text, /data-analytics/);
    const audit = await db.query("SELECT entity_id FROM audit_log WHERE action = 'instelling.gewijzigd' ORDER BY entity_id");
    assert.deepEqual([...new Set(audit.map((row) => row.entity_id))], ['analyticsEnabled', 'analyticsMeasurementId']);
  });

  await testContext.test('Clarity: project-ID, alleen op de publieke pagina\'s waar het mag', async () => {
    assert.equal((await request('/app/beheer/analytics/', { cookie, form: { _csrf: csrf, analyticsEnabled: 'ja', analyticsMeasurementId: 'G-ABC123XYZ', clarityProjectId: 'abc"><b' } })).status, 422);
    assert.equal((await request('/app/beheer/analytics/', { cookie, form: { _csrf: csrf, analyticsEnabled: 'ja', analyticsMeasurementId: 'G-ABC123XYZ', clarityProjectId: 'AbC123xyz9' } })).status, 303);
    const page = await request('/reis/');
    assert.match(page.text, /<body class="[^"]*" data-analytics="G-ABC123XYZ" data-clarity="abc123xyz9" data-privacy-url="\/privacy\/">/);
    assert.doesNotMatch(page.text, /clarity\.ms/, 'Microsoft staat niet in de HTML');
    assert.equal(page.headers.get('content-security-policy'), cspWith(BASE_CSP, 'G-ABC123XYZ', 'abc123xyz9'));
    for (const path of ['/account/inloggen/', '/aanmelden/']) {
      const excluded = await request(path);
      assert.doesNotMatch(excluded.text, /data-clarity/, `${path} zonder Clarity`);
      assert.match(excluded.text, /data-analytics="G-ABC123XYZ"/, `${path} houdt Google Analytics met cookiekeuze`);
      assert.equal(excluded.headers.get('content-security-policy').includes('clarity.ms'), false, `${path}: policy zonder Clarity`);
    }
    assert.equal((await request('/app/inloggen/')).headers.get('content-security-policy'), BASE_CSP, 'het CRM nooit');
    assert.doesNotMatch((await request('/app/beheer/', { cookie })).text, /data-clarity=/);

    // Alleen Clarity, zonder Google Analytics: balk, script en knop blijven.
    assert.equal((await request('/app/beheer/analytics/', { cookie, form: { _csrf: csrf, analyticsMeasurementId: 'G-ABC123XYZ', clarityProjectId: 'abc123xyz9' } })).status, 303);
    const clarityOnly = await request('/reis/');
    assert.match(clarityOnly.text, /<body class="[^"]*" data-clarity="abc123xyz9" data-privacy-url="\/privacy\/">/);
    assert.match(clarityOnly.text, /<script src="\/js\/analytics\.js\?v=[^"]+"><\/script>/);
    assert.match(clarityOnly.text, /data-consent-settings>Cookie-instellingen<\/button>/);
    assert.equal(clarityOnly.headers.get('content-security-policy'), cspWith(BASE_CSP, '', 'abc123xyz9'));
    const noClarityPage = await request('/account/inloggen/');
    assert.doesNotMatch(noClarityPage.text, /analytics\.js|Cookie-instellingen|data-privacy-url/, 'zonder dienst op de pagina geen balk');
    assert.equal(noClarityPage.headers.get('content-security-policy'), BASE_CSP);

    // Leeg = uit.
    assert.equal((await request('/app/beheer/analytics/', { cookie, form: { _csrf: csrf, analyticsEnabled: 'ja', analyticsMeasurementId: 'G-ABC123XYZ', clarityProjectId: '' } })).status, 303);
    assert.doesNotMatch((await request('/reis/')).text, /data-clarity/);
  });

  await testContext.test('uit: weer alles weg', async () => {
    assert.equal((await request('/app/beheer/analytics/', { cookie, form: { _csrf: csrf, analyticsMeasurementId: 'G-ABC123XYZ' } })).status, 303);
    const page = await request('/reis/');
    assert.equal(page.headers.get('content-security-policy'), BASE_CSP);
    assert.doesNotMatch(page.text, /data-analytics|analytics\.js/);
  });
});
