/**
 * Integratietest voor HSTS-preload (W10) via de echte app tegen PostgreSQL (eigen schema): de kop volgt de waarden uit
 * Beheer (database), ook bij het allereerste verzoek na een start, en alleen op de host van het basisadres. Een
 * omgevingsvariabele kan preload niet aanzetten.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createDatabase } = require('../src/database/db');
const { createApp, HSTS_VALUE, HSTS_PRELOAD_VALUE } = require('../src/server');
const { createSettings } = require('../src/beheer/settings');
const { createVault } = require('../src/security/vault');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'hsts_preload_test';
const MASTER_KEY = Buffer.alloc(32, 47);
const SETUP_CODE = 'ABCDE-FGHJK-LMNPQ-RSTUV';
const LIVE_HOST = 'live.example.nl';

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

/**
 * Haalt de HSTS-kop op voor een https-verzoek via de vertrouwde proxy (loopback) met een gekozen `Host`-kop.
 * @param {number} port Poort van de testserver.
 * @param {string} host Waarde van de `Host`-kop.
 * @returns {Promise<(string|undefined)>} De kop `Strict-Transport-Security`.
 */
function hstsFor(port, host) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/robots.txt', headers: { Host: host, 'X-Forwarded-Proto': 'https' } }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.headers['strict-transport-security']));
    });
    request.on('error', reject);
  });
}

/**
 * Start een verse app (met een eigen, nog niet geladen instellingenlaag) op een vrije poort.
 * @param {object} db Database.
 * @param {import('node:test').TestContext} t Testcontext, voor het afsluiten.
 * @returns {number} Poort.
 */
function startApp(db, t) {
  const app = createApp({ db, masterKey: MASTER_KEY, setupCode: SETUP_CODE, indexable: false, siteUrl: 'https://start.example.nl' });
  const server = app.listen(0);
  t.after(() => server.close());
  return server.address().port;
}

test('HSTS-preload: waarde uit Beheer, ook bij het eerste verzoek, alleen op de live host', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  t.after(() => db.close());
  await db.migrate();
  const writer = createSettings({ db, vault: createVault(MASTER_KEY), env: {} });

  await t.test('standaard (uit): gewone HSTS-waarde', async () => {
    assert.equal(await hstsFor(startApp(db, t), LIVE_HOST), HSTS_VALUE);
  });

  await t.test('omgevingsvariabele zet preload niet aan', async () => {
    process.env.HSTS_PRELOAD = 'true';
    t.after(() => { delete process.env.HSTS_PRELOAD; });
    await writer.update({ values: { seoIndexing: true, siteUrl: `https://${LIVE_HOST}` } });
    assert.equal(await hstsFor(startApp(db, t), LIVE_HOST), HSTS_VALUE);
  });

  await t.test('aan in Beheer: preload vanaf het eerste verzoek na een start, alleen op de host van het basisadres', async () => {
    await writer.update({ values: { hstsPreload: true } });
    // Verse app: het eerste verzoek moet al de waarden uit de database gebruiken, niet de startwaarden.
    const port = startApp(db, t);
    assert.equal(await hstsFor(port, LIVE_HOST), HSTS_PRELOAD_VALUE);
    assert.equal(await hstsFor(port, 'avanta.example.nl'), HSTS_VALUE, 'andere host (testomgeving) nooit preload');
  });

  await t.test('site niet live: geen preload', async () => {
    await writer.update({ values: { seoIndexing: false } });
    assert.equal(await hstsFor(startApp(db, t), LIVE_HOST), HSTS_VALUE);
  });
});
