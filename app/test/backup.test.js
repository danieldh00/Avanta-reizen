/**
 * Tests voor de versleutelde back-ups (pakket C1): verbindingsgegevens voor pg_dump, de planner (uur in Nederlandse
 * tijd, één per dag, wachten na een fout), bewaartermijn, het bestandsformaat (echte pg_dump, ontsleutelen, andere
 * hoofdsleutel, beschadiging) en Beheer (rechten, CSRF, Nu maken, lijst, downloaden met audit, limiet). De
 * databasetests draaien in een eigen schema en een tijdelijke map.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Writable } = require('node:stream');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const backups = require('../src/backup/backups');
const { formatBytes, describeNext } = require('../src/beheer/backup-routes');
const { COOKIE_NAME } = require('../src/crm/auth');
const { loginWithTwoFactor } = require('./helpers/two-factor');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'backup_test';
const MASTER_KEY = Buffer.alloc(32, 7);
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

/**
 * Een tijdelijke map die na de test wordt opgeruimd.
 * @param {object} t Testcontext.
 * @returns {string} Pad.
 */
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avanta-backup-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Nep-instellingen voor de back-updienst.
 * @param {object} values Afwijkende waarden.
 * @returns {{get: Function, ready: Function}} Instellingen.
 */
function fakeSettings(values = {}) {
  const all = { backupEnabled: true, backupHour: 3, backupKeepDays: 14, ...values };
  return { get: (key) => all[key], ready: async () => {} };
}

/**
 * De opties waarmee het hostscript van de hersteltest (`deploy/apps01/restore-test.sh`) `pg_restore` aanroept.
 * @returns {string[]} Opties zoals `--clean`, in de volgorde van het script.
 */
function restoreTestOptions() {
  const script = fs.readFileSync(path.join(__dirname, '..', '..', 'deploy', 'apps01', 'restore-test.sh'), 'utf8');
  const command = /pg_restore -U postgres -d postgres([\s\S]*?)2>/.exec(script);
  assert.ok(command, 'pg_restore-aanroep in restore-test.sh gevonden');
  return command[1].split(/\s+/).filter((part) => part.startsWith('--'));
}

/**
 * Zet een dump terug zoals de hersteltest dat doet: in een nieuwe database waarin het schema van de dump al bestaat
 * (zoals `public` in elke nieuwe database), met de opties uit het hostscript. Controleert ook dat het zonder
 * `--clean --if-exists` mislukt, zodat deze test de fout van een lege `public` echt vangt.
 * @param {string} dumpFile Ontsleutelde dump.
 * @param {string} pgRestore Pad van `pg_restore`.
 * @returns {Promise<void>}
 */
async function assertRestorableAsInRestoreTest(dumpFile, pgRestore) {
  const options = restoreTestOptions();
  assert.ok(options.includes('--clean') && options.includes('--if-exists'), 'hersteltest zet terug met --clean --if-exists');
  const database = `hersteltest_${process.pid}`;
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP DATABASE IF EXISTS ${database}`);
  await admin.query(`CREATE DATABASE ${database}`);
  const targetUrl = new URL(DATABASE_URL);
  targetUrl.pathname = `/${database}`;
  targetUrl.search = '';
  const target = createDatabase(targetUrl.toString());
  try {
    const restore = (flags) => {
      try {
        execFileSync(pgRestore, [...flags, '-d', targetUrl.toString(), dumpFile], { stdio: ['ignore', 'pipe', 'pipe'] });
        return '';
      } catch (error) {
        return String(error.stderr);
      }
    };
    await target.query(`CREATE SCHEMA ${SCHEMA}`);
    assert.match(restore(options.filter((flag) => flag !== '--clean' && flag !== '--if-exists')), /already exists/);
    assert.equal(restore(options), '', 'terugzetten met de opties van de hersteltest lukt');
    const [row] = await target.query(`SELECT title FROM ${SCHEMA}.pages WHERE path = '/over-ons/'`);
    assert.equal(row.title, 'Over ons');
  } finally {
    await target.close();
    await admin.query(`DROP DATABASE IF EXISTS ${database}`);
    await admin.close();
  }
}

test('back-up: verbindingsgegevens voor pg_dump zonder wachtwoord in de argumenten', () => {
  assert.deepEqual(backups.pgEnvironment('postgres://avanta:ge%40heim@db:5432/avanta'), {
    PGHOST: 'db', PGPORT: '5432', PGUSER: 'avanta', PGPASSWORD: 'ge@heim', PGDATABASE: 'avanta',
  });
  const withOptions = backups.pgEnvironment('postgresql://u:p@host/db?sslmode=require&options=-c%20search_path%3Dx');
  assert.equal(withOptions.PGPORT, '5432');
  assert.equal(withOptions.PGSSLMODE, 'require');
  assert.equal(withOptions.PGOPTIONS, '-c search_path=x');
  assert.throws(() => backups.pgEnvironment('mysql://u:p@host/db'), /geen PostgreSQL/);
  assert.throws(() => backups.pgEnvironment('geen adres'), /geen geldig/);
});

test('back-up: namen, planner en bewaartermijn', (t) => {
  assert.equal(backups.isBackupName('avanta-20261120-020000.dump.enc'), true);
  assert.equal(backups.isBackupName('../avanta-20261120-020000.dump.enc'), false);
  assert.equal(backups.isBackupName('avanta-20261120-020000.dump'), false);
  assert.equal(backups.dateOfName('avanta-20261120-020304.dump.enc').toISOString(), '2026-11-20T02:03:04.000Z');

  // 20 november 2026: wintertijd, Amsterdam = UTC+1. 02:30 UTC = 03:30 in Nederland.
  const at = (iso) => Date.parse(iso);
  assert.equal(backups.isDue({ now: at('2026-11-20T01:30:00Z'), hour: 3, backups: [] }), false, '02:30 NL: nog niet');
  assert.equal(backups.isDue({ now: at('2026-11-20T02:30:00Z'), hour: 3, backups: [] }), true, '03:30 NL: wel');
  assert.equal(backups.isDue({ now: at('2026-11-20T02:30:00Z'), hour: 3, backups: [{ createdAt: '2026-11-20T02:05:00Z' }] }), false, 'vandaag al gemaakt');
  assert.equal(backups.isDue({ now: at('2026-11-20T02:30:00Z'), hour: 3, backups: [{ createdAt: '2026-11-20T00:30:00Z' }] }), true, 'een back-up van vóór het uur telt niet');
  assert.equal(backups.isDue({ now: at('2026-11-20T02:30:00Z'), hour: 3, backups: [], lastFailAt: '2026-11-20T02:00:00Z' }), false, 'binnen een uur na een fout');
  assert.equal(backups.isDue({ now: at('2026-11-20T03:30:00Z'), hour: 3, backups: [], lastFailAt: '2026-11-20T02:00:00Z' }), true, 'na een uur opnieuw');
  // Zomertijd: 1 juli, Amsterdam = UTC+2.
  assert.equal(backups.isDue({ now: at('2026-07-01T00:30:00Z'), hour: 3, backups: [] }), false);
  assert.equal(backups.isDue({ now: at('2026-07-01T01:00:00Z'), hour: 3, backups: [] }), true);

  const dir = tempDir(t);
  const names = ['20261101-020000', '20261105-020000', '20261110-020000', '20261118-020000', '20261119-020000', '20261120-020000'];
  for (const name of names) fs.writeFileSync(path.join(dir, `avanta-${name}.dump.enc`), 'x');
  fs.writeFileSync(path.join(dir, 'ander-bestand.txt'), 'x');
  const removed = backups.pruneBackups(dir, 7, at('2026-11-20T12:00:00Z'));
  assert.deepEqual(removed.sort(), ['avanta-20261101-020000.dump.enc', 'avanta-20261105-020000.dump.enc', 'avanta-20261110-020000.dump.enc']);
  assert.deepEqual(backups.listBackups(dir).map((item) => item.name), ['avanta-20261120-020000.dump.enc', 'avanta-20261119-020000.dump.enc', 'avanta-20261118-020000.dump.enc']);
  // De nieuwste drie blijven altijd, ook als ze te oud zijn.
  assert.deepEqual(backups.pruneBackups(dir, 1, at('2027-01-01T00:00:00Z')), []);
  assert.ok(fs.existsSync(path.join(dir, 'ander-bestand.txt')));
  assert.deepEqual(backups.listBackups(path.join(dir, 'bestaat-niet')), []);

  assert.equal(formatBytes(512), '512 bytes');
  assert.equal(formatBytes(1536), '1,5 kB');
  assert.equal(describeNext({ enabled: false, hour: 3, now: Date.now(), doneToday: false }), 'Automatische back-ups staan uit.');
  assert.equal(describeNext({ enabled: true, hour: 3, now: at('2026-11-20T01:00:00Z'), doneToday: false }), 'Vandaag rond 03:00 uur.');
  assert.equal(describeNext({ enabled: true, hour: 3, now: at('2026-11-20T05:00:00Z'), doneToday: true }), 'Morgen rond 03:00 uur.');
});

test('back-up: status overleeft een onleesbaar bestand', (t) => {
  const dir = tempDir(t);
  assert.deepEqual(backups.readStatus(dir), { lastRun: null, lastOkAt: '', lastFailAt: '' });
  fs.writeFileSync(path.join(dir, 'status.json'), '{kapot');
  assert.equal(backups.readStatus(dir).lastRun, null);
  backups.writeStatus(dir, { at: '2026-11-20T02:00:00.000Z', ok: false, trigger: 'automatisch', message: 'regel1\nregel2' });
  backups.writeStatus(dir, { at: '2026-11-20T03:00:00.000Z', ok: true, trigger: 'handmatig', name: 'avanta-20261120-030000.dump.enc' });
  const status = backups.readStatus(dir);
  assert.equal(status.lastRun.ok, true);
  assert.equal(status.lastFailAt, '2026-11-20T02:00:00.000Z');
  assert.equal(status.lastOkAt, '2026-11-20T03:00:00.000Z');
});

test('hersteltest: foutregels van pg_restore zonder rijgegevens en veilig voor de JSON-uitslag', (t) => {
  const script = fs.readFileSync(path.join(__dirname, '..', '..', 'deploy', 'apps01', 'restore-test.sh'), 'utf8');
  const functions = ['restore_lines', 'restore_error'].map((name) => {
    const match = new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, 'm').exec(script);
    assert.ok(match, `${name} staat in restore-test.sh`);
    return match[0];
  }).join('\n');
  const dir = tempDir(t);
  const stderr = path.join(dir, 'pg_restore.err');
  fs.writeFileSync(stderr, [
    'pg_restore: error: could not execute query: ERROR:  schema "public" already exists',
    'Command was: CREATE SCHEMA public;',
    'pg_restore: error: COPY failed for table "persons": ERROR:  invalid input "Jan de Vries" \u001b[31m\b\tklaar\r',
    'DETAIL:  Key (email)=(jan@example.com) already exists.',
    'CONTEXT:  COPY persons, line 3, column email: "jan@example.com"',
    'pg_restore: warning: errors ignored on restore: 2',
  ].join('\n'));
  const run = (call) => execFileSync('bash', ['-c', `${functions}\n${call} "$1"`, 'test', stderr]).toString();
  const lines = run('restore_lines');
  assert.equal(lines.split('\n').filter(Boolean).length, 3, 'alleen de regels pg_restore: error|warning');
  assert.doesNotMatch(lines, /Jan de Vries|jan@example\.com|CREATE SCHEMA/, 'geen rijgegevens of SQL');
  assert.match(lines, /table 'persons'/, 'namen blijven leesbaar');
  const message = run('restore_error').trim();
  assert.equal(message, "could not execute query: ERROR: schema 'public' already exists");
  for (const line of lines.split('\n')) {
    assert.doesNotThrow(() => JSON.parse(`{"message":"${line}"}`), 'geldige JSON voor record()');
  }
});

test('hersteltest: de melding noemt de stap die echt mislukte (EPIPE na een fout van pg_restore)', (t) => {
  const script = fs.readFileSync(path.join(__dirname, '..', '..', 'deploy', 'apps01', 'restore-test.sh'), 'utf8');
  const functions = ['restore_lines', 'restore_error', 'decrypt_error', 'restore_failure'].map((name) => {
    const match = new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, 'm').exec(script);
    assert.ok(match, `${name} staat in restore-test.sh`);
    return match[0];
  }).join('\n');
  const dir = tempDir(t);
  /**
   * Draait restore_failure met de gegeven afsluitcodes en foutuitvoer.
   * @param {number} decryptCode Afsluitcode van het ontsleutelen.
   * @param {number} restoreCode Afsluitcode van pg_restore.
   * @param {string} decryptErrors Foutuitvoer van het ontsleutelen.
   * @param {string} restoreErrors Foutuitvoer van pg_restore.
   * @returns {string} De melding (leeg als beide slaagden).
   */
  const failure = (decryptCode, restoreCode, decryptErrors, restoreErrors) => {
    fs.writeFileSync(path.join(dir, 'decrypt.err'), decryptErrors);
    fs.writeFileSync(path.join(dir, 'restore.err'), restoreErrors);
    return execFileSync('bash', ['-c', `${functions}\nrestore_failure "$@"`, 'test', String(decryptCode), String(restoreCode),
      path.join(dir, 'decrypt.err'), path.join(dir, 'restore.err')]).toString().trim();
  };
  const restoreError = 'pg_restore: error: could not execute query: ERROR:  relation "pages" already exists\n';
  assert.equal(failure(1, 1, 'Mislukt: write EPIPE\n', restoreError),
    "Terugzetten met pg_restore mislukt: could not execute query: ERROR: relation 'pages' already exists");
  assert.equal(failure(1, 1, 'Mislukt: Deze back-up is gemaakt met een andere hoofdsleutel.\n',
    'pg_restore: error: input file is too short (read 0, expected 5)\n'),
  'Ontsleutelen mislukt: Deze back-up is gemaakt met een andere hoofdsleutel.');
  assert.equal(failure(0, 1, '', restoreError).startsWith('Terugzetten met pg_restore mislukt: '), true);
  assert.equal(failure(1, 0, 'Mislukt: "Onjuiste tag"\u001b\n', ''), 'Ontsleutelen mislukt: Onjuiste tag');
  assert.equal(failure(0, 0, '', ''), '');
});

test('back-up met pg_dump, planner en Beheer', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const url = withSchema(DATABASE_URL);
  const db = createDatabase(url);
  await db.migrate();
  await db.query("INSERT INTO pages (path, title, body_html) VALUES ('/over-ons/', 'Over ons', '<p>Hallo</p>')");
  t.after(() => db.close());

  await t.test('formaat: echte dump, ontsleutelen, andere sleutel en beschadiging', async (st) => {
    const dir = tempDir(st);
    const backup = await backups.createBackup({ db, connectionString: url, dir, masterKey: MASTER_KEY });
    assert.match(backup.name, backups.BACKUP_NAME);
    assert.ok(backup.size > 100);
    assert.equal(fs.readdirSync(dir).filter((name) => name.endsWith('.part')).length, 0, 'geen tijdelijke bestanden');
    const file = path.join(dir, backup.name);
    assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600');
    assert.equal(fs.readFileSync(file).subarray(0, 4).toString(), 'AVBK');
    assert.doesNotMatch(fs.readFileSync(file).toString('latin1'), /PGDMP|over-ons/, 'niets leesbaar');

    // Ontsleuteld is het een gewone pg_dump met de tabellen van het schema.
    const dumpFile = path.join(dir, 'terug.dump');
    await backups.decryptTo(file, MASTER_KEY, fs.createWriteStream(dumpFile));
    const pgRestore = path.join(path.dirname(execFileSync('sh', ['-c', `command -v ${process.env.PG_DUMP_PATH || 'pg_dump'}`]).toString().trim()), 'pg_restore');
    const contents = execFileSync(fs.existsSync(pgRestore) ? pgRestore : 'pg_restore', ['--list', dumpFile]).toString();
    assert.match(contents, new RegExp(`TABLE ${SCHEMA} pages`));
    assert.match(contents, new RegExp(`TABLE DATA ${SCHEMA} settings`));

    await assertRestorableAsInRestoreTest(dumpFile, fs.existsSync(pgRestore) ? pgRestore : 'pg_restore');

    await assert.rejects(backups.verifyBackup(file, Buffer.alloc(32, 1)), /andere hoofdsleutel/);
    // Na een sleutelrotatie: de huidige plus de vorige sleutels; de sleutel met het id uit de kop wordt gekozen.
    assert.ok((await backups.verifyBackup(file, [Buffer.alloc(32, 1), MASTER_KEY])).bytes > 0);
    await assert.rejects(backups.verifyBackup(file, [Buffer.alloc(32, 1), Buffer.alloc(32, 2)]), /andere hoofdsleutel/);
    const damaged = path.join(dir, 'avanta-20200101-000000.dump.enc');
    const bytes = fs.readFileSync(file);
    bytes[bytes.length - 40] ^= 0xff;
    fs.writeFileSync(damaged, bytes);
    await assert.rejects(backups.verifyBackup(damaged, MASTER_KEY), /Ontsleutelen mislukt/);
    fs.writeFileSync(damaged, 'geen back-up maar wel lang genoeg om de kop te lezen, echt waar');
    await assert.rejects(backups.verifyBackup(damaged, MASTER_KEY), /Geen back-up van Avanta/);
    const sink = new Writable({ write: (chunk, encoding, callback) => callback() });
    await assert.rejects(backups.decryptTo(path.join(dir, 'terug.dump'), MASTER_KEY, sink), /Geen back-up van Avanta/);
  });

  await t.test('mislukte pg_dump: niets achtergelaten en vastgelegd', async (st) => {
    const dir = tempDir(st);
    const service = backups.createBackupService({ db, settings: fakeSettings(), dir, masterKey: MASTER_KEY, connectionString: url, pgDumpPath: '/bestaat/niet/pg_dump' });
    await assert.rejects(service.run({ trigger: 'handmatig' }), /pg_dump starten mislukt/);
    assert.deepEqual(fs.readdirSync(dir).filter((name) => name !== 'status.json'), []);
    assert.equal(service.status().lastRun.ok, false);
    const wrongPassword = new URL(url);
    wrongPassword.password = 'fout';
    const wrong = backups.createBackupService({ db, settings: fakeSettings(), dir, masterKey: MASTER_KEY, connectionString: wrongPassword.toString() });
    const error = await wrong.run().catch((caught) => caught);
    assert.match(error.message, /pg_dump mislukt/);
    assert.doesNotMatch(error.message, /fout@/, 'geen wachtwoord in de melding');
    assert.deepEqual(fs.readdirSync(dir).filter((name) => name !== 'status.json'), [], 'ook na een snelle fout geen .part');
    // Synchrone fout bij het starten (NUL-teken in het pad): ook dan geen .part.
    await assert.rejects(backups.createBackup({ db, connectionString: url, dir, masterKey: MASTER_KEY, pgDumpPath: 'pg_dump\0x' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(fs.readdirSync(dir).filter((name) => name !== 'status.json'), [], 'ook na een synchrone fout geen .part');
    // Een mislukte auditregel maakt een geslaagde back-up niet "mislukt".
    const failingAudit = backups.createBackupService({ db, settings: fakeSettings(), dir, masterKey: MASTER_KEY, connectionString: url });
    const made = await failingAudit.run({ trigger: 'handmatig', audit: async () => { throw new Error('audit stuk'); } });
    assert.ok(fs.existsSync(path.join(dir, made.name)));
    assert.equal(failingAudit.status().lastRun.ok, true);
  });

  await t.test('planner: één per dag op het ingestelde uur, wachten na een fout', async (st) => {
    const dir = tempDir(st);
    let clock = Date.parse('2026-11-20T01:30:00Z');
    const settings = fakeSettings();
    const service = backups.createBackupService({ db, settings, dir, masterKey: MASTER_KEY, connectionString: url, now: () => clock });
    assert.equal(await service.runIfDue(), null, 'vóór 03:00');
    clock = Date.parse('2026-11-20T02:10:00Z');
    const made = await service.runIfDue();
    assert.equal(made.name, 'avanta-20261120-021000.dump.enc');
    clock += 15 * 60 * 1000;
    assert.equal(await service.runIfDue(), null, 'vandaag al gedaan');
    const [audit] = await db.query("SELECT user_id, entity_id FROM audit_log WHERE action = 'backup.gemaakt' ORDER BY id DESC LIMIT 1");
    assert.deepEqual(audit, { user_id: null, entity_id: made.name });
    clock = Date.parse('2026-11-21T02:10:00Z');
    const off = backups.createBackupService({ db, settings: fakeSettings({ backupEnabled: false }), dir, masterKey: MASTER_KEY, connectionString: url, now: () => clock });
    assert.equal(await off.runIfDue(), null, 'uitgezet');
    const broken = backups.createBackupService({ db, settings, dir, masterKey: MASTER_KEY, connectionString: url, pgDumpPath: '/bestaat/niet', now: () => clock });
    await assert.rejects(broken.runIfDue(), /pg_dump/);
    clock += 30 * 60 * 1000;
    assert.equal(await service.runIfDue(), null, 'binnen een uur na de fout');
    clock += 31 * 60 * 1000;
    assert.ok(await service.runIfDue(), 'na een uur opnieuw');
    const unavailable = backups.createBackupService({ db, settings, dir, masterKey: MASTER_KEY });
    assert.equal(unavailable.available(), false);
    assert.equal(await unavailable.runIfDue(), null);
  });

  await t.test('Beheer: rechten, Nu maken, lijst, downloaden en limiet', async (st) => {
    const dir = tempDir(st);
    const app = createApp({ db, masterKey: MASTER_KEY, setupCode: SETUP_CODE, databaseUrl: url, backupDir: dir });
    const server = app.listen(0);
    st.after(() => server.close());
    const base = `http://127.0.0.1:${server.address().port}`;

    /**
     * Doet een verzoek zonder redirects te volgen.
     * @param {string} pathName Pad.
     * @param {{form?: object, cookie?: string}} [init] Formulier en sessiecookie.
     * @returns {Promise<{status: number, text: string, headers: Headers, cookie: string, bytes: Buffer}>} Antwoord.
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
      const bytes = Buffer.from(await response.arrayBuffer());
      return { status: response.status, text: bytes.toString('utf8'), bytes, headers: response.headers, cookie: setCookie.split(';')[0].split('=')[1] || '' };
    };
    const csrfFrom = (text) => (text.match(/name="_csrf" value="([^"]+)"/) || [])[1];

    const installed = await request('/app/installatie/', { form: { code: SETUP_CODE, name: 'Daniël', email: 'beheer@example.nl', password: ADMIN_PASSWORD, password2: ADMIN_PASSWORD } });
    const cookie = installed.cookie;
    const csrf = csrfFrom((await request('/app/', { cookie })).text);
    await request('/app/gebruikers/nieuw/', { cookie, form: { _csrf: csrf, name: 'Kantoor', email: 'kantoor@example.nl', role: 'kantoor', password: 'kantoor wachtwoord 1' } });
    const office = await loginWithTwoFactor(request, 'kantoor@example.nl', 'kantoor wachtwoord 1', { admin: { cookie, csrf } });
    const officeCsrf = csrfFrom((await request('/app/', { cookie: office.cookie })).text);

    const empty = await request('/app/beheer/back-ups/', { cookie });
    assert.equal(empty.status, 200);
    assert.match(empty.text, /Er staan nog geen back-ups op de server/);
    assert.match(empty.text, new RegExp(app.locals.backups.keyId()));
    assert.equal((await request('/app/beheer/back-ups/', { cookie: office.cookie })).status, 403);
    assert.equal((await request('/app/beheer/back-ups/nu/', { cookie: office.cookie, form: { _csrf: officeCsrf } })).status, 403);
    assert.equal((await request('/app/beheer/back-ups/nu/', { cookie, form: { _csrf: 'fout' } })).status, 403, 'CSRF');
    assert.equal((await request('/app/beheer/back-ups/nu/', { form: { _csrf: csrf } })).status, 401, 'niet ingelogd');
    assert.equal(fs.readdirSync(dir).filter(backups.isBackupName).length, 0);

    const made = await request('/app/beheer/back-ups/nu/', { cookie, form: { _csrf: csrf } });
    assert.equal(made.status, 303);
    assert.equal(made.headers.get('location'), '/app/beheer/back-ups/?gestart=1#status');
    await app.locals.backups.idle();
    const after = await request('/app/beheer/back-ups/?gestart=1', { cookie });
    assert.match(after.text, /Back-up gemaakt: avanta-\d{8}-\d{6}\.dump\.enc/);
    const [item] = app.locals.backups.list();
    assert.match(after.text, new RegExp(`/app/beheer/back-ups/download/${item.name.replace(/\./g, '\\.')}`));
    const [created] = await db.query("SELECT u.email, a.ip_prefix FROM audit_log a JOIN users u ON u.id = a.user_id WHERE a.action = 'backup.gemaakt' AND a.entity_id = $1", [item.name]);
    assert.deepEqual(created, { email: 'beheer@example.nl', ip_prefix: '127.0.0.0/24' }, 'met gebruiker en IP-voorvoegsel');
    const [started] = await db.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'backup.gestart'");
    assert.equal(started.count, 1);

    assert.equal((await request(`/app/beheer/back-ups/download/${item.name}`, { cookie: office.cookie })).status, 403);
    const download = await request(`/app/beheer/back-ups/download/${item.name}`, { cookie });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), 'application/octet-stream');
    assert.equal(download.headers.get('cache-control'), 'no-store');
    assert.match(download.headers.get('content-disposition'), new RegExp(`attachment; filename="${item.name}"`));
    assert.deepEqual(download.bytes, fs.readFileSync(path.join(dir, item.name)));
    const downloads = await db.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'backup.gedownload' AND entity_id = $1", [item.name]);
    assert.equal(downloads[0].count, 1);
    assert.equal((await request('/app/beheer/back-ups/download/avanta-20000101-000000.dump.enc', { cookie })).status, 404, 'bestaat niet');
    assert.equal((await request('/app/beheer/back-ups/download/status.json', { cookie })).status, 404, 'geen back-up');
    assert.equal((await request('/app/beheer/back-ups/download/..%2Fmaster-key', { cookie })).status, 404, 'geen pad');

    // Instellingen opslaan werkt via het gewone formulier.
    const saved = await request('/app/beheer/back-ups/', { cookie, form: { _csrf: csrf, backupHour: '4', backupKeepDays: '30' } });
    assert.equal(saved.status, 303);
    assert.equal(app.locals.settings.get('backupEnabled'), false, 'vinkje uit = uit');
    assert.equal(app.locals.settings.get('backupHour'), 4);
    assert.equal((await request('/app/beheer/back-ups/', { cookie, form: { _csrf: csrf, backupEnabled: 'ja', backupHour: '24', backupKeepDays: '30' } })).status, 422);

    // Hoogstens 6 handmatige back-ups per uur (een lopende telt niet opnieuw mee).
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await request('/app/beheer/back-ups/nu/', { cookie, form: { _csrf: csrf } })).status, 303);
      await app.locals.backups.idle();
    }
    assert.equal((await request('/app/beheer/back-ups/nu/', { cookie, form: { _csrf: csrf } })).status, 429);
    // Hoogstens 10 downloads per uur (al gebruikt: één download en twee 404's).
    for (let i = 0; i < 7; i += 1) assert.equal((await request(`/app/beheer/back-ups/download/${item.name}`, { cookie })).status, 200);
    assert.equal((await request(`/app/beheer/back-ups/download/${item.name}`, { cookie })).status, 429);
  });

  await t.test('Beheer: twee keer Nu maken tegelijk of tijdens een lopende back-up', async (st) => {
    const dir = tempDir(st);
    // Een trage pg_dump (eerst een seconde wachten), zodat de back-up nog loopt bij de volgende verzoeken.
    const realPgDump = execFileSync('sh', ['-c', `command -v ${process.env.PG_DUMP_PATH || 'pg_dump'}`]).toString().trim();
    const slowPgDump = path.join(dir, 'trage-pg_dump');
    fs.writeFileSync(slowPgDump, `#!/bin/sh\nsleep 1\nexec ${realPgDump} "$@"\n`, { mode: 0o755 });
    await db.query('TRUNCATE users CASCADE');
    const app = createApp({ db, masterKey: MASTER_KEY, setupCode: SETUP_CODE, databaseUrl: url, backupDir: dir, pgDumpPath: slowPgDump });
    const server = app.listen(0);
    st.after(() => server.close());
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (pathName, cookie, form) => fetch(base + pathName, {
      method: 'POST', redirect: 'manual',
      headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie: `${COOKIE_NAME}=${cookie}` } : {}) },
      body: new URLSearchParams(form).toString(),
    });
    const installed = await post('/app/installatie/', '', { code: SETUP_CODE, name: 'Daniël', email: 'beheer@example.nl', password: ADMIN_PASSWORD, password2: ADMIN_PASSWORD });
    const cookie = installed.headers.getSetCookie().find((value) => value.startsWith(`${COOKIE_NAME}=`)).split(';')[0].split('=')[1];
    const home = await (await fetch(`${base}/app/`, { headers: { cookie: `${COOKIE_NAME}=${cookie}` } })).text();
    const csrf = /name="_csrf" value="([^"]+)"/.exec(home)[1];
    const before = (await db.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'backup.gestart'"))[0].count;
    const answers = await Promise.all([1, 2, 3].map(() => post('/app/beheer/back-ups/nu/', cookie, { _csrf: csrf })));
    assert.deepEqual(answers.map((answer) => answer.status), [303, 303, 303]);
    assert.equal(app.locals.backups.status().running, true);
    assert.equal((await post('/app/beheer/back-ups/nu/', cookie, { _csrf: csrf })).status, 303, 'tijdens de back-up');
    await app.locals.backups.idle();
    const after = (await db.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'backup.gestart'"))[0].count;
    assert.equal(after - before, 1, 'één keer gestart');
    assert.equal(app.locals.backups.list().length, 1, 'één back-up');
    // Telde maar één keer mee: nog vijf handmatige back-ups mogelijk.
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await post('/app/beheer/back-ups/nu/', cookie, { _csrf: csrf })).status, 303);
      await app.locals.backups.idle();
    }
    assert.equal((await post('/app/beheer/back-ups/nu/', cookie, { _csrf: csrf })).status, 429);
  });

  await t.test('Beheer: zonder databaseverbinding geen back-ups', async (st) => {
    const app = createApp({ db, masterKey: MASTER_KEY, setupCode: SETUP_CODE, backupDir: tempDir(st) });
    assert.equal(app.locals.backups.available(), false);
  });
});
