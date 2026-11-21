/**
 * Tests voor de betalingen in het CRM (migratie 26, `crm/payments.js`, `/app/betalingen/<aanmelding>/`): bedragen lezen,
 * saldo, aanbetaling, vervaldatums en achterstand berekenen; de migratie vult bestaande aanmeldingen aan; rechten
 * (zonder sessie naar inloggen, reisleider 403, boekhouding wel), onbekende aanmelding of regel van een andere
 * aanmelding 404; betaling registreren met automatische status, correcties, verouderd formulier 409, bedragen toevoegen
 * en weghalen, audit zonder bedragen; opschoning wist toelichtingen en laat betaalde annuleringen staan.
 * Draait in een eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { hashPassword } = require('../src/crm/passwords');
const { COOKIE_NAME } = require('../src/crm/auth');
const payments = require('../src/crm/payments');
const { validatePayment, validateCharge } = require('../src/crm/payment-routes');
const { anonymizeBookings, CANDIDATES } = require('../src/crm/retention');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'payments_test';
const MASTER_KEY = Buffer.alloc(32, 23);
const PASSWORD = 'een heel goed wachtwoord';
const TERMS = { depositDays: 7, balanceDaysBefore: 42 };

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

test('bedragen lezen en opmaken', () => {
  assert.equal(payments.parseAmount('1.234,56'), 123456);
  assert.equal(payments.parseAmount('1234,5'), 123450);
  assert.equal(payments.parseAmount('1234.56'), 123456);
  assert.equal(payments.parseAmount('€ 15'), 1500);
  assert.equal(payments.parseAmount('-20'), -2000);
  assert.equal(payments.parseAmount('1,2,3'), null);
  assert.equal(payments.parseAmount('12,345'), null);
  assert.equal(payments.parseAmount('abc'), null);
  assert.equal(payments.parseAmount('10000000'), null, 'meer dan € 1.000.000');
  assert.equal(payments.parseAmount(['1']), null);
  assert.equal(payments.formatAmount(-1550), '-€15,50');
  assert.equal(payments.formatAmount(184900), '€1.849,-');
});

test('bedragen bij aanmelden', () => {
  assert.deepEqual(payments.initialCharges({ priceCents: 79900, paymentChoice: 'aanbetaling' }).map((charge) => charge.kind), ['reissom', 'sgr', 'boekingskosten']);
  assert.deepEqual(payments.initialCharges({ priceCents: null, paymentChoice: 'totaal' }), [{ kind: 'sgr', amountCents: 500 }]);
});

test('vervaldatums', () => {
  const booking = { created_at: new Date('2027-01-10T23:30:00Z'), departure_date: '2027-06-01', payment_choice: 'aanbetaling' };
  // 23:30 UTC is 00:30 op 11 januari in Nederland.
  assert.deepEqual(payments.dueDates(booking, TERMS), { depositDueOn: '2027-01-18', balanceDueOn: '2027-04-20' });
  assert.deepEqual(payments.dueDates({ ...booking, departure_date: '2027-02-01' }, TERMS), { depositDueOn: '2027-01-18', balanceDueOn: '2027-01-18' }, 'laat aangemeld: restant op de datum van de aanbetaling');
  assert.deepEqual(payments.dueDates({ ...booking, payment_choice: 'totaal' }, TERMS), { depositDueOn: '2027-01-18', balanceDueOn: '2027-01-18' });
  assert.deepEqual(payments.dueDates({ ...booking, departure_date: null }, TERMS), { depositDueOn: '2027-01-18', balanceDueOn: null });
});

test('saldo, aanbetaling, betaalstatus en achterstand', () => {
  const booking = { status: 'bevestigd', payment_choice: 'aanbetaling', deposit_cents: 20000, created_at: '2027-01-10T10:00:00Z', departure_date: '2027-06-01' };
  const charges = [{ kind: 'reissom', amount_cents: 79900 }, { kind: 'sgr', amount_cents: 500 }, { kind: 'boekingskosten', amount_cents: 1500 }];
  const sum = (paid, today = '2027-01-12', extra = {}) => payments.summarize({ booking: { ...booking, ...extra }, charges, payments: paid.map((amount) => ({ amount_cents: amount })), terms: TERMS, today });
  const open = sum([]);
  assert.equal(open.totalCents, 81900);
  assert.equal(open.depositRequiredCents, 22000, 'aanbetaling van de reis + boekingskosten + SGR');
  assert.equal(open.state, 'open');
  assert.equal(open.overdue, '');
  assert.equal(sum([], '2027-01-17').overdue, '', 'op de vervaldag nog niet te laat');
  assert.equal(sum([], '2027-01-18').overdue, 'aanbetaling');
  assert.equal(sum([10000], '2027-01-19').state, 'open');
  assert.equal(sum([22000], '2027-01-19').state, 'aanbetaald');
  assert.equal(sum([22000], '2027-01-19').overdue, '');
  assert.equal(sum([22000], '2027-04-21').overdue, 'restant');
  assert.equal(sum([22000], '2027-04-21', { status: 'geannuleerd' }).overdue, '', 'geannuleerd is nooit te laat');
  assert.equal(sum([81900]).state, 'betaald');
  assert.equal(sum([90000]).state, 'teveel');
  assert.equal(sum([90000]).balanceCents, -8100);
  assert.equal(sum([], '2027-01-12', { payment_choice: 'totaal' }).depositRequiredCents, 81900);
  assert.equal(sum([], '2027-01-12', { deposit_cents: null }).depositRequiredCents, 2000, 'zonder aanbetaling van de reis alleen de kosten');
  assert.equal(payments.summarize({ booking, charges: [], payments: [], terms: TERMS, today: '2027-02-01' }).state, 'geen');
});

test('status van de aanmelding schuift alleen vooruit mee', () => {
  assert.equal(payments.nextBookingStatus('bevestigd', 'aanbetaald'), 'aanbetaald');
  assert.equal(payments.nextBookingStatus('bevestigd', 'betaald'), 'betaald');
  assert.equal(payments.nextBookingStatus('aanbetaald', 'teveel'), 'betaald');
  assert.equal(payments.nextBookingStatus('aanbetaald', 'aanbetaald'), null);
  assert.equal(payments.nextBookingStatus('nieuw', 'betaald'), null, 'kantoor bevestigt zelf');
  assert.equal(payments.nextBookingStatus('betaald', 'open'), null, 'nooit terug');
  assert.equal(payments.nextBookingStatus('geannuleerd', 'betaald'), null);
});

test('formulieren controleren', () => {
  const today = '2027-03-01';
  assert.equal(validatePayment({ wijze: 'bank', bedrag: '250', datum: today }, today).error, '');
  assert.match(validatePayment({ wijze: 'bank', bedrag: '-250', datum: today }, today).error, /correctie/);
  assert.match(validatePayment({ wijze: 'correctie', bedrag: '-250', datum: today }, today).error, /toelichting/);
  assert.equal(validatePayment({ wijze: 'correctie', bedrag: '-250', datum: today, toelichting: 'Dubbel ingevoerd' }, today).error, '');
  assert.match(validatePayment({ wijze: 'bank', bedrag: '250', datum: '2027-03-02' }, today).error, /toekomst/);
  assert.match(validatePayment({ wijze: 'bank', bedrag: '0', datum: today }, today).error, /bedrag/);
  assert.match(validatePayment({ wijze: 'toString', bedrag: '1', datum: today }, today).error, /Kies/);
  assert.equal(validateCharge({ soort: 'korting', bedrag: '50' }).values.amountCents, -5000);
  assert.match(validateCharge({ soort: 'korting', bedrag: '-50' }).error, /minteken/);
  assert.match(validateCharge({ soort: 'overig', bedrag: '-50' }).error, /omschrijving/);
  assert.equal(validateCharge({ soort: 'overig', bedrag: '-50', omschrijving: 'Teruggave excursie' }).values.amountCents, -5000);
  assert.match(validateCharge({ soort: 'reissom', bedrag: '50' }).error, /soort/);
});

test('betalingen in het CRM', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  const clock = Date.parse('2027-03-01T10:00:00Z');
  const app = createApp({ db, masterKey: MASTER_KEY, now: () => clock });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await db.close(); });

  const hash = await hashPassword(PASSWORD);
  for (const [email, role] of [['kantoor@example.nl', 'kantoor'], ['leider@example.nl', 'reisleider'], ['boek@example.nl', 'boekhouding'], ['red@example.nl', 'redacteur']]) {
    await db.query('INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)', [email, role, role, hash]);
  }
  const [trip] = await db.query("INSERT INTO trips (slug, title, trip_code, departure_date, price_cents, deposit_cents) VALUES ('albanie', 'Albanië', '27-ALB-1', '2027-06-01', 79900, 20000) RETURNING id");
  const insertBooking = async (reference, status = 'nieuw', choice = 'aanbetaling') => (await db.query(
    `INSERT INTO bookings (reference, trip_id, trip_title, trip_code, departure_date, status, gender, first_names, call_name, last_name, email, mobile, street,
       postal_code, city, earlier_trip, credit_card, driver_interest, driver_before, payment_method, payment_choice, price_cents, consent_at, created_at)
     VALUES ($1, $2, 'Albanië', '27-ALB-1', '2027-06-01', $3, 'man', 'Jan', 'Jan', 'Jansen', 'jan@example.nl', '06', 'Straat 1', '1234 AB', 'Goes',
       false, false, false, false, 'handmatig', $4, 79900, now(), '2027-02-20T10:00:00Z')
     RETURNING id`,
    [reference, trip.id, status, choice],
  ))[0].id;

  await t.test('migratie 26 vult bestaande aanmeldingen aan', async () => {
    await db.query('DROP TABLE payments, booking_charges; ALTER TABLE bookings DROP COLUMN deposit_cents; DELETE FROM schema_migrations WHERE id = 26');
    const old = await insertBooking('AV-2027-OUD00001');
    const total = await insertBooking('AV-2027-OUD00002', 'nieuw', 'totaal');
    assert.deepEqual(await db.migrate(), [26]);
    const lines = await db.query('SELECT booking_id, kind, amount_cents FROM booking_charges ORDER BY booking_id, kind');
    assert.deepEqual(lines.map((row) => [row.booking_id, row.kind, row.amount_cents]), [
      [old, 'boekingskosten', 1500], [old, 'reissom', 79900], [old, 'sgr', 500], [total, 'reissom', 79900], [total, 'sgr', 500],
    ]);
    const [booking] = await db.query('SELECT deposit_cents FROM bookings WHERE id = $1', [old]);
    assert.equal(booking.deposit_cents, 20000);
    await db.query('DELETE FROM bookings');
  });

  const bookingId = await insertBooking('AV-2027-AAAA0001', 'bevestigd');
  await db.query('UPDATE bookings SET deposit_cents = 20000 WHERE id = $1', [bookingId]);
  await db.transaction((client) => payments.addInitialCharges(client, bookingId, { priceCents: 79900, paymentChoice: 'aanbetaling' }));
  const otherId = await insertBooking('AV-2027-BBBB0002');
  await db.transaction((client) => payments.addInitialCharges(client, otherId, { priceCents: 79900, paymentChoice: 'aanbetaling' }));
  const path = `/app/betalingen/${bookingId}/`;

  /**
   * Doet een verzoek zonder redirects te volgen.
   * @param {string} url Pad.
   * @param {{form?: object, cookie?: string}} [init] Formulier en sessiecookie.
   * @returns {Promise<{status: number, text: string, headers: Headers, cookie: string}>} Antwoord.
   */
  const request = async (url, init = {}) => {
    const headers = {};
    if (init.cookie) headers.cookie = `${COOKIE_NAME}=${init.cookie}`;
    let body;
    if (init.form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(init.form).toString();
    }
    const response = await fetch(base + url, { method: init.form ? 'POST' : 'GET', headers, body, redirect: 'manual' });
    const setCookie = response.headers.getSetCookie().find((value) => value.startsWith(`${COOKIE_NAME}=`)) || '';
    return { status: response.status, text: await response.text(), headers: response.headers, cookie: setCookie.split(';')[0].split('=')[1] || '' };
  };

  /**
   * Logt in en haalt het CSRF-token op.
   * @param {string} email E-mailadres.
   * @returns {Promise<{cookie: string, csrf: string}>} Sessie.
   */
  const login = async (email) => {
    const response = await request('/app/inloggen/', { form: { email, password: PASSWORD } });
    const home = await request('/app/', { cookie: response.cookie });
    return { cookie: response.cookie, csrf: (home.text.match(/name="_csrf" value="([^"]+)"/) || [])[1] };
  };
  const kantoor = await login('kantoor@example.nl');
  const leider = await login('leider@example.nl');
  const boek = await login('boek@example.nl');
  const redacteur = await login('red@example.nl');

  /**
   * De stand van het formulier op de betaalpagina.
   * @param {number} id Aanmelding.
   * @returns {Promise<string>} Waarde van het veld `stand`.
   */
  const standOf = async (id) => /name="stand" value="([^"]+)"/.exec((await request(`/app/betalingen/${id}/`, { cookie: kantoor.cookie })).text)[1];
  const pay = async (form, session = kantoor, id = bookingId) => request(`/app/betalingen/${id}/betaling/`, {
    cookie: session.cookie, form: { _csrf: session.csrf, stand: await standOf(id), datum: '2027-03-01', ...form },
  });

  await t.test('rechten: zonder sessie naar inloggen, reisleider en redacteur 403, boekhouding wel, onbekend 404', async () => {
    assert.equal((await request(path)).status, 303);
    assert.equal((await request(path, { cookie: leider.cookie })).status, 403);
    assert.equal((await request(path, { cookie: redacteur.cookie })).status, 403);
    assert.equal((await request(`${path}betaling/`, { cookie: leider.cookie, form: { _csrf: leider.csrf, wijze: 'bank', bedrag: '10', datum: '2027-03-01' } })).status, 403);
    const asBookkeeper = await request(path, { cookie: boek.cookie });
    assert.equal(asBookkeeper.status, 200);
    assert.doesNotMatch(asBookkeeper.text, /Naar de aanmelding/, 'boekhouding heeft geen recht op de aanmelding zelf');
    assert.equal((await request('/app/betalingen/999999/', { cookie: kantoor.cookie })).status, 404);
    assert.equal((await request('/app/betalingen/999999/betaling/', { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, wijze: 'bank', bedrag: '10', datum: '2027-03-01' } })).status, 404);
    assert.equal((await request(`${path}betaling/`, { cookie: kantoor.cookie, form: { wijze: 'bank', bedrag: '10', datum: '2027-03-01' } })).status, 403, 'zonder CSRF-token');
  });

  await t.test('pagina toont bedragen, aanbetaling en vervaldatums; aanmelding toont de stand', async () => {
    const page = await request(path, { cookie: kantoor.cookie });
    assert.match(page.text, /€819,-/);
    assert.match(page.text, /€220,- uiterlijk 27-02-2027/);
    assert.match(page.text, /aanbetaling te laat/);
    assert.match(page.text, /20-04-2027/);
    const bookingPage = await request(`/app/aanmeldingen/${bookingId}/`, { cookie: kantoor.cookie });
    assert.match(bookingPage.text, /Betalingen bekijken en registreren/);
  });

  await t.test('betaling registreren: aanmelding schuift door naar aanbetaald en betaald, met historie en audit', async () => {
    const first = await pay({ wijze: 'bank', bedrag: '220,00', toelichting: 'Overboeking' });
    assert.equal(first.status, 303);
    assert.match(first.headers.get('location'), /status=aanbetaald/);
    let [booking] = await db.query('SELECT status FROM bookings WHERE id = $1', [bookingId]);
    assert.equal(booking.status, 'aanbetaald');
    const second = await pay({ wijze: 'ideal', bedrag: '599' });
    assert.match(second.headers.get('location'), /status=betaald/);
    [booking] = await db.query('SELECT status FROM bookings WHERE id = $1', [bookingId]);
    assert.equal(booking.status, 'betaald');
    const events = await db.query('SELECT from_status, to_status, note FROM booking_events WHERE booking_id = $1 ORDER BY id', [bookingId]);
    assert.deepEqual(events.map((event) => event.to_status), ['aanbetaald', 'betaald']);
    assert.match(events[0].note, /Automatisch na een betaling van €220,-/);
    const audit = await db.query("SELECT action, entity_id FROM audit_log WHERE action LIKE 'betaling.%' ORDER BY id");
    assert.deepEqual(audit.map((row) => row.action), ['betaling.geregistreerd', 'betaling.geregistreerd']);
    assert.equal(audit[0].entity_id, String(bookingId));
    const page = await request(path, { cookie: kantoor.cookie });
    assert.match(page.text, /Overboeking/);
    assert.match(page.text, /crm-status--betaald">Betaald/);
  });

  await t.test('nieuwe aanmelding schuift niet automatisch; ongeldige invoer 422', async () => {
    assert.equal((await pay({ wijze: 'bank', bedrag: '100' }, kantoor, otherId)).status, 303);
    const [other] = await db.query('SELECT status FROM bookings WHERE id = $1', [otherId]);
    assert.equal(other.status, 'nieuw');
    assert.match((await request(`/app/betalingen/${otherId}/`, { cookie: kantoor.cookie })).text, /nog niet bevestigd/);
    const refused = await pay({ wijze: 'bank', bedrag: '-50' });
    assert.equal(refused.status, 422);
    assert.match(refused.text, /alleen als correctie/);
    assert.equal((await pay({ wijze: 'bank', bedrag: '50', datum: '2027-03-02' })).status, 422);
    assert.equal((await pay({ wijze: 'correctie', bedrag: '-50' })).status, 422);
    assert.equal((await pay({ wijze: 'correctie', bedrag: '-50', toelichting: 'Teruggestort' })).status, 303);
    const [booking] = await db.query('SELECT status FROM bookings WHERE id = $1', [bookingId]);
    assert.equal(booking.status, 'betaald', 'een correctie zet de status nooit terug');
  });

  await t.test('verouderd of dubbel verstuurd formulier geeft 409 en slaat niets op', async () => {
    const stand = await standOf(bookingId);
    const form = { _csrf: kantoor.csrf, stand, wijze: 'bank', bedrag: '10', datum: '2027-03-01' };
    assert.equal((await request(`${path}betaling/`, { cookie: kantoor.cookie, form })).status, 303);
    const twice = await request(`${path}betaling/`, { cookie: kantoor.cookie, form });
    assert.equal(twice.status, 409);
    assert.match(twice.text, /intussen gewijzigd/);
    const [count] = await db.query('SELECT count(*)::int AS total FROM payments WHERE booking_id = $1 AND amount_cents = 1000', [bookingId]);
    assert.equal(count.total, 1);
  });

  await t.test('bedragen toevoegen en weghalen; regel van een andere aanmelding 404', async () => {
    const add = async (form) => request(`${path}bedragen/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, stand: await standOf(bookingId), ...form } });
    assert.equal((await add({ soort: 'korting', bedrag: '25' })).status, 303);
    assert.equal((await add({ soort: 'overig', bedrag: '10' })).status, 422);
    assert.equal((await add({ soort: 'overig', bedrag: '10', omschrijving: 'Extra excursie' })).status, 303);
    const lines = await db.query("SELECT id, kind, amount_cents FROM booking_charges WHERE booking_id = $1 AND kind IN ('korting', 'overig') ORDER BY id", [bookingId]);
    assert.deepEqual(lines.map((row) => [row.kind, row.amount_cents]), [['korting', -2500], ['overig', 1000]]);
    const [foreign] = await db.query("SELECT id FROM booking_charges WHERE booking_id = $1 AND kind = 'sgr'", [otherId]);
    const wrong = await request(`${path}bedragen/${foreign.id}/weg/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, stand: await standOf(bookingId) } });
    assert.equal(wrong.status, 404);
    assert.equal((await db.query('SELECT id FROM booking_charges WHERE id = $1', [foreign.id])).length, 1);
    assert.equal((await request(`${path}bedragen/${lines[0].id}/weg/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, stand: await standOf(bookingId) } })).status, 303);
    const [removed] = await db.query('SELECT removed_at, removed_by FROM booking_charges WHERE id = $1', [lines[0].id]);
    assert.ok(removed.removed_at, 'weghalen is markeren, niet verwijderen');
    assert.ok(removed.removed_by);
    const page = await request(path, { cookie: kantoor.cookie });
    assert.match(page.text, /Weggehaalde bedragen \(1\)/);
    assert.match(page.text, /Korting: -€25,-, weggehaald/);
    const again = await request(`${path}bedragen/${lines[0].id}/weg/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, stand: await standOf(bookingId) } });
    assert.equal(again.status, 404);
    assert.match(again.text, /al weggehaald/);
    const audit = await db.query("SELECT action FROM audit_log WHERE action LIKE 'betaling.bedrag%' ORDER BY id");
    assert.deepEqual(audit.map((row) => row.action), ['betaling.bedrag', 'betaling.bedrag', 'betaling.bedrag-weg']);
  });

  await t.test('status loopt voor op de betaalstand na een extra bedrag: waarschuwing, niet automatisch terug', async () => {
    const add = await request(`${path}bedragen/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, stand: await standOf(bookingId), soort: 'annulering', bedrag: '100' } });
    assert.equal(add.status, 303);
    const [booking] = await db.query('SELECT status FROM bookings WHERE id = $1', [bookingId]);
    assert.equal(booking.status, 'betaald');
    assert.match((await request(path, { cookie: kantoor.cookie })).text, /staat op betaald, maar er staat nog een bedrag open/);
    assert.match((await request(`/app/aanmeldingen/${bookingId}/`, { cookie: kantoor.cookie })).text, /staat op betaald, maar er staat nog een bedrag open/);
    assert.equal(payments.statusMismatch('aanbetaald', 'open'), 'De aanmelding staat op aanbetaald, maar de aanbetaling is niet (meer) voldaan.');
    assert.equal(payments.statusMismatch('bevestigd', 'open'), '');
    assert.equal(payments.statusMismatch('betaald', 'geen'), '', 'niets open, dus geen waarschuwing');
  });

  await t.test('bedrag weghalen schuift een bevestigde aanmelding door als alles betaald is', async () => {
    const id = await insertBooking('AV-2027-CCCC0003', 'bevestigd');
    await db.query("INSERT INTO booking_charges (booking_id, kind, amount_cents) VALUES ($1, 'reissom', 10000), ($1, 'annulering', 5000)", [id]);
    await db.query("INSERT INTO payments (booking_id, amount_cents, method, received_on) VALUES ($1, 10000, 'bank', '2027-02-25')", [id]);
    const [extra] = await db.query("SELECT id FROM booking_charges WHERE booking_id = $1 AND kind = 'annulering'", [id]);
    const response = await request(`/app/betalingen/${id}/bedragen/${extra.id}/weg/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, stand: await standOf(id) } });
    assert.equal(response.status, 303);
    assert.match(response.headers.get('location'), /status=betaald/);
    const [events] = await db.query('SELECT to_status, note FROM booking_events WHERE booking_id = $1', [id]);
    assert.deepEqual([events.to_status, events.note], ['betaald', 'Automatisch na een weggehaald bedrag.']);
  });

  await t.test('bedrag toevoegen schuift een bevestigde aanmelding door als alles betaald is', async () => {
    const id = await insertBooking('AV-2027-DDDD0004', 'bevestigd');
    await db.query("INSERT INTO booking_charges (booking_id, kind, amount_cents) VALUES ($1, 'reissom', 10000)", [id]);
    await db.query("INSERT INTO payments (booking_id, amount_cents, method, received_on) VALUES ($1, 8000, 'bank', '2027-02-25')", [id]);
    const response = await request(`/app/betalingen/${id}/bedragen/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, stand: await standOf(id), soort: 'korting', bedrag: '20' } });
    assert.equal(response.status, 303);
    assert.match(response.headers.get('location'), /status=betaald/);
    const [event] = await db.query('SELECT to_status, note FROM booking_events WHERE booking_id = $1', [id]);
    assert.deepEqual([event.to_status, event.note], ['betaald', 'Automatisch na een gewijzigd bedrag.']);
  });

  await t.test('opschoning: toelichtingen weg bij anonimiseren, betaalde annulering blijft staan', async () => {
    await db.transaction((client) => anonymizeBookings(client, [bookingId]));
    const notes = await db.query("SELECT note FROM payments WHERE booking_id = $1 AND note <> ''", [bookingId]);
    assert.equal(notes.length, 0);
    const descriptions = await db.query("SELECT description FROM booking_charges WHERE booking_id = $1 AND description <> ''", [bookingId]);
    assert.equal(descriptions.length, 0);
    assert.ok((await db.query('SELECT id FROM payments WHERE booking_id = $1', [bookingId])).length > 0, 'betalingen blijven voor de boekhouding');
    await db.query("UPDATE bookings SET status = 'geannuleerd', cancelled_at = '2026-01-01' WHERE id = $1", [otherId]);
    const candidates = await db.query(CANDIDATES.geannuleerd, ['2027-03-01', 6, 100, otherId, 0]);
    assert.equal(candidates.length, 0, 'er is betaald, dus niet verwijderen');
    await db.query('DELETE FROM payments WHERE booking_id = $1', [otherId]);
    assert.equal((await db.query(CANDIDATES.geannuleerd, ['2027-03-01', 6, 100, otherId, 0])).length, 1);
  });

});
