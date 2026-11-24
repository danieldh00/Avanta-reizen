/**
 * Tests voor de opdrachtregel van de back-ups (`src/backup/cli.js`), vooral de foutpaden: gebruik, lege lijst,
 * ontbrekende hoofdsleutel of DATABASE_URL, DATABASE_URL_FILE, ontsleutelen naar een bestand (bestaand doel,
 * beschadigde back-up zonder resten, vorige sleutel na een rotatie) en `create` met een nep-pg_dump (gelukt, vóór een
 * update en mislukt). De databasetest draait in een eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createDatabase } = require('../src/database/db');
const backups = require('../src/backup/backups');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'backup_cli';
const CLI = path.join(__dirname, '..', 'src', 'backup', 'cli.js');
const MASTER_KEY = Buffer.alloc(32, 7);
const OLD_KEY = Buffer.alloc(32, 8);

/**
 * Een tijdelijke map die na de test wordt opgeruimd.
 * @param {import('node:test').TestContext} t Testcontext.
 * @returns {string} Pad.
 */
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avanta-backup-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Draait de opdrachtregel met een eigen omgeving (zonder de sleutel- en databasevariabelen van de testrunner).
 * @param {string[]} args Argumenten na `cli.js`.
 * @param {object} env Omgevingsvariabelen bovenop een schone basis.
 * @returns {{status: number|null, stdout: string, stderr: string}} Uitkomst.
 */
function runCli(args, env) {
  const base = { ...process.env };
  for (const name of ['AVANTA_MASTER_KEY', 'AVANTA_MASTER_KEY_FILE', 'AVANTA_MASTER_KEY_PREVIOUS', 'DATABASE_URL', 'DATABASE_URL_FILE', 'PG_DUMP_PATH']) delete base[name];
  const result = spawnSync(process.execPath, [CLI, ...args], { env: { ...base, ...env } });
  return { status: result.status, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

/**
 * Schrijft een nep-pg_dump die een vaste dump uitvoert of met een fout stopt.
 * @param {string} dir Map voor het script.
 * @param {string} dumpFile Dump die het script uitvoert.
 * @param {boolean} [fail] Of het script met code 1 en een melding stopt.
 * @returns {string} Pad van het script.
 */
function fakePgDump(dir, dumpFile, fail = false) {
  const script = path.join(dir, fail ? 'pg_dump_fout' : 'pg_dump_nep');
  fs.writeFileSync(script, fail ? '#!/bin/sh\necho "verbinding geweigerd" >&2\nexit 1\n' : `#!/bin/sh\ncat "${dumpFile}"\n`, { mode: 0o755 });
  return script;
}

/**
 * Maakt een echte versleutelde back-up van een nepdump in `<dataDir>/backups`.
 * @param {string} dataDir DATA_DIR van de opdrachtregel.
 * @param {Buffer} masterKey Sleutel waarmee de back-up wordt versleuteld.
 * @returns {Promise<{name: string, dump: Buffer}>} Naam van de back-up en de oorspronkelijke dump.
 */
async function makeBackup(dataDir, masterKey) {
  const dir = path.join(dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const dumpFile = path.join(dataDir, 'echt.dump');
  const dump = Buffer.concat([Buffer.from('PGDMP'), Buffer.alloc(3000, 5)]);
  fs.writeFileSync(dumpFile, dump);
  const db = { query: async () => [{ name: 'public' }] };
  const made = await backups.createBackup({ db, connectionString: 'postgres://u:p@localhost/db', dir, masterKey, pgDumpPath: fakePgDump(dataDir, dumpFile), now: () => Date.parse('2026-11-22T02:00:00Z') });
  return { name: made.name, dump };
}

test('back-up-CLI: gebruik, lijst en ontbrekende instellingen', async (t) => {
  const dataDir = tempDir(t);
  const usage = runCli([], { DATA_DIR: dataDir });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /Gebruik: node src\/backup\/cli\.js create/);
  assert.equal(runCli(['decrypt', 'alleen-bron'], { DATA_DIR: dataDir }).status, 2, 'decrypt zonder doel is onvolledig');
  assert.equal(runCli(['onbekend'], { DATA_DIR: dataDir }).status, 2);

  const empty = runCli(['list'], { DATA_DIR: dataDir });
  assert.equal(empty.status, 0);
  assert.equal(empty.stdout, '', 'geen back-upmap: lege lijst, geen fout');

  const { name } = await makeBackup(dataDir, MASTER_KEY);
  fs.writeFileSync(path.join(dataDir, 'backups', 'iets-anders.txt'), 'x');
  const listed = runCli(['list'], { DATA_DIR: dataDir });
  assert.equal(listed.status, 0);
  assert.match(listed.stdout, new RegExp(`^${name.replace(/\./g, '\\.')}\\t\\d+\\t2026-11-22T02:00:00\\.000Z\\n$`));

  const noKey = runCli(['create'], { DATA_DIR: dataDir });
  assert.equal(noKey.status, 1);
  assert.match(noKey.stderr, /^Mislukt: Geen hoofdsleutel gevonden/);
  assert.equal(fs.existsSync(path.join(dataDir, 'master-key')), false, 'de opdrachtregel maakt nooit zelf een sleutel aan');

  const noDatabase = runCli(['create'], { DATA_DIR: dataDir, AVANTA_MASTER_KEY: MASTER_KEY.toString('hex') });
  assert.equal(noDatabase.status, 1);
  assert.match(noDatabase.stderr, /Mislukt: DATABASE_URL ontbreekt\./);
  const emptyFile = path.join(dataDir, 'database-url');
  fs.writeFileSync(emptyFile, '  \n');
  assert.match(runCli(['create'], { DATA_DIR: dataDir, AVANTA_MASTER_KEY: MASTER_KEY.toString('hex'), DATABASE_URL_FILE: emptyFile }).stderr, /DATABASE_URL ontbreekt/);
});

test('back-up-CLI: ontsleutelen naar een bestand', async (t) => {
  const dataDir = tempDir(t);
  const env = { DATA_DIR: dataDir, AVANTA_MASTER_KEY: MASTER_KEY.toString('hex') };
  const { name, dump } = await makeBackup(dataDir, MASTER_KEY);

  // Alleen de naam is genoeg: de opdrachtregel zoekt dan in de back-upmap.
  const target = path.join(dataDir, 'terug.dump');
  const ok = runCli(['decrypt', name, target], env);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Ontsleuteld naar .*terug\.dump/);
  assert.deepEqual(fs.readFileSync(target), dump);
  assert.equal(fs.statSync(target).mode & 0o777, 0o600, 'de dump is alleen voor de eigenaar leesbaar');

  const exists = runCli(['decrypt', name, target], env);
  assert.equal(exists.status, 1);
  assert.match(exists.stderr, /bestaat al; kies een ander doel/);

  // Beschadigd: geen doelbestand en geen .part achtergelaten.
  const damagedName = 'avanta-20200101-000000.dump.enc';
  const bytes = fs.readFileSync(path.join(dataDir, 'backups', name));
  bytes[bytes.length - 40] ^= 0xff;
  fs.writeFileSync(path.join(dataDir, 'backups', damagedName), bytes);
  const brokenTarget = path.join(dataDir, 'kapot.dump');
  const broken = runCli(['decrypt', damagedName, brokenTarget], env);
  assert.equal(broken.status, 1);
  assert.equal(fs.existsSync(brokenTarget), false);
  assert.equal(fs.existsSync(`${brokenTarget}.part`), false);

  // Andere sleutel: duidelijke melding, ook niets achtergelaten.
  const wrongKey = runCli(['decrypt', name, brokenTarget], { ...env, AVANTA_MASTER_KEY: OLD_KEY.toString('hex') });
  assert.equal(wrongKey.status, 1);
  assert.match(wrongKey.stderr, /andere hoofdsleutel/);
  assert.equal(fs.existsSync(`${brokenTarget}.part`), false);

  // Niet bestaande back-up.
  assert.equal(runCli(['decrypt', 'avanta-19990101-000000.dump.enc', path.join(dataDir, 'x.dump')], env).status, 1);
});

test('back-up-CLI: na een sleutelrotatie met de vorige sleutel ontsleutelen', async (t) => {
  const dataDir = tempDir(t);
  const { name, dump } = await makeBackup(dataDir, OLD_KEY);
  const target = path.join(dataDir, 'oud.dump');
  const env = { DATA_DIR: dataDir, AVANTA_MASTER_KEY: MASTER_KEY.toString('hex'), AVANTA_MASTER_KEY_PREVIOUS: OLD_KEY.toString('hex') };
  const result = runCli(['decrypt', name, target], env);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readFileSync(target), dump);
});

test('back-up-CLI: create met de instellingen uit de database', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const url = new URL(DATABASE_URL);
  url.searchParams.set('options', `-c search_path=${SCHEMA}`);
  const db = createDatabase(url.toString());
  await db.migrate();
  t.after(() => db.close());

  const dataDir = tempDir(t);
  const dumpFile = path.join(dataDir, 'echt.dump');
  fs.writeFileSync(dumpFile, Buffer.concat([Buffer.from('PGDMP'), Buffer.alloc(1000, 2)]));
  const urlFile = path.join(dataDir, 'database-url');
  fs.writeFileSync(urlFile, `${url.toString()}\n`);
  const env = { DATA_DIR: dataDir, AVANTA_MASTER_KEY: MASTER_KEY.toString('hex'), DATABASE_URL_FILE: urlFile, PG_DUMP_PATH: fakePgDump(dataDir, dumpFile) };

  const made = runCli(['create', '--update'], env);
  assert.equal(made.status, 0, made.stderr);
  assert.match(made.stdout, /^Back-up gemaakt: avanta-\d{8}-\d{6}\.dump\.enc \(\d+ bytes\)\n$/);
  const backupDir = path.join(dataDir, 'backups');
  assert.equal(backups.listBackups(backupDir).length, 1);
  assert.equal(backups.readStatus(backupDir).lastRun.trigger, 'update');
  const [audit] = await db.query("SELECT entity_id FROM audit_log WHERE action = 'backup.gemaakt'");
  assert.equal(audit.entity_id, backups.listBackups(backupDir)[0].name);

  // pg_dump mislukt: code 1, melding op één regel, geen .part en de mislukte poging in de status.
  const failed = runCli(['create'], { ...env, PG_DUMP_PATH: fakePgDump(dataDir, dumpFile, true) });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /^Mislukt: pg_dump mislukt[^\n]*\n$/);
  assert.deepEqual(fs.readdirSync(backupDir).filter((file) => file.endsWith('.part')), []);
  const status = backups.readStatus(backupDir);
  assert.equal(status.lastRun.ok, false);
  assert.equal(status.lastRun.trigger, 'handmatig');
});
