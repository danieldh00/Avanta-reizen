/**
 * Tests voor toegang (pakket B3): instelbare sessieduur (geldt meteen, ook voor bestaande sessies) en bewaartermijnen
 * (auditlog, IP-voorvoegsels in het auditlog, 404-lijst), plus de rechten op de nieuwe sectie in Beheer. De
 * databasetests draaien in een eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { purgeExpired, hashToken, COOKIE_NAME } = require('../src/crm/auth');
const { loginWithTwoFactor } = require('./helpers/two-factor');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'toegang_test';
const SETUP_CODE = 'ABCDE-FGHJK-LMNPQ-RSTUV';
const ADMIN_PASSWORD = 'correct paard batterij';

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

test('toegang: sessieduur en bewaartermijnen', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();

  const app = createApp({ db, masterKey: Buffer.alloc(32, 4), setupCode: SETUP_CODE });
  const settings = app.locals.settings;
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await db.close(); });

  /**
   * Doet een verzoek zonder redirects te volgen.
   * @param {string} path Pad.
   * @param {{form?: object, cookie?: string}} [init] Formulier en sessiecookie.
   * @returns {Promise<{status: number, text: string, setCookie: string, cookie: string}>} Antwoord.
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
    return { status: response.status, text: await response.text(), setCookie, cookie: setCookie.split(';')[0].split('=')[1] || '' };
  };
  const csrfFrom = (text) => (text.match(/name="_csrf" value="([^"]+)"/) || [])[1];
  /**
   * Logt in als beheerder.
   * @returns {Promise<{cookie: string, csrf: string, setCookie: string}>} Sessie.
   */
  let adminSecret = '';
  const login = async () => {
    // Elke code werkt één keer; deze test logt vaker in binnen 30 seconden, dus de laatst gebruikte stap gaat terug.
    if (adminSecret) await db.query("UPDATE users SET totp_last_step = NULL WHERE email = 'beheer@example.nl'");
    const session = await loginWithTwoFactor(request, 'beheer@example.nl', ADMIN_PASSWORD, { secret: adminSecret, activation: SETUP_CODE });
    adminSecret = session.secret;
    return session;
  };

  await request('/app/installatie/', { form: { code: SETUP_CODE, name: 'Daniël', email: 'beheer@example.nl', password: ADMIN_PASSWORD, password2: ADMIN_PASSWORD } });
  const session = await login();
  const form = { _csrf: session.csrf, sessionIdleHours: '1', sessionMaxDays: '1', auditRetentionMonths: '24', auditIpRetentionDays: '90', notFoundRetentionDays: '90' };

  await t.test('rechten: zonder recht systeem 403, ongeldige waarden 422', async () => {
    const created = await request('/app/gebruikers/nieuw/', { cookie: session.cookie, form: { _csrf: session.csrf, name: 'Kantoor', email: 'kantoor@example.nl', role: 'kantoor', password: 'kantoor wachtwoord 1' } });
    assert.equal(created.status, 303);
    const office = await loginWithTwoFactor(request, 'kantoor@example.nl', 'kantoor wachtwoord 1', { admin: session });
    const officeCsrf = csrfFrom((await request('/app/', { cookie: office.cookie })).text);
    assert.equal((await request('/app/beheer/sessies/', { cookie: office.cookie })).status, 403);
    assert.equal((await request('/app/beheer/sessies/', { cookie: office.cookie, form: { ...form, _csrf: officeCsrf, sessionIdleHours: '24' } })).status, 403);
    assert.equal((await request('/app/beheer/sessies/', { cookie: session.cookie, form: { ...form, sessionIdleHours: '0' } })).status, 422);
    assert.equal((await request('/app/beheer/sessies/', { cookie: session.cookie, form: { ...form, auditRetentionMonths: '3' } })).status, 422);
    assert.equal(settings.get('sessionIdleHours'), 1, 'standaard 1 uur (audit A07)');
  });

  await t.test('sessieduur: instelling geldt meteen, ook voor bestaande sessies', async () => {
    const other = await login();
    assert.match(other.setCookie, /Max-Age=86400/, 'standaard 1 dag (audit A07)');
    assert.equal((await request('/app/beheer/sessies/', { cookie: session.cookie, form: { ...form, sessionIdleHours: '1', sessionMaxDays: '2' } })).status, 303);
    assert.equal(settings.get('sessionIdleHours'), 1);
    const audit = await db.query("SELECT entity_id FROM audit_log WHERE action = 'instelling.gewijzigd' ORDER BY entity_id");
    assert.deepEqual(audit.map((row) => row.entity_id), ['sessionMaxDays'], 'alleen wat echt verandert');

    await db.query("UPDATE sessions SET last_seen_at = now() - interval '90 minutes' WHERE token_hash = $1", [hashToken(other.cookie)]);
    assert.equal((await request('/app/', { cookie: other.cookie })).status, 303, 'na een uur zonder activiteit uitgelogd');
    const fresh = await login();
    assert.match(fresh.setCookie, /Max-Age=172800/, 'nieuwe sessie: 2 dagen');
    assert.equal((await request('/app/', { cookie: fresh.cookie })).status, 200);
    await db.query("UPDATE sessions SET created_at = now() - interval '3 days', expires_at = now() + interval '4 days' WHERE token_hash = $1", [hashToken(fresh.cookie)]);
    assert.equal((await request('/app/', { cookie: fresh.cookie })).status, 303, 'ouder dan de maximale duur, ook met een latere expires_at');
    await purgeExpired(db, settings);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM sessions WHERE token_hash = $1', [hashToken(fresh.cookie)]))[0].count, 0, 'opgeruimd');
  });

  await t.test('bewaartermijnen: auditlog, IP-voorvoegsels en 404-lijst', async () => {
    const current = await login();
    const saved = await request('/app/beheer/sessies/', { cookie: current.cookie, form: { ...form, _csrf: current.csrf, auditRetentionMonths: '12', auditIpRetentionDays: '30', notFoundRetentionDays: '14' } });
    assert.equal(saved.status, 303);
    await db.query(`INSERT INTO audit_log (action, ip_prefix, created_at) VALUES
      ('test.oud', '203.0.113.0/24', now() - interval '13 months'),
      ('test.middel', '203.0.113.0/24', now() - interval '40 days'),
      ('test.nieuw', '203.0.113.0/24', now() - interval '10 days')`);
    await db.query(`INSERT INTO not_found_log (path, last_seen_at) VALUES ('/oud/', now() - interval '15 days'), ('/nieuw/', now() - interval '13 days')`);
    await purgeExpired(db, settings);
    await app.locals.redirects.purge();
    const rows = await db.query("SELECT action, ip_prefix FROM audit_log WHERE action LIKE 'test.%' ORDER BY action");
    assert.deepEqual(rows, [{ action: 'test.middel', ip_prefix: null }, { action: 'test.nieuw', ip_prefix: '203.0.113.0/24' }]);
    const paths = await db.query('SELECT path FROM not_found_log ORDER BY path');
    assert.deepEqual(paths.map((row) => row.path), ['/nieuw/']);
  });

  await t.test('zonder instellingen gelden de standaardtermijnen', async () => {
    await db.query("INSERT INTO audit_log (action, created_at) VALUES ('test.standaard', now() - interval '20 months')");
    await purgeExpired(db);
    assert.equal((await db.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'test.standaard'"))[0].count, 1);
  });
});
