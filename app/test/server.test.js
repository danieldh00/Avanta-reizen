/**
 * End-to-end-tests tegen PostgreSQL (TEST_DATABASE_URL): migraties, alle paginasoorten, redirects van oude
 * WordPress-adressen, beveiligingskoppen en het aanmeldformulier (opslag, versleuteling, honeypot, limiet, herkomst).
 * Zonder TEST_DATABASE_URL worden ze overgeslagen.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { createVault } = require('../src/security/vault');
const { today } = require('../src/site/content');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MASTER_KEY = Buffer.alloc(32, 3);

/**
 * Datum over een aantal dagen (jjjj-mm-dd).
 * @param {number} days Aantal dagen vanaf vandaag.
 * @returns {string} De datum.
 */
function daysFromNow(days) {
  const date = new Date(`${today()}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test('website en aanmelden', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const db = createDatabase(DATABASE_URL);
  await db.query('DROP SCHEMA public CASCADE');
  await db.query('CREATE SCHEMA public');
  assert.deepEqual(await db.migrate(), [1, 2]);
  assert.deepEqual(await db.migrate(), [], 'tweede keer migreren doet niets');

  const [guide] = await db.query("INSERT INTO guides (legacy_id, slug, name, body_html) VALUES (500, 'harmen', 'Harmen', '<p>Ervaren</p>') RETURNING id");
  const [destination] = await db.query("INSERT INTO trip_categories (legacy_id, slug, name, kind) VALUES (232, 'albanie', 'Albanië', 'bestemming') RETURNING id");
  const [type] = await db.query("INSERT INTO trip_categories (slug, name, kind) VALUES ('kamperen', 'Kampeerreizen', 'type') RETURNING id");
  const insertTrip = (values) => db.query(
    `INSERT INTO trips (legacy_id, slug, title, body_html, trip_code, departure_date, price_cents, fully_booked, guide_id, destinations)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    values,
  );
  const [open] = await insertTrip([1001, '8-dagen-albanie', '8 dagen Albanië', '<p>Ruig</p>', '27-AKO-56', daysFromNow(30), 79900, false, guide.id, ['Albanië']]);
  await insertTrip([1002, 'vol-albanie', 'Volle reis', '', '27-VOL-1', daysFromNow(40), 50000, true, null, []]);
  await insertTrip([1003, 'oude-reis', 'Oude reis', '', '19-OUD-1', '2019-07-30', 50000, false, null, []]);
  await db.query('INSERT INTO trip_category_links (trip_id, category_id) VALUES ($1, $2), ($1, $3)', [open.id, destination.id, type.id]);
  await db.query("INSERT INTO posts (slug, title, body_html, published_at) VALUES ('op-avantuur', 'Op Avantuur', '<p>Verhaal</p>', now())");
  await db.query("INSERT INTO pages (path, title, body_html) VALUES ('/contact/', 'Contact', '<p>Bel ons</p>'), ('/bedankt-voor-je-aanmelding/', 'Bedankt', '<p>Dank</p>'), ('/avanta-reizen/voorpret/', 'Voorpret', '<p>Tips</p>')");
  await db.query("INSERT INTO faqs (slug, question, answer_html, category) VALUES ('algemeen-1', 'Paspoort nodig?', '<p>Ja</p>', 'Algemeen')");

  let clock = Date.now();
  const app = createApp({ db, masterKey: MASTER_KEY, now: () => clock });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await db.close(); });

  /**
   * Haalt een pagina op zonder redirects te volgen.
   * @param {string} path Pad.
   * @param {object} [init] fetch-opties.
   * @returns {Promise<{status: number, text: string, headers: Headers}>} Antwoord.
   */
  const get = async (path, init = {}) => {
    const response = await fetch(base + path, { redirect: 'manual', ...init });
    return { status: response.status, text: await response.text(), headers: response.headers };
  };

  await t.test('pagina’s geven 200 met de juiste inhoud', async () => {
    const checks = [
      ['/', '8 dagen Albanië'], ['/reis/', '27-AKO-56'], ['/reis/8-dagen-albanie/', 'Ik meld me aan!'],
      ['/reis-categorie/albanie/', '8 dagen Albanië'], ['/reis-categorie/kamperen/', '8 dagen Albanië'],
      ['/reisleider/', 'Harmen'], ['/reisleider/harmen/', 'Reizen met Harmen'], ['/blog/', 'Op Avantuur'],
      ['/op-avantuur/', 'Verhaal'], ['/faq/', 'Paspoort nodig?'], ['/contact/', 'Bel ons'],
      ['/avanta-reizen/voorpret/', 'Tips'], ['/zoeken/?s=alban', '8 dagen Albanië'], ['/reis/?bestemming=albanie', '1 reis gevonden'],
    ];
    for (const [path, expected] of checks) {
      const response = await get(path);
      assert.equal(response.status, 200, path);
      assert.match(response.text, new RegExp(expected), path);
    }
  });

  await t.test('lijsten tonen geen vertrokken reizen; volle en oude reizen tonen geen aanmeldknop', async () => {
    const list = await get('/reis/');
    assert.doesNotMatch(list.text, /Oude reis/);
    assert.match((await get('/reis/vol-albanie/')).text, /btn--inactive">Volgeboekt/);
    assert.match((await get('/reis/oude-reis/')).text, /Vertrokken/);
  });

  await t.test('oude adressen worden doorgestuurd', async () => {
    assert.equal((await get('/reis')).headers.get('location'), '/reis/');
    assert.equal((await get('/reisleider/500/')).headers.get('location'), '/reisleider/harmen/');
    assert.equal((await get('/faq/paspoort/')).headers.get('location'), '/faq/');
    assert.equal((await get('/?s=ijsland')).headers.get('location'), '/zoeken/?s=ijsland');
    assert.equal((await get('/category/nieuws/')).status, 301);
    // Geen open redirect via een pad dat met // begint.
    assert.equal((await get('//evil.example')).headers.get('location'), '/evil.example/');
  });

  await t.test('onbekend adres is 404; filters accepteren geen rare invoer', async () => {
    assert.equal((await get('/bestaat-niet/')).status, 404);
    assert.equal((await get('/reis/%3Cscript%3E/')).status, 404);
    const filtered = await get('/reis/?bestemming=%3Cscript%3E');
    assert.equal(filtered.status, 200);
    assert.doesNotMatch(filtered.text, /<script>/i);
  });

  await t.test('beveiligingskoppen en noindex tot go-live', async () => {
    const response = await get('/');
    assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal(response.headers.get('x-powered-by'), null);
    assert.match(response.text, /<meta name="robots" content="noindex, nofollow">/);
    assert.match((await get('/robots.txt')).text, /Disallow: \//);
    assert.equal((await get('/api/health')).status, 200);
  });

  /**
   * Haalt het formulier op en geeft de velden terug die een browser zou meesturen.
   * @param {number} legacyId Oud reis-id.
   * @returns {Promise<URLSearchParams>} Formuliervelden.
   */
  const formFor = async (legacyId) => {
    const page = await get(`/aanmelden/?id=${legacyId}`);
    assert.equal(page.status, 200);
    const token = /name="token" value="([^"]+)"/.exec(page.text)[1];
    return new URLSearchParams({
      id: String(legacyId), reis: '', token, website: '',
      gender: 'vrouw', first_names: 'Anna Maria', call_name: 'Anna', last_name: 'Jansen', birth_date: '1999-05-04',
      mobile: '0612345678', email: 'Anna@Example.nl', email_confirm: 'anna@example.nl', street: 'Dorpsstraat 1',
      postal_code: '4331 ab', city: 'Middelburg', occupation: 'Verpleegkundige', church: 'PKN', nationality: 'Nederlandse',
      document_type: 'paspoort', document_number: 'NX1234567', particulars: 'Notenallergie', earlier_trip: 'nee',
      credit_card: 'ja', driver_interest: 'ja', driver_before: 'nee', payment_choice: 'aanbetaling', consent: 'ja',
    });
  };

  /**
   * Verstuurt het aanmeldformulier.
   * @param {URLSearchParams} form Velden.
   * @param {object} [headers] Extra koppen.
   * @returns {Promise<{status: number, text: string, headers: Headers}>} Antwoord.
   */
  const post = (form, headers = {}) => get('/aanmelden/', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'same-origin', ...headers },
    body: form.toString(),
  });

  await t.test('aanmelding wordt opgeslagen met versleutelde bijzondere gegevens', async () => {
    const form = await formFor(1001);
    clock += 5000;
    const response = await post(form);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/bedankt-voor-je-aanmelding/');
    const [booking] = await db.query('SELECT reference, trip_code, email, postal_code, driver_interest, payment_choice, sensitive_data FROM bookings');
    assert.match(booking.reference, /^AV-\d{4}-[0-9A-F]{8}$/);
    assert.equal(booking.trip_code, '27-AKO-56');
    assert.equal(booking.email, 'anna@example.nl');
    assert.equal(booking.postal_code, '4331 AB');
    assert.equal(booking.driver_interest, true);
    assert.doesNotMatch(booking.sensitive_data, /PKN|NX1234567|Notenallergie|1999/);
    const sensitive = createVault(MASTER_KEY).open(booking.sensitive_data);
    assert.equal(sensitive.church, 'PKN');
    assert.equal(sensitive.document_number, 'NX1234567');
    assert.equal(sensitive.particulars, 'Notenallergie');
  });

  await t.test('fouten in het formulier geven 422 met meldingen en bewaren niets', async () => {
    const form = await formFor(1001);
    form.set('email_confirm', 'ander@example.nl');
    form.set('first_names', '<script>x</script>');
    clock += 5000;
    const response = await post(form);
    assert.equal(response.status, 422);
    assert.match(response.text, /De e-mailadressen zijn niet gelijk/);
    assert.doesNotMatch(response.text, /<script>x<\/script>/);
    assert.equal((await db.query('SELECT COUNT(*)::int AS total FROM bookings'))[0].total, 1);
  });

  await t.test('honeypot, te snel invullen en een vals token slaan niets op', async () => {
    const honeypot = await formFor(1001);
    honeypot.set('website', 'spam');
    clock += 5000;
    assert.equal((await post(honeypot)).status, 303);
    const quick = await formFor(1001);
    assert.equal((await post(quick)).status, 303);
    const forged = await formFor(1001);
    forged.set('token', `${clock - 10000}.vals`);
    assert.equal((await post(forged)).status, 303);
    assert.equal((await db.query('SELECT COUNT(*)::int AS total FROM bookings'))[0].total, 1);
  });

  await t.test('aanmelden kan niet voor volle, vertrokken of onbekende reizen', async () => {
    assert.equal((await get('/aanmelden/?id=1002')).status, 409);
    assert.equal((await get('/aanmelden/?id=1003')).status, 409);
    assert.equal((await get('/aanmelden/?id=9999')).status, 404);
    assert.equal((await get('/aanmelden/')).headers.get('location'), '/reis/');
  });

  await t.test('verzoek van een andere site wordt geweigerd', async () => {
    const form = await formFor(1001);
    clock += 5000;
    assert.equal((await post(form, { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await post(form, { origin: 'https://kwaad.example' })).status, 403);
  });

  await t.test('limiet: na 5 aanmeldingen per 10 minuten volgt 429', async () => {
    let lastStatus = 0;
    for (let i = 0; i < 6; i++) {
      const form = await formFor(1001);
      clock += 5000;
      lastStatus = (await post(form)).status;
    }
    assert.equal(lastStatus, 429);
  });

  await t.test('limiet per bezoeker achter een vertrouwde proxy (X-Forwarded-For)', async () => {
    const form = await formFor(1001);
    clock += 5000;
    assert.equal((await post(form, { 'x-forwarded-for': '203.0.113.9' })).status, 303);
  });

  await t.test('referentiejaar volgt de Nederlandse datum, ook rond de jaarwisseling', async () => {
    clock = Date.UTC(2099, 11, 31, 23, 30);
    const form = await formFor(1001);
    clock += 5000;
    assert.equal((await post(form, { 'x-forwarded-for': '203.0.113.10' })).status, 303);
    const [booking] = await db.query("SELECT reference FROM bookings WHERE reference LIKE 'AV-2100-%'");
    assert.ok(booking, 'aanmelding om 00:30 Nederlandse tijd op 1 januari 2100 krijgt jaar 2100');
  });
});
