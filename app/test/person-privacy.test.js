/**
 * Tests voor de AVG-verzoeken bij een deelnemer (`persons/person-privacy-routes.js`): inzage-export (.xlsx) met alle
 * velden, blokken alleen met recht, audit per blok, limiet; persoon wissen met bevestiging, anonimiseren, het
 * reizigersaccount met hetzelfde adres weg; rechten (zonder recht 403, onbekende persoon 404, CSRF). Eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { createVault } = require('../src/security/vault');
const { createPersons } = require('../src/persons/persons');
const { hashPassword } = require('../src/crm/passwords');
const { COOKIE_NAME } = require('../src/crm/auth');
const { ANONYMIZED_NAME } = require('../src/persons/retention');
const { inspectionFileName, EXPORT_LIMIT } = require('../src/persons/person-privacy-routes');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'person_privacy_test';
const MASTER_KEY = Buffer.alloc(32, 37);
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
 * Leest de bestanden uit een zip (alleen wat `createXlsx` maakt).
 * @param {Buffer} buffer Het zip-bestand.
 * @returns {Record<string, string>} Inhoud per bestandsnaam.
 */
function unzip(buffer) {
  const files = {};
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const start = offset + 30 + nameLength;
    files[name] = zlib.inflateRawSync(buffer.subarray(start, start + size)).toString('utf8');
    offset = start + size;
  }
  return files;
}

test('inzage: bestandsnaam zonder naam', () => {
  assert.equal(inspectionFileName(12, new Date('2027-05-20T22:30:00Z')), 'inzage-deelnemer-12-2027-05-21.xlsx');
});

test('AVG-verzoeken bij een deelnemer', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
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
  const persons = createPersons({ vault: createVault(MASTER_KEY) });

  const hash = await hashPassword(PASSWORD);
  for (const [email, role] of [['beheer@example.nl', 'beheerder'], ['kantoor@example.nl', 'kantoor'], ['boek@example.nl', 'boekhouding']]) {
    await db.query('INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)', [email, role, role, hash]);
  }
  const values = {
    gender: 'vrouw', first_names: 'Grietje', call_name: 'Griet', last_name: 'Bakker', email: 'griet@example.nl', mobile: '0612121212',
    phone: '', street: 'Markt 1', postal_code: '4331 AA', city: 'Middelburg', occupation: 'Juf', birth_date: '1990-03-04',
    nationality: 'Nederlandse', document_type: 'paspoort', document_number: 'NX99', church: 'PKN', consent_religion: 'ja',
    particulars: 'Astma', consent_health: 'ja', emergency_phone: '0687654321',
  };
  const personId = await db.transaction(async (client) => {
    const { personId: id } = await persons.savePerson(client, values);
    await persons.recordConsents(client, { personId: id, bookingId: null, values });
    return id;
  });
  const [booking] = await db.query(
    `INSERT INTO bookings (reference, trip_title, gender, first_names, call_name, last_name, email, mobile, street, postal_code, city,
       earlier_trip, credit_card, driver_interest, driver_before, payment_method, payment_choice, consent_at, person_id, price_cents)
     VALUES ('AV-2027-GRIET', 'Albanië', 'vrouw', 'Grietje', 'Griet', 'Bakker', 'griet@example.nl', '0612', 'Markt 1', '4331 AA', 'Middelburg',
       true, false, false, false, 'handmatig', 'aanbetaling', now(), $1, 129900) RETURNING id`,
    [personId],
  );
  await db.query("INSERT INTO booking_events (booking_id, from_status, to_status, note) VALUES ($1, 'nieuw', 'bevestigd', 'Belde over dieet')", [booking.id]);
  await db.query("INSERT INTO booking_charges (booking_id, kind, amount_cents) VALUES ($1, 'sgr', 500)", [booking.id]);
  await db.query("INSERT INTO booking_charges (booking_id, kind, amount_cents, removed_at) VALUES ($1, 'korting', -2500, now())", [booking.id]);
  await db.query("INSERT INTO payments (booking_id, amount_cents, method, received_on, note) VALUES ($1, 2000, 'bank', '2027-01-05', 'Via ouders')", [booking.id]);
  await db.query("INSERT INTO customer_accounts (email, password_hash, verified_at) VALUES ('griet@example.nl', 'x', now()), ('ander@example.nl', 'x', now())");

  /**
   * Doet een verzoek zonder redirects te volgen.
   * @param {string} path Pad.
   * @param {{form?: object, cookie?: string}} [init] Formulier en sessiecookie.
   * @returns {Promise<{status: number, text: string, buffer: Buffer, headers: Headers, cookie: string}>} Antwoord.
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
    const buffer = Buffer.from(await response.arrayBuffer());
    return { status: response.status, text: buffer.toString('utf8'), buffer, headers: response.headers, cookie: setCookie.split(';')[0].split('=')[1] || '' };
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
  const boek = await login('boek@example.nl');
  const inzage = `/app/deelnemers/${personId}/inzage/`;
  const wissen = `/app/deelnemers/${personId}/wissen/`;

  await t.test('rechten, 404 en CSRF', async () => {
    assert.equal((await request(inzage, { form: { _csrf: 'x' } })).status, 401);
    assert.equal((await request(inzage, { cookie: boek.cookie, form: { _csrf: boek.csrf } })).status, 403);
    assert.equal((await request(wissen, { cookie: boek.cookie, form: { _csrf: boek.csrf, bevestiging: 'WISSEN' } })).status, 403);
    assert.equal((await request(inzage, { cookie: kantoor.cookie, form: { _csrf: 'fout' } })).status, 403);
    assert.equal((await request('/app/deelnemers/999999/inzage/', { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf } })).status, 404);
    assert.equal((await request('/app/deelnemers/999999/wissen/', { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, bevestiging: 'WISSEN' } })).status, 404);
    const page = await request(`/app/deelnemers/${personId}/`, { cookie: kantoor.cookie });
    assert.match(page.text, /AVG-verzoeken/);
  });

  await t.test('inzage-export: alles met recht, kerkgenootschap niet voor kantoor, audit', async () => {
    const response = await request(inzage, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-disposition'), /inzage-deelnemer-\d+-\d{4}-\d{2}-\d{2}\.xlsx/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const files = unzip(response.buffer);
    const personSheet = files['xl/worksheets/sheet1.xml'];
    assert.match(personSheet, /Bakker/);
    assert.match(personSheet, /NX99/);
    assert.match(personSheet, /Astma/);
    assert.doesNotMatch(personSheet, /PKN/);
    assert.match(personSheet, /Niet opgenomen/);
    assert.match(files['xl/worksheets/sheet2.xml'], /AV-2027-GRIET/);
    assert.match(files['xl/worksheets/sheet2.xml'], /1299/);
    assert.match(files['xl/worksheets/sheet3.xml'], /Belde over dieet/);
    assert.match(files['xl/worksheets/sheet5.xml'], /art\. 9/);
    assert.match(files['xl/worksheets/sheet4.xml'], /SGR-garantie/);
    assert.match(files['xl/worksheets/sheet4.xml'], /Via ouders/);
    assert.match(files['xl/worksheets/sheet4.xml'], /weggehaald .*telt niet mee/, 'ook weggehaalde bedragen staan in de inzage');
    const actions = (await db.query("SELECT action FROM audit_log WHERE action LIKE 'deelnemer.inzage%' ORDER BY action")).map((row) => row.action);
    assert.deepEqual(actions, ['deelnemer.inzage', 'deelnemer.inzage.gezondheid', 'deelnemer.inzage.identiteit', 'deelnemer.inzage.noodnummer']);
    const full = unzip((await request(inzage, { cookie: beheer.cookie, form: { _csrf: beheer.csrf } })).buffer);
    assert.match(full['xl/worksheets/sheet1.xml'], /PKN/);
  });

  await t.test('wissen: bevestiging nodig, daarna geanonimiseerd en account weg', async () => {
    const refused = await request(wissen, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, bevestiging: 'ja' } });
    assert.equal(refused.status, 422);
    assert.match(refused.text, /Typ WISSEN/);
    assert.equal((await db.query('SELECT anonymized_at FROM persons WHERE id = $1', [personId]))[0].anonymized_at, null);

    // Zonder reis en vertrekdatum, vandaag aangemeld: telt als lopend (zelfde einddatum als de opschoning).
    const undated = await request(wissen, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, bevestiging: 'WISSEN' } });
    assert.equal(undated.status, 422);
    assert.match(undated.text, /lopende of toekomstige aanmelding/);
    await db.query("UPDATE bookings SET departure_date = '2099-07-01' WHERE id = $1", [booking.id]);
    const upcoming = await request(wissen, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, bevestiging: 'WISSEN' } });
    assert.equal(upcoming.status, 422);
    assert.match(upcoming.text, /lopende of toekomstige aanmelding/);
    assert.equal((await db.query('SELECT anonymized_at FROM persons WHERE id = $1', [personId]))[0].anonymized_at, null);

    const done = await request(wissen, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, bevestiging: 'WISSEN', lopend: 'ja' } });
    assert.equal(done.status, 303);
    assert.match(done.headers.get('location'), /opgeslagen=gewist/);
    const [person] = await db.query('SELECT last_name, email, special_data, anonymized_at FROM persons WHERE id = $1', [personId]);
    assert.equal(person.last_name, ANONYMIZED_NAME);
    assert.equal(person.email, '');
    assert.equal(person.special_data, null);
    assert.ok(person.anonymized_at);
    const [row] = await db.query('SELECT last_name, email, anonymized_at FROM bookings WHERE id = $1', [booking.id]);
    assert.equal(row.email, '');
    assert.ok(row.anonymized_at);
    assert.equal((await db.query("SELECT note FROM booking_events WHERE booking_id = $1", [booking.id]))[0].note, '');
    assert.deepEqual((await db.query('SELECT email FROM customer_accounts')).map((item) => item.email), ['ander@example.nl']);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'deelnemer.gewist'"))[0].n, 1);
    const page = await request(`/app/deelnemers/${personId}/?opgeslagen=gewist`, { cookie: kantoor.cookie });
    assert.match(page.text, /De persoon is gewist/);
    assert.match(page.text, /Al geanonimiseerd/);
    const again = await request(wissen, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, bevestiging: 'WISSEN' } });
    assert.equal(again.status, 303);
    assert.doesNotMatch(again.headers.get('location'), /gewist/);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'deelnemer.gewist'"))[0].n, 1);
  });

  await t.test('limiet op de inzage-export', async () => {
    let status = 200;
    for (let i = 0; i < EXPORT_LIMIT + 2 && status !== 429; i++) {
      status = (await request(inzage, { cookie: beheer.cookie, form: { _csrf: beheer.csrf } })).status;
    }
    assert.equal(status, 429);
  });
});
