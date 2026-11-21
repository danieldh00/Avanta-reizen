/**
 * Tests voor de personen (CRM-PR 3, migratie 10): afgeleide sleutels van de kluis, de match_key, ontdubbelen zonder
 * iets te overschrijven (nieuw, aanvullen, mogelijk dubbel), toestemmingen en het omzetten van oude aanmeldingen.
 * De databasetests draaien in een eigen schema, naast de andere testbestanden.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/database/db');
const { createVault } = require('../src/security/vault');
const { createPersons, LEGACY_TEXT_VERSION, LEGACY_ART9_TEXT_VERSION } = require('../src/crm/persons');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'persons_test';
const MASTER_KEY = Buffer.alloc(32, 11);

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
 * Formulierwaarden van een aanmelding, met eventuele afwijkingen.
 * @param {object} [overrides] Andere waarden.
 * @returns {Record<string, string>} Waarden.
 */
function bookingValues(overrides = {}) {
  return {
    gender: 'man', first_names: 'Pieter Jan', call_name: 'Piet', last_name: 'de Vries', email: 'Piet@Example.nl',
    mobile: '0611111111', phone: '', street: 'Kerkstraat 2', postal_code: '1234 ab', city: 'Goes', occupation: 'Boer',
    birth_date: '1980-02-03', nationality: 'Nederlandse', document_type: 'paspoort', document_number: '', document_valid_until: '',
    church: '', consent_religion: '', particulars: '', consent_health: '', emergency_phone: '',
    ...overrides,
  };
}

test('kluis: afgeleide sleutels per doel', () => {
  const vault = createVault(MASTER_KEY);
  assert.equal(vault.deriveKey('persons:match').length, 32);
  assert.deepEqual(vault.deriveKey('persons:match'), vault.deriveKey('persons:match'));
  assert.notDeepEqual(vault.deriveKey('persons:match'), vault.deriveKey('iets anders'));
  assert.notDeepEqual(vault.deriveKey('persons:match'), MASTER_KEY);
  assert.throws(() => vault.deriveKey(''));
});

test('match_key: genormaliseerd e-mailadres, geboortedatum telt mee, andere sleutel geeft andere waarde', () => {
  const persons = createPersons({ vault: createVault(MASTER_KEY) });
  const key = persons.matchKey('Piet@Example.nl ', '1980-02-03');
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(persons.matchKey('piet@example.nl', '1980-02-03'), key);
  assert.notEqual(persons.matchKey('piet@example.nl', '1980-02-04'), key);
  assert.notEqual(createPersons({ vault: createVault(Buffer.alloc(32, 12)) }).matchKey('piet@example.nl', '1980-02-03'), key);
});

test('personen in PostgreSQL', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  t.after(() => db.close());
  await db.migrate();
  const vault = createVault(MASTER_KEY);
  const persons = createPersons({ vault });
  const count = async () => (await db.query('SELECT count(*)::int AS total FROM persons'))[0].total;
  const save = (values) => db.transaction((client) => persons.savePerson(client, values));
  const personById = async (id) => (await db.query('SELECT id, first_names, email, postal_code, mobile, duplicate_of, identity_data, special_data, health_data, emergency_data FROM persons WHERE id = $1', [id]))[0];

  let firstId;
  await t.test('nieuwe persoon: NAW leesbaar, blokken versleuteld per categorie', async () => {
    const result = await save(bookingValues({ church: 'Hersteld Hervormd', consent_religion: 'ja' }));
    assert.equal(result.outcome, 'nieuw');
    firstId = result.personId;
    const person = await personById(firstId);
    assert.equal(person.email, 'piet@example.nl');
    assert.equal(person.postal_code, '1234 AB');
    assert.equal(person.duplicate_of, null);
    assert.equal(persons.openBlock('identity_data', person).birth_date, '1980-02-03');
    assert.equal(persons.openBlock('identity_data', person).document_number, undefined, 'lege velden niet opgeslagen');
    assert.equal(persons.openBlock('special_data', person).church, 'Hersteld Hervormd');
    assert.equal(person.health_data, null);
    assert.deepEqual(persons.openBlock('health_data', person), {});
    assert.throws(() => persons.openBlock('onbekend', person));
  });

  await t.test('zelfde persoon: lege velden worden aangevuld, niets overschreven', async () => {
    const result = await save(bookingValues({ email: 'piet@example.nl', first_names: 'pieter  jan', emergency_phone: '0622222222', document_number: 'AB12' }));
    assert.deepEqual(result, { personId: firstId, outcome: 'bestaand' });
    assert.equal(await count(), 1);
    const person = await personById(firstId);
    assert.equal(person.first_names, 'Pieter Jan', 'bestaande schrijfwijze blijft');
    assert.equal(persons.openBlock('emergency_data', person).emergency_phone, '0622222222');
    assert.equal(persons.openBlock('identity_data', person).document_number, 'AB12');
    assert.equal(persons.openBlock('special_data', person).church, 'Hersteld Hervormd', 'leeg veld wist niets');
  });

  await t.test('afwijkend ingevuld veld: nieuwe persoon, gemarkeerd als mogelijk dubbel', async () => {
    const result = await save(bookingValues({ street: 'Andere straat 9' }));
    assert.equal(result.outcome, 'mogelijk-dubbel');
    assert.notEqual(result.personId, firstId);
    assert.equal((await personById(result.personId)).duplicate_of, firstId);
    assert.equal((await db.query('SELECT street FROM persons WHERE id = $1', [firstId]))[0].street, 'Kerkstraat 2', 'origineel onaangetast');
  });

  await t.test('nog een aanmelding met hetzelfde afwijkende adres: hetzelfde dubbel, geen nieuwe persoon', async () => {
    const before = await count();
    const [duplicate] = await db.query('SELECT id FROM persons WHERE duplicate_of = $1 ORDER BY id', [firstId]);
    const result = await save(bookingValues({ street: 'Andere straat 9', mobile: '0611111111' }));
    assert.deepEqual(result, { personId: duplicate.id, outcome: 'mogelijk-dubbel' });
    assert.equal(await count(), before);
    const third = await save(bookingValues({ street: 'Derde straat 3' }));
    assert.equal((await personById(third.personId)).duplicate_of, firstId, 'nieuw afwijkend adres: dubbel van het origineel');
  });

  await t.test('blok van de bestaande persoon niet te openen: aanmelding gaat door als mogelijk dubbel', async () => {
    const values = bookingValues({ email: 'kapotblok@example.nl' });
    const { personId } = await save(values);
    await db.query('UPDATE persons SET identity_data = $2 WHERE id = $1', [personId, createVault(Buffer.alloc(32, 98)).seal({ birth_date: '1980-02-03' })]);
    const result = await save(values);
    assert.equal(result.outcome, 'mogelijk-dubbel');
    assert.equal((await personById(result.personId)).duplicate_of, personId);
  });

  await t.test('zelfde e-mailadres, andere geboortedatum: mogelijk dubbel', async () => {
    const result = await save(bookingValues({ birth_date: '1981-02-03', first_names: 'Partner' }));
    assert.equal(result.outcome, 'mogelijk-dubbel');
    assert.equal((await personById(result.personId)).duplicate_of, firstId);
  });

  await t.test('ander e-mailadres: gewoon nieuw', async () => {
    assert.equal((await save(bookingValues({ email: 'ander@example.nl' }))).outcome, 'nieuw');
  });

  await t.test('gelijktijdige aanmeldingen van een nieuwe persoon maken één persoon', async () => {
    const values = bookingValues({ email: 'tegelijk@example.nl' });
    const results = await Promise.all([save(values), save(values), save(values)]);
    assert.equal(new Set(results.map((result) => result.personId)).size, 1);
  });

  await t.test('toestemmingen: voorwaarden altijd, art. 9 alleen met vinkje én ingevuld veld', async () => {
    const [booking] = await db.query(
      `INSERT INTO bookings (reference, trip_title, gender, first_names, call_name, last_name, email, mobile, street, postal_code, city,
         earlier_trip, credit_card, driver_interest, driver_before, payment_method, payment_choice, consent_at, person_id)
       VALUES ('AV-T-1', 'Reis', 'man', 'P', 'P', 'V', 'p@example.nl', '06', 's', 'p', 'c', false, false, false, false, 'handmatig', 'aanbetaling', now(), $1)
       RETURNING id`,
      [firstId],
    );
    const kinds = await db.transaction((client) => persons.recordConsents(client, {
      personId: firstId, bookingId: booking.id, values: bookingValues({ church: 'PKN', consent_religion: 'ja', consent_health: 'ja' }),
    }));
    assert.deepEqual(kinds, ['voorwaarden', 'art9_religie'], 'vinkje gezondheid zonder bijzonderheden telt niet');
  });

  await t.test('oude aanmeldingen omzetten: persoon, blokken, toestemming; niet te ontsleutelen blijft staan', async () => {
    const insertOld = (reference, email, sealed) => db.query(
      `INSERT INTO bookings (reference, trip_title, gender, first_names, call_name, last_name, email, mobile, street, postal_code, city,
         occupation, earlier_trip, credit_card, driver_interest, driver_before, payment_method, payment_choice, sensitive_data, consent_at)
       VALUES ($1, 'Reis', 'vrouw', 'Oud', 'Oud', 'Klant', $2, '0633333333', 'Laan 1', '9999 ZZ', 'Assen', '', false, false, false, false,
         'handmatig', 'aanbetaling', $3, '2026-01-02T10:00:00Z') RETURNING id`,
      [reference, email, sealed],
    );
    const sensitive = { birth_date: '1970-01-01', church: 'GKV', nationality: 'NL', document_type: 'paspoort', document_number: '', document_valid_until: '', particulars: 'Diabetes', emergency_phone: '0644444444' };
    const [broken] = await insertOld('AV-OUD-0', 'fout@example.nl', vault.seal(sensitive));
    const [good] = await insertOld('AV-OUD-1', 'oud@example.nl', vault.seal(sensitive));
    const [bad] = await insertOld('AV-OUD-2', 'kapot@example.nl', createVault(Buffer.alloc(32, 99)).seal(sensitive));
    // De eerste transactie (die van AV-OUD-0) mislukt; de rest gaat gewoon door.
    let calls = 0;
    const flakyDb = { ...db, transaction: (work) => (calls++ === 0 ? Promise.reject(new Error('slot verlopen')) : db.transaction(work)) };
    assert.deepEqual(await persons.backfillPersons(flakyDb, { batchSize: 1 }), { converted: 1, failed: 2 });
    assert.equal((await db.query('SELECT person_id FROM bookings WHERE id = $1', [broken.id]))[0].person_id, null, 'mislukte blijft staan');
    const [row] = await db.query('SELECT person_id, sensitive_data FROM bookings WHERE id = $1', [good.id]);
    assert.equal(row.sensitive_data, null);
    const person = await personById(row.person_id);
    assert.equal(person.email, 'oud@example.nl');
    assert.equal(persons.openBlock('emergency_data', person).emergency_phone, '0644444444');
    assert.equal(persons.openBlock('identity_data', person).birth_date, '1970-01-01');
    assert.equal(persons.openBlock('health_data', person).particulars, 'Diabetes', 'art. 9 gaat mee (besluit Daniël)');
    assert.equal(persons.openBlock('special_data', person).church, 'GKV');
    const consents = await db.query('SELECT kind, text_version, given_at FROM consents WHERE booking_id = $1 ORDER BY kind', [good.id]);
    assert.deepEqual(consents.map((consent) => [consent.kind, consent.text_version]), [
      ['art9_gezondheid', LEGACY_ART9_TEXT_VERSION],
      ['art9_religie', LEGACY_ART9_TEXT_VERSION],
      ['voorwaarden', LEGACY_TEXT_VERSION],
    ]);
    assert.ok(consents.every((consent) => consent.given_at.toISOString() === '2026-01-02T10:00:00.000Z'));
    assert.equal((await db.query('SELECT person_id FROM bookings WHERE id = $1', [bad.id]))[0].person_id, null);
    assert.deepEqual(await persons.backfillPersons(db), { converted: 1, failed: 1 }, 'volgende start: de eerder mislukte lukt nu, de kapotte blijft');
    const [plain] = await insertOld('AV-OUD-3', 'zonder-art9@example.nl', vault.seal({ ...sensitive, church: '', particulars: '' }));
    assert.deepEqual(await persons.backfillPersons(db), { converted: 1, failed: 1 });
    const plainConsents = await db.query('SELECT kind FROM consents WHERE booking_id = $1', [plain.id]);
    assert.deepEqual(plainConsents.map((consent) => consent.kind), ['voorwaarden'], 'lege art. 9-velden: geen art. 9-toestemming');
  });
});
