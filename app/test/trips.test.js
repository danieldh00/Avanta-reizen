/**
 * Tests voor reizen beheren (CMS-pakket G2, migratie 15): bedragen en velden controleren, en de routes onder
 * `/app/reizen/`: rechten (zonder sessie naar inloggen, zonder recht 403), aanmaken als concept (niet op de site),
 * publiceren met meerdere landen, reistypes en reisleiders, dubbele slug, wijzigen met automatische 301, opgeschoonde
 * HTML, onbekende categorieën genegeerd, onbekend id → 404, CSRF, filters van de lijst, de auditlog en dat de
 * WordPress-import een in het CRM gewijzigde reis overslaat. Draait in een eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { hashPassword } = require('../src/crm/passwords');
const { COOKIE_NAME } = require('../src/crm/auth');
const { parseEuros, eurosText, validateTrip, isDate } = require('../src/trips/trips');
const { store } = require('../tools/import-wordpress');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'trips_test';
const MASTER_KEY = Buffer.alloc(32, 31);
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

test('bedragen lezen en tonen', () => {
  assert.deepEqual(parseEuros('1849'), { cents: 184900, ok: true });
  assert.deepEqual(parseEuros('€ 1.849,50'), { cents: 184950, ok: true });
  assert.deepEqual(parseEuros('1849,-'), { cents: 184900, ok: true });
  assert.deepEqual(parseEuros('799,5'), { cents: 79950, ok: true });
  assert.deepEqual(parseEuros(''), { cents: null, ok: true });
  assert.equal(parseEuros('-5').ok, false);
  assert.equal(parseEuros('12.5').ok, false);
  assert.equal(parseEuros('100001').ok, false);
  assert.equal(parseEuros('1e5').ok, false);
  assert.equal(eurosText(184900), '1849');
  assert.equal(eurosText(79950), '799,50');
  assert.equal(eurosText(null), '');
  assert.equal(isDate('2027-02-29'), false);
  assert.equal(isDate('2028-02-29'), true);
});

test('velden van een reis controleren', () => {
  const ok = validateTrip({
    title: ' 20 dagen Namibië ', departure_date: '2027-06-01', price: '1849', deposit: '300', capacity: '16', categorie: ['3', '3', 'x', '7'],
    reisleider_1: '5', reisleider_2: '5', reisleider_3: '9', published: '1', body_html: '<p>Tekst<script>alert(1)</script></p>',
  });
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.values.slug, '20-dagen-namibie');
  assert.equal(ok.values.priceCents, 184900);
  assert.equal(ok.values.depositCents, 30000);
  assert.equal(ok.values.capacity, 16);
  assert.deepEqual(ok.values.categoryIds, [3, 7]);
  assert.deepEqual(ok.values.guideIds, [5, 9], 'dubbele reisleider valt weg, volgorde blijft');
  assert.equal(ok.values.published, true);
  assert.equal(ok.values.bodyHtml, '<p>Tekst</p>');
  const bad = validateTrip({ title: '', slug: 'fout!', departure_date: '2027-13-01', price: 'gratis', capacity: '-1', duration_days: '0', offer_until: 'morgen' });
  assert.deepEqual(Object.keys(bad.errors).sort(), ['capacity', 'departure_date', 'duration_days', 'offer_until', 'price', 'slug', 'title']);
});

test('reizen in het CRM', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
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
  for (const [email, role] of [['kantoor@example.nl', 'kantoor'], ['leider@example.nl', 'reisleider'], ['redactie@example.nl', 'redacteur']]) {
    await db.query('INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)', [email, role, role, hash]);
  }
  const [namibia] = await db.query("INSERT INTO trip_categories (slug, name, kind) VALUES ('namibie', 'Namibië', 'bestemming') RETURNING id");
  const [botswana] = await db.query("INSERT INTO trip_categories (slug, name, kind) VALUES ('botswana', 'Botswana', 'bestemming') RETURNING id");
  const [camping] = await db.query("INSERT INTO trip_categories (slug, name, kind) VALUES ('kamperen', 'Kampeerreizen', 'type') RETURNING id");
  const [martijn] = await db.query("INSERT INTO guides (slug, name) VALUES ('martijn', 'Martijn') RETURNING id");
  const [eva] = await db.query("INSERT INTO guides (slug, name) VALUES ('eva', 'Eva') RETURNING id");
  const [imported] = await db.query("INSERT INTO trips (legacy_id, slug, title, departure_date) VALUES (293, 'oude-reis', 'Oude reis', '2099-01-01') RETURNING id");

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
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(init.form)) for (const item of [].concat(value)) params.append(key, item);
      body = params.toString();
    }
    const response = await fetch(base + url, { method: body !== undefined ? 'POST' : 'GET', headers, body, redirect: 'manual' });
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
  const redactie = await login('redactie@example.nl');
  const audits = async (action) => (await db.query('SELECT count(*)::int AS count FROM audit_log WHERE action = $1', [action]))[0].count;
  const tripForm = (extra) => ({
    _csrf: kantoor.csrf, title: '20 dagen Namibië', slug: '', trip_code: '27-NAM-1', departure_date: '2099-06-01', price: '1849',
    deposit: '300', capacity: '16', published: '0', categorie: [String(namibia.id), String(botswana.id), String(camping.id), '999999'],
    reisleider_1: String(eva.id), reisleider_2: String(martijn.id), ...extra,
  });
  let tripId;

  await t.test('rechten: zonder sessie naar inloggen, reisleider en redacteur 403, kantoor wel', async () => {
    assert.equal((await request('/app/reizen/')).status, 303);
    for (const session of [leider, redactie]) {
      assert.equal((await request('/app/reizen/', { cookie: session.cookie })).status, 403);
      assert.equal((await request('/app/reizen/nieuw/', { cookie: session.cookie, form: { ...tripForm(), _csrf: session.csrf } })).status, 403);
      assert.equal((await request(`/app/reizen/${imported.id}/`, { cookie: session.cookie })).status, 403);
      assert.equal((await request(`/app/reizen/${imported.id}/`, { cookie: session.cookie, form: { ...tripForm(), _csrf: session.csrf } })).status, 403);
    }
    const list = await request('/app/reizen/', { cookie: kantoor.cookie });
    assert.equal(list.status, 200);
    assert.match(list.text, /href="\/app\/reizen\/"/);
    assert.match(list.text, />Oude reis</);
  });

  await t.test('aanmaken als concept: alle velden, niet op de site', async () => {
    const created = await request('/app/reizen/nieuw/', { cookie: kantoor.cookie, form: tripForm({ body_html: '<p onclick="x()">Safari</p><script>alert(1)</script>' }) });
    assert.equal(created.status, 303);
    const [row] = await db.query("SELECT id, slug, price_cents, deposit_cents, capacity, published, managed_in_crm, body_html FROM trips WHERE trip_code = '27-NAM-1'");
    tripId = row.id;
    assert.equal(row.slug, '20-dagen-namibie');
    assert.equal(row.price_cents, 184900);
    assert.equal(row.deposit_cents, 30000);
    assert.equal(row.capacity, 16);
    assert.equal(row.published, false);
    assert.equal(row.managed_in_crm, true);
    assert.equal(row.body_html, '<p>Safari</p>');
    const links = await db.query('SELECT category_id FROM trip_category_links WHERE trip_id = $1 ORDER BY category_id', [tripId]);
    assert.deepEqual(links.map((link) => link.category_id), [namibia.id, botswana.id, camping.id].sort((a, b) => a - b), 'onbekende categorie genegeerd');
    const guides = await db.query('SELECT guide_id FROM trip_guides WHERE trip_id = $1 ORDER BY sort_order', [tripId]);
    assert.deepEqual(guides.map((guide) => guide.guide_id), [eva.id, martijn.id]);
    assert.equal((await request('/reis/20-dagen-namibie/')).status, 404, 'concept niet op de site');
    const concepts = await request('/app/reizen/?status=concept', { cookie: kantoor.cookie });
    assert.match(concepts.text, />20 dagen Namibië</);
    assert.doesNotMatch(concepts.text, />Oude reis</);
    assert.equal(await audits('reis.aangemaakt'), 1);
  });

  await t.test('fouten: verplichte velden, dubbele slug, onbekend id, CSRF', async () => {
    const invalid = await request('/app/reizen/nieuw/', { cookie: kantoor.cookie, form: tripForm({ title: '', price: 'veel' }) });
    assert.equal(invalid.status, 422);
    assert.match(invalid.text, /Vul een titel in/);
    assert.match(invalid.text, /value="veel"/, 'ingevulde waarden blijven staan');
    assert.equal((await request('/app/reizen/nieuw/', { cookie: kantoor.cookie, form: tripForm({ slug: 'oude-reis' }) })).status, 422);
    assert.equal((await request('/app/reizen/999999/', { cookie: kantoor.cookie })).status, 404);
    assert.equal((await request('/app/reizen/999999/', { cookie: kantoor.cookie, form: tripForm() })).status, 404);
    assert.equal((await request(`/app/reizen/${tripId}/`, { cookie: kantoor.cookie, form: tripForm({ _csrf: 'fout' }) })).status, 403);
  });

  await t.test('publiceren: op de site met landen, reistype en beide reisleiders', async () => {
    const saved = await request(`/app/reizen/${tripId}/`, { cookie: kantoor.cookie, form: tripForm({ published: '1' }) });
    assert.equal(saved.status, 303);
    assert.match(saved.headers.get('location'), /opgeslagen=1/);
    const page = await request('/reis/20-dagen-namibie/');
    assert.equal(page.status, 200);
    assert.match(page.text, /Reisleiders<\/dt><dd><a href="\/reisleider\/eva\/">Eva<\/a>, <a href="\/reisleider\/martijn\/">Martijn<\/a>/);
    assert.match(page.text, /Botswana<\/a>, <a href="\/reis-categorie\/namibie\/">Namibië/);
    assert.match(page.text, /\/aanmelden\/\?id=&reis=20-dagen-namibie/);
    // Zoeken op een land vindt de reis (landen komen nu uit de koppeltabel).
    assert.match((await request('/zoeken/?s=Botswana')).text, /20 dagen Namibië/);
    assert.match((await request('/reisleider/eva/')).text, /20 dagen Namibië/);
    const edit = await request(`/app/reizen/${tripId}/`, { cookie: kantoor.cookie });
    assert.match(edit.text, /name="price" type="text" value="1849"/);
    assert.match(edit.text, new RegExp(`<option value="${eva.id}" selected>Eva`));
  });

  await t.test('wijzigen: andere slug geeft een 301', async () => {
    const saved = await request(`/app/reizen/${tripId}/`, { cookie: kantoor.cookie, form: tripForm({ published: '1', slug: 'namibie-juni' }) });
    assert.match(saved.headers.get('location'), /opgeslagen=2/);
    const old = await request('/reis/20-dagen-namibie/');
    assert.equal(old.status, 301);
    assert.equal(old.headers.get('location'), '/reis/namibie-juni/');
    assert.equal((await request('/reis/namibie-juni/')).status, 200);
    assert.equal(await audits('reis.gewijzigd'), 2);
  });

  await t.test('import slaat een in het CRM gewijzigde reis over', async () => {
    await request(`/app/reizen/${imported.id}/`, { cookie: kantoor.cookie, form: tripForm({ title: 'Oude reis, nieuw', slug: 'oude-reis', trip_code: '' }) });
    const importTrip = (slug, title) => ({
      legacyId: null, slug, title, tagline: '', summary: '', bodyHtml: '', tripCode: null, departureDate: '2099-01-01', durationLabel: '',
      durationDays: null, priceCents: null, oldPriceCents: null, offerUntil: null, extraCostsCents: null, statusLabel: '', guaranteed: false,
      fullyBooked: false, isNew: false, heroImageUrl: null, cardImageUrl: null, gallery: [], galleryTitle: '', gallerySubtitle: '',
      guideRef: 'martijn', categorySlugs: ['kamperen'],
    });
    await store(db, { guides: [{ legacyId: null, slug: 'martijn', name: 'Martijn', intro: '', bodyHtml: '', photoUrl: null }], categories: [], trips: [importTrip('oude-reis', 'Overschreven'), importTrip('nieuwe-import', 'Nieuw uit de import')], posts: [], pages: [], faqs: [] });
    const [kept] = await db.query("SELECT title FROM trips WHERE slug = 'oude-reis'");
    assert.equal(kept.title, 'Oude reis, nieuw');
    assert.equal((await db.query('SELECT count(*)::int AS count FROM trip_category_links WHERE trip_id = $1', [imported.id]))[0].count, 3, 'koppelingen ongemoeid');
    const [fresh] = await db.query("SELECT t.title, g.slug FROM trips t JOIN trip_guides tg ON tg.trip_id = t.id JOIN guides g ON g.id = tg.guide_id WHERE t.slug = 'nieuwe-import'");
    assert.deepEqual(fresh, { title: 'Nieuw uit de import', slug: 'martijn' });
  });
});
