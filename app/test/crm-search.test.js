/**
 * Tests voor het zoeken over het hele CRM (`/app/zoeken/`, `crm/search.js`, B03): zoekveld in de kopbalk alleen met
 * iets te doorzoeken, bronnen volgens de rechten (redacteur ziet geen deelnemers, boekhouding geen berichten, reisleider
 * niets), escaping, te korte zoekterm, `%` als gewone tekst, hoogstens vijf per bron met een link naar de lijst, en
 * geanonimiseerde deelnemers niet. Draait in een eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { hashPassword } = require('../src/crm/passwords');
const { COOKIE_NAME } = require('../src/crm/auth');
const { sourcesFor, canSearch } = require('../src/crm/search');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'crm_search_test';
const MASTER_KEY = Buffer.alloc(32, 41);
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

test('bronnen per rol', () => {
  const keys = (role) => sourcesFor(role).map((source) => source.key);
  assert.deepEqual(keys('beheerder'), ['aanmeldingen', 'deelnemers', 'berichten', 'reizen', 'reisleiders', 'paginas', 'blog', 'faq', 'gebruikers']);
  assert.deepEqual(keys('kantoor'), ['aanmeldingen', 'deelnemers', 'berichten', 'reizen', 'reisleiders', 'paginas', 'blog', 'faq']);
  assert.deepEqual(keys('boekhouding'), ['deelnemers']);
  assert.deepEqual(keys('redacteur'), ['paginas', 'blog', 'faq']);
  assert.deepEqual(keys('reisleider'), [], 'alleen eigen vertrekken: niets over alle records');
  assert.equal(canSearch('reisleider'), false);
  assert.equal(canSearch('onbekend'), false);
});

test('zoeken in het CRM', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (testContext) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  const app = createApp({ db, masterKey: MASTER_KEY });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  testContext.after(async () => { server.close(); await db.close(); });

  const hash = await hashPassword(PASSWORD);
  for (const role of ['kantoor', 'beheerder', 'reisleider', 'boekhouding', 'redacteur']) {
    await db.query('INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)', [`${role}@example.nl`, `Gebruiker ${role}`, role, hash]);
  }
  const [trip] = await db.query("INSERT INTO trips (slug, title, trip_code, departure_date) VALUES ('noorwegen', 'Noorwegen <fjorden>', '27-NOR-1', '2027-07-01') RETURNING id");
  await db.query("INSERT INTO guides (slug, name, body_html) VALUES ('noor', 'Noor de Gids', '')");
  await db.query("INSERT INTO pages (path, title, body_html) VALUES ('/reizen-naar-noorwegen/', 'Reizen naar Noorwegen', '')");
  await db.query("INSERT INTO contact_messages (name, email, subject, message, consent_at) VALUES ('Klaas', 'klaas@example.nl', 'Vraag', 'Gaat Noorwegen door?', now())");
  for (let i = 1; i <= 7; i++) {
    const [person] = await db.query(
      "INSERT INTO persons (gender, first_names, call_name, last_name, email, mobile, street, postal_code, city, occupation, match_key) VALUES ('man', 'Jan', 'Jan', $1, $2, '06', 'Straat 1', '1234 AB', 'Goes', 'x', $3) RETURNING id",
      [`Noordhof${i}`, `jan${i}@example.nl`, `sleutel${i}`],
    );
    await db.query(
      `INSERT INTO bookings (reference, trip_id, trip_title, trip_code, departure_date, gender, first_names, call_name, last_name, email, mobile,
         street, postal_code, city, earlier_trip, credit_card, driver_interest, driver_before, payment_method, payment_choice, consent_at, person_id)
       VALUES ($1, $2, 'Noorwegen', '27-NOR-1', '2027-07-01', 'man', 'Jan', 'Jan', $3, $4, '06', 'Straat 1', '1234 AB', 'Goes',
         false, false, false, false, 'handmatig', 'aanbetaling', now(), $5)`,
      [`AV-2027-0000000${i}`, trip.id, `Noordhof${i}`, `jan${i}@example.nl`, person.id],
    );
  }
  await db.query("UPDATE persons SET anonymized_at = now() WHERE last_name = 'Noordhof7'");

  const request = async (url, cookie) => {
    const response = await fetch(base + url, { headers: cookie ? { cookie: `${COOKIE_NAME}=${cookie}` } : {}, redirect: 'manual' });
    return { status: response.status, text: await response.text() };
  };
  const login = async (role) => {
    const response = await fetch(`${base}/app/inloggen/`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: `${role}@example.nl`, password: PASSWORD }).toString(), redirect: 'manual' });
    return response.headers.getSetCookie().find((value) => value.startsWith(`${COOKIE_NAME}=`)).split(';')[0].split('=')[1];
  };
  const sessions = {};
  for (const role of ['kantoor', 'beheerder', 'reisleider', 'boekhouding', 'redacteur']) sessions[role] = await login(role);

  await testContext.test('zoekveld in de kopbalk; zonder sessie naar inloggen; reisleider 403 zonder zoekveld', async () => {
    assert.equal((await request('/app/zoeken/?q=noor')).status, 303);
    assert.match((await request('/app/', sessions.kantoor)).text, /<form class="crm-header-search" method="get" action="\/app\/zoeken\/" role="search">/);
    assert.doesNotMatch((await request('/app/', sessions.reisleider)).text, /crm-header-search/);
    assert.equal((await request('/app/zoeken/?q=noor', sessions.reisleider)).status, 403);
  });

  await testContext.test('kantoor: treffers per bron, hoogstens vijf met link naar de lijst, ge-escaped, geanonimiseerd niet', async () => {
    const page = await request('/app/zoeken/?q=noor', sessions.kantoor);
    assert.equal(page.status, 200);
    assert.match(page.text, /id="crm-zoek"[^>]*value="noor"/, 'zoekterm blijft in de kopbalk staan');
    assert.match(page.text, /<h2 id="zoek-aanmeldingen">Aanmeldingen <span class="crm-tabs-count">5\+<\/span><\/h2>/);
    assert.match(page.text, /href="\/app\/aanmeldingen\/\?q=noor">Alle treffers in aanmeldingen/);
    assert.match(page.text, /<h2 id="zoek-deelnemers">Deelnemers <span class="crm-tabs-count">5\+<\/span>/);
    assert.match(page.text, /Noorwegen &lt;fjorden&gt; \(27-NOR-1\)/);
    assert.match(page.text, /href="\/app\/reisleiders\/\d+\/">Noor de Gids/);
    assert.match(page.text, /Reizen naar Noorwegen/);
    assert.match(page.text, /href="\/app\/berichten\/\d+\/">Klaas/);
    assert.doesNotMatch(page.text, /zoek-gebruikers/, 'kantoor heeft geen recht op gebruikers');
    const anonymized = await request('/app/zoeken/?q=noordhof7', sessions.kantoor);
    assert.doesNotMatch(anonymized.text, /zoek-deelnemers/);
    assert.match(anonymized.text, /zoek-aanmeldingen/);
  });

  await testContext.test('rechten: redacteur alleen website, boekhouding alleen deelnemers, beheerder ook gebruikers', async () => {
    const editor = (await request('/app/zoeken/?q=noor', sessions.redacteur)).text;
    assert.match(editor, /zoek-paginas/);
    assert.doesNotMatch(editor, /zoek-deelnemers|zoek-aanmeldingen|zoek-berichten|zoek-reizen/);
    const books = (await request('/app/zoeken/?q=noor', sessions.boekhouding)).text;
    assert.match(books, /zoek-deelnemers/);
    assert.doesNotMatch(books, /zoek-berichten|zoek-paginas/);
    assert.match((await request('/app/zoeken/?q=gebruiker%20kantoor', sessions.beheerder)).text, /href="\/app\/gebruikers\/\d+\/">Gebruiker kantoor/);
  });

  await testContext.test('te kort, niets gevonden, % als gewone tekst, leeg', async () => {
    assert.match((await request('/app/zoeken/?q=n', sessions.kantoor)).text, /Typ minstens 2 tekens/);
    assert.match((await request('/app/zoeken/?q=xyzzy', sessions.kantoor)).text, /Niets gevonden voor “xyzzy”/);
    assert.match((await request('/app/zoeken/?q=%25%25', sessions.kantoor)).text, /Niets gevonden/);
    assert.match((await request('/app/zoeken/', sessions.kantoor)).text, /Zoek op naam, e-mailadres/);
    assert.equal((await request('/app/zoeken/?q=a&q=b', sessions.kantoor)).status, 200, 'dubbele parameter breekt niets');
  });
});
