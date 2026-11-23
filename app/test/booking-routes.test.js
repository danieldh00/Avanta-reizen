/**
 * Tests voor de aanmeldingen in het CRM (`/app/aanmeldingen/`, migratie 11): rechten (zonder recht 403, reisleider
 * dicht tot zijn eigen vertrekken er zijn), onbekend id → 404, lijst met filters, statusovergangen met historie en
 * audit, annuleren alleen met reden, gelijktijdige wijziging → 409, notities. Draait in een eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { canTransition } = require('../src/crm/booking-routes');
const { hashPassword } = require('../src/crm/passwords');
const { COOKIE_NAME } = require('../src/crm/auth');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'booking_routes_test';
const MASTER_KEY = Buffer.alloc(32, 17);
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

test('statusovergangen', () => {
  assert.equal(canTransition('nieuw', 'bevestigd'), true);
  assert.equal(canTransition('nieuw', 'betaald'), false);
  assert.equal(canTransition('bevestigd', 'betaald'), true);
  assert.equal(canTransition('betaald', 'geannuleerd'), true);
  assert.equal(canTransition('geannuleerd', 'nieuw'), false);
  assert.equal(canTransition('toString', 'nieuw'), false);
  assert.equal(canTransition('nieuw', 'wachtlijst'), false);
});

test('aanmeldingen in het CRM', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  const app = createApp({ db, masterKey: MASTER_KEY });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await db.close(); });

  const hash = await hashPassword(PASSWORD);
  for (const [email, role] of [['kantoor@example.nl', 'kantoor'], ['leider@example.nl', 'reisleider'], ['boek@example.nl', 'boekhouding']]) {
    await db.query('INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)', [email, role, role, hash]);
  }
  const [trip] = await db.query("INSERT INTO trips (slug, title, trip_code, departure_date) VALUES ('albanie', 'Albanië', '27-ALB-1', '2027-06-01') RETURNING id");
  const [other] = await db.query("INSERT INTO trips (slug, title, trip_code, departure_date) VALUES ('ijsland', 'IJsland', '27-IJS-1', '2027-07-01') RETURNING id");
  const insertBooking = async (reference, tripId, lastName) => (await db.query(
    `INSERT INTO bookings (reference, trip_id, trip_title, trip_code, gender, first_names, call_name, last_name, email, mobile, street, postal_code, city,
       earlier_trip, credit_card, driver_interest, driver_before, payment_method, payment_choice, consent_at)
     VALUES ($1, $2, 'Reis', '27-X', 'man', 'Jan', 'Jan', $3, 'jan@example.nl', '06', 'Straat 1', '1234 AB', 'Goes', false, false, false, false, 'handmatig', 'aanbetaling', now())
     RETURNING id`,
    [reference, tripId, lastName],
  ))[0].id;
  const bookingId = await insertBooking('AV-2026-AAAA0001', trip.id, 'Jansen');
  await insertBooking('AV-2026-BBBB0002', other.id, 'Pietersen');
  const path = `/app/aanmeldingen/${bookingId}/`;

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
  const change = (form, session = kantoor) => request(`${path}status/`, { cookie: session.cookie, form: { _csrf: session.csrf, ...form } });

  await t.test('rechten: zonder sessie naar inloggen, reisleider en boekhouding 403, onbekend id 404', async () => {
    assert.equal((await request('/app/aanmeldingen/')).status, 303);
    assert.equal((await request('/app/aanmeldingen/', { cookie: leider.cookie })).status, 403);
    assert.equal((await request(path, { cookie: boek.cookie })).status, 403);
    assert.equal((await change({ van: 'nieuw', naar: 'bevestigd' }, boek)).status, 403);
    assert.equal((await request('/app/aanmeldingen/999999/', { cookie: kantoor.cookie })).status, 404);
    assert.equal((await request('/app/aanmeldingen/999999/status/', { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, van: 'nieuw', naar: 'bevestigd' } })).status, 404);
  });

  await t.test('lijst: filter op reis, status en zoekwoord', async () => {
    const all = await request('/app/aanmeldingen/', { cookie: kantoor.cookie });
    assert.match(all.text, /AV-2026-AAAA0001/);
    assert.match(all.text, /AV-2026-BBBB0002/);
    const byTrip = await request(`/app/aanmeldingen/?reis=${other.id}`, { cookie: kantoor.cookie });
    assert.doesNotMatch(byTrip.text, /AV-2026-AAAA0001/);
    assert.match(byTrip.text, /AV-2026-BBBB0002/);
    assert.match(byTrip.text, />Alle <span class="crm-tabs-count">1<\/span><\/a>/, 'aantallen binnen de gekozen reis');
    assert.match(byTrip.text, new RegExp(`href="/app/aanmeldingen/\\?reis=${other.id}&amp;status=nieuw"`), 'filterknop houdt de reis vast');
    assert.match((await request('/app/aanmeldingen/?q=jansen', { cookie: kantoor.cookie })).text, /AV-2026-AAAA0001/);
    assert.match((await request('/app/aanmeldingen/?status=betaald', { cookie: kantoor.cookie })).text, /Geen aanmeldingen gevonden/);
    assert.equal((await request("/app/aanmeldingen/?status=x'&reis=abc", { cookie: kantoor.cookie })).status, 200, 'onbekende filters worden genegeerd');
  });

  await t.test('status wijzigen: alleen toegestane overgangen, met historie en audit', async () => {
    assert.equal((await change({ van: 'nieuw', naar: 'betaald' })).status, 422);
    assert.equal((await change({ van: 'nieuw', naar: 'bevestigd' }, { ...kantoor, csrf: 'fout' })).status, 403);
    const confirmed = await change({ van: 'nieuw', naar: 'bevestigd', notitie: 'Bevestiging gemaild' });
    assert.equal(confirmed.status, 303);
    const [row] = await db.query('SELECT status, confirmed_at FROM bookings WHERE id = $1', [bookingId]);
    assert.equal(row.status, 'bevestigd');
    assert.ok(row.confirmed_at);
    const stale = await change({ van: 'nieuw', naar: 'bevestigd' });
    assert.equal(stale.status, 409, 'formulier met verouderde status');
    assert.match(stale.text, /intussen door iemand anders gewijzigd/);
    const page = await request(path, { cookie: kantoor.cookie });
    assert.match(page.text, /Nieuw → Bevestigd/);
    assert.match(page.text, /Bevestiging gemaild/);
    assert.equal((await db.query("SELECT count(*)::int AS total FROM audit_log WHERE action = 'aanmelding.status' AND entity_id = $1", [String(bookingId)]))[0].total, 1);
  });

  await t.test('annuleren vraagt een reden; daarna verandert de status niet meer', async () => {
    const noReason = await change({ van: 'bevestigd', naar: 'geannuleerd', notitie: '  ' });
    assert.equal(noReason.status, 422);
    assert.match(noReason.text, /toelichting/);
    assert.equal((await change({ van: 'bevestigd', naar: 'geannuleerd', notitie: 'Ziek <script>' })).status, 303);
    const [row] = await db.query('SELECT status, cancelled_at, cancel_reason FROM bookings WHERE id = $1', [bookingId]);
    assert.equal(row.status, 'geannuleerd');
    assert.ok(row.cancelled_at);
    assert.equal(row.cancel_reason, 'Ziek <script>');
    const page = await request(path, { cookie: kantoor.cookie });
    assert.doesNotMatch(page.text, /Ziek <script>/, 'notitie ge-escaped');
    assert.match(page.text, /de status verandert niet meer/);
    assert.equal((await change({ van: 'geannuleerd', naar: 'nieuw' })).status, 422);
  });

  await t.test('notitie: verplicht, opgeslagen in de historie', async () => {
    const empty = await request(`${path}notitie/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, notitie: '' } });
    assert.equal(empty.status, 422);
    assert.equal((await request(`${path}notitie/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, notitie: 'Gebeld over restbetaling' } })).status, 303);
    const [event] = await db.query('SELECT from_status, to_status, note FROM booking_events WHERE booking_id = $1 ORDER BY id DESC LIMIT 1', [bookingId]);
    assert.deepEqual(event, { from_status: 'geannuleerd', to_status: 'geannuleerd', note: 'Gebeld over restbetaling' });
    // Deterministisch: de status verandert terwijl de notitie wacht op de vergrendelde rij; de historie krijgt de nieuwe status.
    let pending;
    await db.transaction(async (client) => {
      await client.query('SELECT id FROM bookings WHERE id = $1 FOR UPDATE', [bookingId]);
      pending = request(`${path}notitie/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, notitie: 'Tijdens wijziging' } });
      const settled = await Promise.race([pending.then(() => 'klaar'), new Promise((resolve) => { setTimeout(() => resolve('wacht'), 400); })]);
      assert.equal(settled, 'wacht', 'notitie wacht op de vergrendelde aanmelding');
      await client.query("UPDATE bookings SET status = 'betaald' WHERE id = $1", [bookingId]);
    });
    assert.equal((await pending).status, 303);
    const [latest] = await db.query('SELECT from_status, to_status FROM booking_events WHERE booking_id = $1 ORDER BY id DESC LIMIT 1', [bookingId]);
    assert.deepEqual(latest, { from_status: 'betaald', to_status: 'betaald' });
  });

  await t.test('database weigert een onbekende status', async () => {
    await assert.rejects(db.query("UPDATE bookings SET status = 'wachtlijst' WHERE id = $1", [bookingId]), /bookings_status_check/);
  });
});
