/**
 * Tests voor `src/crm/cli.js` (bevinding F07): een beheerder die er niet meer in komt, krijgt via de server een
 * tijdelijk wachtwoord en een activatiecode; sessies en tweestapsverificatie gaan weg, het auditlog legt het vast.
 * De databasetest draait in een eigen schema en wordt overgeslagen zonder TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/database/db');
const { verifyPassword, hashPassword } = require('../src/crm/passwords');
const { recoverAdmin, temporaryPassword, maskEmail, main } = require('../src/crm/cli');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'crm_cli_test';

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

test('cli: tijdelijk wachtwoord, gemaskeerd adres en gebruik', async () => {
  const password = temporaryPassword();
  assert.match(password, /^([a-km-np-zA-HJ-NP-Z2-9]{4}-){5}[a-km-np-zA-HJ-NP-Z2-9]{4}$/);
  assert.notEqual(temporaryPassword(), password);
  assert.equal(maskEmail('daniel@example.nl'), 'd***@example.nl');
  const errors = [];
  const original = console.error;
  console.error = (line) => errors.push(line);
  try {
    assert.equal(await main([]), 2);
    assert.equal(await main(['iets-anders', 'a@b.nl']), 2);
  } finally {
    console.error = original;
  }
  assert.match(errors.join('\n'), /beheerder-herstel <e-mailadres>/);
});

test('cli: beheerder-herstel', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (testContext) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  testContext.after(() => db.close());
  await db.migrate();
  const oldHash = await hashPassword('het vergeten wachtwoord');
  const [beheerder] = await db.query(
    "INSERT INTO users (email, name, role, password_hash, totp_secret, totp_enabled_at) VALUES ('daniel@example.nl', 'Daniël', 'beheerder', $1, 'versleuteld-geheim', now()) RETURNING id",
    [oldHash],
  );
  const [office] = await db.query("INSERT INTO users (email, name, role, password_hash) VALUES ('kantoor@example.nl', 'Kantoor', 'kantoor', $1) RETURNING id", [oldHash]);
  await db.query("INSERT INTO users (email, name, role, password_hash, active) VALUES ('oud@example.nl', 'Oud', 'beheerder', $1, false)", [oldHash]);
  await db.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('a', $1, now() + interval '1 hour'), ('b', $2, now() + interval '1 hour')", [beheerder.id, office.id]);

  await testContext.test('alleen een actieve beheerder; anders de gemaskeerde beheerders en niets veranderd', async () => {
    for (const email of ['kantoor@example.nl', 'oud@example.nl', 'niemand@example.nl']) {
      assert.deepEqual(await recoverAdmin(db, email), { ok: false, admins: ['d***@example.nl'] }, email);
    }
    const [row] = await db.query('SELECT password_hash FROM users WHERE id = $1', [office.id]);
    assert.equal(row.password_hash, oldHash);
  });

  await testContext.test('nieuw wachtwoord, 2FA uit met activatiecode, sessies weg, auditregel', async () => {
    const result = await recoverAdmin(db, '  Daniel@Example.NL ');
    assert.equal(result.ok, true);
    const [row] = await db.query('SELECT password_hash, totp_secret, totp_enabled_at, totp_activation_hash, totp_activation_expires_at > now() AS activation_valid FROM users WHERE id = $1', [beheerder.id]);
    assert.equal(await verifyPassword(result.password, row.password_hash), true);
    assert.equal(await verifyPassword('het vergeten wachtwoord', row.password_hash), false);
    assert.equal(row.totp_secret, null);
    assert.equal(row.totp_enabled_at, null);
    assert.ok(row.totp_activation_hash && row.activation_valid);
    assert.ok(!row.totp_activation_hash.includes(result.activation), 'alleen de hash van de activatiecode');
    const sessions = await db.query('SELECT user_id FROM sessions ORDER BY user_id');
    assert.deepEqual(sessions.map((session) => session.user_id), [office.id], 'alleen de sessies van deze beheerder weg');
    const audit = await db.query('SELECT user_id, action, entity, entity_id, ip_prefix FROM audit_log');
    assert.deepEqual(audit, [{ user_id: null, action: 'gebruiker.hersteld-server', entity: 'users', entity_id: String(beheerder.id), ip_prefix: null }]);
  });
});
