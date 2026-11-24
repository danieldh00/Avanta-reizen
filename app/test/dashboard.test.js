/**
 * Tests voor het overzicht van het CRM (`/app/`, `crm/dashboard.js`): per rol alleen de onderdelen waarvoor het recht
 * er is (tegels *Te doen*, komende vertrekken, openstaand bedrag, recente activiteit, systeem), de aantallen, en de
 * omschrijving van een wijziging. Draait in een eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { hashPassword } = require('../src/crm/passwords');
const { COOKIE_NAME } = require('../src/crm/auth');
const { dashboardAccess, describeEvent, systemState, renderDashboard, loadDashboard, FAILED } = require('../src/crm/dashboard');
const { toString } = require('../src/site/html');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'dashboard_test';
const MASTER_KEY = Buffer.alloc(32, 23);
const PASSWORD = 'een heel goed wachtwoord';
/** Vaste klok: 1 maart 2027, 12:00 in Nederland. */
const NOW = Date.parse('2027-03-01T11:00:00Z');

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

test('overzicht: toegang per rol', () => {
  assert.deepEqual(dashboardAccess('beheerder'), { bookings: true, persons: true, payments: true, trips: true, system: true, users: true });
  assert.deepEqual(dashboardAccess('kantoor'), { bookings: true, persons: true, payments: true, trips: true, system: false, users: false });
  assert.deepEqual(dashboardAccess('boekhouding'), { bookings: false, persons: true, payments: true, trips: false, system: false, users: false });
  assert.deepEqual(dashboardAccess('reisleider'), { bookings: false, persons: false, payments: false, trips: false, system: false, users: false }, 'reisleider: dicht tot eigen vertrekken bestaan');
  assert.deepEqual(dashboardAccess('redacteur'), { bookings: false, persons: false, payments: false, trips: false, system: false, users: false });
  assert.deepEqual(dashboardAccess('onbekend'), { bookings: false, persons: false, payments: false, trips: false, system: false, users: false });
});

test('overzicht: omschrijving van een wijziging', () => {
  assert.equal(describeEvent({ from_status: 'nieuw', to_status: 'bevestigd' }), 'van Nieuw naar Bevestigd');
  assert.equal(describeEvent({ from_status: 'nieuw', to_status: 'nieuw' }), 'notitie toegevoegd');
  assert.equal(describeEvent({ from_status: null, to_status: 'nieuw' }), 'aangemaakt als Nieuw');
  assert.equal(describeEvent({ from_status: 'nieuw', to_status: 'iets-anders' }), 'van Nieuw naar iets-anders');
});

test('overzicht: stand van het systeem, ook zonder bronnen', () => {
  assert.deepEqual(systemState({}), { monitorEnabled: false, openIncidents: 0, lastBackupAt: null, version: '', updateAvailable: false });
  const state = systemState({
    monitor: { view: () => ({ enabled: true, open: [{}, {}] }) },
    backups: { list: () => [{ createdAt: '2027-03-01T02:00:00.000Z' }, { createdAt: '2027-02-28T02:00:00.000Z' }] },
    systemUpdate: { view: () => ({ running: '1.2.3', newer: true }) },
  });
  assert.deepEqual(state, { monitorEnabled: true, openIncidents: 2, lastBackupAt: '2027-03-01T02:00:00.000Z', version: '1.2.3', updateAvailable: true });
});

test('overzicht: zonder rechten geen onderdelen, en waarden worden ge-escaped', () => {
  assert.equal(toString(renderDashboard({ access: dashboardAccess('redacteur') })).trim(), '');
  const page = toString(renderDashboard({
    access: dashboardAccess('kantoor'), newBookings: 0, latePayments: { count: 500, atLeast: true }, duplicates: 1, draftTrips: 0,
    departures: [{ id: 7, title: '<b>Reis</b>', trip_code: '', departure_date: '2027-06-01', capacity: null, fully_booked: false, published: false, booked_seats: 3, outstanding_cents: '12300' }],
    activity: [{ booking_id: 4, reference: 'AV-<1>', from_status: 'nieuw', to_status: 'bevestigd', created_at: new Date(NOW), user_name: '<i>Kim</i>' }],
  }));
  assert.match(page, /<span class="crm-tile-count">500\+<\/span>/);
  assert.match(page, /&lt;b&gt;Reis&lt;\/b&gt;/);
  assert.match(page, /3 bezet/);
  assert.match(page, /crm-status--concept/);
  assert.match(page, /AV-&lt;1&gt;/);
  assert.match(page, /&lt;i&gt;Kim&lt;\/i&gt;/);
  assert.doesNotMatch(page, /overzicht-systeem/);
});

test('overzicht: een onderdeel dat niet laadt toont een melding, de rest blijft staan', async () => {
  const logged = [];
  /** Database waarvan alleen de vraag naar de vertrekken mislukt. */
  const db = {
    query: async (sql) => {
      if (/FROM trips t/.test(sql)) throw Object.assign(new Error('geheim detail'), { code: '57014' });
      if (/FROM booking_events|FROM bookings b/.test(sql)) return [];
      return [{ total: 3 }];
    },
  };
  const data = await loadDashboard(
    { db, settings: { get: () => 7 }, backups: { list: () => { throw new Error('schijf'); } }, appLog: { error: (...entry) => logged.push(entry) } },
    { role: 'beheerder', now: NOW },
  );
  assert.equal(data.departures, FAILED);
  assert.equal(data.system, FAILED);
  assert.equal(data.newBookings, 3);
  assert.deepEqual(logged.map((entry) => entry[1]).sort(), ['onderdeel komende vertrekken niet geladen (57014)', 'onderdeel systeem niet geladen (Error)'], 'zonder de foutmelding zelf');
  const page = toString(renderDashboard(data));
  assert.equal((page.match(/Dit onderdeel kon niet worden geladen/g) || []).length, 2);
  assert.match(page, /<span class="crm-tile-count">3<\/span>\s*<span class="crm-tile-label">Nieuwe aanmeldingen/);
  const failedTile = toString(renderDashboard({ access: dashboardAccess('kantoor'), newBookings: FAILED, latePayments: FAILED }));
  assert.equal((failedTile.match(/<span class="crm-tile-count">\?<\/span>/g) || []).length, 2);
});

test('overzicht in het CRM', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  const app = createApp({ db, masterKey: MASTER_KEY, now: () => NOW });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await db.close(); });

  const hash = await hashPassword(PASSWORD);
  const users = {};
  for (const role of ['beheerder', 'kantoor', 'reisleider', 'boekhouding', 'redacteur']) {
    [users[role]] = await db.query('INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id', [`${role}@example.nl`, role, role, hash]);
  }
  const [albania] = await db.query("INSERT INTO trips (slug, title, trip_code, departure_date, capacity) VALUES ('albanie', 'Albanië', '27-ALB-1', '2027-06-01', 2) RETURNING id");
  const [iceland] = await db.query("INSERT INTO trips (slug, title, trip_code, departure_date, published) VALUES ('ijsland', 'IJsland', '27-IJS-1', '2027-07-01', false) RETURNING id");
  await db.query("INSERT INTO trips (slug, title, departure_date) VALUES ('oud', 'Vertrokken reis', '2027-02-01')");
  await db.query("INSERT INTO trips (slug, title, departure_date, published) VALUES ('oud-concept', 'Oud concept', '2026-05-01', false)");
  /**
   * Maakt een aanmelding van zestig dagen geleden die het totaalbedrag ineens betaalt (dus al vervallen).
   * @param {string} reference Referentie.
   * @param {number} tripId Reis.
   * @param {string} status Status.
   * @returns {Promise<number>} Id van de aanmelding.
   */
  const insertBooking = async (reference, tripId, status) => (await db.query(
    `INSERT INTO bookings (reference, trip_id, trip_title, trip_code, departure_date, status, gender, first_names, call_name, last_name, email, mobile, street,
       postal_code, city, earlier_trip, credit_card, driver_interest, driver_before, payment_method, payment_choice, consent_at, created_at)
     VALUES ($1, $2, 'Reis', '27-X', '2027-06-01', $3, 'man', 'Jan', 'Jan', 'Jansen', 'jan@example.nl', '06', 'Straat 1', '1234 AB', 'Goes', false, false, false,
       false, 'handmatig', 'totaal', now(), $4)
     RETURNING id`,
    [reference, tripId, status, new Date(NOW - 60 * 24 * 60 * 60 * 1000)],
  ))[0].id;
  const first = await insertBooking('AV-2027-AAAA0001', albania.id, 'nieuw');
  const second = await insertBooking('AV-2027-BBBB0002', albania.id, 'bevestigd');
  const cancelled = await insertBooking('AV-2027-CCCC0003', albania.id, 'geannuleerd');
  for (const [bookingId, cents] of [[first, 100000], [second, 50000], [cancelled, 70000]]) {
    await db.query("INSERT INTO booking_charges (booking_id, kind, amount_cents) VALUES ($1, 'reissom', $2)", [bookingId, cents]);
  }
  await db.query("INSERT INTO payments (booking_id, amount_cents, method, received_on) VALUES ($1, 20000, 'bank', '2027-01-10')", [second]);
  await db.query('INSERT INTO booking_events (booking_id, from_status, to_status, user_id, note) VALUES ($1, $2, $3, $4, $5)', [second, 'nieuw', 'bevestigd', users.kantoor.id, 'Gebeld met de deelnemer']);
  const [original] = await db.query("INSERT INTO persons (first_names, last_name, email, match_key) VALUES ('Jan', 'Jansen', 'jan@example.nl', 'sleutel-1') RETURNING id");
  await db.query("INSERT INTO persons (first_names, last_name, email, match_key, duplicate_of) VALUES ('Jan', 'Janssen', 'jan2@example.nl', 'sleutel-2', $1)", [original.id]);

  /**
   * Logt in en haalt een pagina van het CRM op.
   * @param {string} role Rol.
   * @param {string} [path] Pad (standaard het overzicht).
   * @returns {Promise<string>} HTML van de pagina.
   */
  const pageFor = async (role, path = '/app/') => {
    const login = await fetch(`${base}/app/inloggen/`, {
      method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: `${role}@example.nl`, password: PASSWORD }).toString(),
    });
    const cookie = login.headers.getSetCookie().find((value) => value.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
    const response = await fetch(base + path, { headers: { cookie }, redirect: 'manual' });
    assert.equal(response.status, 200);
    return response.text();
  };
  /**
   * Haalt het overzicht op voor een rol.
   * @param {string} role Rol.
   * @returns {Promise<string>} HTML van `/app/`.
   */
  const overviewFor = (role) => pageFor(role);
  /**
   * Zoekt het getal op een tegel.
   * @param {string} page HTML.
   * @param {string} label Omschrijving op de tegel.
   * @returns {(string|null)} Het getal, of null als de tegel ontbreekt.
   */
  const tile = (page, label) => (page.match(new RegExp(`<span class="crm-tile-count">([^<]+)</span>\\s*<span class="crm-tile-label">${label}</span>`)) || [])[1] || null;

  await t.test('kantoor: tegels, vertrekken met plaatsen en openstaand, activiteit; geen systeem', async () => {
    const page = await overviewFor('kantoor');
    assert.equal(tile(page, 'Nieuwe aanmeldingen'), '1');
    assert.equal(tile(page, 'Te late betalingen'), '2', 'beide openstaande aanmeldingen zijn over de termijn');
    assert.equal(tile(page, 'Mogelijk dubbele deelnemers'), '1');
    assert.equal(tile(page, 'Reizen in concept'), '2', 'ook een concept uit het verleden, net als het filter Concept in de lijst');
    const draftList = await pageFor('kantoor', '/app/reizen/?status=concept');
    assert.match(draftList, /IJsland/);
    assert.match(draftList, /Oud concept/);
    assert.match(page, /href="\/app\/aanmeldingen\/\?status=nieuw"/);
    assert.match(page, /href="\/app\/betalingen\/\?weergave=te-laat"/);
    assert.match(page, new RegExp(`<a href="/app/reizen/${albania.id}/">Albanië</a> <span class="crm-nowrap">\\(27-ALB-1\\)</span>`));
    assert.match(page, /2 van 2 <span class="crm-status crm-status--vol">Volgeboekt<\/span>/, 'geannuleerd telt niet mee');
    assert.match(page, /<td data-label="Openstaand" class="crm-num">€1\.300,-<\/td>/, '1.000 + 300 openstaand; geannuleerd telt niet mee');
    assert.match(await pageFor('kantoor', `/app/betalingen/?reis=${albania.id}`), /2 aanmeldingen · openstaand €1\.300,-/, 'gelijk aan het betaaloverzicht van die reis');
    assert.match(page, new RegExp(`<a href="/app/reizen/${iceland.id}/">IJsland</a> <span class="crm-nowrap">\\(27-IJS-1\\)</span> <span class="crm-status crm-status--concept">Concept</span>`));
    assert.doesNotMatch(page, /Vertrokken reis/);
    assert.match(page, new RegExp(`<a href="/app/aanmeldingen/${second}/">AV-2027-BBBB0002</a>: van Nieuw naar Bevestigd`));
    assert.doesNotMatch(page, /Gebeld met de deelnemer/, 'de notitie zelf staat niet op het overzicht');
    assert.doesNotMatch(page, /overzicht-systeem/);
    assert.doesNotMatch(page, /Het CRM wordt in stappen gebouwd/);
  });

  await t.test('beheerder: ook de stand van het systeem', async () => {
    const page = await overviewFor('beheerder');
    assert.match(page, /id="overzicht-systeem"/);
    assert.match(page, /href="\/app\/beheer\/bewaking\/"/);
    assert.match(page, /href="\/app\/beheer\/back-ups\/"/);
    assert.match(page, /Nog geen/);
  });

  await t.test('boekhouding: alleen betalingen en dubbelen, geen vertrekken of activiteit', async () => {
    const page = await overviewFor('boekhouding');
    assert.equal(tile(page, 'Te late betalingen'), '2');
    assert.equal(tile(page, 'Mogelijk dubbele deelnemers'), '1');
    assert.equal(tile(page, 'Nieuwe aanmeldingen'), null);
    assert.equal(tile(page, 'Reizen in concept'), null);
    assert.doesNotMatch(page, /overzicht-vertrekken|overzicht-activiteit|overzicht-systeem|AV-2027/);
  });

  await t.test('reisleider en redacteur: geen cijfers of gegevens', async () => {
    for (const role of ['reisleider', 'redacteur']) {
      const page = await overviewFor(role);
      assert.match(page, /Welkom, /);
      assert.doesNotMatch(page, /crm-tile|overzicht-vertrekken|overzicht-activiteit|overzicht-systeem|AV-2027|Albanië/, role);
    }
  });
});
