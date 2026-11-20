/**
 * Tests voor pakket D2: het logboek (`system/app-log.js`: privacyfilter, genormaliseerde paden, buffer met teller,
 * grens per minuut, terugval naar de console, console-koppeling, opschonen), foutcodes en de debugmodus op de
 * foutpagina, de request-id en de pagina Beheer > Logboek (rechten, filters, zoeken op foutcode). Plus migratie M7
 * (tabel en de partiële index voor het opschonen van IP-adressen). De databasetests draaien in een eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { createAppLog, cleanText, cleanData, normalizePath, describeError } = require('../src/system/app-log');
const { COOKIE_NAME } = require('../src/crm/auth');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'app_log_test';
const MASTER_KEY = Buffer.alloc(32, 7);
const SETUP_CODE = 'ABCDE-FGHJK-LMNPQ-RSTUV';
const ADMIN_PASSWORD = 'correct paard batterij';

test('privacyfilter, paden en foutbeschrijving', () => {
  const text = cleanText('mail jan@example.nl, iban NL91 ABNA 0417 1643 00, postgres://avanta:geheim@db/avanta, Bearer abcdefghijkl, password=hunter2\nnieuwe regel');
  assert.doesNotMatch(text, /jan@example|NL91|geheim|abcdefghijkl|hunter2/);
  assert.match(text, /\*\*\*@\*\*\*/);
  assert.doesNotMatch(text, /\n/);
  assert.equal(cleanText('x'.repeat(900)).length, 500);
  assert.deepEqual(cleanData({ wachtwoord: 'a', token: 'b', email: 'c', nested: { naam: 'ok', geboortedatum: '1990' } }), { wachtwoord: '***', token: '***', email: '***', nested: { naam: 'ok', geboortedatum: '***' } });
  assert.equal(normalizePath('/app/gebruikers/12/?zoek=jan'), '/app/gebruikers/:id/');
  assert.equal(normalizePath('/reset/abcdefghij1234567890abcdef/'), '/reset/:token/');
  assert.equal(normalizePath('/x/jan%40example.nl'), '/x/:waarde');
  const described = describeError(Object.assign(new Error('relatie "trips" bestaat niet, gebruiker jan@example.nl'), { code: '42P01' }));
  assert.equal(described.code, '42P01');
  assert.doesNotMatch(described.message, /jan@example/);
  assert.ok(described.frames.length === 0 || !described.frames.some((frame) => frame.includes('node_modules')));
});

test('logboek: buffer met teller, grens per minuut, terugval en console', async () => {
  const inserted = [];
  let fail = false;
  const db = { query: async (sql, params) => { if (fail) throw new Error('database weg'); inserted.push({ sql, params }); return []; } };
  const fallback = [];
  let clock = Date.parse('2026-11-22T10:00:00Z');
  const appLog = createAppLog({ db, flushMs: 0, perMinuteLimit: 3, now: () => clock, write: (line) => fallback.push(line) });
  appLog.warn('app', 'zelfde melding');
  appLog.warn('app', 'zelfde melding');
  appLog.error('fout', 'met code', { errorCode: 'abcd1234', requestId: '0123456789ab' });
  appLog.error('fout', 'met code', { errorCode: 'abcd1235', requestId: 'niet-geldig' });
  assert.equal(appLog.pending(), 3, 'zelfde melding samengevoegd, foutcodes apart');
  assert.equal(await appLog.flush(), 3);
  const params = inserted[0].params;
  assert.equal(params[9], 2, 'teller 2');
  assert.equal(params.filter((value) => value === 'abcd1234').length, 1);
  assert.ok(!params.includes('niet-geldig'));

  // Grens per minuut per bron.
  for (let i = 0; i < 6; i += 1) appLog.info('veel', `regel ${i}`);
  assert.equal(appLog.pending(), 3);
  clock += 60000;
  appLog.info('veel', 'nieuwe minuut');
  assert.equal(appLog.pending(), 4);

  // Database weg: regels naar de terugval, niets gegooid.
  fail = true;
  assert.equal(await appLog.flush(), 0);
  assert.ok(fallback.some((line) => /wegschrijven mislukt/.test(line)));
  assert.equal(appLog.pending(), 0);
  fail = false;

  // Console: warn/error gaan mee (geschoond), daarna terugzetten.
  const originalError = console.error;
  console.error = () => {};
  const restore = appLog.captureConsole();
  console.error('Back-up mislukt voor', 'jan@example.nl');
  restore();
  assert.equal(console.error.name, '');
  console.error = originalError;
  await appLog.flush();
  assert.match(inserted[inserted.length - 1].params[6], /Back-up mislukt voor \*\*\*@\*\*\*/);
});

test('logboek, foutcodes, debugmodus en Beheer > Logboek', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const url = new URL(DATABASE_URL);
  url.searchParams.set('options', `-c search_path=${SCHEMA}`);
  const db = createDatabase(url.toString());
  await db.migrate();
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avanta-log-'));
  const app = createApp({ db, masterKey: MASTER_KEY, setupCode: SETUP_CODE, backupDir });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await db.close(); fs.rmSync(backupDir, { recursive: true, force: true }); });
  const appLog = app.locals.appLog;

  /**
   * Doet een verzoek zonder redirects te volgen.
   * @param {string} pathName Pad.
   * @param {{form?: object, cookie?: string}} [init] Formulier en sessiecookie.
   * @returns {Promise<{status: number, text: string, headers: Headers, cookie: string}>} Antwoord.
   */
  const request = async (pathName, init = {}) => {
    const headers = { 'sec-fetch-site': 'same-origin', 'x-request-id': 'van-buiten' };
    if (init.cookie) headers.cookie = `${COOKIE_NAME}=${init.cookie}`;
    let body;
    if (init.form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(init.form).toString();
    }
    const response = await fetch(base + pathName, { method: init.form ? 'POST' : 'GET', headers, body, redirect: 'manual' });
    const setCookie = response.headers.getSetCookie().find((value) => value.startsWith(`${COOKIE_NAME}=`)) || '';
    return { status: response.status, text: await response.text(), headers: response.headers, cookie: setCookie.split(';')[0].split('=')[1] || '' };
  };
  const csrfFrom = (text) => (text.match(/name="_csrf" value="([^"]+)"/) || [])[1];

  // M7: tabel en de partiële index op audit_log.
  const [index] = await db.query("SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND indexname = 'audit_log_ip_idx'", [SCHEMA]);
  assert.match(index.indexdef, /WHERE \(ip_prefix IS NOT NULL\)/);

  const installed = await request('/app/installatie/', { form: { code: SETUP_CODE, name: 'Daniël', email: 'beheer@example.nl', password: ADMIN_PASSWORD, password2: ADMIN_PASSWORD } });
  const cookie = installed.cookie;
  const csrf = csrfFrom((await request('/app/', { cookie })).text);
  await request('/app/gebruikers/nieuw/', { cookie, form: { _csrf: csrf, name: 'Kantoor', email: 'kantoor@example.nl', role: 'kantoor', password: 'kantoor wachtwoord 1' } });
  const office = await request('/app/inloggen/', { form: { email: 'kantoor@example.nl', password: 'kantoor wachtwoord 1' } });

  // Request-id: eigen id, nooit die van buiten.
  const home = await request('/');
  assert.match(home.headers.get('x-request-id'), /^[0-9a-f]{12}$/);

  // Een fout op de publieke site: foutcode op de pagina en in het logboek, zonder details (ook niet in debugmodus).
  await app.locals.settings.update({ values: { debugMode: true } });
  await db.query('ALTER TABLE trips RENAME TO trips_weg');
  const broken = await request('/reis/?email=jan@example.nl');
  await db.query('ALTER TABLE trips_weg RENAME TO trips');
  assert.equal(broken.status, 500);
  const code = (broken.text.match(/foutcode <strong>([0-9a-f]{8})<\/strong>/) || [])[1];
  assert.ok(code, 'foutcode op de pagina');
  assert.doesNotMatch(broken.text, /Details \(debugmodus\)/, 'bezoeker ziet nooit details');
  await appLog.flush();
  const [row] = await db.query('SELECT level, source, request_id, message, data FROM app_logs WHERE error_code = $1', [code]);
  assert.equal(row.level, 'error');
  assert.equal(row.source, 'fout');
  assert.equal(row.request_id, broken.headers.get('x-request-id'));
  assert.equal(row.data.path, '/reis/');
  assert.equal(row.data.code, '42P01');
  assert.doesNotMatch(JSON.stringify(row), /jan@example/);

  // Debugmodus: een beheerder ziet de details; uit = alleen de foutcode.
  await db.query('ALTER TABLE schema_migrations RENAME TO schema_migrations_weg');
  const debugPage = await request('/app/beheer/', { cookie });
  await app.locals.settings.update({ values: { debugMode: false } });
  const plainPage = await request('/app/beheer/', { cookie });
  await db.query('ALTER TABLE schema_migrations_weg RENAME TO schema_migrations');
  assert.equal(debugPage.status, 500);
  assert.match(debugPage.text, /Details \(debugmodus\)/);
  assert.match(debugPage.text, /42P01/);
  assert.equal(plainPage.status, 500);
  assert.doesNotMatch(plainPage.text, /Details \(debugmodus\)/);

  // Beheer > Logboek: alleen recht systeem; zoeken op foutcode, filter op niveau; opschonen op bewaartermijn.
  appLog.info('app', 'gewone melding');
  assert.equal((await request('/app/beheer/logboek/', { cookie: office.cookie })).status, 403);
  const all = await request('/app/beheer/logboek/', { cookie });
  assert.equal(all.status, 200);
  assert.match(all.text, /gewone melding/);
  const byCode = await request(`/app/beheer/logboek/?zoek=${code}`, { cookie });
  assert.match(byCode.text, new RegExp(code));
  assert.doesNotMatch(byCode.text, /gewone melding/);
  const errorsOnly = await request('/app/beheer/logboek/?niveau=error&zoek=%25', { cookie });
  assert.doesNotMatch(errorsOnly.text, /gewone melding/);
  assert.equal((await request('/app/beheer/logboek/?niveau=kapot&bron=%3Cx%3E&voor=abc', { cookie })).status, 200);
  await db.query("UPDATE app_logs SET created_at = now() - interval '40 days' WHERE message = 'gewone melding'");
  await appLog.prune();
  assert.equal((await db.query("SELECT count(*)::int AS count FROM app_logs WHERE message = 'gewone melding'"))[0].count, 0);
  assert.ok((await db.query('SELECT count(*)::int AS count FROM app_logs'))[0].count > 0, 'recente regels blijven');
});
