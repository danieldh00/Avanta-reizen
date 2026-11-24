/**
 * Tests voor Google Analytics met cookiekeuze (pakket A4): het actieve meet-ID, de uitgebreide Content-Security-Policy,
 * het script `public/js/analytics.js` in een vm-sandbox met een nagebootste DOM (niets van Google vóór Accepteren,
 * alleen analytics_storage, cookies wissen bij weigeren) en het effect van de instelling in Beheer op de site.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDatabase } = require('../src/database/db');
const { createApp, BASE_CSP } = require('../src/server');
const { COOKIE_NAME } = require('../src/crm/auth');
const { activeMeasurementId, cspWith } = require('../src/site/analytics');

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
 * @param {{measurementId?: string, stored?: string, cookies?: string[]}} options Meet-ID op <body>, eerdere keuze en cookies.
 * @returns {{window: object, document: object, find: Function, scripts: Function, cookieWrites: string[]}} De sandbox.
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
  document.body.setAttribute('data-privacy-url', '/privacy/');
  const window = {
    document,
    location: { hostname: 'www.avantareizen.nl' },
    localStorage: { getItem: (key) => (storage.has(key) ? storage.get(key) : null), setItem: (key, value) => storage.set(key, String(value)) },
  };
  vm.runInNewContext(SCRIPT, { window, JSON, Date, encodeURIComponent, String });
  return {
    window,
    document,
    storage,
    cookieWrites,
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

  await testContext.test('uit: weer alles weg', async () => {
    assert.equal((await request('/app/beheer/analytics/', { cookie, form: { _csrf: csrf, analyticsMeasurementId: 'G-ABC123XYZ' } })).status, 303);
    const page = await request('/reis/');
    assert.equal(page.headers.get('content-security-policy'), BASE_CSP);
    assert.doesNotMatch(page.text, /data-analytics|analytics\.js/);
  });
});
