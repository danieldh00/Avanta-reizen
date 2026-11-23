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
    reisleider: ['5', '9'], reisleider_1: '7', published: '1', body_html: '<p>Tekst<script>alert(1)</script></p>',
  });
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.values.slug, '20-dagen-namibie');
  assert.equal(ok.values.priceCents, 184900);
  assert.equal(ok.values.depositCents, 30000);
  assert.equal(ok.values.capacity, 16);
  assert.deepEqual(ok.values.categoryIds, [3, 7]);
  assert.deepEqual(ok.values.guideIds, [5], 'een reis heeft hoogstens één reisleider; het oude veld reisleider_1 telt niet meer');
  for (const empty of [undefined, '', 'x']) {
    assert.deepEqual(validateTrip({ title: 'Reis', price: '10', reisleider: empty }).values.guideIds, [], `geen reisleider bij ${empty}`);
  }
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
    reisleider: String(eva.id), ...extra,
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
    assert.deepEqual(guides.map((guide) => guide.guide_id), [eva.id]);
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

  await t.test('ook een concept hernoemen geeft een 301 (het kan eerder gepubliceerd zijn geweest)', async () => {
    assert.equal((await request(`/app/reizen/${tripId}/`, { cookie: kantoor.cookie, form: tripForm({ slug: 'tijdelijk' }) })).status, 303);
    assert.deepEqual(await db.query("SELECT from_path FROM redirects WHERE to_url = '/reis/tijdelijk/'"), [{ from_path: '/reis/20-dagen-namibie/' }]);
  });

  await t.test('publiceren: op de site met landen, reistype en beide reisleiders', async () => {
    const saved = await request(`/app/reizen/${tripId}/`, { cookie: kantoor.cookie, form: tripForm({ published: '1' }) });
    assert.equal(saved.status, 303);
    assert.match(saved.headers.get('location'), /opgeslagen=2/, 'bij publiceren wel een 301 van de vorige slug');
    const page = await request('/reis/20-dagen-namibie/');
    assert.equal(page.status, 200);
    assert.match(page.text, /Reisleider<\/dt><dd><a href="\/reisleider\/eva\/">Eva<\/a><\/dd>/);
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
    assert.equal(await audits('reis.gewijzigd'), 3);
  });

  await t.test('gepubliceerd, dan concept, dan hernoemd: het oude adres verwijst door', async () => {
    assert.equal((await request(`/app/reizen/${tripId}/`, { cookie: kantoor.cookie, form: tripForm({ slug: 'namibie-juni', published: '0' }) })).status, 303);
    assert.equal((await request(`/app/reizen/${tripId}/`, { cookie: kantoor.cookie, form: tripForm({ slug: 'namibie-juli', published: '0' }) })).status, 303);
    const old = await request('/reis/namibie-juni/');
    assert.equal(old.status, 301);
    assert.equal(old.headers.get('location'), '/reis/namibie-juli/');
    assert.equal((await request(`/app/reizen/${tripId}/`, { cookie: kantoor.cookie, form: tripForm({ slug: 'namibie-juni', published: '1' }) })).status, 303);
    assert.equal((await request('/reis/namibie-juni/')).status, 200, 'terug naar de oude slug: geen lus');
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

  /**
   * Voegt een aanmelding toe voor een reis.
   * @param {number} id Id van de reis.
   * @param {string} status Status van de aanmelding.
   * @returns {Promise<void>}
   */
  const addBooking = async (id, status) => {
    await db.query(
      `INSERT INTO bookings (reference, trip_id, trip_title, status, gender, first_names, call_name, last_name, email, mobile, street,
         postal_code, city, earlier_trip, credit_card, driver_interest, driver_before, payment_method, payment_choice, consent_at)
       VALUES ('AV-T-' || md5(random()::text), $1, 'Reis', $2, 'vrouw', 'A', 'A', 'B', 'a@example.nl', '0600000000', 'Straat 1',
         '1234 AB', 'Plaats', false, false, false, false, 'handmatig', 'aanbetaling', now())`,
      [id, status],
    );
  };

  await t.test('plaatsen: bezet uit de aanmeldingen, geannuleerd telt niet, vol is automatisch volgeboekt', async () => {
    for (let i = 0; i < 15; i++) await addBooking(tripId, i % 2 ? 'bevestigd' : 'nieuw');
    await addBooking(tripId, 'geannuleerd');
    let edit = await request(`/app/reizen/${tripId}/`, { cookie: kantoor.cookie });
    assert.match(edit.text, /15 aanmeldingen \(niet geannuleerd\) van 16 plaatsen, 1 vrij\./);
    assert.doesNotMatch(edit.text, /<strong>Volgeboekt<\/strong>/);
    assert.match(edit.text, new RegExp(`href="/app/aanmeldingen/\\?reis=${tripId}"`));
    assert.doesNotMatch((await request('/reis/namibie-juni/')).text, /Volgeboekt/);
    await addBooking(tripId, 'betaald');
    edit = await request(`/app/reizen/${tripId}/`, { cookie: kantoor.cookie });
    assert.match(edit.text, /16 aanmeldingen \(niet geannuleerd\) van 16 plaatsen, 0 vrij\.\s*<strong>Volgeboekt<\/strong> \(automatisch/);
    const list = await request('/app/reizen/', { cookie: kantoor.cookie });
    assert.match(list.text, /<td>16 van 16<\/td>\s*<td><span class="crm-status crm-status--vol">Volgeboekt<\/span><\/td>/);
    assert.match(list.text, /<td>0 aangemeld<\/td>/, 'zonder aantal plaatsen alleen het aantal aanmeldingen');
    assert.match((await request('/reis/namibie-juni/')).text, /Volgeboekt/);
    assert.equal((await request('/aanmelden/?reis=namibie-juni')).status, 409);
    const [row] = await db.query('SELECT fully_booked FROM trips WHERE id = $1', [tripId]);
    assert.equal(row.fully_booked, false, 'het vinkje zelf blijft uit');
  });

  await t.test('kopiëren naar nieuw vertrek: concept met alles behalve vertrek en aanmeldingen', async () => {
    const [photo] = await db.query(
      "INSERT INTO media (local_name, content_type, bytes, source, title, alt_text, variants) VALUES ('kop.webp', 'image/webp', 10, 'upload', 'Kop', '', '{}') RETURNING id",
    );
    await db.query("INSERT INTO trip_media (trip_id, media_id, role, sort_order) VALUES ($1, $2, 'kop', 0)", [tripId, photo.id]);
    await db.query("UPDATE trips SET hero_image_url = '/media/kop.webp', guaranteed = true, offer_until = '2099-01-01', old_price_cents = 199900, gallery_title = 'Beelden' WHERE id = $1", [tripId]);
    for (const session of [leider, redactie]) {
      assert.equal((await request(`/app/reizen/${tripId}/kopieren/`, { cookie: session.cookie, form: { _csrf: session.csrf } })).status, 403);
    }
    assert.equal((await request(`/app/reizen/${tripId}/kopieren/`, { cookie: kantoor.cookie, form: { _csrf: 'fout' } })).status, 403);
    assert.equal((await request('/app/reizen/999999/kopieren/', { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf } })).status, 404);
    assert.equal(await audits('reis.gekopieerd'), 0);

    const copied = await request(`/app/reizen/${tripId}/kopieren/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf } });
    assert.equal(copied.status, 303);
    const copyId = Number(/\/app\/reizen\/(\d+)\/\?opgeslagen=4$/.exec(copied.headers.get('location'))[1]);
    assert.notEqual(copyId, tripId);
    const [copy] = await db.query(
      `SELECT slug, title, trip_code, departure_date, published, guaranteed, fully_booked, offer_until, old_price_cents, price_cents,
              capacity, hero_image_url, gallery_title, managed_in_crm, legacy_id FROM trips WHERE id = $1`,
      [copyId],
    );
    assert.deepEqual({ ...copy }, {
      slug: 'namibie-juni-kopie', title: '20 dagen Namibië', trip_code: '27-NAM-1', departure_date: null, published: false, guaranteed: false,
      fully_booked: false, offer_until: null, old_price_cents: null, price_cents: 184900, capacity: 16, hero_image_url: '/media/kop.webp',
      gallery_title: 'Beelden', managed_in_crm: true, legacy_id: null,
    });
    const linksOf = async (id) => (await db.query('SELECT category_id FROM trip_category_links WHERE trip_id = $1 ORDER BY category_id', [id])).map((row) => row.category_id);
    assert.deepEqual(await linksOf(copyId), await linksOf(tripId));
    const guidesOf = async (id) => (await db.query('SELECT guide_id FROM trip_guides WHERE trip_id = $1 ORDER BY sort_order', [id])).map((row) => row.guide_id);
    assert.deepEqual(await guidesOf(copyId), [eva.id]);
    assert.deepEqual(await db.query('SELECT media_id, role FROM trip_media WHERE trip_id = $1', [copyId]), [{ media_id: photo.id, role: 'kop' }]);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM bookings WHERE trip_id = $1', [copyId]))[0].count, 0);

    const edit = await request(`/app/reizen/${copyId}/?opgeslagen=4`, { cookie: kantoor.cookie });
    assert.equal(edit.status, 200);
    assert.match(edit.text, /Dit is een kopie als concept/);
    assert.match(edit.text, /0 aanmeldingen \(niet geannuleerd\) van 16 plaatsen, 16 vrij\./);
    assert.equal((await request('/reis/namibie-juni-kopie/')).status, 404, 'kopie is een concept');

    // Een tweede kopie krijgt een eigen slug; een oud adres in de doorverwijzingen telt ook als bezet.
    await db.query("INSERT INTO redirects (from_path, to_url, status) VALUES ('/reis/namibie-juni-kopie-2/', '/reis/', 301)");
    const second = await request(`/app/reizen/${tripId}/kopieren/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf } });
    const secondId = Number(/\/app\/reizen\/(\d+)\//.exec(second.headers.get('location'))[1]);
    assert.equal((await db.query('SELECT slug FROM trips WHERE id = $1', [secondId]))[0].slug, 'namibie-juni-kopie-3');
    // Twee kopieën tegelijk (dubbelklik): beide lukken, elk met een eigen slug.
    const both = await Promise.all([1, 2].map(() => request(`/app/reizen/${tripId}/kopieren/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf } })));
    assert.deepEqual(both.map((response) => response.status), [303, 303]);
    const slugs = await db.query("SELECT slug FROM trips WHERE slug IN ('namibie-juni-kopie-4', 'namibie-juni-kopie-5') ORDER BY slug");
    assert.equal(slugs.length, 2);
    assert.equal(await audits('reis.gekopieerd'), 4);
    const [entry] = await db.query("SELECT entity_id FROM audit_log WHERE action = 'reis.gekopieerd' ORDER BY id LIMIT 1");
    assert.equal(entry.entity_id, String(copyId));
    // Een oude reis met twee reisleiders: kopiëren neemt alleen de eerste mee, opslaan laat alleen de gekozen over,
    // en zonder keuze verdwijnt de koppeling.
    await db.query('INSERT INTO trip_guides (trip_id, guide_id, sort_order) VALUES ($1, $2, 5)', [tripId, martijn.id]);
    assert.deepEqual(await guidesOf(tripId), [eva.id, martijn.id]);
    const oneGuide = await request(`/app/reizen/${tripId}/kopieren/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf } });
    assert.equal(oneGuide.status, 303);
    const oneGuideId = Number(oneGuide.headers.get('location').match(/\/app\/reizen\/(\d+)\//)[1]);
    assert.deepEqual(await guidesOf(oneGuideId), [eva.id], 'alleen de eerste reisleider gaat mee');
    const [current] = await db.query('SELECT slug, published FROM trips WHERE id = $1', [tripId]);
    const keep = { slug: current.slug, published: current.published ? '1' : '0' };
    assert.equal((await request(`/app/reizen/${tripId}/`, { cookie: kantoor.cookie, form: tripForm({ ...keep, reisleider: String(martijn.id) }) })).status, 303);
    assert.deepEqual(await guidesOf(tripId), [martijn.id], 'na opslaan alleen de gekozen reisleider');
    assert.equal((await request(`/app/reizen/${tripId}/`, { cookie: kantoor.cookie, form: tripForm({ ...keep, reisleider: '' }) })).status, 303);
    assert.deepEqual(await guidesOf(tripId), [], 'zonder keuze geen reisleider');

    // Vertrekdatum invullen en publiceren: dan staat de kopie op de site.
    const saved = await request(`/app/reizen/${copyId}/`, { cookie: kantoor.cookie, form: tripForm({ slug: 'namibie-augustus', departure_date: '2099-08-01', published: '1' }) });
    assert.equal(saved.status, 303);
    assert.equal((await request('/reis/namibie-augustus/')).status, 200);
  });
});
