/**
 * End-to-end-tests tegen PostgreSQL (TEST_DATABASE_URL): migraties, alle paginasoorten, redirects van oude
 * WordPress-adressen, beveiligingskoppen, het aanmeldformulier (opslag, versleuteling, honeypot, limiet, herkomst) en het
 * contactformulier (opslag, meldingen, honeypot, token, herkomst, limiet).
 * Zonder TEST_DATABASE_URL worden ze overgeslagen.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { normalizeSiteContent } = require('../src/site/site-content');
const { createVault } = require('../src/security/vault');
const { createPersons } = require('../src/persons/persons');
const { CONSENT_TEXT_VERSION } = require('../src/booking/fields');
const { today } = require('../src/site/content');
const { MAX_FILL_MS } = require('../src/security/form-guard');

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
  assert.deepEqual(await db.migrate(), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31]);
  assert.deepEqual(await db.migrate(), [], 'tweede keer migreren doet niets');

  const [guide] = await db.query("INSERT INTO guides (legacy_id, slug, name, body_html) VALUES (500, 'harmen', 'Harmen', '<p>Ervaren</p>') RETURNING id");
  const [destination] = await db.query("INSERT INTO trip_categories (legacy_id, slug, name, kind) VALUES (232, 'albanie', 'Albanië', 'bestemming') RETURNING id");
  const [type] = await db.query("INSERT INTO trip_categories (slug, name, kind) VALUES ('kamperen', 'Kampeerreizen', 'type') RETURNING id");
  const insertTrip = async ([legacyId, slug, title, body, code, departure, price, full, guideId]) => {
    const rows = await db.query(
      `INSERT INTO trips (legacy_id, slug, title, body_html, trip_code, departure_date, price_cents, fully_booked)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [legacyId, slug, title, body, code, departure, price, full],
    );
    if (guideId) await db.query('INSERT INTO trip_guides (trip_id, guide_id) VALUES ($1, $2)', [rows[0].id, guideId]);
    return rows;
  };
  const [open] = await insertTrip([1001, '8-dagen-albanie', '8 dagen Albanië', '<p>Ruig</p>', '27-AKO-56', daysFromNow(30), 79900, false, guide.id, ['Albanië']]);
  await insertTrip([1002, 'vol-albanie', 'Volle reis', '', '27-VOL-1', daysFromNow(40), 50000, true, null, []]);
  await insertTrip([1003, 'oude-reis', 'Oude reis', '', '19-OUD-1', '2019-07-30', 50000, false, null, []]);
  await db.query('INSERT INTO trip_category_links (trip_id, category_id) VALUES ($1, $2), ($1, $3)', [open.id, destination.id, type.id]);
  await db.query("INSERT INTO posts (slug, title, body_html, published_at) VALUES ('op-avantuur', 'Op Avantuur', '<p>Verhaal &amp; meer</p>', now())");
  await db.query(`INSERT INTO posts (slug, title, intro, body_html, published_at) VALUES ('met-video', 'Met video', 'Kijk dit filmpje',
    '<p><a href="https://www.youtube.com/embed/el9qys7UK9A?feature=oembed" rel="noopener" target="_blank">Bekijk de video</a></p><p>Tekst</p>', now() - interval '1 day')`);
  await db.query("INSERT INTO pages (path, title, body_html) VALUES ('/contact/', 'Contact', '<p>Bel ons</p>'), ('/bedankt-voor-je-aanmelding/', 'Bedankt', '<p>Dank</p>'), ('/avanta-reizen/voorpret/', 'Voorpret', '<p>Tips</p>')");
  await db.query("INSERT INTO faqs (slug, question, answer_html, category) VALUES ('algemeen-1', 'Paspoort nodig?', '<p>Ja</p>', 'Algemeen')");

  let clock = Date.now();
  // Database met een schakelaar om een botsing op de unieke referentie (23505) na te bootsen.
  const collisions = { count: 0, constraint: 'bookings_reference_key' };
  /**
   * Geeft een query-functie die een botsing nabootst zolang de schakelaar aan staat.
   * @param {Function} query De echte query-functie.
   * @returns {Function} Query-functie.
   */
  const colliding = (query) => (sql, params) => {
    if (collisions.count > 0 && sql.trimStart().startsWith('INSERT INTO bookings')) {
      collisions.count--;
      return Promise.reject(Object.assign(new Error('duplicate key'), { code: '23505', constraint: collisions.constraint }));
    }
    return query(sql, params);
  };
  const collidingDb = {
    ...db,
    query: colliding(db.query),
    transaction: (work) => db.transaction((client) => work({ ...client, query: colliding(client.query) })),
  };
  // Vaste inhoud zoals de import die schrijft: een tag, het uitgelichte bericht en een galerij onder een pagina.
  const siteContent = {
    load: () => normalizeSiteContent({
      blogTags: [{ slug: 'avontuur', name: 'Avontuur', posts: ['op-avantuur', 'bestaat-niet'] }],
      featuredPost: 'op-avantuur',
      galleries: { '/avanta-reizen/voorpret/': { title: 'Avanta = avontuur', images: ['/media/voorpret.jpg'] } },
    }),
  };
  const app = createApp({ db: collidingDb, masterKey: MASTER_KEY, now: () => clock, siteContent });
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

  await t.test('homepage: last-minutes, reistypes, bestemmingen en blog uit de database; nieuwe reizen bovenaan', async () => {
    await db.query("INSERT INTO trip_categories (slug, name, kind) VALUES ('hostel', 'Hostelreizen', 'type')");
    await insertTrip([1004, 'nieuw-ijsland', 'Nieuw IJsland', '', '27-IJS-1', daysFromNow(90), 99900, false, null, []]);
    await db.query("UPDATE trips SET is_new = TRUE WHERE slug = 'nieuw-ijsland'");
    const page = (await get('/')).text;
    assert.match(page, /<body class="home">|class="home"/);
    const lastMinutes = page.slice(page.indexOf('homepage__last-minutes'), page.indexOf('homepage__trip-types'));
    assert.match(lastMinutes, /href="\/reis\/8-dagen-albanie\/"/);
    assert.match(lastMinutes, /href="\/reis\/nieuw-ijsland\/"[\s\S]*<span class="box__label">Nieuw<\/span>/);
    assert.doesNotMatch(lastMinutes, /Volle reis|Oude reis/, 'alleen reizen met plek die nog niet vertrokken zijn');
    // Reistypes in de volgorde van de huidige site (hostel voor kamperen), alleen bestaande types.
    const types = page.slice(page.indexOf('homepage__trip-types'), page.indexOf('homepage__inspiration'));
    assert.ok(types.indexOf('/reis-categorie/hostel/') < types.indexOf('/reis-categorie/kamperen/'));
    assert.doesNotMatch(types, /reis-categorie\/jeugd\//);
    assert.match(page, /<a class="banner banner--fullimage" href="\/reis-categorie\/albanie\/"/);
    assert.match(page, /href="\/op-avantuur\/"/);
    assert.match(page, /Nieuwe reizen \(1\)/);
    const list = (await get('/reis/?nieuw=1')).text;
    assert.ok(list.indexOf('Nieuw IJsland') > -1 && list.indexOf('Nieuw IJsland') < list.indexOf('8 dagen Albanië'), 'nieuw=1 zet nieuwe reizen bovenaan');
    const normal = (await get('/reis/')).text;
    assert.ok(normal.indexOf('8 dagen Albanië') < normal.indexOf('Nieuw IJsland'), 'standaard op vertrekdatum');
  });

  await t.test('reispagina\'s in de opmaak van de huidige site; video alleen op de homepage in de CSP', async () => {
    const detail = (await get('/reis/8-dagen-albanie/')).text;
    assert.match(detail, /<div class="trip__single">/);
    assert.match(detail, /<span class="block-ghost__label">Reisleider<\/span>[\s\S]*href="\/reisleider\/harmen\/">Harmen/);
    assert.match(detail, /<a class="trip-type" href="\/reis-categorie\/kamperen\/"/);
    assert.match(detail, /<span class="trip__price">€799,-<\/span>/);
    const list = (await get('/reis/?bestemming=albanie&nieuw=1')).text;
    assert.match(list, /<div class="filter">[\s\S]*<option value="albanie" selected>/);
    assert.match(list, /name="nieuw" checked/);
    assert.match(list, /class="list list--journey archive archive--journey"/);
    assert.match((await get('/reis/?bestemming=bestaat-niet')).text, /<div class="alert">Geen reizen gevonden op basis van het filter\.<\/div>/);
    assert.match((await get('/reis-categorie/kamperen/')).text, /post-teaser--landscape" href="\/reis\/8-dagen-albanie\/"/);
    const guides = (await get('/reisleider/')).text;
    assert.match(guides, /<a class="post-teaser post-teaser--guide" href="\/reisleider\/harmen\/">/);
    assert.match(guides, /Ontmoet alvast onze reisleiders!/);
    const guide = (await get('/reisleider/harmen/')).text;
    assert.match(guide, /<section class="page-header page-header--bare">/);
    assert.match(guide, /<h1 class="guide__name">Harmen<\/h1>/);
    // Zonder homepage.json heeft de standaardslider de video van de huidige site: alleen / staat youtube-nocookie toe.
    const home = await get('/');
    assert.match(home.headers.get('content-security-policy'), /frame-src 'self' https:\/\/www\.youtube-nocookie\.com/);
    assert.match(home.text, /<iframe src="https:\/\/www\.youtube-nocookie\.com\/embed\//);
    assert.doesNotMatch((await get('/reis/')).headers.get('content-security-policy'), /youtube/);
  });

  await t.test('weblog, tags, bericht met video, pagina met galerij, FAQ en zoeken in de opmaak van de huidige site', async () => {
    const blog = await get('/blog/');
    assert.match(blog.text, /<p class="page-header__pretitle">campfire stories<\/p>\s*<h1 class="page-header__title">Weblog<\/h1>/);
    assert.match(blog.text, /<a class="tags__item" href="\/tag\/avontuur\/">Avontuur<\/a>/);
    assert.match(blog.text, /post-wrapper featured-post"><a class="post-teaser" href="\/op-avantuur\/">/, 'uitgelicht bericht groot rechts');
    assert.match(blog.text, /<span class="post-teaser__summary">Verhaal &amp; meer \.\.\.<\/span>/, 'samenvatting uit de tekst');
    assert.doesNotMatch(blog.text, /Bekijk de video \.\.\./, 'de videolink telt niet mee in de samenvatting');
    const tag = await get('/tag/avontuur/');
    assert.equal(tag.status, 200);
    assert.match(tag.text, /<h1 class="page-header__title">Avontuur<\/h1>/);
    assert.match(tag.text, /post-teaser--landscape" href="\/op-avantuur\/"/);
    assert.doesNotMatch(tag.text, /met-video/);
    assert.equal((await get('/tag/onbekend/')).headers.get('location'), '/blog/');
    assert.equal((await get('/tag/%3Cscript%3E/')).status, 301);

    const video = await get('/met-video/');
    assert.match(video.headers.get('content-security-policy'), /frame-src 'self' https:\/\/www\.youtube-nocookie\.com/);
    assert.match(video.text, /class="page-header page-header--single/);
    assert.match(video.text, /<div class="page-introduction">Kijk dit filmpje<\/div><div class="page-content"><div class="page-content__video-wrapper">/);
    assert.match(video.text, /<iframe src="https:\/\/www\.youtube-nocookie\.com\/embed\/el9qys7UK9A"/);
    assert.doesNotMatch((await get('/op-avantuur/')).headers.get('content-security-policy'), /youtube/, 'zonder video geen frame-src');

    const page = (await get('/avanta-reizen/voorpret/')).text;
    assert.match(page, /<div class="page-content"><div class="page-content__text"><p>Tips<\/p><\/div><\/div>/);
    assert.match(page, /<h2 class="section__title">Avanta = avontuur<\/h2>/);
    assert.match(page, /<img src="\/media\/voorpret\.jpg"/);

    const faq = (await get('/faq/')).text;
    assert.match(faq, /<div class="category category--faq" id="algemeen">/);
    assert.match(faq, /<summary class="faq__summary"><h2 class="faq__question">Paspoort nodig\?<\/h2>/);

    const search = (await get('/zoeken/?s=avantuur')).text;
    assert.match(search, /<div class="content-main"><div class="layout-container search-results">/);
    assert.match(search, /post-teaser--landscape" href="\/op-avantuur\/"/);
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
    // HSTS alleen bij https: rechtstreeks over http niet, via de vertrouwde proxy (loopback) met https wel.
    assert.equal(response.headers.get('strict-transport-security'), null);
    const viaProxy = await get('/', { headers: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '198.51.100.7' } });
    assert.equal(viaProxy.headers.get('strict-transport-security'), 'max-age=31536000');
  });

  await t.test('/api/health: versie alleen van binnen de server (A23)', async () => {
    const local = await get('/api/health');
    assert.equal(local.status, 200);
    assert.equal(local.headers.get('cache-control'), 'no-store');
    assert.deepEqual(JSON.parse(local.text), { ok: true, version: require('../package.json').version });
    // Via een proxy (doorstuurkop) alleen ok, ook als de verbinding zelf van loopback komt.
    for (const header of ['X-Forwarded-For', 'Forwarded', 'CF-Connecting-IP', 'X-Real-IP']) {
      const outside = await get('/api/health', { headers: { [header]: '198.51.100.7' } });
      assert.deepEqual(JSON.parse(outside.text), { ok: true }, header);
    }
  });

  await t.test('security.txt met het contactadres uit Beheer (V01)', async () => {
    const response = await get('/.well-known/security.txt');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/plain/);
    assert.match(response.text, /^Contact: mailto:info@avantareizen\.nl\nExpires: \d{4}-\d{2}-\d{2}T00:00:00Z\n/);
    const expires = Date.parse(/Expires: (\S+)/.exec(response.text)[1]);
    assert.ok(expires > Date.now() && expires < Date.now() + 366 * 86400000, 'verloopt binnen een jaar, niet in het verleden');
    assert.match(response.text, /Canonical: https?:\/\/[^\n]+\/\.well-known\/security\.txt\n/);
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
      consent_religion: 'ja', consent_health: 'ja',
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
    const [booking] = await db.query('SELECT id, reference, trip_code, email, postal_code, driver_interest, payment_choice, sensitive_data, person_id FROM bookings');
    assert.match(booking.reference, /^AV-\d{4}-[0-9A-F]{8}$/);
    assert.equal(booking.trip_code, '27-AKO-56');
    assert.equal(booking.email, 'anna@example.nl');
    assert.equal(booking.postal_code, '4331 AB');
    assert.equal(booking.driver_interest, true);
    assert.equal(booking.sensitive_data, null, 'bijzondere gegevens staan alleen nog bij de persoon');
    const [person] = await db.query('SELECT id, first_names, email, postal_code, match_key, identity_data, special_data, health_data, emergency_data FROM persons WHERE id = $1', [booking.person_id]);
    assert.equal(person.first_names, 'Anna Maria');
    assert.equal(person.postal_code, '4331 AB');
    for (const column of ['identity_data', 'special_data', 'health_data']) assert.doesNotMatch(person[column], /PKN|NX1234567|Notenallergie|1999/);
    assert.equal(person.emergency_data, null, 'leeg blok wordt niet opgeslagen');
    assert.doesNotMatch(person.match_key, /1999|anna/);
    const persons = createPersons({ vault: createVault(MASTER_KEY) });
    assert.equal(persons.openBlock('special_data', person).church, 'PKN');
    assert.equal(persons.openBlock('identity_data', person).document_number, 'NX1234567');
    assert.equal(persons.openBlock('identity_data', person).birth_date, '1999-05-04');
    assert.equal(persons.openBlock('health_data', person).particulars, 'Notenallergie');
    assert.throws(() => persons.openBlock('special_data', { ...person, id: person.id + 1 }), 'blok hoort bij dit ene record');
    const consents = await db.query('SELECT kind, text_version FROM consents WHERE booking_id = $1 ORDER BY kind', [booking.id]);
    assert.deepEqual(consents.map((row) => row.kind), ['art9_gezondheid', 'art9_religie', 'voorwaarden']);
    assert.equal(consents[0].text_version, CONSENT_TEXT_VERSION);
    // Verwachte bedragen voor de betalingen in het CRM: reissom, SGR en boekingskosten (gekozen: aanbetaling).
    const charges = await db.query('SELECT kind, amount_cents FROM booking_charges WHERE booking_id = $1 ORDER BY kind', [booking.id]);
    assert.deepEqual(charges.map((row) => [row.kind, row.amount_cents]), [['boekingskosten', 1500], ['reissom', 79900], ['sgr', 500]]);
  });

  await t.test('art. 9: kerkgenootschap of bijzonderheden zonder eigen toestemming geeft 422; leeg laten mag', async () => {
    const withoutConsent = await formFor(1001);
    withoutConsent.delete('consent_religion');
    withoutConsent.delete('consent_health');
    clock += 5000;
    const refused = await post(withoutConsent, { 'x-forwarded-for': '203.0.113.40' });
    assert.equal(refused.status, 422);
    assert.equal((refused.text.match(/Geef toestemming, of laat het veld hierboven leeg/g) || []).length, 2);
    const empty = await formFor(1001);
    for (const name of ['church', 'particulars', 'consent_religion', 'consent_health']) empty.delete(name);
    clock += 5000;
    assert.equal((await post(empty, { 'x-forwarded-for': '203.0.113.40' })).status, 303);
    const [booking] = await db.query('SELECT id, person_id FROM bookings ORDER BY id DESC LIMIT 1');
    const kinds = await db.query('SELECT kind FROM consents WHERE booking_id = $1', [booking.id]);
    assert.deepEqual(kinds.map((row) => row.kind), ['voorwaarden']);
    // Zelfde e-mailadres en geboortedatum: dezelfde persoon, en een leeg veld wist niets wat er al stond.
    const [first] = await db.query('SELECT person_id FROM bookings ORDER BY id LIMIT 1');
    assert.equal(booking.person_id, first.person_id);
    const [person] = await db.query('SELECT id, special_data FROM persons WHERE id = $1', [booking.person_id]);
    assert.equal(createPersons({ vault: createVault(MASTER_KEY) }).openBlock('special_data', person).church, 'PKN');
    await db.query('DELETE FROM bookings WHERE id = $1', [booking.id]);
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

  await t.test('honeypot: stil doorsturen naar de bedanktpagina zonder op te slaan', async () => {
    const honeypot = await formFor(1001);
    honeypot.set('website', 'spam');
    clock += 5000;
    const response = await post(honeypot, { 'x-forwarded-for': '203.0.113.30' });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/bedankt-voor-je-aanmelding/');
    assert.equal((await db.query('SELECT COUNT(*)::int AS total FROM bookings'))[0].total, 1);
  });

  await t.test('te snel, verlopen of vals token: 422 met ingevulde waarden, melding en nieuw token', async () => {
    const ip = { 'x-forwarded-for': '203.0.113.31' };
    const forged = await formFor(1001);
    forged.set('token', `${clock - 10000}.vals`);
    const expired = await formFor(1001);
    clock += MAX_FILL_MS + 1000;
    const expiredResponse = await post(expired, ip);
    const quickForm = await formFor(1001);
    const quickResponse = await post(quickForm, ip);
    clock += 5000;
    const forgedResponse = await post(forged, ip);
    for (const [name, response, sent] of [['verlopen', expiredResponse, expired], ['te snel', quickResponse, quickForm], ['vals', forgedResponse, forged]]) {
      assert.equal(response.status, 422, name);
      assert.match(response.text, /Het formulier is verlopen of te snel verstuurd/, name);
      assert.match(response.text, /value="Anna Maria"/, `${name}: ingevulde waarden blijven staan`);
      const newToken = /name="token" value="([^"]+)"/.exec(response.text)[1];
      // Te snel: hetzelfde tijdstip geeft hetzelfde (geldige) token; verlopen en vals krijgen een nieuw token.
      if (name !== 'te snel') assert.notEqual(newToken, sent.get('token'), `${name}: nieuw token`);
    }
    assert.equal((await db.query('SELECT COUNT(*)::int AS total FROM bookings'))[0].total, 1);
    // Opnieuw versturen met het nieuwe token lukt.
    const retry = new URLSearchParams(forged);
    retry.set('token', /name="token" value="([^"]+)"/.exec(forgedResponse.text)[1]);
    clock += 5000;
    assert.equal((await post(retry, ip)).status, 303);
    assert.equal((await db.query('SELECT COUNT(*)::int AS total FROM bookings'))[0].total, 2);
    await db.query("DELETE FROM bookings WHERE reference = (SELECT reference FROM bookings ORDER BY created_at DESC LIMIT 1)");
  });

  await t.test('deelnemer onder de 16: ouder of voogd verplicht, vastgelegd in consents en een eigen blok (A02)', async () => {
    const ip = { 'x-forwarded-for': '203.0.113.60' };
    const day = today();
    // Precies 16 min één dag: nog 15, dus een ouder moet tekenen.
    const minorBirth = `${Number(day.slice(0, 4)) - 16}${day.slice(4)}`;
    const almost = new Date(`${minorBirth}T12:00:00Z`);
    almost.setUTCDate(almost.getUTCDate() + 1);
    const form = await formFor(1001);
    form.set('email', 'kind@example.nl');
    form.set('email_confirm', 'kind@example.nl');
    form.set('birth_date', almost.toISOString().slice(0, 10));
    clock += 5000;
    const refused = await post(form, ip);
    assert.equal(refused.status, 422);
    assert.match(refused.text, /data-guardian="16"/);
    assert.equal((refused.text.match(/Verplicht bij een deelnemer jonger dan 16 jaar/g) || []).length, 3, 'naam, relatie en e-mailadres');
    assert.match(refused.text, /Bij een deelnemer jonger dan 16 jaar geeft een ouder of voogd toestemming/);
    const before = (await db.query('SELECT count(*)::int AS total FROM bookings'))[0].total;
    assert.equal(before, 1, 'niets opgeslagen');

    const signed = await formFor(1001);
    for (const [name, value] of form) if (name !== 'token') signed.set(name, value);
    signed.set('guardian_name', 'Petra Jansen');
    signed.set('guardian_relation', 'ouder');
    signed.set('guardian_email', 'petra@example.nl');
    signed.set('guardian_phone', '0611112222');
    signed.set('consent_guardian', 'ja');
    clock += 5000;
    assert.equal((await post(signed, ip)).status, 303);
    const [booking] = await db.query('SELECT id, person_id FROM bookings ORDER BY id DESC LIMIT 1');
    const consents = await db.query('SELECT kind, given_by FROM consents WHERE booking_id = $1 ORDER BY kind', [booking.id]);
    assert.deepEqual(consents.map((row) => [row.kind, row.given_by]), [
      ['art9_gezondheid', 'ouder_voogd'], ['art9_religie', 'ouder_voogd'], ['ouder_voogd', 'ouder_voogd'], ['voorwaarden', 'ouder_voogd'],
    ]);
    const [person] = await db.query('SELECT id, guardian_data FROM persons WHERE id = $1', [booking.person_id]);
    assert.doesNotMatch(person.guardian_data, /Petra|petra@/, 'versleuteld');
    const persons = createPersons({ vault: createVault(MASTER_KEY) });
    assert.deepEqual(persons.openBlock('guardian_data', person), {
      guardian_name: 'Petra Jansen', guardian_relation: 'ouder', guardian_email: 'petra@example.nl', guardian_phone: '0611112222',
    });
    await db.query('DELETE FROM bookings WHERE id = $1', [booking.id]);
    await db.query('DELETE FROM persons WHERE id = $1', [person.id]);
  });

  await t.test('volwassene: oudervelden worden genegeerd en niet bewaard', async () => {
    const form = await formFor(1001);
    form.set('email', 'volwassen@example.nl');
    form.set('email_confirm', 'volwassen@example.nl');
    form.set('guardian_name', 'Niet nodig');
    form.set('guardian_email', 'geen-adres');
    form.set('consent_guardian', 'ja');
    clock += 5000;
    assert.equal((await post(form, { 'x-forwarded-for': '203.0.113.61' })).status, 303, 'een fout in een overbodig veld blokkeert niet');
    const [booking] = await db.query('SELECT id, person_id FROM bookings ORDER BY id DESC LIMIT 1');
    const consents = await db.query('SELECT kind, given_by FROM consents WHERE booking_id = $1', [booking.id]);
    assert.ok(consents.every((row) => row.given_by === 'deelnemer' && row.kind !== 'ouder_voogd'));
    const [person] = await db.query('SELECT id, guardian_data FROM persons WHERE id = $1', [booking.person_id]);
    assert.equal(person.guardian_data, null);
    await db.query('DELETE FROM bookings WHERE id = $1', [booking.id]);
    await db.query('DELETE FROM persons WHERE id = $1', [person.id]);
  });

  await t.test('aanmelden kan niet voor volle, vertrokken of onbekende reizen', async () => {
    assert.equal((await get('/aanmelden/?id=1002')).status, 409);
    assert.equal((await get('/aanmelden/?id=1003')).status, 409);
    assert.equal((await get('/aanmelden/?id=9999')).status, 404);
    // Zonder reis: de melding van de huidige site met de kop "Aanmelden" en een knop naar alle reizen.
    const none = await get('/aanmelden/');
    assert.equal(none.status, 200);
    assert.match(none.text, /<p class="page-header__pretitle">Ja! Ik ga graag mee op reis<\/p>/);
    assert.match(none.text, /<h2>Er is geen reis geselecteerd<\/h2>\s*<a class="btn page-introduction--small" href="\/reis\/">Naar alle reizen<\/a>/);
    assert.match((await get('/aanmelden/?id=1002')).text, /<h2>Deze reis is volgeboekt.<\/h2>/);
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

  /**
   * Haalt het contactformulier op en geeft de velden terug die een browser zou meesturen.
   * @param {string} [query] Querystring, bijvoorbeeld `?reis=8-dagen-albanie`.
   * @returns {Promise<URLSearchParams>} Formuliervelden.
   */
  const contactFormFor = async (query = '') => {
    const page = await get(`/contact/${query}`);
    assert.equal(page.status, 200);
    const token = /name="token" value="([^"]+)"/.exec(page.text)[1];
    const reis = /name="reis" value="([^"]+)"/.exec(page.text)?.[1];
    return new URLSearchParams({
      ...(reis ? { reis } : {}), token, website: '',
      name: 'Test Persoon', phone: '0612345678', email: 'Test@Example.nl', subject: '', message: 'Hallo,\nIk heb een vraag.', consent: 'ja',
    });
  };

  /**
   * Verstuurt het contactformulier.
   * @param {URLSearchParams} form Velden.
   * @param {object} [headers] Extra koppen.
   * @returns {Promise<{status: number, text: string, headers: Headers}>} Antwoord.
   */
  const postContact = (form, headers = {}) => get('/contact/', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'same-origin', ...headers },
    body: form.toString(),
  });

  /**
   * Aantal opgeslagen contactberichten.
   * @returns {Promise<number>} Aantal.
   */
  const contactCount = async () => (await db.query('SELECT COUNT(*)::int AS total FROM contact_messages'))[0].total;

  await t.test('contact: formulier staat onder de pagina-inhoud en een bericht wordt opgeslagen', async () => {
    const page = await get('/contact/');
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.ok(page.text.indexOf('Bel ons') < page.text.indexOf('<form class="form form--theme" method="post" action="/contact/"'));
    assert.match(page.text, /<div class="grid contact-extra-info">/);
    assert.match(page.text, /<h2 class="box__title" id="contact-titel">Verstuur bericht<\/h2>/);
    assert.match(page.text, /veelgestelde vragen<\/a>/);
    assert.match(page.text, /name="consent"/);
    assert.doesNotMatch(page.headers.get('content-security-policy'), /youtube-nocookie/, 'zonder video geen YouTube in frame-src');
    await db.query("UPDATE pages SET body_html = $1 WHERE path = '/contact/'", ['<p>Bel ons</p><p><a href="https://www.youtube.com/embed/el9qys7UK9A" rel="noopener" target="_blank">Bekijk de video</a></p>']);
    const withVideo = await get('/contact/');
    assert.match(withVideo.headers.get('content-security-policy'), /frame-src 'self' https:\/\/www\.youtube-nocookie\.com/, 'video op de contactpagina mag');
    assert.match(withVideo.text, /<iframe src="https:\/\/www\.youtube-nocookie\.com\/embed\/el9qys7UK9A"/);
    await db.query("UPDATE pages SET body_html = '<p>Bel ons</p>' WHERE path = '/contact/'");
    const form = await contactFormFor();
    clock += 5000;
    const response = await postContact(form);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/contact/?verzonden=1');
    assert.match((await get('/contact/?verzonden=1')).text, /Bedankt voor je bericht/);
    const [message] = await db.query('SELECT name, email, phone, subject, message, trip_slug, status, consent_at FROM contact_messages');
    assert.deepEqual(
      { name: message.name, email: message.email, phone: message.phone, subject: message.subject, message: message.message, trip: message.trip_slug, status: message.status },
      { name: 'Test Persoon', email: 'test@example.nl', phone: '0612345678', subject: '', message: 'Hallo,\nIk heb een vraag.', trip: null, status: 'nieuw' },
    );
    assert.ok(message.consent_at instanceof Date);
  });

  await t.test('contact: vanaf een reis wordt de reis bewaard; een onbekende reis niet', async () => {
    const form = await contactFormFor('?reis=8-dagen-albanie');
    assert.equal(form.get('reis'), '8-dagen-albanie');
    assert.match((await get('/contact/?reis=8-dagen-albanie')).text, /value="Vraag over 8 dagen Albanië"/);
    form.set('subject', 'Vraag over 8 dagen Albanië');
    clock += 5000;
    assert.equal((await postContact(form)).status, 303);
    const unknown = await contactFormFor();
    unknown.set('reis', 'bestaat-niet');
    clock += 5000;
    assert.equal((await postContact(unknown)).status, 303);
    const rows = await db.query('SELECT trip_slug, subject FROM contact_messages ORDER BY id DESC LIMIT 2');
    assert.deepEqual(rows.map((row) => row.trip_slug), [null, '8-dagen-albanie']);
    assert.equal(rows[1].subject, 'Vraag over 8 dagen Albanië');
  });

  await t.test('contact: fouten geven 422 met Nederlandse meldingen en bewaren niets', async () => {
    const before = await contactCount();
    const form = await contactFormFor();
    for (const name of ['name', 'message', 'consent']) form.delete(name);
    form.set('email', 'geen-adres');
    form.set('phone', 'abc');
    form.set('subject', '<script>x</script>');
    clock += 5000;
    const response = await postContact(form);
    assert.equal(response.status, 422);
    assert.match(response.text, /Controleer de gemarkeerde velden/);
    assert.equal((response.text.match(/Dit veld is verplicht\./g) || []).length, 2);
    assert.match(response.text, /Vul een geldig e-mailadres in\./);
    assert.match(response.text, /Vul een geldig telefoonnummer in\./);
    assert.match(response.text, /Ga akkoord met de privacyverklaring/);
    assert.doesNotMatch(response.text, /<script>x<\/script>/);
    assert.match(response.text, /value="&lt;script&gt;x&lt;\/script&gt;"/, 'ingevulde waarde blijft staan, ge-escaped');
    const tooLong = await contactFormFor();
    tooLong.set('message', 'x'.repeat(5001));
    clock += 5000;
    const long = await postContact(tooLong);
    assert.equal(long.status, 422);
    assert.match(long.text, /Maximaal 5000 tekens\./);
    assert.equal(await contactCount(), before);
  });

  await t.test('contact: NUL-tekens in de invoer geven geen 500', async () => {
    clock += 11 * 60 * 1000;
    const before = await contactCount();
    const form = await contactFormFor();
    form.set('message', 'Hallo\u0000wereld');
    form.set('name', 'Test\u0000 Persoon');
    clock += 5000;
    assert.equal((await postContact(form, { 'x-forwarded-for': '203.0.113.50' })).status, 303);
    const [row] = await db.query('SELECT name, message FROM contact_messages ORDER BY id DESC LIMIT 1');
    assert.deepEqual(row, { name: 'Test Persoon', message: 'Hallowereld' });
    assert.equal(await contactCount(), before + 1);
  });

  await t.test('contact: honeypot stil, ongeldig/verlopen/te snel token geeft 422 met waarden en nieuw token', async () => {
    clock += 11 * 60 * 1000; // nieuw limietvenster na de vorige tests
    const ip = { 'x-forwarded-for': '203.0.113.40' };
    const before = await contactCount();
    const honeypot = await contactFormFor();
    honeypot.set('website', 'spam');
    clock += 5000;
    assert.equal((await postContact(honeypot, ip)).headers.get('location'), '/contact/?verzonden=1');
    const expired = await contactFormFor();
    clock += MAX_FILL_MS + 1000;
    const quick = await contactFormFor();
    const forged = await contactFormFor();
    forged.set('token', `${clock - 10000}.vals`);
    const bookingToken = await formFor(1001);
    const crossForm = await contactFormFor();
    crossForm.set('token', bookingToken.get('token'));
    const responses = [['te snel', await postContact(quick, ip)]];
    clock += 5000;
    responses.push(['verlopen', await postContact(expired, ip)], ['vals', await postContact(forged, ip)]);
    clock += 11 * 60 * 1000;
    responses.push(['ander formulier', await postContact(crossForm, ip)]);
    for (const [name, response] of responses) {
      assert.equal(response.status, 422, name);
      assert.match(response.text, /Het formulier is verlopen of te snel verstuurd/, name);
      assert.match(response.text, /value="Test Persoon"/, `${name}: ingevulde waarden blijven staan`);
      assert.match(response.text, /name="token" value="[^"]+"/, `${name}: nieuw token`);
    }
    assert.equal(await contactCount(), before);
  });

  await t.test('contact: verzoek van een andere site wordt geweigerd', async () => {
    const before = await contactCount();
    const form = await contactFormFor();
    clock += 5000;
    assert.equal((await postContact(form, { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await postContact(form, { origin: 'https://kwaad.example' })).status, 403);
    assert.equal(await contactCount(), before);
  });

  await t.test('contact: limiet van 5 berichten per 10 minuten, daarna 429', async () => {
    clock += 11 * 60 * 1000;
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      const form = await contactFormFor();
      clock += 5000;
      statuses.push((await postContact(form)).status);
    }
    assert.deepEqual(statuses, [303, 303, 303, 303, 303, 429]);
    const limited = await postContact(await contactFormFor());
    assert.equal(limited.headers.get('retry-after'), '600');
    assert.match(limited.text, /Te veel berichten/);
  });

  await t.test('limiet per bezoeker achter een vertrouwde proxy (X-Forwarded-For)', async () => {
    const form = await formFor(1001);
    clock += 5000;
    assert.equal((await post(form, { 'x-forwarded-for': '203.0.113.9' })).status, 303);
  });

  await t.test('botsing op de referentie: opnieuw proberen, andere fout of drie botsingen geven 500', async () => {
    const before = (await db.query('SELECT COUNT(*)::int AS total FROM bookings'))[0].total;
    const attempt = async (count, constraint, ip) => {
      Object.assign(collisions, { count, constraint });
      const form = await formFor(1001);
      clock += 5000;
      const status = (await post(form, { 'x-forwarded-for': ip })).status;
      collisions.count = 0;
      return status;
    };
    assert.equal(await attempt(2, 'bookings_reference_key', '203.0.113.20'), 303);
    assert.equal(await attempt(1, 'bookings_andere_key', '203.0.113.21'), 500);
    assert.equal(await attempt(3, 'bookings_reference_key', '203.0.113.22'), 500);
    assert.equal((await db.query('SELECT COUNT(*)::int AS total FROM bookings'))[0].total, before + 1);
  });

  await t.test('referentiejaar volgt de Nederlandse datum, ook rond de jaarwisseling', async () => {
    clock = Date.UTC(2099, 11, 31, 23, 30);
    const form = await formFor(1001);
    clock += 5000;
    assert.equal((await post(form, { 'x-forwarded-for': '203.0.113.10' })).status, 303);
    const [booking] = await db.query("SELECT reference FROM bookings WHERE reference LIKE 'AV-2100-%'");
    assert.ok(booking, 'aanmelding om 00:30 Nederlandse tijd op 1 januari 2100 krijgt jaar 2100');
  });

  await t.test('alle plaatsen bezet: automatisch volgeboekt op de site, aanmelden geeft 409; geannuleerd telt niet', async () => {
    const form = await formFor(1001);
    clock += 5000;
    const [{ total }] = await db.query("SELECT COUNT(*)::int AS total FROM bookings WHERE trip_id = (SELECT id FROM trips WHERE legacy_id = 1001) AND status <> 'geannuleerd'");
    await db.query('UPDATE trips SET capacity = $1 WHERE legacy_id = 1001', [total]);
    const refused = await post(form, { 'x-forwarded-for': '203.0.113.30' });
    assert.equal(refused.status, 409);
    assert.match(refused.text, /Deze reis is volgeboekt/);
    assert.equal((await db.query('SELECT COUNT(*)::int AS total FROM bookings'))[0].total >= total, true);
    assert.equal((await db.query("SELECT COUNT(*)::int AS total FROM bookings WHERE trip_id = (SELECT id FROM trips WHERE legacy_id = 1001) AND status <> 'geannuleerd'"))[0].total, total, 'niets opgeslagen');
    assert.match((await get('/reis/8-dagen-albanie/')).text, /Volgeboekt/);
    // Eén aanmelding geannuleerd: er is weer een plaats vrij.
    await db.query("UPDATE bookings SET status = 'geannuleerd' WHERE id = (SELECT min(id) FROM bookings WHERE trip_id = (SELECT id FROM trips WHERE legacy_id = 1001))");
    assert.equal((await get('/aanmelden/?id=1001')).status, 200);
    // Twee aanmeldingen tegelijk voor de laatste plaats: precies één lukt.
    const first = await formFor(1001);
    const second = await formFor(1001);
    clock += 5000;
    const statuses = (await Promise.all([post(first, { 'x-forwarded-for': '203.0.113.31' }), post(second, { 'x-forwarded-for': '203.0.113.32' })])).map((response) => response.status).sort();
    assert.deepEqual(statuses, [303, 409]);
    assert.equal((await db.query("SELECT COUNT(*)::int AS total FROM bookings WHERE trip_id = (SELECT id FROM trips WHERE legacy_id = 1001) AND status <> 'geannuleerd'"))[0].total, total);
    await db.query('UPDATE trips SET capacity = NULL WHERE legacy_id = 1001');
  });
});
