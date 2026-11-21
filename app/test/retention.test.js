/**
 * Tests voor de AVG-opschoning (`crm/retention.js`, Beheer > AVG en bewaartermijnen): blokken wissen na terugkomst
 * (geboortedatum blijft), een nieuwe aanmelding schuift de termijn op, personen en aanmeldingen anonimiseren,
 * geannuleerde aanmeldingen zonder betaling verwijderen, oude aanmeldingen na de fiscale termijn verwijderen, oude
 * contactberichten en ongebruikte reizigersaccounts weg, een tweede ronde doet niets, een onleesbaar blok telt als
 * mislukt, en de routes in Beheer (rechten, CSRF, voorbeeld, audit, limiet). Draait in een eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { createVault } = require('../src/security/vault');
const { createPersons } = require('../src/crm/persons');
const { hashPassword } = require('../src/crm/passwords');
const { COOKIE_NAME } = require('../src/crm/auth');
const { ANONYMIZED_NAME } = require('../src/crm/retention');
const { summarize } = require('../src/beheer/retention-routes');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'retention_test';
const MASTER_KEY = Buffer.alloc(32, 31);
const PASSWORD = 'een heel goed wachtwoord';

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

test('AVG-opschoning: samenvatting zonder database', () => {
  assert.equal(summarize({}), 'Niets te wissen');
  assert.equal(summarize({ personen: 2, contact: 0 }), 'Personen geanonimiseerd: 2');
});

test('AVG-opschoning', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  let today = '2027-03-01';
  const app = createApp({ db, masterKey: MASTER_KEY, retentionToday: () => today });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await db.close(); });
  const retention = app.locals.retention;
  const persons = createPersons({ vault: createVault(MASTER_KEY) });

  const hash = await hashPassword(PASSWORD);
  for (const [email, role] of [['beheer@example.nl', 'beheerder'], ['kantoor@example.nl', 'kantoor']]) {
    await db.query('INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)', [email, role, role, hash]);
  }
  const insertTrip = async (slug, departure, days) => (await db.query(
    'INSERT INTO trips (slug, title, trip_code, departure_date, duration_days) VALUES ($1, $1, $1, $2, $3) RETURNING id',
    [slug, departure, days],
  ))[0].id;
  const pastTrip = await insertTrip('past', '2027-01-10', 8); // terug 17-01-2027
  const futureTrip = await insertTrip('future', '2027-06-01', 10);
  const oldTrip = await insertTrip('old', '2019-07-01', 14);

  /**
   * Maakt een persoon met alle blokken ingevuld.
   * @param {string} email E-mailadres (uniek per persoon).
   * @param {string} [lastActivity] Laatste activiteit (anders nu).
   * @returns {Promise<number>} Id.
   */
  const insertPerson = async (email, lastActivity) => {
    const values = {
      gender: 'vrouw', first_names: 'Grietje', call_name: 'Griet', last_name: 'Bakker', email, mobile: '0612121212', phone: '',
      street: 'Markt 1', postal_code: '4331 AA', city: 'Middelburg', occupation: 'Juf', birth_date: '1990-03-04',
      nationality: 'Nederlandse', document_type: 'paspoort', document_number: 'NX99', church: 'PKN', consent_religion: 'ja',
      particulars: 'Astma', consent_health: 'ja', emergency_phone: '0687654321',
    };
    const id = await db.transaction(async (client) => {
      const { personId } = await persons.savePerson(client, values);
      await persons.recordConsents(client, { personId, bookingId: null, values });
      return personId;
    });
    if (lastActivity) await db.query('UPDATE persons SET last_activity_at = $2 WHERE id = $1', [id, lastActivity]);
    return id;
  };

  /**
   * Maakt een aanmelding.
   * @param {{reference: string, tripId: number, personId?: number, status?: string, createdAt?: string, cancelledAt?: string, accountId?: number}} input Gegevens.
   * @returns {Promise<number>} Id.
   */
  const insertBooking = async (input) => (await db.query(
    `INSERT INTO bookings (reference, trip_id, trip_title, gender, first_names, call_name, last_name, email, mobile, street, postal_code, city,
       earlier_trip, credit_card, driver_interest, driver_before, payment_method, payment_choice, consent_at, person_id, status, created_at,
       cancelled_at, cancel_reason, customer_account_id)
     VALUES ($1, $2, 'Reis', 'man', 'Jan', 'Jan', 'Jansen', 'jan@example.nl', '0611', 'Straat 1', '1234 AB', 'Goes', true, false, false, false,
       'handmatig', 'aanbetaling', now(), $3, $4, coalesce($5::timestamptz, now()), $6, $7, $8)
     RETURNING id`,
    [input.reference, input.tripId, input.personId || null, input.status || 'bevestigd', input.createdAt || null, input.cancelledAt || null,
      input.cancelledAt ? 'Ziek, zegt Jan' : '', input.accountId || null],
  ))[0].id;

  const recent = await insertPerson('recent@example.nl');
  await insertBooking({ reference: 'AV-RECENT', tripId: pastTrip, personId: recent });
  const future = await insertPerson('future@example.nl');
  await insertBooking({ reference: 'AV-FUTURE', tripId: futureTrip, personId: future });
  const old = await insertPerson('old@example.nl', '2019-08-01');
  const oldBooking = await insertBooking({ reference: 'AV-OLD', tripId: oldTrip, personId: old, createdAt: '2019-03-01' });
  await db.query("INSERT INTO booking_events (booking_id, from_status, to_status, note) VALUES ($1, 'nieuw', 'nieuw', 'Belt over dieet van Jan')", [oldBooking]);
  const middle = await insertPerson('middle@example.nl', '2024-01-01');
  const middleBooking = await insertBooking({ reference: 'AV-MIDDLE', tripId: null, personId: middle, createdAt: '2023-12-01' });
  const broken = await insertPerson('broken@example.nl');
  await insertBooking({ reference: 'AV-BROKEN', tripId: pastTrip, personId: broken });
  await db.query("UPDATE persons SET identity_data = 'kapot' WHERE id = $1", [broken]);
  const cancelled = await insertBooking({ reference: 'AV-CANCEL', tripId: futureTrip, status: 'geannuleerd', cancelledAt: '2026-08-01' });
  const cancelledPaid = await insertBooking({ reference: 'AV-CANCELPAID', tripId: futureTrip, status: 'geannuleerd', cancelledAt: '2026-08-01' });
  await db.query("INSERT INTO booking_events (booking_id, from_status, to_status) VALUES ($1, 'bevestigd', 'aanbetaald')", [cancelledPaid]);
  const cancelledRecent = await insertBooking({ reference: 'AV-CANCELNEW', tripId: futureTrip, status: 'geannuleerd', cancelledAt: '2027-02-01' });
  const unlinked = await insertBooking({ reference: 'AV-UNLINKED', tripId: oldTrip, createdAt: '2019-03-01' });
  await db.query("INSERT INTO contact_messages (name, email, message, consent_at, created_at) VALUES ('Oud', 'o@example.nl', 'x', now(), '2025-12-01'), ('Nieuw', 'n@example.nl', 'x', now(), '2026-12-01')");
  const [oldAccount] = await db.query("INSERT INTO customer_accounts (email, password_hash, verified_at, last_login_at, created_at) VALUES ('oud@example.nl', 'x', '2024-01-01', '2024-06-01', '2024-01-01') RETURNING id");
  const [newAccount] = await db.query("INSERT INTO customer_accounts (email, password_hash, verified_at, last_login_at) VALUES ('nieuw@example.nl', 'x', now(), now()) RETURNING id");

  await t.test('voorbeeld wijzigt niets', async () => {
    const preview = await retention.preview();
    assert.equal(preview.blokken, 4, 'recent, broken en de twee te anonimiseren personen');
    assert.equal(preview.personen, 2);
    assert.equal(preview.geannuleerd, 1);
    assert.equal(preview.contact, 1);
    assert.equal(preview.accounts, 1);
    const [row] = await db.query('SELECT special_data IS NOT NULL AS filled FROM persons WHERE id = $1', [recent]);
    assert.ok(row.filled);
  });

  await t.test('eerste ronde', async () => {
    const outcome = await retention.run({ trigger: 'dagelijks' });
    assert.equal(outcome.error, '');
    assert.equal(outcome.failed, 1, 'onleesbaar identiteitsblok');
    assert.equal(outcome.counts.blokken, 3);
    assert.equal(outcome.counts.personen, 2);
    assert.equal(outcome.counts.aanmeldingen, 1, 'aanmelding zonder persoon');
    assert.equal(outcome.counts.geannuleerd, 1);
    assert.equal(outcome.counts.verlopen, 2, 'oude aanmelding van de persoon en de losse aanmelding (ouder dan 7 jaar)');
    assert.equal(outcome.counts.personenWeg, 1, 'oude persoon zonder aanmeldingen');
    assert.equal(outcome.counts.accounts, 1);
    assert.equal(outcome.counts.contact, 1);

    // Blokken van de recente reiziger gewist, geboortedatum en NAW blijven.
    const kept = await persons.findPerson(db, recent);
    assert.equal(kept.special_data, null);
    assert.equal(kept.health_data, null);
    assert.equal(kept.emergency_data, null);
    assert.deepEqual(persons.openBlock('identity_data', kept), { birth_date: '1990-03-04' });
    assert.equal(kept.last_name, 'Bakker');
    // Toekomstige reis: niets gewist.
    const untouched = await persons.findPerson(db, future);
    assert.ok(untouched.special_data && untouched.health_data);
    assert.equal(persons.openBlock('identity_data', untouched).document_number, 'NX99');
    // Onleesbaar identiteitsblok blijft staan, de rest is gewist.
    const brokenRow = await persons.findPerson(db, broken);
    assert.equal(brokenRow.identity_data, 'kapot');
    assert.equal(brokenRow.health_data, null);

    // Persoon met een aanmelding binnen de fiscale termijn: geanonimiseerd, aanmelding blijft zonder persoonsgegevens.
    const [anon] = await db.query('SELECT first_names, last_name, email, mobile, street, match_key, identity_data, health_data, anonymized_at FROM persons WHERE id = $1', [middle]);
    assert.equal(anon.last_name, ANONYMIZED_NAME);
    assert.equal(anon.email, '');
    assert.equal(anon.street, '');
    assert.equal(anon.identity_data, null);
    assert.equal(anon.match_key, `verwijderd:${middle}`);
    assert.ok(anon.anonymized_at);
    const [booking] = await db.query('SELECT last_name, email, street, cancel_reason, anonymized_at, status FROM bookings WHERE id = $1', [middleBooking]);
    assert.equal(booking.last_name, ANONYMIZED_NAME);
    assert.equal(booking.email, '');
    assert.equal(booking.status, 'bevestigd');
    assert.ok(booking.anonymized_at);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM consents WHERE person_id = $1', [middle]))[0].n, 3, 'toestemmingen blijven als bewijs');

    // Oud: aanmelding na 7 jaar weg, persoon (al anoniem, zonder aanmeldingen) weg, met toestemmingen en historie.
    assert.equal((await db.query('SELECT count(*)::int AS n FROM persons WHERE id = $1', [old]))[0].n, 0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM bookings WHERE id = ANY($1::int[])', [[oldBooking, unlinked]]))[0].n, 0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM booking_events WHERE booking_id = $1', [oldBooking]))[0].n, 0);

    // Geannuleerd: zonder betaling weg, met aanbetaling of recent blijft.
    const left = (await db.query('SELECT id FROM bookings WHERE id = ANY($1::int[]) ORDER BY id', [[cancelled, cancelledPaid, cancelledRecent]])).map((row) => row.id);
    assert.deepEqual(left, [cancelledPaid, cancelledRecent]);
    // Contactberichten en accounts.
    assert.deepEqual((await db.query('SELECT name FROM contact_messages')).map((row) => row.name), ['Nieuw']);
    assert.deepEqual((await db.query('SELECT id FROM customer_accounts ORDER BY id')).map((row) => row.id), [newAccount.id]);
    assert.ok(oldAccount.id);

    const [run] = await db.query('SELECT trigger, finished_at, failed, counts FROM retention_runs ORDER BY id DESC LIMIT 1');
    assert.equal(run.trigger, 'dagelijks');
    assert.ok(run.finished_at);
    assert.equal(run.counts.personen, 2);
  });

  await t.test('tweede ronde doet niets (behalve het onleesbare blok)', async () => {
    const outcome = await retention.run({});
    assert.equal(outcome.failed, 1);
    assert.equal(Object.values(outcome.counts).reduce((sum, value) => sum + value, 0), 0);
  });

  await t.test('een nieuwe aanmelding schuift de termijn op; daarna wordt opnieuw gewist', async () => {
    await insertBooking({ reference: 'AV-AGAIN', tripId: futureTrip, personId: recent });
    await persons.writeBlock(db, recent, 'health_data', { particulars: 'Pinda-allergie' });
    assert.equal((await retention.run({})).counts.blokken, 0, 'reis nog niet geweest');
    today = '2027-08-01';
    assert.equal((await retention.run({})).counts.blokken, 2, 'recent en de reiziger van dezelfde reis');
    assert.equal((await persons.findPerson(db, recent)).health_data, null);
    assert.equal((await persons.findPerson(db, future)).health_data, null);
    today = '2027-03-01';
  });

  /**
   * Doet een verzoek zonder redirects te volgen.
   * @param {string} path Pad.
   * @param {{form?: object, cookie?: string}} [init] Formulier en sessiecookie.
   * @returns {Promise<{status: number, text: string, cookie: string}>} Antwoord.
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
    return { status: response.status, text: await response.text(), cookie: setCookie.split(';')[0].split('=')[1] || '' };
  };

  /**
   * Logt in en haalt het CSRF-token op.
   * @param {string} email E-mailadres.
   * @returns {Promise<{cookie: string, csrf: string}>} Sessie.
   */
  const login = async (email) => {
    const response = await request('/app/inloggen/', { form: { email, password: PASSWORD } });
    assert.equal(response.status, 303, `inloggen ${email}`);
    const home = await request('/app/', { cookie: response.cookie });
    return { cookie: response.cookie, csrf: (home.text.match(/name="_csrf" value="([^"]+)"/) || [])[1] };
  };
  const beheer = await login('beheer@example.nl');
  const kantoor = await login('kantoor@example.nl');

  await t.test('Beheer: rechten, CSRF, voorbeeld, opschonen en audit', async () => {
    assert.equal((await request('/app/beheer/bewaartermijnen/')).status, 303);
    assert.equal((await request('/app/beheer/bewaartermijnen/', { cookie: kantoor.cookie })).status, 403);
    assert.equal((await request('/app/beheer/bewaartermijnen/opschonen/', { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf } })).status, 403);
    assert.equal((await request('/app/beheer/bewaartermijnen/opschonen/', { cookie: beheer.cookie, form: { _csrf: 'fout' } })).status, 403);

    const page = await request('/app/beheer/bewaartermijnen/', { cookie: beheer.cookie });
    assert.equal(page.status, 200);
    assert.match(page.text, /Laatste rondes/);
    assert.match(page.text, /Dagelijks/);
    assert.match(page.text, /Personen geanonimiseerd: 2/);
    assert.match(page.text, /name="retentionPersonMonths"/);
    assert.doesNotMatch(page.text, /Bakker|Grietje/, 'nooit namen');

    const preview = await request('/app/beheer/bewaartermijnen/voorbeeld/', { cookie: beheer.cookie, form: { _csrf: beheer.csrf } });
    assert.equal(preview.status, 200);
    assert.match(preview.text, /Voorbeeld: wat er nu gewist zou worden/);

    const unconfirmed = await request('/app/beheer/bewaartermijnen/opschonen/', { cookie: beheer.cookie, form: { _csrf: beheer.csrf } });
    assert.equal(unconfirmed.status, 422);
    const run = await request('/app/beheer/bewaartermijnen/opschonen/', { cookie: beheer.cookie, form: { _csrf: beheer.csrf, bevestigen: 'ja' } });
    assert.equal(run.status, 200);
    assert.match(run.text, /Opgeschoond\./);
    assert.match(run.text, /Met de hand \(beheerder\)/);
    const audits = await db.query("SELECT entity, entity_id FROM audit_log WHERE action = 'avg.opschonen'");
    assert.equal(audits.length, 1);
    const [latest] = await db.query('SELECT id FROM retention_runs ORDER BY id DESC LIMIT 1');
    assert.deepEqual(audits[0], { entity: 'retention_runs', entity_id: String(latest.id) });
  });

  await t.test('Beheer: limiet', async () => {
    let status = 200;
    for (let i = 0; i < 12 && status !== 429; i++) {
      status = (await request('/app/beheer/bewaartermijnen/voorbeeld/', { cookie: beheer.cookie, form: { _csrf: beheer.csrf } })).status;
    }
    assert.equal(status, 429);
  });

  await t.test('geanonimiseerde persoon in het CRM: badge en niet meer te wijzigen', async () => {
    const list = await request('/app/deelnemers/', { cookie: kantoor.cookie });
    assert.match(list.text, /geanonimiseerd/);
    const detail = await request(`/app/deelnemers/${middle}/`, { cookie: kantoor.cookie });
    assert.match(detail.text, /is geanonimiseerd op/);
    assert.doesNotMatch(detail.text, /action="\/app\/deelnemers\/\d+\/blok\/"/);
    const edit = await request(`/app/deelnemers/${middle}/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, first_names: 'Terug', last_name: 'Gezet', email: 'terug@example.nl' } });
    assert.equal(edit.status, 409);
    const [row] = await db.query('SELECT email FROM persons WHERE id = $1', [middle]);
    assert.equal(row.email, '');
  });
});
