/**
 * Tests voor de hersteltests (pakket C3): de uitslag van het hostscript (metingen → geslaagd/waarschuwing/mislukt,
 * opnieuw gecontroleerd en begrensd), de opdrachtregel (uitslag vastleggen, ontsleutelen naar stdout), de test van de
 * Google Drive-kopie (identiek, afwijkend, niet gekoppeld, onleesbaar, wekelijks) en Beheer (rechten, CSRF, aanvragen
 * met audit en limiet). De databasetests draaien in een eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const backups = require('../src/backup/backups');
const { createRestoreTests, evaluateRun, parseCounts, recordHostRun, readRuns, HOST_FILE, DRIVE_FILE, REQUEST_FILE } = require('../src/backup/restore-test');
const { COOKIE_NAME } = require('../src/crm/auth');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'restore_test';
const MASTER_KEY = Buffer.alloc(32, 4);
const SETUP_CODE = 'ABCDE-FGHJK-LMNPQ-RSTUV';
const ADMIN_PASSWORD = 'correct paard batterij';
const CLI = path.join(__dirname, '..', 'src', 'backup', 'cli.js');

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
 * Een tijdelijke map die na de test wordt opgeruimd.
 * @param {object} t Testcontext.
 * @returns {string} Pad.
 */
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avanta-hersteltest-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('hersteltest: uitslag uit de metingen van het hostscript', () => {
  assert.deepEqual(parseCounts('pages=12,trips=3,kapot,Users=1,x=-1,settings=0'), { pages: 12, trips: 3, settings: 0 });
  const now = Date.parse('2026-11-22T03:40:00Z');
  const base = { trigger: 'schema', startedAt: '2026-11-22T03:30:00Z', backup: 'avanta-20261122-020000.dump.enc', schemaVersion: 6 };

  const running = evaluateRun({ ...base, state: 'bezig' }, now);
  assert.equal(running.state, 'bezig');
  assert.equal(running.finishedAt, '');
  assert.equal(evaluateRun({ ...base, state: 'mislukt', message: 'Terugzetten met pg_restore mislukt.' }, now).message, 'Terugzetten met pg_restore mislukt.');

  const ok = evaluateRun({ ...base, restored: 'pages=100,trips=40,users=2', live: 'pages=104,trips=40,users=2', appOk: true }, now);
  assert.equal(ok.state, 'geslaagd');
  assert.equal(ok.tables, 3);
  assert.equal(ok.rows, 142);
  assert.equal(ok.finishedAt, '2026-11-22T03:40:00.000Z');

  const warning = evaluateRun({ ...base, restored: 'pages=100,trips=40,users=2', live: 'pages=200,trips=41,users=3,bookings=5', appOk: true }, now);
  assert.equal(warning.state, 'waarschuwing');
  assert.deepEqual(warning.differences, [{ table: 'bookings', restored: null, live: 5 }, { table: 'pages', restored: 100, live: 200 }]);

  assert.equal(evaluateRun({ ...base, restored: '', live: 'pages=1', appOk: true }, now).state, 'mislukt');
  const noApp = evaluateRun({ ...base, restored: 'pages=1', live: 'pages=1', appOk: false }, now);
  assert.equal(noApp.state, 'mislukt');
  assert.match(noApp.message, /app start niet/);
  const odd = evaluateRun({ trigger: 'iets', backup: '../master-key', startedAt: 'gisteren', state: 'mislukt', message: 'a\nb' }, now);
  assert.equal(odd.trigger, 'schema');
  assert.equal(odd.backup, '');
  assert.equal(odd.message, 'a b');
});

test('hersteltest: runs vastleggen en terugzien', (t) => {
  const dir = tempDir(t);
  assert.deepEqual(readRuns(dir, HOST_FILE), []);
  const startedAt = new Date().toISOString();
  recordHostRun(dir, { trigger: 'handmatig', startedAt, state: 'bezig' });
  assert.equal(readRuns(dir, HOST_FILE)[0].state, 'bezig');
  recordHostRun(dir, { trigger: 'handmatig', startedAt, restored: 'pages=1', live: 'pages=1', appOk: true });
  const runs = readRuns(dir, HOST_FILE);
  assert.equal(runs.length, 1, 'de lopende run wordt vervangen');
  assert.equal(runs[0].state, 'geslaagd');
  // Een run die al ruim een uur "bezig" is, telt als afgebroken; rommel in het bestand valt weg.
  fs.writeFileSync(path.join(dir, HOST_FILE), JSON.stringify({ runs: [
    { state: 'bezig', startedAt: '2026-11-01T00:00:00Z', trigger: 'schema' },
    { state: 'gehackt', startedAt: '2026-11-01T00:00:00Z' },
    { state: 'geslaagd', startedAt: '2026-10-01T00:00:00Z', differences: [{ table: 'DROP TABLE', restored: 1 }], message: '<script>' },
  ] }));
  const cleaned = readRuns(dir, HOST_FILE);
  assert.equal(cleaned.length, 2);
  assert.equal(cleaned[0].state, 'mislukt');
  assert.match(cleaned[0].message, /Afgebroken/);
  assert.deepEqual(cleaned[1].differences, []);
  for (let i = 0; i < 15; i += 1) recordHostRun(dir, { startedAt: new Date(Date.UTC(2026, 10, 1, i)).toISOString(), state: 'mislukt' });
  assert.equal(readRuns(dir, HOST_FILE).length, 12, 'hoogstens 12 runs');
});

test('hersteltest: opdrachtregel legt de uitslag vast', (t) => {
  const dataDir = tempDir(t);
  const run = spawnSync(process.execPath, [CLI, 'restore-test-result'], {
    input: JSON.stringify({ trigger: 'schema', startedAt: new Date().toISOString(), backup: 'avanta-20261122-020000.dump.enc', restored: 'pages=3', live: 'pages=3', appOk: true }),
    env: { ...process.env, DATA_DIR: dataDir },
  });
  assert.equal(run.status, 0, run.stderr.toString());
  assert.match(run.stdout.toString(), /Hersteltest vastgelegd: geslaagd/);
  assert.equal(readRuns(path.join(dataDir, 'backups'), HOST_FILE)[0].backup, 'avanta-20261122-020000.dump.enc');
  const broken = spawnSync(process.execPath, [CLI, 'restore-test-result'], { input: 'geen json', env: { ...process.env, DATA_DIR: dataDir } });
  assert.equal(broken.status, 1);
});

test('hersteltest: Google Drive-kopie', async (t) => {
  const dir = tempDir(t);
  const name = 'avanta-20261122-020000.dump.enc';
  // Een echte, versleutelde "dump" zonder pg_dump: kop + versleutelde PGDMP-inhoud via een eigen kleine back-up.
  const fakeDump = path.join(dir, 'echt.dump');
  fs.writeFileSync(fakeDump, Buffer.concat([Buffer.from('PGDMP'), Buffer.alloc(2000, 1)]));
  const fakePgDump = path.join(dir, 'pg_dump');
  fs.writeFileSync(fakePgDump, `#!/bin/sh\ncat ${fakeDump}\n`, { mode: 0o755 });
  const db = { query: async () => [{ name: 'public' }] };
  const made = await backups.createBackup({ db, connectionString: 'postgres://u:p@localhost/db', dir, masterKey: MASTER_KEY, pgDumpPath: fakePgDump, now: () => Date.parse('2026-11-22T02:00:00Z') });
  assert.equal(made.name, name);

  let remote = fs.readFileSync(path.join(dir, name));
  let connected = true;
  const drive = {
    connected: () => connected,
    listRemote: async () => (remote ? [{ id: 'x', name, size: remote.length }] : []),
    download: async (fileName, target) => { fs.writeFileSync(target, remote); return { name: fileName, size: remote.length }; },
  };
  let clock = Date.parse('2026-11-22T06:00:00Z');
  const tests = createRestoreTests({ dir, masterKey: MASTER_KEY, drive, now: () => (clock += 1000) });

  const ok = await tests.runDriveTest({ trigger: 'handmatig' });
  assert.equal(ok.state, 'geslaagd', ok.message);
  assert.match(ok.message, /identiek aan de back-up op de server/);
  assert.equal(fs.readdirSync(dir).filter((file) => file.includes('drive-hersteltest')).length, 0, 'download opgeruimd');

  // Op Drive een andere, wel geldige back-up met dezelfde naam: waarschuwing.
  fs.renameSync(path.join(dir, name), path.join(dir, 'bewaard.enc'));
  await backups.createBackup({ db, connectionString: 'postgres://u:p@localhost/db', dir, masterKey: MASTER_KEY, pgDumpPath: fakePgDump, now: () => Date.parse('2026-11-22T02:00:00Z') });
  remote = fs.readFileSync(path.join(dir, 'bewaard.enc'));
  assert.equal((await tests.runDriveTest()).state, 'waarschuwing');

  remote = Buffer.from('beschadigd en helemaal geen back-up van Avanta, maar wel lang genoeg');
  const damaged = await tests.runDriveTest();
  assert.equal(damaged.state, 'mislukt');
  assert.match(damaged.message, /Geen back-up van Avanta/);
  remote = null;
  assert.match((await tests.runDriveTest()).message, /nog geen back-up op Google Drive/);
  connected = false;
  assert.match((await tests.runDriveTest()).message, /niet gekoppeld/);
  assert.equal(tests.driveRuns().length, 5);

  // Wekelijks: niet binnen een week na de vorige test, niet als Drive uit staat.
  connected = true;
  remote = fs.readFileSync(path.join(dir, 'bewaard.enc'));
  assert.equal(await tests.driveTestIfDue(true), null);
  clock += 8 * 24 * 60 * 60 * 1000;
  assert.equal(await tests.driveTestIfDue(false), null);
  assert.ok(await tests.driveTestIfDue(true));
  assert.equal(readRuns(dir, DRIVE_FILE)[0].trigger, 'schema');

  // Ontsleutelen naar stdout (voor het hostscript): echte dump, en code 1 bij een beschadigde back-up.
  const env = { ...process.env, DATA_DIR: dir, AVANTA_MASTER_KEY: MASTER_KEY.toString('hex') };
  const out = spawnSync(process.execPath, [CLI, 'decrypt', path.join(dir, name), '-'], { env });
  assert.equal(out.status, 0, out.stderr.toString());
  assert.deepEqual(out.stdout, fs.readFileSync(fakeDump));
  const bytes = fs.readFileSync(path.join(dir, name));
  bytes[bytes.length - 30] ^= 0xff;
  fs.writeFileSync(path.join(dir, 'avanta-20200101-000000.dump.enc'), bytes);
  assert.equal(spawnSync(process.execPath, [CLI, 'decrypt', path.join(dir, 'avanta-20200101-000000.dump.enc'), '-'], { env }).status, 1);
  const noKey = spawnSync(process.execPath, [CLI, 'decrypt', path.join(dir, name), '-'], { env: { ...process.env, DATA_DIR: tempDir(t), AVANTA_MASTER_KEY: '' } });
  assert.equal(noKey.status, 1);
  assert.match(noKey.stderr.toString(), /Geen hoofdsleutel/);
});

test('hersteltest in Beheer', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  const dir = tempDir(t);
  const app = createApp({ db, masterKey: MASTER_KEY, setupCode: SETUP_CODE, backupDir: dir });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await db.close(); });

  /**
   * Doet een verzoek zonder redirects te volgen.
   * @param {string} pathName Pad.
   * @param {{form?: object, cookie?: string}} [init] Formulier en sessiecookie.
   * @returns {Promise<{status: number, text: string, headers: Headers, cookie: string}>} Antwoord.
   */
  const request = async (pathName, init = {}) => {
    const headers = { 'sec-fetch-site': 'same-origin' };
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

  const installed = await request('/app/installatie/', { form: { code: SETUP_CODE, name: 'Daniël', email: 'beheer@example.nl', password: ADMIN_PASSWORD, password2: ADMIN_PASSWORD } });
  const cookie = installed.cookie;
  const csrf = csrfFrom((await request('/app/', { cookie })).text);
  await request('/app/gebruikers/nieuw/', { cookie, form: { _csrf: csrf, name: 'Kantoor', email: 'kantoor@example.nl', role: 'kantoor', password: 'kantoor wachtwoord 1' } });
  const office = await request('/app/inloggen/', { form: { email: 'kantoor@example.nl', password: 'kantoor wachtwoord 1' } });
  const officeCsrf = csrfFrom((await request('/app/', { cookie: office.cookie })).text);

  recordHostRun(dir, { trigger: 'schema', startedAt: '2026-11-22T03:30:00Z', backup: 'avanta-20261122-020000.dump.enc', restored: 'pages=10', live: 'pages=50', appOk: true });
  const page = await request('/app/beheer/hersteltest/', { cookie });
  assert.equal(page.status, 200);
  assert.match(page.text, /Waarschuwing/);
  assert.match(page.text, /pages 10 → 50/);
  assert.match(page.text, /De kopie naar Google Drive staat uit/);
  assert.equal((await request('/app/beheer/hersteltest/', { cookie: office.cookie })).status, 403);
  for (const kind of ['server', 'drive']) {
    assert.equal((await request(`/app/beheer/hersteltest/${kind}/`, { cookie: office.cookie, form: { _csrf: officeCsrf } })).status, 403, kind);
    assert.equal((await request(`/app/beheer/hersteltest/${kind}/`, { cookie, form: { _csrf: 'fout' } })).status, 403, `${kind}: CSRF`);
  }
  assert.equal((await request('/app/beheer/hersteltest/drive/', { cookie, form: { _csrf: csrf } })).status, 422, 'Drive staat uit');

  const requested = await request('/app/beheer/hersteltest/server/', { cookie, form: { _csrf: csrf } });
  assert.equal(requested.status, 303);
  assert.ok(fs.existsSync(path.join(dir, REQUEST_FILE)));
  assert.match((await request('/app/beheer/hersteltest/', { cookie })).text, /aangevraagd of bezig/);
  const [audit] = await db.query("SELECT u.email, a.entity_id FROM audit_log a JOIN users u ON u.id = a.user_id WHERE a.action = 'hersteltest.aangevraagd'");
  assert.deepEqual(audit, { email: 'beheer@example.nl', entity_id: 'server' });
  assert.equal((await request('/app/beheer/hersteltest/server/', { cookie, form: { _csrf: csrf } })).status, 303);
  assert.equal((await request('/app/beheer/hersteltest/server/', { cookie, form: { _csrf: csrf } })).status, 303);
  assert.equal((await request('/app/beheer/hersteltest/server/', { cookie, form: { _csrf: csrf } })).status, 429, 'hoogstens 3 per uur');
});
