/**
 * Tests voor het betaaloverzicht (`/app/betalingen/`, `crm/payment-overview-routes.js`): rechten (reisleider en
 * redacteur 403, boekhouding wel), weergaven nog te betalen / te laat / te veel / alles, filter op reis, totalen,
 * Excel-export met audit en limiet. Draait in een eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { hashPassword } = require('../src/crm/passwords');
const { COOKIE_NAME } = require('../src/crm/auth');
const { EXPORT_LIMIT } = require('../src/crm/payment-overview-routes');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'payment_overview_test';
const MASTER_KEY = Buffer.alloc(32, 29);
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

/**
 * Leest de bestanden uit een zip (.xlsx) met alleen lokale headers.
 * @param {Buffer} buffer Zip.
 * @returns {Record<string, string>} Inhoud per pad.
 */
function unzip(buffer) {
  const files = {};
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString();
    const start = offset + 30 + nameLength + extraLength;
    const data = buffer.subarray(start, start + size);
    files[name] = (method === 8 ? zlib.inflateRawSync(data) : data).toString();
    offset = start + size;
  }
  return files;
}

test('betaaloverzicht', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  const app = createApp({ db, masterKey: MASTER_KEY, now: () => Date.parse('2027-03-01T10:00:00Z') });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await db.close(); });

  const hash = await hashPassword(PASSWORD);
  for (const [email, role] of [['kantoor@example.nl', 'kantoor'], ['leider@example.nl', 'reisleider'], ['boek@example.nl', 'boekhouding'], ['red@example.nl', 'redacteur']]) {
    await db.query('INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)', [email, role, role, hash]);
  }
  const [albania] = await db.query("INSERT INTO trips (slug, title, trip_code, departure_date) VALUES ('albanie', 'Albanië', '27-ALB-1', '2027-06-01') RETURNING id");
  const [iceland] = await db.query("INSERT INTO trips (slug, title, trip_code, departure_date) VALUES ('ijsland', 'IJsland', '27-IJS-1', '2027-03-20') RETURNING id");
  /**
   * Maakt een aanmelding met een reissom en eventueel een betaling.
   * @param {string} reference Referentie.
   * @param {object} trip Reis.
   * @param {{lastName: string, paid?: number, status?: string, createdAt?: string}} details Naam, betaald, status, aanmelddatum.
   * @returns {Promise<number>} Id.
   */
  const booking = async (reference, trip, details) => {
    const [row] = await db.query(
      `INSERT INTO bookings (reference, trip_id, trip_title, trip_code, departure_date, status, gender, first_names, call_name, last_name, email, mobile,
         street, postal_code, city, earlier_trip, credit_card, driver_interest, driver_before, payment_method, payment_choice, consent_at, created_at)
       SELECT $1, t.id, t.title, t.trip_code, t.departure_date, $3, 'man', 'Jan', 'Jan', $4, 'jan@example.nl', '06', 'Straat 1', '1234 AB', 'Goes',
              false, false, false, false, 'handmatig', 'aanbetaling', now(), $5
         FROM trips t WHERE t.id = $2 RETURNING id`,
      [reference, trip.id, details.status || 'bevestigd', details.lastName, details.createdAt || '2027-02-27T10:00:00Z'],
    );
    await db.query("INSERT INTO booking_charges (booking_id, kind, amount_cents) VALUES ($1, 'reissom', 50000), ($1, 'sgr', 500)", [row.id]);
    if (details.paid) await db.query("INSERT INTO payments (booking_id, amount_cents, method, received_on) VALUES ($1, $2, 'bank', '2027-02-28')", [row.id, details.paid]);
    return row.id;
  };
  await booking('AV-2027-OPEN0001', albania, { lastName: 'Openstaand' });
  await booking('AV-2027-LAAT0002', albania, { lastName: 'Laatkomer', createdAt: '2027-01-10T10:00:00Z' });
  await booking('AV-2027-KLAAR003', albania, { lastName: 'Voldaan', paid: 50500 });
  await booking('AV-2027-TEVEEL04', iceland, { lastName: 'Teveel', paid: 60000 });
  await booking('AV-2027-ANNUL005', iceland, { lastName: 'Geannuleerd', status: 'geannuleerd' });

  /**
   * Doet een verzoek zonder redirects te volgen.
   * @param {string} url Pad.
   * @param {{form?: object, cookie?: string}} [init] Formulier en sessiecookie.
   * @returns {Promise<{status: number, text: string, buffer: Buffer, headers: Headers, cookie: string}>} Antwoord.
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
    const buffer = Buffer.from(await response.arrayBuffer());
    return { status: response.status, text: buffer.toString(), buffer, headers: response.headers, cookie: setCookie.split(';')[0].split('=')[1] || '' };
  };
  const login = async (email) => (await request('/app/inloggen/', { form: { email, password: PASSWORD } })).cookie;
  const kantoor = await login('kantoor@example.nl');
  const leider = await login('leider@example.nl');
  const boek = await login('boek@example.nl');
  const redacteur = await login('red@example.nl');

  await t.test('rechten: zonder sessie naar inloggen, reisleider en redacteur 403, boekhouding wel; menu', async () => {
    assert.equal((await request('/app/betalingen/')).status, 303);
    assert.equal((await request('/app/betalingen/', { cookie: leider })).status, 403);
    assert.equal((await request('/app/betalingen/overzicht.xlsx', { cookie: leider })).status, 403);
    assert.equal((await request('/app/betalingen/', { cookie: redacteur })).status, 403);
    const page = await request('/app/betalingen/', { cookie: boek });
    assert.equal(page.status, 200);
    assert.match(page.text, /href="\/app\/betalingen\/"[^>]*aria-current="page"/);
    assert.doesNotMatch((await request('/app/', { cookie: redacteur })).text, /href="\/app\/betalingen\/"/);
  });

  await t.test('weergaven en filter op reis', async () => {
    const open = (await request('/app/betalingen/', { cookie: kantoor })).text;
    assert.match(open, /AV-2027-OPEN0001/);
    assert.match(open, /AV-2027-LAAT0002/);
    assert.doesNotMatch(open, /AV-2027-KLAAR003|AV-2027-TEVEEL04|AV-2027-ANNUL005/);
    assert.match(open, /2 aanmeldingen · openstaand €1.010,- · 1 te laat/);
    const late = (await request('/app/betalingen/?weergave=te-laat', { cookie: kantoor })).text;
    assert.match(late, /AV-2027-LAAT0002/);
    assert.doesNotMatch(late, /AV-2027-OPEN0001/);
    const tooMuch = (await request('/app/betalingen/?weergave=teveel', { cookie: kantoor })).text;
    assert.match(tooMuch, /AV-2027-TEVEEL04/);
    assert.match(tooMuch, /-€95,-/);
    assert.doesNotMatch(tooMuch, /AV-2027-ANNUL005/, 'geannuleerd zonder betaling heeft geen teveel');
    const all = (await request(`/app/betalingen/?weergave=alles&reis=${iceland.id}`, { cookie: kantoor })).text;
    assert.match(all, /AV-2027-TEVEEL04/);
    assert.match(all, /AV-2027-ANNUL005/);
    assert.doesNotMatch(all, /AV-2027-OPEN0001/);
    assert.match((await request('/app/betalingen/?weergave=toString&reis=abc', { cookie: kantoor })).text, /AV-2027-OPEN0001/, 'onbekend filter = standaard');
  });

  await t.test('Excel-export met audit', async () => {
    const response = await request(`/app/betalingen/overzicht.xlsx?weergave=open&reis=${albania.id}`, { cookie: kantoor });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /spreadsheetml/);
    assert.match(response.headers.get('content-disposition'), /betalingen-open-2027-03-01\.xlsx/);
    const files = unzip(response.buffer);
    const sheets = Object.keys(files).filter((name) => name.startsWith('xl/worksheets/')).sort().map((name) => files[name]).join('');
    const strings = files['xl/sharedStrings.xml'] || '';
    const text = sheets + strings;
    assert.match(text, /AV-2027-OPEN0001/);
    assert.match(text, /Laatkomer/);
    assert.doesNotMatch(text, /AV-2027-KLAAR003/);
    assert.match(text, /Albanië \(27-ALB-1\)/);
    assert.match(text, /Te late termijn/);
    assert.match(text, />aanbetaling</, 'de te late termijn staat als tekst in de kolom');
    const audit = await db.query("SELECT action, entity_id FROM audit_log WHERE action = 'export.betalingen'");
    assert.deepEqual(audit.map((row) => row.entity_id), [String(albania.id)]);
  });

  await t.test('limiet op exports', async () => {
    let last;
    for (let i = 0; i < EXPORT_LIMIT; i++) last = await request('/app/betalingen/overzicht.xlsx', { cookie: boek });
    assert.equal(last.status, 200);
    assert.equal((await request('/app/betalingen/overzicht.xlsx', { cookie: boek })).status, 429);
  });

  await t.test('afgekapte lijst: waarschuwing op de pagina, export geweigerd; het maximum telt alleen de juiste kant', async () => {
    const small = createApp({ db, masterKey: MASTER_KEY, now: () => Date.parse('2027-03-01T10:00:00Z'), paymentOverviewMaxRows: 1 });
    const smallServer = small.listen(0);
    const smallBase = `http://127.0.0.1:${smallServer.address().port}`;
    try {
      const cookie = `${COOKIE_NAME}=${kantoor}`;
      const get = async (url) => {
        const response = await fetch(smallBase + url, { headers: { cookie }, redirect: 'manual' });
        return { status: response.status, text: await response.text() };
      };
      // Twee openstaande aanmeldingen bij een maximum van 1: afgekapt.
      const page = await get('/app/betalingen/');
      assert.equal(page.status, 200);
      assert.match(page.text, /Alleen de eerste 1 aanmeldingen zijn meegenomen; kies een reis/);
      const refused = await get('/app/betalingen/overzicht.xlsx');
      assert.equal(refused.status, 422);
      assert.match(refused.text, /kies een reis en exporteer per reis/);
      const perTrip = await get(`/app/betalingen/overzicht.xlsx?reis=${albania.id}`);
      assert.equal(perTrip.status, 422);
      assert.match(perTrip.text, /Deze reis heeft in deze weergave meer dan 1 aanmeldingen; kies een smallere weergave/);
      // Te veel betaald: één aanmelding aan die kant; de openstaande tellen niet mee voor het maximum.
      const tooMuch = await get('/app/betalingen/?weergave=teveel');
      assert.match(tooMuch.text, /AV-2027-TEVEEL04/);
      assert.doesNotMatch(tooMuch.text, /zijn meegenomen/);
      assert.equal((await get('/app/betalingen/overzicht.xlsx?weergave=teveel')).status, 200);
      // Te laat: de te veel betaalde komt niet uit de database en duwt de te late er dus niet uit.
      const late = await get(`/app/betalingen/?weergave=te-laat&reis=${albania.id}`);
      assert.match(late.text, /AV-2027-LAAT0002/);
      assert.match(late.text, /van deze reis zijn meegenomen; kies een smallere weergave/);
    } finally {
      smallServer.close();
    }
  });
});
