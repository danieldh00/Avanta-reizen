/**
 * Tests voor het overzicht van de reisleider (`/app/`, `crm/guide-dashboard.js`) en het instelbare venster
 * (`trips/guide-window.js`, Beheer > CRM > Reisleider): alleen eigen vertrekken via het gekoppelde profiel, aantallen
 * zonder geannuleerden, de stand van het venster, verlopen vertrekken weg, zonder profiel een uitleg, waarden
 * ge-escaped, en het venster uit Beheer ook in de deelnemerslijsten (aanbieden en weigeren met 403). Draait in een
 * eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { hashPassword } = require('../src/crm/passwords');
const { COOKIE_NAME } = require('../src/crm/auth');
const { renderGuideDashboard } = require('../src/crm/guide-dashboard');
const { guideWindowFrom, describeWindow, clampDays, MAX_WINDOW_DAYS } = require('../src/trips/guide-window');
const { toString } = require('../src/site/html');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'guide_dashboard_test';
const MASTER_KEY = Buffer.alloc(32, 23);
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

test('venster: waarden uit de instellingen, begrensd, en in gewone taal', () => {
  assert.deepEqual(guideWindowFrom(), { daysBefore: 14, daysAfter: 0 }, 'zonder instellingen de standaard');
  const settings = (values) => ({ get: (key) => values[key] });
  assert.deepEqual(guideWindowFrom(settings({ guideWindowDaysBefore: 7, guideWindowDaysAfter: 30 })), { daysBefore: 7, daysAfter: 30 });
  assert.deepEqual(guideWindowFrom(settings({ guideWindowDaysBefore: -1, guideWindowDaysAfter: 'veel' })), { daysBefore: 14, daysAfter: 0 }, 'ongeldig geeft de standaard');
  assert.equal(clampDays(1000, 14), MAX_WINDOW_DAYS);
  assert.equal(clampDays(2.5, 14), 14);
  assert.equal(describeWindow(14, 0), 'van 14 dagen vóór vertrek tot en met de terugkomst');
  assert.equal(describeWindow(1, 1), 'van 1 dag vóór vertrek tot en met 1 dag na de terugkomst');
  assert.equal(describeWindow(0, 30), 'vanaf de vertrekdag tot en met 30 dagen na de terugkomst');
});

test('overzicht reisleider: zonder profiel een uitleg, waarden ge-escaped', () => {
  const window = { daysBefore: 14, daysAfter: 0 };
  const empty = toString(renderGuideDashboard({ guideName: null, trips: [], window }));
  assert.match(empty, /hangt nog niet aan een reisleidersprofiel/);
  assert.doesNotMatch(empty, /crm-tile/);
  const page = toString(renderGuideDashboard({
    guideName: 'Henk',
    window,
    trips: [
      { id: 3, title: '<b>Reis</b>', trip_code: 'X&Y', departure_date: '2027-06-01', return_date: '2027-06-08', opens_on: '2027-05-18', closes_on: '2027-06-08', in_window: true, departs_soon: true, participant_count: 2 },
      { id: 4, title: 'Zonder datum', trip_code: '', departure_date: null, return_date: null, opens_on: null, closes_on: null, in_window: false, departs_soon: null, participant_count: 0 },
    ],
  }));
  assert.match(page, /&lt;b&gt;Reis&lt;\/b&gt; \(X&amp;Y\)/);
  assert.match(page, /t\/m 08-06-2027/);
  assert.match(page, /Nog geen datum/);
  assert.match(page, /href="\/app\/deelnemerslijsten\/#reis-3"/);
  assert.doesNotMatch(page, /#reis-4/, 'zonder deelnemers geen link');
  assert.match(page, /<span class="crm-tile-count">2<\/span><span class="crm-tile-label">Deelnemers/);
  assert.match(page, /<span class="crm-tile-count">1<\/span><span class="crm-tile-label">Venster open/);
});

test('overzicht reisleider in het CRM', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
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
  const [guide] = await db.query("INSERT INTO guides (slug, name) VALUES ('henk', 'Henk') RETURNING id");
  const [otherGuide] = await db.query("INSERT INTO guides (slug, name) VALUES ('piet', 'Piet') RETURNING id");
  await db.query('INSERT INTO users (email, name, role, password_hash, guide_id) VALUES ($1, $2, $3, $4, $5)', ['leider@example.nl', 'Henk', 'reisleider', hash, guide.id]);
  await db.query('INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)', ['los@example.nl', 'Los', 'reisleider', hash]);
  await db.query('INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)', ['kantoor@example.nl', 'Kantoor', 'kantoor', hash]);

  /**
   * Maakt een reis met een vertrek relatief aan vandaag en koppelt hem aan een reisleider.
   * @param {{slug: string, title: string, offset: (number|null), days?: number, guideId: number}} input Gegevens; `offset` in
   *   dagen vanaf vandaag (null = geen vertrekdatum).
   * @returns {Promise<number>} Id van de reis.
   */
  const insertTrip = async (input) => {
    const [trip] = await db.query(
      `INSERT INTO trips (slug, title, departure_date, duration_days)
       VALUES ($1, $2, CASE WHEN $3::int IS NULL THEN NULL ELSE (now() AT TIME ZONE 'Europe/Amsterdam')::date + $3::int END, $4) RETURNING id`,
      [input.slug, input.title, input.offset, input.days || null],
    );
    await db.query('INSERT INTO trip_guides (trip_id, guide_id) VALUES ($1, $2)', [trip.id, input.guideId]);
    return trip.id;
  };
  const soon = await insertTrip({ slug: 'binnenkort', title: 'Binnenkort', offset: 5, days: 8, guideId: guide.id });
  const later = await insertTrip({ slug: 'later', title: 'Later', offset: 60, guideId: guide.id });
  await insertTrip({ slug: 'zonder-datum', title: 'Zonder datum', offset: null, guideId: guide.id });
  await insertTrip({ slug: 'lang-geleden', title: 'Lang geleden', offset: -40, days: 8, guideId: guide.id });
  const returned = await insertTrip({ slug: 'net-terug', title: 'Net terug', offset: -10, days: 8, guideId: guide.id });
  await insertTrip({ slug: 'van-piet', title: 'Reis van Piet', offset: 3, guideId: otherGuide.id });

  /**
   * Maakt een aanmelding voor een reis.
   * @param {string} reference Referentie.
   * @param {number} tripId Reis.
   * @param {string} status Status.
   * @returns {Promise<void>}
   */
  const insertBooking = async (reference, tripId, status) => {
    await db.query(
      `INSERT INTO bookings (reference, trip_id, trip_title, status, gender, first_names, call_name, last_name, email, mobile, street, postal_code, city,
         earlier_trip, credit_card, driver_interest, driver_before, payment_method, payment_choice, consent_at)
       VALUES ($1, $2, 'Reis', $3, 'man', 'Jan', 'Jan', 'Jansen', 'jan@example.nl', '0611', 'Straat 1', '1234 AB', 'Goes', false, false, false, false, 'handmatig', 'aanbetaling', now())`,
      [reference, tripId, status],
    );
  };
  await insertBooking('AV-1', soon, 'nieuw');
  await insertBooking('AV-2', soon, 'bevestigd');
  await insertBooking('AV-3', soon, 'geannuleerd');
  await insertBooking('AV-4', returned, 'bevestigd');

  /**
   * Logt in en geeft het sessiekoekje terug.
   * @param {string} email E-mailadres.
   * @returns {Promise<string>} Koekje.
   */
  const login = async (email) => {
    const response = await fetch(`${base}/app/inloggen/`, {
      method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email, password: PASSWORD }).toString(),
    });
    return response.headers.getSetCookie().find((value) => value.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  };
  /**
   * Haalt een pagina op.
   * @param {string} cookie Sessiekoekje.
   * @param {string} path Pad.
   * @returns {Promise<string>} HTML.
   */
  const page = async (cookie, path) => {
    const response = await fetch(base + path, { headers: { cookie }, redirect: 'manual' });
    assert.equal(response.status, 200);
    return response.text();
  };
  const leider = await login('leider@example.nl');

  await t.test('eigen vertrekken met aantallen en venster, standaardvenster', async () => {
    const html = await page(leider, '/app/');
    assert.match(html, /Mijn vertrekken/);
    for (const title of ['Binnenkort', 'Later', 'Zonder datum']) assert.match(html, new RegExp(title));
    assert.doesNotMatch(html, /Reis van Piet/, 'reis van een ander profiel');
    assert.doesNotMatch(html, /Lang geleden/, 'venster al dicht');
    assert.doesNotMatch(html, /Net terug/, 'met 0 dagen na de terugkomst is dit vertrek voorbij');
    assert.match(html, /<span class="crm-tile-count">3<\/span><span class="crm-tile-label">Vertrekken/);
    assert.match(html, /<span class="crm-tile-count">2<\/span><span class="crm-tile-label">Deelnemers/, 'zonder geannuleerden');
    assert.match(html, /<span class="crm-tile-count">1<\/span><span class="crm-tile-label">Venster open/);
    assert.match(html, /<span class="crm-tile-count">1<\/span><span class="crm-tile-label">Vertrek binnen 30 dagen/);
    assert.match(html, new RegExp(`#reis-${soon}`));
    assert.doesNotMatch(html, new RegExp(`#reis-${later}"`), 'zonder deelnemers geen link');
    assert.doesNotMatch(html, /overzicht-vertrekken|overzicht-activiteit|Jansen|AV-1/, 'geen algemene onderdelen of persoonsgegevens');
    assert.match(html, /van 14 dagen vóór vertrek tot en met de terugkomst/);
  });

  await t.test('zonder gekoppeld profiel: uitleg, geen reizen', async () => {
    const html = await page(await login('los@example.nl'), '/app/');
    assert.match(html, /hangt nog niet aan een reisleidersprofiel/);
    assert.doesNotMatch(html, /Binnenkort|Reis van Piet/);
  });

  await t.test('kantoor houdt het gewone overzicht', async () => {
    const html = await page(await login('kantoor@example.nl'), '/app/');
    assert.match(html, /overzicht-vertrekken/);
    assert.doesNotMatch(html, /overzicht-mijn-vertrekken/);
  });

  await t.test('venster uit Beheer: overzicht en deelnemerslijst volgen', async () => {
    const csrfOf = (html) => /name="_csrf" value="([^"]+)"/.exec(html)[1];
    // Standaard: "Net terug" valt buiten het venster; de lijst biedt geen gezondheid aan en weigert die met 403.
    let lists = await page(leider, '/app/deelnemerslijsten/');
    const rowOf = (html, id) => new RegExp(`<tr id="reis-${id}">[\\s\\S]*?</tr>`).exec(html)[0];
    assert.doesNotMatch(rowOf(lists, returned), /name="gezondheid"/);
    assert.match(rowOf(lists, soon), /name="gezondheid"/);
    const refused = await fetch(`${base}/app/deelnemerslijsten/${returned}/`, {
      method: 'POST', redirect: 'manual', headers: { cookie: leider, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrfOf(lists), gezondheid: 'ja' }).toString(),
    });
    assert.equal(refused.status, 403);

    // Venster tot 30 dagen na de terugkomst en pas 3 dagen vóór vertrek.
    await app.locals.settings.update({ values: { guideWindowDaysBefore: '3', guideWindowDaysAfter: '30' } });
    const html = await page(leider, '/app/');
    assert.match(html, /Net terug/, 'nu nog in het venster na de terugkomst');
    assert.match(html, /van 3 dagen vóór vertrek tot en met 30 dagen na de terugkomst/);
    lists = await page(leider, '/app/deelnemerslijsten/');
    assert.match(rowOf(lists, returned), /name="gezondheid"/);
    assert.doesNotMatch(rowOf(lists, soon), /name="gezondheid"/, 'vertrek over 5 dagen valt buiten 3 dagen vooraf');
    const allowed = await fetch(`${base}/app/deelnemerslijsten/${returned}/`, {
      method: 'POST', redirect: 'manual', headers: { cookie: leider, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrfOf(lists), gezondheid: 'ja' }).toString(),
    });
    assert.equal(allowed.status, 200);
    const refusedSoon = await fetch(`${base}/app/deelnemerslijsten/${soon}/`, {
      method: 'POST', redirect: 'manual', headers: { cookie: leider, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrfOf(lists), gezondheid: 'ja' }).toString(),
    });
    assert.equal(refusedSoon.status, 403);
    await app.locals.settings.update({ values: { guideWindowDaysBefore: '14', guideWindowDaysAfter: '0' } });
  });
});
