/**
 * Tests van Beheer > Systeem > Livegang (`beheer/go-live-check.js`, `beheer/go-live-routes.js`): de beoordeling van de
 * instellingen voor de overstap en van de vaste inhoud (zonder database), en de route met database: zonder sessie naar
 * inloggen, zonder recht 403, beheerder 200 met de juiste standen, en geen persoonsgegevens of geheimen op de pagina.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Eigen datamap vóór het laden van de app: `paths.js` leest DATA_DIR bij het laden.
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'avanta-livegang-'));
process.env.DATA_DIR = DATA_DIR;

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { COOKIE_NAME } = require('../src/crm/auth');
const { settingsChecks, contentChecks } = require('../src/beheer/go-live-check');
const { TRANSFER_PARTS } = require('../src/site/content-transfer');
const { findSection } = require('../src/beheer/indeling');
const { loginWithTwoFactor } = require('./helpers/two-factor');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'livegang_test';
const MASTER_KEY = Buffer.alloc(32, 41);
const SETUP_CODE = 'ABCDE-FGHJK-LMNPQ-RSTUV';
const ADMIN_PASSWORD = 'correct paard batterij';

/** Instellingen zoals vóór de livegang (de standaard). */
const BEFORE = {
  mfaRequiredFor: 'niemand', devBannerEnabled: true, seoIndexing: false, siteUrl: 'https://avanta.example.nl',
  guideWindowDaysBefore: 14, guideWindowDaysAfter: 0, monitorEmail: '', monitorHeartbeatUrl: '',
  mailMode: 'smtp', mailHost: '', mailFromAddress: '', captchaEnabled: false, captchaSiteKey: '', hstsPreload: false,
};
/** Instellingen zoals na de overstap. */
const AFTER = {
  ...BEFORE, mfaRequiredFor: 'gegevens', devBannerEnabled: false, seoIndexing: true, siteUrl: 'https://www.avantareizen.nl',
  monitorEmail: 'beheer@example.nl', monitorHeartbeatUrl: 'https://hc.example.nl/ping/x', mailHost: 'smtp.example.nl',
  mailFromAddress: 'info@example.nl', captchaEnabled: true, captchaSiteKey: 'sleutel',
};

/**
 * Maakt een nagebootste instellingenlaag met vaste waarden.
 * @param {object} values Waarden per sleutel.
 * @returns {{get: (key: string) => *}} Instellingen.
 */
function fakeSettings(values) {
  return { get: (key) => { assert.ok(Object.hasOwn(values, key), `onbekende instelling ${key}`); return values[key]; } };
}

/**
 * Zoekt de stand van een regel op label.
 * @param {object[]} rows Regels.
 * @param {string} label Begin van het label.
 * @returns {string} Stand.
 */
function stateOf(rows, label) {
  const row = rows.find((item) => item.label.startsWith(label));
  assert.ok(row, `regel ${label}`);
  return row.state;
}

/**
 * Voegt een zoekpad naar het testschema toe aan de verbindings-URL.
 * @param {string} url Verbindings-URL.
 * @returns {string} URL.
 */
function withSchema(url) {
  const parsed = new URL(url);
  parsed.searchParams.set('options', `-c search_path=${SCHEMA}`);
  return parsed.toString();
}

test('livegang: instellingen vóór en na de overstap', () => {
  const before = settingsChecks(fakeSettings(BEFORE), { usersWithout2fa: 2 });
  for (const label of ['Mailserver', 'Meldadres', 'Heartbeat', 'Captcha', 'Iedereen met bijzondere', 'Tweestapsverificatie verplicht', 'Balk', 'Basisadres', 'Zoekmachines']) {
    assert.equal(stateOf(before, label), 'open', label);
  }
  assert.equal(stateOf(before, 'Venster voor de reisleider'), 'handmatig');
  assert.equal(stateOf(before, 'HSTS-preload'), 'later', 'preload pas na een stabiele periode');
  assert.equal(stateOf(settingsChecks(fakeSettings({ ...AFTER, hstsPreload: true }), { usersWithout2fa: 0 }), 'HSTS-preload'), 'klaar');
  assert.match(before.find((row) => row.label.startsWith('Venster')).detail, /14 dag\(en\) vóór vertrek tot 0 dag\(en\)/);
  assert.match(before.find((row) => row.label.startsWith('Iedereen')).detail, /^2 actieve gebruiker/);

  const after = settingsChecks(fakeSettings(AFTER), { usersWithout2fa: 0 });
  assert.deepEqual(after.filter((row) => row.state === 'open'), [], 'na de overstap niets meer open');
  assert.equal(stateOf(settingsChecks(fakeSettings({ ...AFTER, mailMode: 'connector', mailHost: '' }), { usersWithout2fa: 0 }), 'Mailserver'), 'klaar', 'connector zonder host');
  assert.equal(stateOf(settingsChecks(fakeSettings({ ...AFTER, siteUrl: 'geen adres' }), { usersWithout2fa: 0 }), 'Basisadres'), 'open');
  // Elke regel linkt naar een bestaand onderdeel van Beheer of een scherm van het CRM.
  for (const row of after) {
    const match = /^\/app\/beheer\/([a-z0-9-]+)\/$/.exec(row.href);
    if (match) assert.ok(findSection(match[1]), `sectie ${match[1]}`);
    else assert.match(row.href, /^\/app\/[a-z-]+\/$/);
  }
});

test('livegang: vaste inhoud overgezet en homepage in het CRM', () => {
  const before = contentChecks({ homeInCrm: false, transfersDone: 2 });
  assert.equal(stateOf(before, 'Homepage'), 'open');
  assert.equal(stateOf(before, 'Vaste inhoud van de huidige site overgezet'), 'open');
  assert.match(before.find((row) => row.label === 'Vaste inhoud van de huidige site overgezet').detail, new RegExp(`^2 van de ${TRANSFER_PARTS.length} delen`));
  const after = contentChecks({ homeInCrm: true, transfersDone: TRANSFER_PARTS.length });
  assert.deepEqual(after.filter((row) => row.state === 'open'), [], 'alles in het CRM: niets open');
});

test('livegang: de pagina in Beheer', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (testContext) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  const app = createApp({ db, masterKey: MASTER_KEY, setupCode: SETUP_CODE });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  testContext.after(async () => { server.close(); await db.close(); fs.rmSync(DATA_DIR, { recursive: true, force: true }); });

  /**
   * Doet een verzoek zonder redirects te volgen.
   * @param {string} urlPath Pad.
   * @param {{form?: object, cookie?: string}} [init] Formulier en sessiecookie.
   * @returns {Promise<{status: number, text: string, headers: Headers, cookie: string}>} Antwoord.
   */
  const request = async (urlPath, init = {}) => {
    const headers = {};
    if (init.cookie) headers.cookie = `${COOKIE_NAME}=${init.cookie}`;
    let body;
    if (init.form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(init.form).toString();
    }
    const response = await fetch(base + urlPath, { method: init.form ? 'POST' : 'GET', headers, body, redirect: 'manual' });
    const setCookie = response.headers.getSetCookie().find((value) => value.startsWith(`${COOKIE_NAME}=`)) || '';
    return { status: response.status, text: await response.text(), headers: response.headers, cookie: setCookie.split(';')[0].split('=')[1] || '' };
  };
  const csrfFrom = (page) => (page.match(/name="_csrf" value="([^"]+)"/) || [])[1] || '';

  const installed = await request('/app/installatie/', { form: { code: SETUP_CODE, name: 'Beheerder', email: 'beheer@example.nl', password: ADMIN_PASSWORD, password2: ADMIN_PASSWORD } });
  assert.equal(installed.status, 303);
  const adminCookie = installed.cookie;
  const adminCsrf = csrfFrom((await request('/app/', { cookie: adminCookie })).text);

  await testContext.test('zonder sessie naar inloggen, zonder recht 403', async () => {
    const anonymous = await request('/app/beheer/livegang/');
    assert.equal(anonymous.status, 303);
    assert.equal(anonymous.headers.get('location'), '/app/inloggen/');
    assert.equal((await request('/app/gebruikers/nieuw/', { cookie: adminCookie, form: { _csrf: adminCsrf, name: 'Kantoor', email: 'kantoor@example.nl', role: 'kantoor', password: 'kantoor wachtwoord 1' } })).status, 303);
    const office = await loginWithTwoFactor(request, 'kantoor@example.nl', 'kantoor wachtwoord 1', { admin: { cookie: adminCookie, csrf: adminCsrf } });
    assert.equal((await request('/app/beheer/livegang/', { cookie: office.cookie })).status, 403);
  });

  await testContext.test('beheerder ziet de standen, zonder persoonsgegevens', async () => {
    const page = await request('/app/beheer/livegang/', { cookie: adminCookie });
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.match(page.text, /<h1 class="crm-title">Livegang<\/h1>/);
    assert.match(page.text, /Instellingen voor de overstap/);
    assert.match(page.text, /Vaste inhoud in het CRM/);
    // De beheerder heeft geen tweestapsverificatie aangezet; kantoor wel (helper hierboven).
    assert.match(page.text, /1 actieve gebruiker\(s\) met rol beheerder, kantoor of reisleider zonder tweestapsverificatie/);
    assert.match(page.text, /0 van de 5 delen overgezet/);
    assert.match(page.text, /Staat offline of ontbreekt/);
    assert.match(page.text, /crm-status--vol">Open</);
    assert.match(page.text, /crm-status--open">Zelf controleren</);
    assert.doesNotMatch(page.text, /beheer@example\.nl|kantoor@example\.nl/, 'geen e-mailadressen van gebruikers');
    // Te vinden via het zoekveld van Beheer.
    assert.match((await request('/app/beheer/?zoek=livegang', { cookie: adminCookie })).text, /href="\/app\/beheer\/livegang\/"/);
  });

  await testContext.test('na het zetten van de instellingen staat de stap op klaar', async () => {
    const form = await request('/app/beheer/ontwikkeling/', { cookie: adminCookie });
    const saved = await request('/app/beheer/ontwikkeling/', { cookie: adminCookie, form: { _csrf: csrfFrom(form.text), devBannerText: 'Tekst' } });
    assert.equal(saved.status, 303);
    const page = await request('/app/beheer/livegang/', { cookie: adminCookie });
    assert.match(page.text, /Balk &quot;in ontwikkeling&quot; uit<\/a><\/td>\s*<td role="cell" data-label="Stand"><span class="crm-status crm-status--gepubliceerd">Klaar/);
  });

  await testContext.test('limiet: na 60 verzoeken per minuut een 429', async () => {
    let status = 200;
    for (let i = 0; i < 70 && status === 200; i++) status = (await request('/app/beheer/livegang/', { cookie: adminCookie })).status;
    assert.equal(status, 429);
  });
});
