/**
 * Tests voor reisleiders beheren in het CRM (pakket I4, migratie 22): velden controleren (zonder database), de extra
 * gegevens voor de site (bestand of database), en de routes onder `/app/reisleiders/`: rechten (zonder sessie naar
 * inloggen, redacteur en boekhouding 403, kantoor wel), onbekend id → 404, CSRF, het profiel (gegevens uit
 * `site-content.json` gaan bij de eerste wijziging mee), adres wijzigen met 301, portret uit de bibliotheek,
 * online/offline, nieuw en verwijderen (alleen offline, niet uit de import, zonder reizen), de auditlog en de
 * WordPress-import die een reisleider uit het CRM laat staan. Draait in een eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { hashPassword } = require('../src/crm/passwords');
const { COOKIE_NAME } = require('../src/crm/auth');
const { validateGuideFields, arrangedPositions, galleryFingerprint, GUIDE_LIMITS } = require('../src/trips/guides');
const { normalizeSiteContent, guideExtra } = require('../src/site/site-content');
const { store } = require('../tools/import-wordpress');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'cms_guides_test';
const MASTER_KEY = Buffer.alloc(32, 34);
const PASSWORD = 'een heel goed wachtwoord';

/** Gegevens van de huidige site voor reisleider Martijn. */
const FIXED = {
  guides: {
    martijn: {
      surname: 'de Vries', city: 'Goes', since: '2012', quote: 'Samen op pad', portrait: '/media/martijn-portret.jpg',
      image: '/media/martijn-tweede.jpg', galleryTitle: 'Onderweg', gallery: ['/media/martijn-galerij.jpg'],
    },
  },
};

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

test('reisleiders: velden en de gegevens voor de site (zonder database)', () => {
  const good = validateGuideFields({ name: ' Martijn ', surname: 'de  Vries', slug: '', since: '2012', city: 'Goes', quote: 'Q', intro: 'Hallo\r\nwereld', body: '<p>Tekst<script>x()</script></p>' });
  assert.deepEqual(good.errors, {});
  assert.equal(good.values.slug, 'martijn');
  assert.equal(good.values.surname, 'de Vries');
  assert.equal(good.values.intro, 'Hallo\nwereld');
  assert.doesNotMatch(good.values.bodyHtml, /script/);
  const bad = validateGuideFields({ name: '', slug: 'Fout Adres', since: '1850', intro: 'x'.repeat(GUIDE_LIMITS.intro + 1), body: 'x'.repeat(GUIDE_LIMITS.body + 1), city: 'x'.repeat(GUIDE_LIMITS.city + 1) });
  assert.deepEqual(Object.keys(bad.errors).sort(), ['body', 'city', 'intro', 'name', 'since', 'slug']);
  assert.ok(validateGuideFields({ name: ['lijst'] }).errors.name, 'geen lijst');

  const guides = normalizeSiteContent(FIXED).guides;
  assert.equal(guideExtra({ slug: 'martijn', managed_in_crm: false }, guides).city, 'Goes', 'nog uit het bestand');
  const managed = guideExtra({ slug: 'martijn', managed_in_crm: true, surname: 'Jansen', city: '', since: '', quote: '', image_url: null }, guides);
  assert.deepEqual([managed.surname, managed.city, managed.portrait, managed.image, managed.gallery], ['Jansen', '', '', '', []], 'uit de database, ook de galerij');
  const withGallery = guideExtra({ slug: 'martijn', managed_in_crm: true, gallery: [{ url: '/media/a.jpg', alt: 'A' }], gallery_title: 'T', gallery_subtitle: 'S' }, guides);
  assert.deepEqual([withGallery.galleryTitle, withGallery.gallerySubtitle, withGallery.gallery], ['T', 'S', [{ url: '/media/a.jpg', alt: 'A' }]]);

  assert.deepEqual(arrangedPositions({ volgorde_0: '3', volgorde_1: '1', volgorde_2: 'x', weg: '3' }, 4), [1, 0, 2], 'nummers, foute nummers houden hun plek, weghalen');
  assert.deepEqual(arrangedPositions({ weg: ['0', '1'] }, 2), []);
  assert.equal(galleryFingerprint([{ url: '/a' }]), galleryFingerprint([{ url: '/a', alt: 'x' }]), 'alleen de adressen tellen');
  assert.notEqual(galleryFingerprint([{ url: '/a' }, { url: '/b' }]), galleryFingerprint([{ url: '/b' }, { url: '/a' }]));
  assert.equal(validateGuideFields({ name: 'A', sort_order: '12' }).values.sortOrder, 12);
  assert.equal(validateGuideFields({ name: 'A' }).values.sortOrder, null, 'leeg = ongewijzigd');
  assert.ok(validateGuideFields({ name: 'A', sort_order: '1.5' }).errors.sort_order);
});

test('reisleiders in het CRM', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (testContext) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'avanta-guides-'));
  const mediaDir = path.join(dataDir, 'media');
  await fs.mkdir(mediaDir);
  const siteContent = { load: () => normalizeSiteContent(FIXED) };
  const app = createApp({ db, masterKey: MASTER_KEY, mediaDir, siteContent });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  testContext.after(async () => { server.close(); await db.close(); await fs.rm(dataDir, { recursive: true, force: true }); });

  const hash = await hashPassword(PASSWORD);
  for (const [email, role] of [['kantoor@example.nl', 'kantoor'], ['redactie@example.nl', 'redacteur'], ['boekhouding@example.nl', 'boekhouding']]) {
    await db.query('INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)', [email, role, role, hash]);
  }
  const [martijn] = await db.query("INSERT INTO guides (legacy_id, slug, name, intro, body_html, photo_url) VALUES (77, 'martijn', 'Martijn', 'Reisleider', '<p>Oud</p>', '/media/import-martijn.jpg') RETURNING id");
  const [trip] = await db.query("INSERT INTO trips (slug, title, departure_date, published) VALUES ('noorwegen', 'Noorwegen', '2099-07-01', true) RETURNING id");
  await db.query('INSERT INTO trip_guides (trip_id, guide_id) VALUES ($1, $2)', [trip.id, martijn.id]);
  const [photo] = await db.query(
    `INSERT INTO media (original_url, local_name, content_type, bytes, source, title, alt_text, variants)
     VALUES (NULL, 'bib-00000000000000ee-1600.webp', 'image/webp', 10, 'upload', 'Portret', 'Martijn', '{"400": "bib-00000000000000ee-400.webp", "800": "bib-00000000000000ee-800.webp", "1600": "bib-00000000000000ee-1600.webp"}') RETURNING id`,
  );

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
      body = new URLSearchParams(init.form).toString();
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
  const redactie = await login('redactie@example.nl');
  const boekhouding = await login('boekhouding@example.nl');
  const post = (url, form, session = kantoor) => request(url, { cookie: session.cookie, form: { _csrf: session.csrf, ...form } });
  const audits = async (action) => (await db.query('SELECT count(*)::int AS count FROM audit_log WHERE action = $1', [action]))[0].count;
  const url = `/app/reisleiders/${martijn.id}/`;
  const profile = { name: 'Martijn', surname: 'de Vries', slug: 'martijn', city: 'Middelburg', since: '2012', quote: 'Samen op pad', intro: 'Reisleider', body: '<p>Nieuw verhaal</p>' };

  await testContext.test('rechten: zonder sessie naar inloggen, redacteur en boekhouding 403, kantoor wel; menu en 404', async () => {
    assert.equal((await request('/app/reisleiders/')).status, 303);
    for (const session of [redactie, boekhouding]) {
      assert.equal((await request('/app/reisleiders/', { cookie: session.cookie })).status, 403);
      assert.equal((await request(url, { cookie: session.cookie })).status, 403);
      assert.equal((await request(`${url}foto/portret/`, { cookie: session.cookie })).status, 403);
      assert.equal((await post(url, profile, session)).status, 403);
      assert.equal((await post(`${url}online/`, { stand: 'offline' }, session)).status, 403);
      assert.equal((await post(`${url}foto/portret/`, { media_id: String(photo.id) }, session)).status, 403);
      assert.equal((await post(`${url}verwijderen/`, { zeker: 'ja' }, session)).status, 403);
      assert.equal((await post('/app/reisleiders/nieuw/', { name: 'X' }, session)).status, 403);
    }
    const list = await request('/app/reisleiders/?q=mart', { cookie: kantoor.cookie });
    assert.equal(list.status, 200);
    assert.match(list.text, /href="\/app\/reisleiders\/" aria-current="page"/);
    assert.match(list.text, />Martijn</);
    assert.doesNotMatch((await request('/app/reisleiders/?q=zzz', { cookie: kantoor.cookie })).text, />Martijn</);
    assert.equal((await request('/app/reisleiders/999999/', { cookie: kantoor.cookie })).status, 404);
    assert.equal((await request('/app/reisleiders/999999/foto/portret/', { cookie: kantoor.cookie })).status, 404);
    assert.equal((await request(`${url}foto/anders/`, { cookie: kantoor.cookie })).status, 404, 'onbekende soort foto');
    assert.equal((await post('/app/reisleiders/999999/', profile)).status, 404);
    assert.equal((await request(url, { cookie: kantoor.cookie, form: { _csrf: 'fout', ...profile } })).status, 403, 'CSRF');
  });

  await testContext.test('profiel: eerst de gegevens van de huidige site, bij opslaan beheerd in het CRM', async () => {
    const edit = await request(url, { cookie: kantoor.cookie });
    assert.match(edit.text, /value="Goes"/, 'woonplaats uit site-content.json in het formulier');
    assert.match(edit.text, /martijn-portret\.jpg/);
    assert.match((await request('/reisleider/martijn/')).text, /Goes/);

    assert.equal((await post(url, { ...profile, since: '1850' })).status, 422);
    assert.equal((await post(url, profile)).status, 303);
    const [row] = await db.query('SELECT surname, city, since, quote, photo_url, image_url, body_html, managed_in_crm FROM guides WHERE id = $1', [martijn.id]);
    assert.deepEqual(row, { surname: 'de Vries', city: 'Middelburg', since: '2012', quote: 'Samen op pad', photo_url: '/media/martijn-portret.jpg', image_url: '/media/martijn-tweede.jpg', body_html: '<p>Nieuw verhaal</p>', managed_in_crm: true });
    const site = (await request('/reisleider/martijn/')).text;
    assert.match(site, /Middelburg/);
    assert.doesNotMatch(site, /Goes/);
    assert.match(site, /martijn-portret\.jpg/, 'portret overgenomen');
    assert.match(site, /martijn-galerij\.jpg/, 'galerij nog uit het bestand');
    assert.match(site, /Nieuw verhaal/);
  });

  await testContext.test('portret uit de bibliotheek, adres wijzigen met 301, offline en online', async () => {
    assert.match((await request(`${url}foto/portret/`, { cookie: kantoor.cookie })).text, /bib-00000000000000ee-400\.webp/);
    assert.equal((await post(`${url}foto/portret/`, {})).status, 422);
    assert.equal((await post(`${url}foto/portret/`, { media_id: '999999' })).status, 409);
    assert.equal((await post(`${url}foto/portret/`, { media_id: String(photo.id) })).status, 303);
    const [{ photo_url: portrait }] = await db.query('SELECT photo_url FROM guides WHERE id = $1', [martijn.id]);
    assert.match(portrait, /^\/media\/bib-00000000000000ee-\d+\.webp$/);
    assert.equal((await post(`${url}foto/kopfoto/`, { geen: '1' })).status, 303);
    assert.equal((await db.query('SELECT image_url FROM guides WHERE id = $1', [martijn.id]))[0].image_url, null);

    const moved = await post(url, { ...profile, slug: 'martijn-de-vries' });
    assert.equal(moved.headers.get('location'), `${url}?opgeslagen=2#profiel`);
    const old = await request('/reisleider/martijn/');
    assert.equal(old.status, 301);
    assert.equal(old.headers.get('location'), '/reisleider/martijn-de-vries/');
    assert.equal((await request('/reisleider/martijn-de-vries/')).status, 200);

    assert.equal((await post(`${url}online/`, { stand: 'x' })).status, 422);
    assert.equal((await post(`${url}online/`, { stand: 'offline' })).status, 303);
    assert.equal((await request('/reisleider/martijn-de-vries/')).status, 404);
    assert.doesNotMatch((await request('/reisleider/')).text, /Martijn/);
    assert.equal((await post(`${url}verwijderen/`, { zeker: 'ja' })).status, 409, 'uit de import');
    assert.equal((await post(`${url}online/`, { stand: 'online' })).status, 303);
    assert.equal((await post(`${url}verwijderen/`, { zeker: 'ja' })).status, 409, 'online');
  });

  await testContext.test('galerij en volgorde: overgenomen uit het bestand, fotos toevoegen, ordenen, weghalen en tekst', async () => {
    const edit = await request(url, { cookie: kantoor.cookie });
    assert.match(edit.text, /martijn-galerij\.jpg/, 'galerij uit het bestand staat in het scherm');
    const fingerprint = (edit.text.match(/name="galerij" value="([^"]+)"/) || [])[1];
    assert.ok(fingerprint);
    for (const session of [redactie, boekhouding]) {
      assert.equal((await request(`${url}galerij/toevoegen/`, { cookie: session.cookie })).status, 403);
      assert.equal((await post(`${url}galerij/toevoegen/`, { media_id: String(photo.id) }, session)).status, 403);
      assert.equal((await post(`${url}galerij/`, { galerij: fingerprint }, session)).status, 403);
      assert.equal((await post(`${url}galerij/tekst/`, { gallery_title: 'X' }, session)).status, 403);
    }
    assert.equal((await request('/app/reisleiders/999999/galerij/toevoegen/', { cookie: kantoor.cookie })).status, 404);
    assert.equal((await post('/app/reisleiders/999999/galerij/', { galerij: fingerprint })).status, 404);
    assert.equal((await post('/app/reisleiders/999999/galerij/tekst/', {})).status, 404);
    assert.equal((await post('/app/reisleiders/999999/galerij/toevoegen/', { media_id: String(photo.id) })).status, 404);

    assert.match((await request(`${url}galerij/toevoegen/`, { cookie: kantoor.cookie })).text, /type="checkbox" name="media_id"/);
    assert.equal((await post(`${url}galerij/toevoegen/`, {})).status, 422);
    assert.equal((await post(`${url}galerij/toevoegen/`, { media_id: '999999' })).status, 409);
    assert.equal((await post(`${url}galerij/toevoegen/`, { media_id: String(photo.id) })).status, 303);
    assert.equal((await post(`${url}galerij/toevoegen/`, { media_id: String(photo.id) })).status, 303, 'dezelfde foto niet dubbel');
    let [row] = await db.query('SELECT gallery, gallery_title FROM guides WHERE id = $1', [martijn.id]);
    assert.deepEqual(row.gallery.map((item) => item.url), ['/media/martijn-galerij.jpg', '/media/bib-00000000000000ee-1600.webp']);
    assert.equal(row.gallery_title, 'Onderweg', 'titel uit het bestand');

    assert.equal((await post(`${url}galerij/`, { galerij: fingerprint, volgorde_0: '2', volgorde_1: '1' })).status, 409, 'oude stand');
    const current = (await request(url, { cookie: kantoor.cookie })).text.match(/name="galerij" value="([^"]+)"/)[1];
    assert.equal((await post(`${url}galerij/`, { galerij: current, volgorde_0: '2', volgorde_1: '1' })).status, 303);
    [row] = await db.query('SELECT gallery FROM guides WHERE id = $1', [martijn.id]);
    assert.deepEqual(row.gallery.map((item) => item.url), ['/media/bib-00000000000000ee-1600.webp', '/media/martijn-galerij.jpg']);
    assert.equal(row.gallery[0].alt, 'Martijn', 'alt-tekst uit de bibliotheek');
    assert.equal((await post(`${url}galerij/tekst/`, { gallery_title: ' Op  pad ', gallery_subtitle: 'x'.repeat(300) })).status, 303);
    [row] = await db.query('SELECT gallery_title, gallery_subtitle FROM guides WHERE id = $1', [martijn.id]);
    assert.deepEqual([row.gallery_title, row.gallery_subtitle.length], ['Op pad', GUIDE_LIMITS.galleryText]);
    const site = (await request('/reisleider/martijn-de-vries/')).text;
    assert.match(site, /Op pad/);
    assert.match(site, /bib-00000000000000ee-\d+\.webp/);
    assert.ok(site.indexOf('bib-00000000000000ee') < site.indexOf('martijn-galerij.jpg'), 'nieuwe volgorde op de site');

    const again = (await request(url, { cookie: kantoor.cookie })).text.match(/name="galerij" value="([^"]+)"/)[1];
    assert.equal((await post(`${url}galerij/`, { galerij: again, weg: '1' })).status, 303);
    [row] = await db.query('SELECT gallery FROM guides WHERE id = $1', [martijn.id]);
    assert.equal(row.gallery.length, 1);
    await db.query("UPDATE guides SET gallery = (SELECT jsonb_agg(jsonb_build_object('url', '/media/x' || n || '.jpg', 'alt', '')) FROM generate_series(1, $2) AS n) WHERE id = $1", [martijn.id, GUIDE_LIMITS.gallery]);
    assert.equal((await post(`${url}galerij/toevoegen/`, { media_id: String(photo.id) })).status, 422, 'te veel');
    assert.doesNotMatch((await request(url, { cookie: kantoor.cookie })).text, /galerij\/toevoegen\//, 'geen knop als de galerij vol is');
    await db.query("UPDATE guides SET gallery = '[]'::jsonb WHERE id = $1", [martijn.id]);
    assert.match((await request(url, { cookie: kantoor.cookie })).text, /Nog geen foto's in de galerij/);

    // Volgorde: lager staat eerder op de site; in het CRM ook.
    const [anna] = await db.query("INSERT INTO guides (slug, name, published, managed_in_crm, sort_order) VALUES ('anna-test', 'Anna', true, true, 5) RETURNING id");
    assert.equal((await post(url, { ...profile, slug: 'martijn-de-vries', sort_order: 'x' })).status, 422);
    assert.equal((await post(url, { ...profile, slug: 'martijn-de-vries', sort_order: '9' })).status, 303);
    let list = (await request('/reisleider/')).text;
    assert.ok(list.indexOf('Anna') < list.indexOf('Martijn'), 'Anna (5) voor Martijn (9)');
    assert.equal((await post(url, { ...profile, slug: 'martijn-de-vries', sort_order: '1' })).status, 303);
    list = (await request('/reisleider/')).text;
    assert.ok(list.indexOf('Martijn') < list.indexOf('Anna'), 'Martijn (1) voor Anna (5)');
    assert.equal((await post(url, { ...profile, slug: 'martijn-de-vries' })).status, 303, 'zonder veld blijft de volgorde');
    assert.equal((await db.query('SELECT sort_order FROM guides WHERE id = $1', [martijn.id]))[0].sort_order, 1);
    const crmList = (await request('/app/reisleiders/', { cookie: kantoor.cookie })).text;
    assert.ok(crmList.indexOf('>Martijn') < crmList.indexOf('>Anna'), 'CRM-lijst op volgorde');
    await db.query('DELETE FROM guides WHERE id = $1', [anna.id]);
    assert.ok(await audits('reisleider.galerij') >= 3);
  });

  await testContext.test('nieuwe reisleider: offline, adres uniek, verwijderen alleen zonder reizen', async () => {
    assert.equal((await post('/app/reisleiders/nieuw/', { name: '' })).status, 422);
    assert.equal((await post('/app/reisleiders/nieuw/', { name: 'Martijn', slug: 'martijn-de-vries' })).status, 422, 'adres bestaat');
    const created = await post('/app/reisleiders/nieuw/', { name: 'Martijn', slug: 'martijn' });
    assert.equal(created.status, 303, 'oud adres van een verplaatste reisleider mag weer');
    const [fresh] = await db.query("SELECT id, published, managed_in_crm FROM guides WHERE slug = 'martijn'");
    assert.deepEqual([fresh.published, fresh.managed_in_crm], [false, true]);
    assert.equal((await db.query("SELECT count(*)::int AS count FROM redirects WHERE from_path = '/reisleider/martijn/'"))[0].count, 0, 'oude doorverwijzing weg');
    assert.equal((await request('/reisleider/martijn/')).status, 404, 'offline');

    await db.query('INSERT INTO trip_guides (trip_id, guide_id) VALUES ($1, $2)', [trip.id, fresh.id]);
    assert.equal((await post(`/app/reisleiders/${fresh.id}/verwijderen/`, { zeker: 'ja' })).status, 409, 'hangt aan een reis');
    await db.query('DELETE FROM trip_guides WHERE guide_id = $1', [fresh.id]);
    assert.equal((await post(`/app/reisleiders/${fresh.id}/verwijderen/`, {})).status, 422, 'vinkje nodig');
    assert.equal((await post(`/app/reisleiders/${fresh.id}/verwijderen/`, { zeker: 'ja' })).status, 303);
    const gone = await request('/reisleider/martijn/');
    assert.equal(gone.status, 301);
    assert.equal(gone.headers.get('location'), '/reisleider/');

    for (const action of ['reisleider.nieuw', 'reisleider.gewijzigd', 'reisleider.online', 'reisleider.foto', 'reisleider.verwijderd']) assert.ok(await audits(action) >= 1, action);
  });

  await testContext.test('de WordPress-import laat een reisleider uit het CRM staan en koppelt reizen aan hem', async () => {
    const counts = await store(db, {
      guides: [
        { legacyId: 77, slug: 'martijn', name: 'Martijn uit WP', intro: '', bodyHtml: '<p>WP</p>', photoUrl: null },
        { legacyId: 78, slug: 'anna', name: 'Anna', intro: '', bodyHtml: '<p>WP</p>', photoUrl: null },
      ],
      categories: [], posts: [], pages: [], faqs: [],
      trips: [{
        legacyId: 9001, slug: 'zweden-wp', title: 'Zweden', tagline: '', summary: '', bodyHtml: '', tripCode: null, departureDate: '2099-08-01', durationLabel: '',
        durationDays: null, priceCents: null, oldPriceCents: null, offerUntil: null, extraCostsCents: null, statusLabel: '', guaranteed: false,
        fullyBooked: false, isNew: false, heroImageUrl: null, cardImageUrl: null, gallery: [], galleryTitle: '', gallerySubtitle: '', guideRef: 77, categorySlugs: [],
      }],
    });
    assert.ok(counts);
    const rows = await db.query('SELECT slug, name, legacy_id FROM guides ORDER BY slug');
    assert.deepEqual(rows.map((row) => [row.slug, row.name, row.legacy_id]), [['anna', 'Anna', 78], ['martijn-de-vries', 'Martijn', 77]], 'geen tweede Martijn');
    const [linked] = await db.query("SELECT g.slug FROM trip_guides tg JOIN trips t ON t.id = tg.trip_id JOIN guides g ON g.id = tg.guide_id WHERE t.slug = 'zweden-wp'");
    assert.equal(linked.slug, 'martijn-de-vries');
  });
});
