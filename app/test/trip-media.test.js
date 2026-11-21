/**
 * Tests voor foto's bij een reis (CMS-pakket G3, migratie 16): overnemen van de bestaande foto's uit de import,
 * kop- en kaartfoto kiezen, galerij toevoegen, verschuiven en weghalen, galerijtekst, de afgeleide kolommen op de site,
 * "gebruikt in" en niet verwijderen, verdwenen foto, rechten (403), andere reis → 404, CSRF en de auditlog; en het
 * terugsturen naar de reis na direct uploaden. Draait in een eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { hashPassword } = require('../src/crm/passwords');
const { COOKIE_NAME } = require('../src/crm/auth');
const { MIGRATIONS } = require('../src/database/migrations');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'trip_media_test';
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

test('foto\'s bij reizen in het CRM', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'avanta-reisfoto-'));
  const mediaDir = path.join(dataDir, 'media');
  await fs.mkdir(mediaDir);
  const app = createApp({ db, masterKey: MASTER_KEY, mediaDir });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await db.close(); await fs.rm(dataDir, { recursive: true, force: true }); });

  const hash = await hashPassword(PASSWORD);
  for (const [email, role] of [['kantoor@example.nl', 'kantoor'], ['redactie@example.nl', 'redacteur']]) {
    await db.query('INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)', [email, role, role, hash]);
  }
  const [namibia] = await db.query("INSERT INTO trip_categories (slug, name, kind) VALUES ('namibie', 'Namibië', 'bestemming') RETURNING id");
  const insertPhoto = async (name, extra = {}) => (await db.query(
    `INSERT INTO media (original_url, local_name, content_type, bytes, source, title, alt_text, variants)
     VALUES ($1, $2, 'image/webp', 10, $3, $4, $5, $6) RETURNING id`,
    [extra.original || null, name, extra.source || 'upload', extra.title || name, extra.alt || '', JSON.stringify(extra.variants || {})],
  ))[0];
  const imported = await insertPhoto('import-a.jpg', { source: 'import', original: 'https://example.nl/a.jpg' });
  const importedB = await insertPhoto('import-b.jpg', { source: 'import', original: 'https://example.nl/b.jpg' });
  const upload = await insertPhoto('bib-00000000000000bb-1600.webp', { alt: 'Duinen', variants: { 400: 'bib-00000000000000bb-400.webp', 1600: 'bib-00000000000000bb-1600.webp' } });
  const upload2 = await insertPhoto('bib-00000000000000cc-800.webp', { alt: 'Olifant', variants: { 400: 'bib-00000000000000cc-400.webp', 800: 'bib-00000000000000cc-800.webp' } });
  await db.query('INSERT INTO media_countries (media_id, category_id) VALUES ($1, $2)', [upload.id, namibia.id]);
  const [trip] = await db.query(
    `INSERT INTO trips (slug, title, departure_date, hero_image_url, card_image_url, gallery, published)
     VALUES ('namibie-reis', 'Namibië-reis', '2099-06-01', '/media/import-a.jpg', '/media/onbekend.jpg', $1::jsonb, true) RETURNING id`,
    [JSON.stringify([{ url: '/media/import-b.jpg', alt: '' }, { url: '/media/bib-00000000000000bb-400.webp', alt: '' }, { url: '/media/elders.jpg' }])],
  );
  await db.query('INSERT INTO trip_category_links (trip_id, category_id) VALUES ($1, $2)', [trip.id, namibia.id]);
  const [otherTrip] = await db.query("INSERT INTO trips (slug, title, departure_date) VALUES ('andere', 'Andere reis', '2099-07-01') RETURNING id");
  await db.query("INSERT INTO trip_media (trip_id, media_id, role) VALUES ($1, $2, 'galerij')", [otherTrip.id, importedB.id]);
  const [otherLink] = await db.query('SELECT id FROM trip_media WHERE trip_id = $1', [otherTrip.id]);

  /**
   * Doet een verzoek zonder redirects te volgen.
   * @param {string} url Pad.
   * @param {{form?: object, body?: FormData, cookie?: string}} [init] Formulier, multipart-body en sessiecookie.
   * @returns {Promise<{status: number, text: string, headers: Headers, cookie: string}>} Antwoord.
   */
  const request = async (url, init = {}) => {
    const headers = {};
    if (init.cookie) headers.cookie = `${COOKIE_NAME}=${init.cookie}`;
    let body = init.body;
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
  const redactie = await login('redactie@example.nl');
  const links = async (tripId = trip.id) => db.query('SELECT id, media_id, role, sort_order FROM trip_media WHERE trip_id = $1 ORDER BY role, sort_order, id', [tripId]);
  const tripRow = async () => (await db.query('SELECT hero_image_url, card_image_url, gallery, gallery_title, managed_in_crm FROM trips WHERE id = $1', [trip.id]))[0];
  const tripsBase = `/app/reizen/${trip.id}/`;

  await t.test('bestaande foto\'s uit de import overgenomen (migratie 16)', async () => {
    // De overname draait bij de migratie op een lege tabel; hier opnieuw op de testreis.
    const backfill = MIGRATIONS.find((migration) => migration.id === 16).sql.split('-- Bestaande reizen')[1].replace(/^[^\n]*\n/, '');
    await db.query(backfill);
    const rows = await links();
    assert.deepEqual(rows.map((row) => [row.role, row.media_id]), [['galerij', importedB.id], ['galerij', upload.id], ['kop', imported.id]], 'onbekende adressen vallen weg, varianten tellen mee');
  });

  await t.test('rechten: redacteur 403, andere reis of koppeling 404, CSRF 403', async () => {
    assert.equal((await request(`${tripsBase}fotos/`, { cookie: redactie.cookie, form: { _csrf: redactie.csrf, rol: 'kop', media_id: String(upload.id) } })).status, 403);
    assert.equal((await request(`${tripsBase}galerij/`, { cookie: redactie.cookie, form: { _csrf: redactie.csrf, gallery_title: 'x' } })).status, 403);
    assert.equal((await request('/app/reizen/999999/fotos/', { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, rol: 'kop', media_id: String(upload.id) } })).status, 404);
    assert.equal((await request(`${tripsBase}fotos/${otherLink.id}/verwijderen/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf } })).status, 409, 'koppeling van een andere reis');
    assert.equal((await links(otherTrip.id)).length, 1);
    assert.equal((await request(`${tripsBase}fotos/`, { cookie: kantoor.cookie, form: { _csrf: 'fout', rol: 'kop', media_id: String(upload.id) } })).status, 403);
  });

  await t.test('bewerkscherm: foto\'s en kiezer met de foto\'s van het land', async () => {
    const page = await request(tripsBase, { cookie: kantoor.cookie });
    assert.equal(page.status, 200);
    assert.match(page.text, /id="fotos"/);
    assert.match(page.text, new RegExp(`name="media_id" value="${upload.id}"`));
    assert.doesNotMatch(page.text, new RegExp(`name="media_id" value="${upload2.id}"`), 'andere landen pas na zoeken');
    assert.match(page.text, /name="terug" value="\/app\/reizen\/\d+\/"/);
  });

  await t.test('kopfoto vervangen, galerij toevoegen en verschuiven, afgeleide kolommen', async () => {
    assert.equal((await request(`${tripsBase}fotos/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, rol: 'kop', media_id: [String(upload.id), String(upload2.id)] } })).status, 303);
    assert.equal((await request(`${tripsBase}fotos/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, rol: 'kaart', media_id: String(upload2.id) } })).status, 303);
    assert.equal((await request(`${tripsBase}fotos/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, rol: 'galerij', media_id: [String(upload2.id), String(upload.id)] } })).status, 303);
    let rows = await links();
    assert.deepEqual(rows.filter((row) => row.role === 'galerij').map((row) => row.media_id), [importedB.id, upload.id, upload2.id], 'dubbele foto niet twee keer');
    assert.deepEqual(rows.filter((row) => row.role !== 'galerij').map((row) => [row.role, row.media_id]), [['kaart', upload2.id], ['kop', upload.id]]);
    const last = rows.filter((row) => row.role === 'galerij').at(-1);
    assert.equal((await request(`${tripsBase}fotos/${last.id}/omhoog/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf } })).status, 303);
    rows = await links();
    assert.deepEqual(rows.filter((row) => row.role === 'galerij').map((row) => row.media_id), [importedB.id, upload2.id, upload.id]);
    const first = rows.find((row) => row.role === 'galerij');
    assert.equal((await request(`${tripsBase}fotos/${first.id}/omhoog/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf } })).status, 303, 'vooraan: niets te doen');
    assert.equal((await request(`${tripsBase}galerij/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, gallery_title: 'Afrikaans Avantuur', gallery_subtitle: 'wild & wonderful' } })).status, 303);
    const row = await tripRow();
    assert.equal(row.hero_image_url, '/media/bib-00000000000000bb-1600.webp');
    assert.equal(row.card_image_url, '/media/bib-00000000000000cc-800.webp');
    assert.deepEqual(row.gallery, [
      { url: '/media/import-b.jpg', alt: '' },
      { url: '/media/bib-00000000000000cc-800.webp', alt: 'Olifant' },
      { url: '/media/bib-00000000000000bb-1600.webp', alt: 'Duinen' },
    ]);
    assert.equal(row.gallery_title, 'Afrikaans Avantuur');
    assert.equal(row.managed_in_crm, true);
    const site = await request('/reis/namibie-reis/');
    assert.match(site.text, /Afrikaans Avantuur/);
    assert.match(site.text, /alt="Olifant"/);
    assert.equal((await db.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'reis.fotos'"))[0].count, 5);
  });

  await t.test('gebruikte foto niet te verwijderen; weghalen bij de reis wel; verdwenen foto', async () => {
    assert.equal((await app.locals.mediaLibrary.remove(upload2.id)).status, 'gebruikt');
    const usage = await request(`/app/fotobibliotheek/${upload2.id}/`, { cookie: kantoor.cookie });
    assert.match(usage.text, /Reis: <a href="\/reis\/namibie-reis\/">Namibië-reis<\/a>/);
    for (const link of (await links()).filter((row) => row.media_id === upload2.id)) {
      assert.equal((await request(`${tripsBase}fotos/${link.id}/verwijderen/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf } })).status, 303);
    }
    assert.equal((await tripRow()).card_image_url, null);
    assert.equal((await app.locals.mediaLibrary.remove(upload2.id)).status, 'ok');
    assert.equal((await request(`${tripsBase}fotos/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, rol: 'galerij', media_id: String(upload2.id) } })).status, 409);
    assert.equal((await request(`${tripsBase}fotos/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, rol: 'onzin', media_id: String(upload.id) } })).status, 422);
  });

  await t.test('direct uploaden vanaf een reis stuurt terug naar de reis', async () => {
    const photo = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#c0603a' } }).jpeg().toBuffer();
    const form = (terug) => {
      const data = new FormData();
      data.append('_csrf', kantoor.csrf);
      data.append('terug', terug);
      data.append('land', String(namibia.id));
      data.append('foto', new Blob([photo], { type: 'image/jpeg' }), 'woestijn.jpg');
      return data;
    };
    const back = await request('/app/fotobibliotheek/uploaden/', { cookie: kantoor.cookie, body: form(tripsBase) });
    assert.equal(back.status, 303);
    assert.equal(back.headers.get('location'), `${tripsBase}?geupload=1#fotos`);
    const elsewhere = await request('/app/fotobibliotheek/uploaden/', { cookie: kantoor.cookie, body: form('https://evil.example/') });
    assert.equal(elsewhere.headers.get('location'), '/app/fotobibliotheek/?geupload=1');
    assert.match((await request(`${tripsBase}?geupload=1`, { cookie: kantoor.cookie })).text, /1 foto geüpload/);
  });

  await t.test('alleen de galerijtekst wijzigen laat de galerij (ook foto\'s uit de import) staan', async () => {
    const gallery = [{ url: '/media/niet-in-de-bibliotheek.jpg', alt: '' }];
    await db.query('UPDATE trips SET gallery = $2 WHERE id = $1', [trip.id, JSON.stringify(gallery)]);
    assert.equal((await request(`${tripsBase}galerij/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, gallery_title: 'Nieuwe titel', gallery_subtitle: '' } })).status, 303);
    const row = await tripRow();
    assert.deepEqual(row.gallery, gallery);
    assert.equal(row.gallery_title, 'Nieuwe titel');
  });
});
