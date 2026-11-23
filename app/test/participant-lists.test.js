/**
 * Tests voor de deelnemerslijst per vertrek (`/app/deelnemerslijsten/`, .xlsx): rechten (zonder recht 403, categorie
 * zonder recht 403, reisleider alleen eigen vertrekken via het gekoppelde profiel, andere reis 404, beperkte kolommen,
 * bijzondere gegevens alleen in het venster rond vertrek, profiel koppelen in Gebruikers), onbekende reis → 404, CSRF, geannuleerde
 * aanmeldingen niet in de lijst, bijzondere gegevens alleen op verzoek en met recht, art. 9 alleen met een niet
 * ingetrokken toestemming, audit per export en per categorie, en de limiet. Draait in een eigen schema.
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
const { buildParticipantWorkbook, participantFileName, NO_CONSENT, UNREADABLE } = require('../src/persons/participant-lists');
const { EXPORT_LIMIT, MAX_ROWS } = require('../src/persons/participant-list-routes');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'participant_lists_test';
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

/**
 * Leest de bestanden uit een zip (alleen wat `createXlsx` maakt: deflate, geen data descriptors).
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

test('deelnemerslijst: bestandsnaam en werkmap zonder database', () => {
  const now = new Date('2027-05-20T22:30:00Z');
  assert.equal(participantFileName({ id: 4, trip_code: '27-ALB/1 Zomér', slug: 'x' }, now), 'deelnemerslijst-27-alb-1-zomer-2027-05-21.xlsx');
  assert.equal(participantFileName({ id: 4, trip_code: '', slug: '' }, now), 'deelnemerslijst-reis-4-2027-05-21.xlsx');
  assert.equal(participantFileName({ id: 4, trip_code: '"; rm', slug: '' }, now), 'deelnemerslijst-rm-2027-05-21.xlsx');

  const base = { id: 1, reference: 'AV-1', status: 'nieuw', created_at: now, number: 1, plain: { last_name: '=Jansen', first_names: 'Jan' } };
  const rows = [
    { ...base, person_id: 7, health_data: 'versleuteld', consent_health: false, emergency_data: null, identity_data: 'kapot' },
    { ...base, person_id: null, number: 2 },
  ];
  const openBlock = (block) => {
    if (block === 'identity_data') throw new Error('kapot');
    return {};
  };
  const files = unzip(buildParticipantWorkbook({ trip: { id: 1, title: 'Albanië', departure_date: '2027-06-01' }, rows, categories: ['identiteit', 'gezondheid'], openBlock, userName: 'Kantoor', now }));
  const sheet = files['xl/worksheets/sheet1.xml'];
  assert.match(sheet, /Medische bijzonderheden/);
  assert.ok(sheet.includes(NO_CONSENT), 'art. 9 zonder toestemming');
  assert.ok(sheet.includes(UNREADABLE), 'blok dat niet te openen is');
  assert.ok(sheet.includes("'=Jansen"), 'geen formule');
  assert.match(files['xl/worksheets/sheet2.xml'], /Albanië/);
  assert.match(files['xl/workbook.xml'], /Over deze lijst/);
});

test('deelnemerslijsten in het CRM', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  let clock = Date.now();
  const app = createApp({ db, masterKey: MASTER_KEY, now: () => clock });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await db.close(); });
  const persons = createPersons({ vault: createVault(MASTER_KEY) });

  const hash = await hashPassword(PASSWORD);
  for (const [email, role] of [['beheer@example.nl', 'beheerder'], ['kantoor@example.nl', 'kantoor'], ['leider@example.nl', 'reisleider'], ['boek@example.nl', 'boekhouding'], ['red@example.nl', 'redacteur']]) {
    await db.query('INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)', [email, role, role, hash]);
  }
  const [trip] = await db.query("INSERT INTO trips (slug, title, trip_code, departure_date) VALUES ('albanie', 'Albanië', '27-ALB-1', '2027-06-01') RETURNING id");
  const [empty] = await db.query("INSERT INTO trips (slug, title, trip_code, departure_date) VALUES ('ijsland', 'IJsland', '27-IJS-1', '2027-07-01') RETURNING id");

  /**
   * Maakt een aanmelding, met of zonder persoon.
   * @param {{reference: string, lastName: string, personId?: number, status?: string}} input Gegevens.
   * @returns {Promise<number>} Id van de aanmelding.
   */
  const insertBooking = async (input) => (await db.query(
    `INSERT INTO bookings (reference, trip_id, trip_title, trip_code, gender, first_names, call_name, last_name, email, mobile, street, postal_code, city,
       earlier_trip, credit_card, driver_interest, driver_before, payment_method, payment_choice, consent_at, person_id, status)
     VALUES ($1, $2, 'Albanië', '27-ALB-1', 'man', 'Jan', 'Jan', $3, 'jan@example.nl', '0611', 'Straat 1', '1234 AB', 'Goes', true, false, false, false, 'handmatig', 'aanbetaling', now(), $4, $5)
     RETURNING id`,
    [input.reference, trip.id, input.lastName, input.personId || null, input.status || 'nieuw'],
  ))[0].id;

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
  await insertBooking({ reference: 'AV-2027-GRIET001', lastName: 'Formulier-Bakker', personId });
  await insertBooking({ reference: 'AV-2027-ZONDER01', lastName: 'Zonderpersoon' });
  await insertBooking({ reference: 'AV-2027-WEG00001', lastName: 'Geannuleerd', status: 'geannuleerd' });

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
  const leider = await login('leider@example.nl');
  const boek = await login('boek@example.nl');
  const redacteur = await login('red@example.nl');
  const exportPath = `/app/deelnemerslijsten/${trip.id}/`;

  /**
   * Haalt een export op en geeft het eerste werkblad terug.
   * @param {{cookie: string, csrf: string}} session Sessie.
   * @param {object} [extra] Aangevinkte categorieën.
   * @returns {Promise<{response: object, sheet: string, about: string}>} Antwoord en bladen.
   */
  const download = async (session, extra = {}) => {
    const response = await request(exportPath, { cookie: session.cookie, form: { _csrf: session.csrf, ...extra } });
    assert.equal(response.status, 200, response.text.slice(0, 200));
    const files = unzip(response.buffer);
    return { response, sheet: files['xl/worksheets/sheet1.xml'], about: files['xl/worksheets/sheet2.xml'] };
  };

  await t.test('rechten, 404 en CSRF', async () => {
    assert.equal((await request('/app/deelnemerslijsten/')).status, 303);
    assert.equal((await request(exportPath, { form: { _csrf: 'x' } })).status, 401);
    for (const session of [boek, redacteur]) {
      assert.equal((await request('/app/deelnemerslijsten/', { cookie: session.cookie })).status, 403);
      assert.equal((await request(exportPath, { cookie: session.cookie, form: { _csrf: session.csrf } })).status, 403);
    }
    assert.equal((await request(exportPath, { cookie: kantoor.cookie, form: { _csrf: 'fout' } })).status, 403);
    assert.equal((await request('/app/deelnemerslijsten/999999/', { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf } })).status, 404);
    assert.equal((await request(exportPath, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, religie: 'ja' } })).status, 403, 'kantoor mag geen kerkgenootschap');
  });

  await t.test('overzicht toont reizen met aanmeldingen en alleen toegestane categorieën', async () => {
    const page = await request('/app/deelnemerslijsten/', { cookie: kantoor.cookie });
    assert.equal(page.status, 200);
    assert.match(page.text, /Albanië \(27-ALB-1\)/);
    assert.doesNotMatch(page.text, /IJsland/, 'reis zonder aanmeldingen staat er niet');
    assert.match(page.text, /name="identiteit"/);
    assert.match(page.text, /name="gezondheid"/);
    assert.doesNotMatch(page.text, /name="religie"/);
    assert.match((await request('/app/deelnemerslijsten/', { cookie: beheer.cookie })).text, /name="religie"/);
    assert.match((await request(`/app/aanmeldingen/?reis=${trip.id}`, { cookie: kantoor.cookie })).text, new RegExp(`href="/app/deelnemerslijsten/#reis-${trip.id}"`));
    assert.match((await request('/app/', { cookie: kantoor.cookie })).text, /href="\/app\/deelnemerslijsten\/"/);
    assert.match((await request('/app/', { cookie: leider.cookie })).text, /href="\/app\/deelnemerslijsten\/"/);
    assert.equal(empty.id > 0, true);
  });

  await t.test('zonder categorieën: alleen NAW, geen geannuleerden', async () => {
    const before = (await db.query("SELECT count(*)::int AS total FROM audit_log WHERE action LIKE 'export.deelnemers%'"))[0].total;
    const { response, sheet, about } = await download(kantoor);
    assert.match(response.headers.get('content-disposition'), /attachment; filename="deelnemerslijst-27-alb-1-\d{4}-\d{2}-\d{2}\.xlsx"/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(sheet, />Bakker</, 'actuele gegevens van de persoon');
    assert.doesNotMatch(sheet, /Formulier-Bakker/);
    assert.match(sheet, />Zonderpersoon</, 'aanmelding zonder persoon uit het formulier');
    assert.doesNotMatch(sheet, /Geannuleerd/);
    assert.doesNotMatch(sheet, /Geboortedatum|Astma|PKN|NX99/);
    assert.match(about, /Aantal deelnemers/);
    const audit = await db.query("SELECT action, entity, entity_id FROM audit_log WHERE action LIKE 'export.deelnemers%' ORDER BY id");
    assert.equal(audit.length - before, 1);
    assert.deepEqual(audit.at(-1), { action: 'export.deelnemers', entity: 'trips', entity_id: String(trip.id) });
  });

  await t.test('met identiteit en gezondheid (kantoor), met kerkgenootschap alleen beheerder', async () => {
    const { sheet } = await download(kantoor, { identiteit: 'ja', gezondheid: 'ja' });
    assert.match(sheet, /04-03-1990/);
    assert.match(sheet, />Paspoort</);
    assert.match(sheet, />Astma</);
    assert.match(sheet, />0687654321</);
    assert.doesNotMatch(sheet, /PKN/);
    const actions = (await db.query("SELECT action FROM audit_log WHERE action LIKE 'export.deelnemers%' ORDER BY id DESC LIMIT 3")).map((row) => row.action);
    assert.deepEqual(actions, ['export.deelnemers.gezondheid', 'export.deelnemers.identiteit', 'export.deelnemers']);
    assert.match((await download(beheer, { religie: 'ja' })).sheet, />PKN</);
    // Het auditlog toont een leesbare naam voor de nieuwe acties.
    assert.match((await request('/app/auditlog/', { cookie: beheer.cookie })).text, /Deelnemerslijst met medische bijzonderheden en noodnummer geëxporteerd/);
  });

  await t.test('ingetrokken art. 9-toestemming: geen gegevens', async () => {
    await db.query("UPDATE consents SET withdrawn_at = now() WHERE person_id = $1 AND kind = 'art9_gezondheid'", [personId]);
    const { sheet } = await download(kantoor, { gezondheid: 'ja' });
    assert.doesNotMatch(sheet, /Astma/);
    assert.ok(sheet.includes(NO_CONSENT));
    assert.match(sheet, />0687654321</, 'noodnummer is geen art. 9 en blijft');
  });

  await t.test('reisleider: alleen eigen vertrekken, beperkt, bijzondere gegevens alleen in het venster', async () => {
    // Zonder gekoppeld profiel: niets te zien, elke reis 404.
    assert.match((await request('/app/deelnemerslijsten/', { cookie: leider.cookie })).text, /nog geen vertrekken met aanmeldingen waar jij reisleider van bent/);
    assert.equal((await request(exportPath, { cookie: leider.cookie, form: { _csrf: leider.csrf } })).status, 404);

    const [guide] = await db.query("INSERT INTO guides (slug, name) VALUES ('henk', 'Henk') RETURNING id");
    const [otherGuide] = await db.query("INSERT INTO guides (slug, name) VALUES ('piet', 'Piet') RETURNING id");
    const [leiderUser] = await db.query("SELECT id FROM users WHERE email = 'leider@example.nl'");
    // Koppelen via Gebruikers (beheerder); een onbekend profiel geeft 422, een andere rol slaat geen profiel op.
    const form = { _csrf: beheer.csrf, name: 'Leider', email: 'leider@example.nl', role: 'reisleider', active: 'ja' };
    assert.equal((await request(`/app/gebruikers/${leiderUser.id}/`, { cookie: beheer.cookie, form: { ...form, guide_id: '999999' } })).status, 422);
    assert.match((await request(`/app/gebruikers/${leiderUser.id}/`, { cookie: beheer.cookie })).text, /name="guide_id"/);
    assert.equal((await request(`/app/gebruikers/${leiderUser.id}/`, { cookie: beheer.cookie, form: { ...form, guide_id: String(guide.id) } })).status, 303);
    assert.equal((await db.query('SELECT guide_id FROM users WHERE id = $1', [leiderUser.id]))[0].guide_id, guide.id);
    assert.equal((await db.query("SELECT count(*)::int AS total FROM audit_log WHERE action = 'gebruiker.reisleidersprofiel'"))[0].total, 1);
    const relogged = await login('leider@example.nl');

    // Reis van een ander profiel: 404. Eigen reis buiten het venster: beperkt, zonder categorieën.
    await db.query('INSERT INTO trip_guides (trip_id, guide_id) VALUES ($1, $2)', [trip.id, otherGuide.id]);
    assert.equal((await request(exportPath, { cookie: relogged.cookie, form: { _csrf: relogged.csrf } })).status, 404);
    await db.query('INSERT INTO trip_guides (trip_id, guide_id) VALUES ($1, $2)', [trip.id, guide.id]);
    const overview = await request('/app/deelnemerslijsten/', { cookie: relogged.cookie });
    assert.match(overview.text, /Albanië/);
    assert.doesNotMatch(overview.text, /name="gezondheid"/, 'buiten het venster geen categorieën');
    assert.equal((await request(exportPath, { cookie: relogged.cookie, form: { _csrf: relogged.csrf, gezondheid: 'ja' } })).status, 403);
    const limited = await download(relogged);
    assert.match(limited.sheet, />Bakker</);
    assert.match(limited.sheet, />0612121212</);
    assert.match(limited.sheet, />griet@example\.nl</);
    assert.doesNotMatch(limited.sheet, /Markt 1|Middelburg|AV-2027-GRIET001|Betaalkeuze/, 'geen adres, referentie of betaalgegevens');
    assert.match(limited.about, /Reisleider/);

    // Eigen reis binnen het venster (vertrek over 5 dagen): identiteit en gezondheid mogen, kerkgenootschap nooit.
    const [soon] = await db.query("INSERT INTO trips (slug, title, trip_code, departure_date, duration_days) VALUES ('binnenkort', 'Binnenkort', '26-BIN-1', current_date + 5, 8) RETURNING id");
    await db.query('INSERT INTO trip_guides (trip_id, guide_id) VALUES ($1, $2)', [soon.id, guide.id]);
    await db.query("UPDATE consents SET withdrawn_at = NULL WHERE person_id = $1 AND kind = 'art9_gezondheid'", [personId]);
    await db.query('UPDATE bookings SET trip_id = $1 WHERE reference = $2', [soon.id, 'AV-2027-GRIET001']);
    assert.match((await request('/app/deelnemerslijsten/', { cookie: relogged.cookie })).text, /name="gezondheid"/);
    const response = await request(`/app/deelnemerslijsten/${soon.id}/`, { cookie: relogged.cookie, form: { _csrf: relogged.csrf, identiteit: 'ja', gezondheid: 'ja' } });
    assert.equal(response.status, 200);
    const sheet = unzip(response.buffer)['xl/worksheets/sheet1.xml'];
    assert.match(sheet, />Astma</);
    assert.match(sheet, /04-03-1990/);
    assert.doesNotMatch(sheet, /Markt 1/);
    assert.equal((await request(`/app/deelnemerslijsten/${soon.id}/`, { cookie: relogged.cookie, form: { _csrf: relogged.csrf, religie: 'ja' } })).status, 403);
    // Na de terugkomst (vertrek 20 dagen geleden, 8 dagen): weer dicht.
    await db.query('UPDATE trips SET departure_date = current_date - 20 WHERE id = $1', [soon.id]);
    assert.equal((await request(`/app/deelnemerslijsten/${soon.id}/`, { cookie: relogged.cookie, form: { _csrf: relogged.csrf, gezondheid: 'ja' } })).status, 403);
  });

  await t.test('meer dan MAX_ROWS deelnemers: 422, geen bestand en geen audit', async () => {
    const [big] = await db.query("INSERT INTO trips (slug, title, trip_code, departure_date) VALUES ('groot', 'Groot', '27-GRO-1', '2027-08-01') RETURNING id");
    await db.query(
      `INSERT INTO bookings (reference, trip_id, trip_title, gender, first_names, call_name, last_name, email, mobile, street, postal_code, city,
         earlier_trip, credit_card, driver_interest, driver_before, payment_method, payment_choice, consent_at)
       SELECT 'AV-GROOT-' || n, $1, 'Groot', 'man', 'Jan', 'Jan', 'Groot' || n, 'groot@example.nl', '06', 'Straat 1', '1234 AB', 'Goes',
              false, false, false, false, 'handmatig', 'aanbetaling', now()
         FROM generate_series(1, $2::int) AS n`,
      [big.id, MAX_ROWS + 1],
    );
    const before = (await db.query("SELECT count(*)::int AS total FROM audit_log WHERE action LIKE 'export.deelnemers%'"))[0].total;
    const response = await request(`/app/deelnemerslijsten/${big.id}/`, { cookie: beheer.cookie, form: { _csrf: beheer.csrf } });
    assert.equal(response.status, 422);
    assert.notEqual(response.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.equal((await db.query("SELECT count(*)::int AS total FROM audit_log WHERE action LIKE 'export.deelnemers%'"))[0].total, before);
  });

  await t.test('limiet per gebruiker', async () => {
    clock += 60 * 60 * 1000;
    for (let i = 0; i < EXPORT_LIMIT; i++) assert.equal((await request(exportPath, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf } })).status, 200);
    const limited = await request(exportPath, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf } });
    assert.equal(limited.status, 429);
    assert.match(limited.text, /href="\/app\/deelnemerslijsten\/"/, 'CRM-pagina met link terug');
    assert.equal((await request(exportPath, { cookie: beheer.cookie, form: { _csrf: beheer.csrf } })).status, 200, 'andere gebruiker heeft een eigen teller');
  });
});
