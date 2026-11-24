/**
 * Tests voor de sleutelrotatie (P7.5, A13): de kluis met vorige sleutels (formaat v2 met sleutel-id, v1 blijft
 * leesbaar), het laden van vorige sleutels, en de rotatie in PostgreSQL (personen met match_key, oude aanmeldingen,
 * tweestapsgeheimen, geheime instellingen) en betaallinks van vóór de rotatie. Back-ups met vorige sleutels: backup.test.js.
 * Eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDatabase } = require('../src/database/db');
const { createVault, loadPreviousKeys, keyIdOf } = require('../src/security/vault');
const { createPersons } = require('../src/persons/persons');
const { createKeyRotation } = require('../src/security/key-rotation');
const { main } = require('../src/security/key-rotation-cli');
const { createOnlinePayments } = require('../src/payments/online-payments');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'key_rotation_test';
const OLD_KEY = Buffer.alloc(32, 21);
const NEW_KEY = Buffer.alloc(32, 22);

/**
 * Maakt een tekst in het oude formaat v1 (zonder sleutel-id), zoals de kluis die vóór P7.5 schreef.
 * @param {Buffer} key Sleutel.
 * @param {*} value JSON-waarde.
 * @param {string} [context] AAD.
 * @returns {string} `v1.<iv>.<tag>.<data>`.
 */
function legacySeal(key, value, context = '') {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  if (context) cipher.setAAD(Buffer.from(context, 'utf8'));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

test('kluis: v2 met sleutel-id, vorige sleutels alleen om te lezen, v1 blijft leesbaar', () => {
  const oldVault = createVault(OLD_KEY);
  const sealedOld = oldVault.seal({ a: 1 }, 'ctx');
  assert.match(sealedOld, new RegExp(`^v2\\.${keyIdOf(OLD_KEY)}\\.`));
  assert.equal(oldVault.isCurrent(sealedOld), true);

  const vault = createVault(NEW_KEY, { previousKeys: [OLD_KEY, NEW_KEY] });
  assert.equal(vault.previousKeys.length, 1, 'de huidige sleutel telt niet als vorige');
  assert.deepEqual(vault.open(sealedOld, 'ctx'), { a: 1 });
  assert.equal(vault.isCurrent(sealedOld), false);
  assert.throws(() => vault.open(sealedOld, 'ander'), 'AAD telt nog steeds');
  assert.equal(vault.isCurrent(vault.seal('x')), true);
  assert.deepEqual(vault.open(legacySeal(OLD_KEY, ['oud'], 'c'), 'c'), ['oud']);
  assert.deepEqual(vault.open(legacySeal(NEW_KEY, 'nieuw')), 'nieuw');
  assert.equal(vault.isCurrent(legacySeal(NEW_KEY, 'nieuw')), false, 'v1 wordt altijd opnieuw versleuteld');
  assert.throws(() => createVault(NEW_KEY).open(sealedOld), /onbekende sleutel/);
  assert.throws(() => createVault(NEW_KEY).open(legacySeal(OLD_KEY, 1)));
  assert.throws(() => vault.open('v2.kapot'), /onbekend formaat/);
  assert.throws(() => vault.open('v3.a.b.c.d'), /onbekend formaat/);
  assert.throws(() => createVault(NEW_KEY, { previousKeys: [Buffer.alloc(3)] }), /32 bytes/);
});

test('vorige sleutels: uit de omgeving of uit DATA_DIR/master-key.previous', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'avanta-sleutels-'));
  assert.deepEqual(loadPreviousKeys({ keys: '', dataDir: directory }), []);
  fs.writeFileSync(path.join(directory, 'master-key.previous'), `# oud\n${OLD_KEY.toString('hex')}\n\n${OLD_KEY.toString('hex')}\n`);
  const hex = (keys) => keys.map((key) => key.toString('hex'));
  assert.deepEqual(hex(loadPreviousKeys({ keys: '', dataDir: directory })), hex([OLD_KEY]), 'commentaar en dubbelen weg');
  assert.deepEqual(hex(loadPreviousKeys({ keys: `${NEW_KEY.toString('hex')}, ${OLD_KEY.toString('hex')}`, dataDir: directory })), hex([NEW_KEY, OLD_KEY]));
  assert.throws(() => loadPreviousKeys({ keys: 'abc' }), /64 hex/);
});

test('betaallinks van vóór de rotatie blijven geldig, nieuwe links gebruiken de nieuwe sleutel', () => {
  const settings = { get: () => '' };
  const before = createOnlinePayments({ db: null, settings, mollie: null, masterKey: OLD_KEY });
  const after = createOnlinePayments({ db: null, settings, mollie: null, masterKey: NEW_KEY, previousKeys: [OLD_KEY] });
  const oldPart = before.pathFor(42).split('/')[2];
  assert.equal(after.bookingIdFrom(oldPart), 42);
  assert.equal(after.bookingIdFrom(after.pathFor(42).split('/')[2]), 42);
  assert.notEqual(after.pathFor(42), before.pathFor(42));
  assert.equal(createOnlinePayments({ db: null, settings, mollie: null, masterKey: NEW_KEY }).bookingIdFrom(oldPart), null);
  assert.equal(after.bookingIdFrom('42-verkeerdtokenverkeerd'), null);
});

test('sleutelrotatie in PostgreSQL', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const url = new URL(DATABASE_URL);
  url.searchParams.set('options', `-c search_path=${SCHEMA}`);
  const db = createDatabase(url.toString());
  t.after(() => db.close());
  await db.migrate();

  // Gegevens van vóór de rotatie, met de oude sleutel.
  const oldVault = createVault(OLD_KEY);
  const oldPersons = createPersons({ vault: oldVault });
  const values = {
    gender: 'vrouw', first_names: 'Anna', call_name: 'Anna', last_name: 'Jansen', email: 'anna@example.nl', mobile: '0611111111',
    phone: '', street: 'Dorpsstraat 1', postal_code: '1234 AB', city: 'Ede', occupation: '', birth_date: '1990-05-06',
    nationality: 'Nederlandse', document_type: '', document_number: '', document_valid_until: '', church: 'PKN',
    consent_religion: 'ja', particulars: '', consent_health: '', emergency_phone: '0622222222',
  };
  const { personId } = await db.transaction((client) => oldPersons.savePerson(client, values));
  const [anonymous] = await db.query("INSERT INTO persons (first_names, last_name, email, match_key) VALUES ('X', 'Y', '', 'verwijderd:99') RETURNING id");
  const [booking] = await db.query(
    `INSERT INTO bookings (reference, trip_title, gender, first_names, call_name, last_name, email, mobile, street, postal_code, city,
       occupation, earlier_trip, credit_card, driver_interest, driver_before, payment_method, payment_choice, sensitive_data, consent_at)
     VALUES ('AV-R-1', 'Reis', 'vrouw', 'Oud', 'Oud', 'Klant', 'oud@example.nl', '06', 'Laan 1', '9999 ZZ', 'Assen', '', false, false, false, false,
       'handmatig', 'aanbetaling', $1, now()) RETURNING id`,
    [legacySeal(OLD_KEY, { birth_date: '1970-01-01' })],
  );
  const [user] = await db.query("INSERT INTO users (email, name, role, password_hash) VALUES ('b@example.nl', 'B', 'beheerder', 'x') RETURNING id");
  await db.query('UPDATE users SET totp_secret = $2 WHERE id = $1', [user.id, oldVault.seal('GEHEIM', `users:totp:${user.id}`)]);
  await db.query('INSERT INTO settings (key, value) VALUES ($1, $2)', ['smtpPassword', JSON.stringify({ enc: oldVault.seal({ key: 'smtpPassword', value: 'wachtwoord' }) })]);
  await db.query('INSERT INTO settings (key, value) VALUES ($1, $2)', ['siteName', JSON.stringify('Avanta')]);
  const [{ match_key: oldMatchKey }] = await db.query('SELECT match_key FROM persons WHERE id = $1', [personId]);

  const vault = createVault(NEW_KEY, { previousKeys: [OLD_KEY] });
  const persons = createPersons({ vault });
  const rotation = createKeyRotation({ db, vault, persons, batchSize: 1 });

  await t.test('vóór de rotatie: oude match_key wordt nog gevonden, status telt wat open staat', async () => {
    const again = await db.transaction((client) => persons.savePerson(client, values));
    assert.deepEqual(again, { personId, outcome: 'bestaand' }, 'geen dubbele persoon door de nieuwe sleutel');
    const { keyId, pending } = await rotation.status();
    assert.equal(keyId, keyIdOf(NEW_KEY));
    // De tweede aanmelding versleutelde de blokken van Anna al opnieuw (aanvullen); haar match_key is nog de oude.
    assert.deepEqual(pending, { persons: 0, bookings: 1, users: 1, settings: 1 });
    const [{ match_key: stillOld }] = await db.query('SELECT match_key FROM persons WHERE id = $1', [personId]);
    assert.equal(stillOld, oldMatchKey);
  });

  await t.test('rotatie: alles opnieuw versleuteld, match_key herberekend, waarden gelijk', async () => {
    const counts = await rotation.run();
    assert.deepEqual(counts, { persons: 1, bookings: 1, users: 1, settings: 1, failed: 0 });
    const [person] = await db.query('SELECT id, match_key, identity_data, special_data, emergency_data FROM persons WHERE id = $1', [personId]);
    assert.notEqual(person.match_key, oldMatchKey);
    assert.equal(person.match_key, persons.matchKey('anna@example.nl', '1990-05-06'));
    const onlyNew = createVault(NEW_KEY);
    assert.equal(onlyNew.open(person.identity_data, `persons:identity_data:${personId}`).birth_date, '1990-05-06');
    assert.equal(onlyNew.open(person.special_data, `persons:special_data:${personId}`).church, 'PKN');
    const [{ match_key: anonymousKey }] = await db.query('SELECT match_key FROM persons WHERE id = $1', [anonymous.id]);
    assert.equal(anonymousKey, 'verwijderd:99', 'geanonimiseerde persoon blijft onvindbaar');
    const [{ sensitive_data: sensitive }] = await db.query('SELECT sensitive_data FROM bookings WHERE id = $1', [booking.id]);
    assert.deepEqual(onlyNew.open(sensitive), { birth_date: '1970-01-01' });
    const [{ totp_secret: secret }] = await db.query('SELECT totp_secret FROM users WHERE id = $1', [user.id]);
    assert.equal(onlyNew.open(secret, `users:totp:${user.id}`), 'GEHEIM');
    const [setting] = await db.query("SELECT value FROM settings WHERE key = 'smtpPassword'");
    assert.deepEqual(onlyNew.open(JSON.parse(setting.value).enc), { key: 'smtpPassword', value: 'wachtwoord' });
    const [plain] = await db.query("SELECT value FROM settings WHERE key = 'siteName'");
    assert.equal(plain.value, JSON.stringify('Avanta'), 'gewone instellingen blijven ongemoeid');
    const [audit] = await db.query("SELECT entity, entity_id FROM audit_log WHERE action = 'sleutel.geroteerd'");
    assert.deepEqual(audit, { entity: 'systeem', entity_id: keyIdOf(NEW_KEY) });
  });

  await t.test('tweede ronde doet niets meer; status is leeg', async () => {
    assert.deepEqual(await rotation.run(), { persons: 0, bookings: 0, users: 0, settings: 0, failed: 0 });
    assert.deepEqual((await rotation.status()).pending, { persons: 0, bookings: 0, users: 0, settings: 0 });
  });

  await t.test('een waarde met een onbekende sleutel blijft staan en telt als mislukt', async () => {
    const foreign = createVault(Buffer.alloc(32, 99));
    await db.query('UPDATE users SET totp_secret = $2 WHERE id = $1', [user.id, foreign.seal('X', `users:totp:${user.id}`)]);
    await db.query('UPDATE persons SET health_data = $2 WHERE id = $1', [personId, foreign.seal({ particulars: 'x' }, `persons:health_data:${personId}`)]);
    const counts = await rotation.run();
    assert.equal(counts.failed, 2);
    const [{ totp_secret: secret }] = await db.query('SELECT totp_secret FROM users WHERE id = $1', [user.id]);
    assert.equal(foreign.open(secret, `users:totp:${user.id}`), 'X', 'onaangeroerd');
  });

  await t.test('opdrachtregel: status en herversleutelen, met uitgangscodes en zonder waarden in de uitvoer', async () => {
    await db.query('UPDATE users SET totp_secret = NULL');
    await db.query('UPDATE persons SET health_data = NULL');
    await db.query('UPDATE bookings SET sensitive_data = $2 WHERE id = $1', [booking.id, legacySeal(OLD_KEY, { birth_date: '1970-01-01' })]);
    const lines = [];
    const options = { db, masterKey: NEW_KEY, previousKeys: [OLD_KEY], log: (line) => lines.push(line) };
    assert.equal(await main(['status'], options), 3);
    assert.equal(await main(['herversleutelen'], options), 0);
    assert.equal(await main(['status'], options), 0);
    assert.equal(await main(['iets'], options), 2);
    const output = lines.join('\n');
    assert.match(output, new RegExp(keyIdOf(OLD_KEY)));
    assert.doesNotMatch(output, new RegExp(NEW_KEY.toString('hex')));
    assert.doesNotMatch(output, /1970-01-01|wachtwoord|GEHEIM/);
  });
});
