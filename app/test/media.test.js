/**
 * Tests voor de fotobibliotheek (CMS-pakket F, migratie 12): soort bestand op inhoud, EXIF/GPS weg, rechtzetten en
 * varianten (sharp), en de routes onder `/app/fotobibliotheek/`: rechten (zonder sessie naar inloggen, zonder recht 403,
 * redacteur wel), uploaden van meerdere foto's met land, ongeldige bestanden, te veel bestanden, CSRF, wijzigen met
 * landen, filter op land en "zonder land", onbekend id → 404 en de auditlog. Draait in een eigen schema en een eigen map.
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
const { roleHasRight } = require('../src/crm/rights');
const { processImage, detectImageType, variantWidthsFor } = require('../src/media/images');
const { createMediaLibrary, mediaUrl, titleFromFilename } = require('../src/media/library');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'media_test';
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
 * Maakt een JPEG-testfoto met EXIF (camera en GPS) en eventueel een oriëntatie.
 * @param {{width?: number, height?: number, orientation?: number}} [options] Afmetingen en EXIF-oriëntatie.
 * @returns {Promise<Buffer>} JPEG.
 */
function jpegWithExif(options = {}) {
  let image = sharp({ create: { width: options.width || 1000, height: options.height || 600, channels: 3, background: '#c0603a' } })
    .withExif({ IFD0: { Make: 'Testcamera', Copyright: 'Jan Jansen' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '52/1 22/1 0/1' } });
  if (options.orientation) image = image.withMetadata({ orientation: options.orientation });
  return image.jpeg().toBuffer();
}

test('soort bestand op inhoud', async () => {
  assert.equal(detectImageType(await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).png().toBuffer()), 'png');
  assert.equal(detectImageType(await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).webp().toBuffer()), 'webp');
  assert.equal(detectImageType(await jpegWithExif()), 'jpeg');
  assert.equal(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(detectImageType(Buffer.from('GIF89a......')), null);
  assert.equal(detectImageType(Buffer.alloc(4)), null);
});

test('varianten: vaste breedtes, nooit vergroten', () => {
  assert.deepEqual(variantWidthsFor(300), [300]);
  assert.deepEqual(variantWidthsFor(400), [400]);
  assert.deepEqual(variantWidthsFor(1000), [400, 800, 1000]);
  assert.deepEqual(variantWidthsFor(5000), [400, 800, 1600, 2400]);
});

test('verwerken: EXIF en GPS weg, rechtgezet, WebP', async () => {
  const result = await processImage(await jpegWithExif({ orientation: 6 }));
  // Oriëntatie 6: de foto staat na het rechtzetten op zijn kant (600 breed, 1000 hoog).
  assert.equal(result.width, 600);
  assert.equal(result.height, 1000);
  assert.deepEqual(result.variants.map((variant) => variant.width), [400, 600]);
  for (const variant of result.variants) {
    const metadata = await sharp(variant.data).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.exif, undefined, 'geen EXIF');
    assert.equal(metadata.xmp, undefined, 'geen XMP');
    assert.ok(!metadata.orientation || metadata.orientation === 1);
  }
});

test('verwerken: ongeldige bestanden geweigerd', async () => {
  await assert.rejects(processImage(Buffer.from('dit is geen foto, al heet het foto.jpg')), { code: 'soort' });
  const fakePng = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 1)]);
  await assert.rejects(processImage(fakePng), { code: 'beschadigd' });
  await assert.rejects(processImage(await jpegWithExif({ width: 150, height: 150 })), { code: 'te-klein' });
});

test('adres van een foto en standaardtitel', () => {
  assert.equal(mediaUrl({ local_name: 'oud.jpg', variants: {} }), '/media/oud.jpg');
  const item = { local_name: 'bib-a-1600.webp', variants: { 400: 'bib-a-400.webp', 800: 'bib-a-800.webp', 1600: 'bib-a-1600.webp' } };
  assert.equal(mediaUrl(item, 400), '/media/bib-a-400.webp');
  assert.equal(mediaUrl(item, 500), '/media/bib-a-800.webp');
  assert.equal(mediaUrl(item, 3000), '/media/bib-a-1600.webp');
  assert.equal(mediaUrl(item), '/media/bib-a-400.webp');
  assert.equal(titleFromFilename('C:\\Fotos\\namibie_woestijn-2024.JPG'), 'namibie woestijn 2024');
  assert.equal(titleFromFilename('../../etc/passwd'), 'passwd');
});

test('rechten: media voor beheerder, kantoor en redacteur', () => {
  assert.equal(roleHasRight('beheerder', 'media'), true);
  assert.equal(roleHasRight('kantoor', 'media'), true);
  assert.equal(roleHasRight('redacteur', 'media'), true);
  assert.equal(roleHasRight('redacteur', 'deelnemers'), false);
  assert.equal(roleHasRight('reisleider', 'media'), false);
  assert.equal(roleHasRight('boekhouding', 'media'), false);
});

test('fotobibliotheek in het CRM', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'avanta-media-'));
  const mediaDir = path.join(dataDir, 'media');
  await fs.mkdir(mediaDir);
  const app = createApp({ db, masterKey: MASTER_KEY, mediaDir });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await db.close(); await fs.rm(dataDir, { recursive: true, force: true }); });

  const hash = await hashPassword(PASSWORD);
  for (const [email, role] of [['redactie@example.nl', 'redacteur'], ['kantoor@example.nl', 'kantoor'], ['boek@example.nl', 'boekhouding']]) {
    await db.query('INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)', [email, role, role, hash]);
  }
  const [namibia] = await db.query("INSERT INTO trip_categories (slug, name, kind) VALUES ('namibie', 'Namibië', 'bestemming') RETURNING id");
  const [botswana] = await db.query("INSERT INTO trip_categories (slug, name, kind) VALUES ('botswana', 'Botswana', 'bestemming') RETURNING id");
  const [hostel] = await db.query("INSERT INTO trip_categories (slug, name, kind) VALUES ('hostel', 'Hostel', 'type') RETURNING id");
  await db.query("INSERT INTO media (original_url, local_name, content_type, bytes) VALUES ('https://example.nl/a.jpg', 'import-a.jpg', 'image/jpeg', 10), ('https://example.nl/b.mp4', 'import-b.mp4', 'video/mp4', 10)");

  /**
   * Doet een verzoek zonder redirects te volgen.
   * @param {string} url Pad.
   * @param {{form?: object, body?: FormData, cookie?: string, headers?: object}} [init] Formulier, multipart-body, sessiecookie, koppen.
   * @returns {Promise<{status: number, text: string, headers: Headers, cookie: string}>} Antwoord.
   */
  const request = async (url, init = {}) => {
    const headers = { ...(init.headers || {}) };
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

  /**
   * Een multipart-formulier met foto's.
   * @param {{csrf?: string, lands?: number[], files: {name: string, data: Buffer, type?: string}[]}} form Inhoud.
   * @returns {FormData} Formulier.
   */
  const uploadForm = (form) => {
    const data = new FormData();
    if (form.csrf) data.append('_csrf', form.csrf);
    for (const land of form.lands || []) data.append('land', String(land));
    for (const file of form.files) data.append('foto', new Blob([file.data], { type: file.type || 'image/jpeg' }), file.name);
    return data;
  };

  const redactie = await login('redactie@example.nl');
  const kantoor = await login('kantoor@example.nl');
  const boek = await login('boek@example.nl');
  const photo = await jpegWithExif({ width: 1000, height: 700 });

  await t.test('rechten: zonder sessie naar inloggen, boekhouding 403, redacteur en kantoor wel; menu', async () => {
    assert.equal((await request('/app/fotobibliotheek/')).status, 303);
    assert.equal((await request('/app/fotobibliotheek/', { cookie: boek.cookie })).status, 403);
    assert.equal((await request('/app/fotobibliotheek/uploaden/', { cookie: boek.cookie, body: uploadForm({ csrf: boek.csrf, files: [{ name: 'a.jpg', data: photo }] }) })).status, 403);
    assert.equal((await request('/app/fotobibliotheek/1/', { cookie: boek.cookie, form: { _csrf: boek.csrf, title: 'x' } })).status, 403);
    const list = await request('/app/fotobibliotheek/', { cookie: redactie.cookie });
    assert.equal(list.status, 200);
    assert.match(list.text, /href="\/app\/fotobibliotheek\/"/);
    assert.doesNotMatch(list.text, /href="\/app\/deelnemers\/"/, 'redacteur ziet geen deelnemers');
    assert.equal((await request('/app/deelnemers/', { cookie: redactie.cookie })).status, 403);
    assert.equal((await request('/app/fotobibliotheek/', { cookie: kantoor.cookie })).status, 200);
    // Alleen afbeeldingen, geen video uit de import; landen in het filter, geen reistypes.
    assert.match(list.text, /import-a\.jpg/);
    assert.doesNotMatch(list.text, /import-b\.mp4/);
    assert.match(list.text, /<option value="\d+">Namibië<\/option>/);
    assert.doesNotMatch(list.text, />Hostel</);
  });

  await t.test('uploaden: twee foto\'s met land, zonder EXIF, audit', async () => {
    const response = await request('/app/fotobibliotheek/uploaden/', {
      cookie: redactie.cookie,
      body: uploadForm({ csrf: redactie.csrf, lands: [namibia.id, hostel.id, 999999], files: [{ name: 'woestijn_namibie.jpg', data: photo }, { name: 'duinen.png', data: await sharp(photo).png().toBuffer(), type: 'image/png' }] }),
    });
    assert.equal(response.status, 303, response.text);
    assert.equal(response.headers.get('location'), '/app/fotobibliotheek/?geupload=2');
    const rows = await db.query("SELECT id, local_name, title, width, height, variants, uploaded_by, original_url FROM media WHERE source = 'upload' ORDER BY id");
    assert.equal(rows.length, 2);
    assert.equal(rows[0].title, 'woestijn namibie');
    assert.equal(rows[0].original_url, null);
    assert.equal(rows[0].width, 1000);
    assert.deepEqual(Object.keys(rows[0].variants).sort(), ['1000', '400', '800']);
    assert.equal(rows[0].local_name, rows[0].variants['1000']);
    for (const name of Object.values(rows[0].variants)) {
      assert.match(name, /^bib-[0-9a-f]{16}-\d+\.webp$/);
      const metadata = await sharp(path.join(mediaDir, name)).metadata();
      assert.equal(metadata.exif, undefined);
    }
    // Alleen bestaande landen; een reistype of onbekend id wordt genegeerd.
    const links = await db.query('SELECT category_id FROM media_countries WHERE media_id = ANY($1::int[]) ORDER BY media_id', [rows.map((row) => row.id)]);
    assert.deepEqual(links.map((link) => link.category_id), [namibia.id, namibia.id]);
    const audits = await db.query("SELECT entity, entity_id FROM audit_log WHERE action = 'media.geupload' ORDER BY id");
    assert.deepEqual(audits.map((row) => row.entity_id), rows.map((row) => String(row.id)));
    // Het bestand is via /media/ op te halen.
    const served = await fetch(`${base}/media/${rows[0].variants['400']}`);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get('content-type'), 'image/webp');
    const list = await request('/app/fotobibliotheek/?geupload=2', { cookie: redactie.cookie });
    assert.match(list.text, /2 foto&#39;s geüpload\.|2 foto's geüpload\./);
    assert.match(list.text, new RegExp(`src="/media/${rows[0].variants['400']}"`));
  });

  await t.test('uploaden: ongeldige bestanden, te veel bestanden, CSRF en verkeerd soort verzoek', async () => {
    const before = (await db.query('SELECT count(*)::int AS n FROM media'))[0].n;
    const invalid = await request('/app/fotobibliotheek/uploaden/', {
      cookie: redactie.cookie,
      body: uploadForm({ csrf: redactie.csrf, files: [{ name: 'goed.jpg', data: photo }, { name: 'nep.jpg', data: Buffer.from('<?php echo 1; ?>') }, { name: 'plaatje.svg', data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), type: 'image/svg+xml' }] }),
    });
    assert.equal(invalid.status, 422);
    assert.match(invalid.text, /1 foto geüpload\. Niet gelukt: nep\.jpg: Alleen JPEG-, PNG- en WebP-foto/);
    assert.match(invalid.text, /plaatje\.svg: Alleen JPEG/);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM media'))[0].n, before + 1);
    const files = Array.from({ length: 11 }, (_, i) => ({ name: `foto-${i}.jpg`, data: photo }));
    const tooMany = await request('/app/fotobibliotheek/uploaden/', { cookie: redactie.cookie, body: uploadForm({ csrf: redactie.csrf, files }) });
    assert.equal(tooMany.status, 413);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM media'))[0].n, before + 1, 'niets opgeslagen bij te veel bestanden');
    const noCsrf = await request('/app/fotobibliotheek/uploaden/', { cookie: redactie.cookie, body: uploadForm({ files: [{ name: 'a.jpg', data: photo }] }) });
    assert.equal(noCsrf.status, 403);
    const wrongToken = await request('/app/fotobibliotheek/uploaden/', { cookie: redactie.cookie, body: uploadForm({ csrf: 'fout', files: [{ name: 'a.jpg', data: photo }] }) });
    assert.equal(wrongToken.status, 403);
    // Een bestand vóór het token wordt niet gebufferd: meteen 403.
    const fileFirst = new FormData();
    fileFirst.append('foto', new Blob([photo], { type: 'image/jpeg' }), 'a.jpg');
    fileFirst.append('_csrf', redactie.csrf);
    assert.equal((await request('/app/fotobibliotheek/uploaden/', { cookie: redactie.cookie, body: fileFirst })).status, 403);
    const crossSite = await request('/app/fotobibliotheek/uploaden/', { cookie: redactie.cookie, headers: { origin: 'https://evil.example' }, body: uploadForm({ csrf: redactie.csrf, files: [{ name: 'a.jpg', data: photo }] }) });
    assert.equal(crossSite.status, 403);
    const empty = await request('/app/fotobibliotheek/uploaden/', { cookie: redactie.cookie, body: uploadForm({ csrf: redactie.csrf, files: [] }) });
    assert.equal(empty.status, 422);
    const urlencoded = await request('/app/fotobibliotheek/uploaden/', { cookie: redactie.cookie, form: { _csrf: redactie.csrf } });
    assert.equal(urlencoded.status, 415);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM media'))[0].n, before + 1);
    // Geen achtergebleven tijdelijke bestanden.
    assert.deepEqual((await fs.readdir(mediaDir)).filter((name) => name.endsWith('.tmp')), []);
  });

  await t.test('wijzigen: teksten en landen, onbekend id 404, audit', async () => {
    const [item] = await db.query("SELECT id FROM media WHERE source = 'upload' ORDER BY id LIMIT 1");
    const page = await request(`/app/fotobibliotheek/${item.id}/`, { cookie: redactie.cookie });
    assert.equal(page.status, 200);
    assert.match(page.text, /<option value="\d+" selected>Namibië<\/option>/);
    const saved = await request(`/app/fotobibliotheek/${item.id}/`, {
      cookie: redactie.cookie,
      form: { _csrf: redactie.csrf, title: '  Duinen\nbij Sossusvlei ', alt_text: 'Rode duinen <script>', caption: 'Bij zonsopgang', photographer: 'Avanta', land: [String(botswana.id), String(hostel.id), 'abc'] },
    });
    assert.equal(saved.status, 303);
    const [row] = await db.query('SELECT title, alt_text, caption, photographer FROM media WHERE id = $1', [item.id]);
    assert.deepEqual({ ...row }, { title: 'Duinen bij Sossusvlei', alt_text: 'Rode duinen <script>', caption: 'Bij zonsopgang', photographer: 'Avanta' });
    const links = await db.query('SELECT category_id FROM media_countries WHERE media_id = $1', [item.id]);
    assert.deepEqual(links.map((link) => link.category_id), [botswana.id]);
    const after = await request(`/app/fotobibliotheek/${item.id}/?opgeslagen=1`, { cookie: redactie.cookie });
    assert.match(after.text, /alt="Rode duinen &lt;script&gt;"/);
    assert.match(after.text, /De foto is opgeslagen\./);
    const [audit] = await db.query("SELECT entity_id FROM audit_log WHERE action = 'media.gewijzigd'");
    assert.equal(audit.entity_id, String(item.id));
    assert.equal((await request('/app/fotobibliotheek/999999/', { cookie: redactie.cookie })).status, 404);
    assert.equal((await request('/app/fotobibliotheek/999999/', { cookie: redactie.cookie, form: { _csrf: redactie.csrf, title: 'x' } })).status, 404);
    const [video] = await db.query("SELECT id FROM media WHERE content_type = 'video/mp4'");
    assert.equal((await request(`/app/fotobibliotheek/${video.id}/`, { cookie: redactie.cookie })).status, 404, 'geen video in de bibliotheek');
    assert.equal((await request(`/app/fotobibliotheek/${item.id}/`, { cookie: redactie.cookie, form: { title: 'zonder token' } })).status, 403);
    // Alle landen tegelijk kiezen past binnen de formuliergrens.
    const many = await request(`/app/fotobibliotheek/${item.id}/`, { cookie: redactie.cookie, form: { _csrf: redactie.csrf, title: 'Duinen bij Sossusvlei', land: [String(botswana.id), ...Array.from({ length: 150 }, (_, i) => String(i + 100000))] } });
    assert.equal(many.status, 303);
  });

  await t.test('filter op land, zonder land en zoeken', async () => {
    const byCountry = await request(`/app/fotobibliotheek/?land=${botswana.id}`, { cookie: redactie.cookie });
    assert.equal((byCountry.text.match(/class="media-grid__item"/g) || []).length, 1);
    const byNamibia = await request(`/app/fotobibliotheek/?land=${namibia.id}`, { cookie: redactie.cookie });
    assert.equal((byNamibia.text.match(/class="media-grid__item"/g) || []).length, 1);
    const without = await request('/app/fotobibliotheek/?land=zonder', { cookie: redactie.cookie });
    assert.match(without.text, /import-a\.jpg/);
    assert.match(without.text, /goed/);
    const search = await request('/app/fotobibliotheek/?q=duinen%20sossus', { cookie: redactie.cookie });
    assert.equal((search.text.match(/class="media-grid__item"/g) || []).length, 1);
    const wildcard = await request('/app/fotobibliotheek/?q=%25', { cookie: redactie.cookie });
    assert.equal((wildcard.text.match(/class="media-grid__item"/g) || []).length, 0, '% is geen jokerteken');
    // Een reistype als land telt niet als filter.
    const typeFilter = await request(`/app/fotobibliotheek/?land=${hostel.id}`, { cookie: redactie.cookie });
    assert.ok((typeFilter.text.match(/class="media-grid__item"/g) || []).length >= 4);
  });

  await t.test('uurgrens en gelijktijdige uploads', async () => {
    /**
     * Start een tweede app met andere grenzen en logt daar in als redacteur.
     * @param {object} limits Grenzen.
     * @returns {Promise<{post: Function, close: Function}>} Upload-functie en afsluiter.
     */
    const startWith = async (limits) => {
      const other = createApp({ db, masterKey: MASTER_KEY, mediaDir, mediaLimits: limits }).listen(0);
      const otherBase = `http://127.0.0.1:${other.address().port}`;
      const send = async (url, init) => {
        const response = await fetch(otherBase + url, { redirect: 'manual', ...init });
        return { status: response.status, text: await response.text(), cookie: ((response.headers.getSetCookie().find((value) => value.startsWith(`${COOKIE_NAME}=`)) || '').split(';')[0].split('=')[1]) || '' };
      };
      const loggedIn = await send('/app/inloggen/', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: 'redactie@example.nl', password: PASSWORD }).toString() });
      const home = await send('/app/', { headers: { cookie: `${COOKIE_NAME}=${loggedIn.cookie}` } });
      const csrf = home.text.match(/name="_csrf" value="([^"]+)"/)[1];
      const post = (count) => send('/app/fotobibliotheek/uploaden/', {
        method: 'POST', headers: { cookie: `${COOKIE_NAME}=${loggedIn.cookie}` }, body: uploadForm({ csrf, files: Array.from({ length: count }, (_, i) => ({ name: `grens-${i}.jpg`, data: photo })) }),
      });
      t.after(() => other.close());
      return { post, close: () => other.close() };
    };
    const count = async () => (await db.query('SELECT count(*)::int AS n FROM media'))[0].n;
    const limited = await startWith({ uploadsPerHour: 3 });
    const before = await count();
    assert.equal((await limited.post(2)).status, 303);
    const over = await limited.post(2);
    assert.equal(over.status, 429, 'twee extra passen niet meer binnen de grens van drie');
    assert.match(over.text, /maximaal 3 foto/);
    assert.equal(await count(), before + 2, 'niets opgeslagen boven de grens');
    assert.equal((await limited.post(1)).status, 429, 'grens bereikt: meteen geweigerd');
    limited.close();
    const busy = await startWith({ maxParallelUploads: 0 });
    assert.equal((await busy.post(1)).status, 503);
    busy.close();
    assert.equal(await count(), before + 2);
  });

  await t.test('mappen per land, gebruikt in en verwijderen', async () => {
    const list = await request('/app/fotobibliotheek/', { cookie: redactie.cookie });
    assert.match(list.text, new RegExp(`href="/app/fotobibliotheek/\\?land=${botswana.id}">Botswana <span class="media-folders__count">1</span>`));
    assert.match(list.text, /Zonder land <span class="media-folders__count">\d+<\/span>/);
    const [item] = await db.query("SELECT id, local_name, variants FROM media WHERE source = 'upload' ORDER BY id LIMIT 1");
    const files = Object.values(item.variants);
    await db.query("INSERT INTO trips (slug, title, hero_image_url) VALUES ('namibie-reis', 'Afrikaans Avantuur', $1)", [`/media/${item.variants['400']}`]);
    const page = await request(`/app/fotobibliotheek/${item.id}/`, { cookie: redactie.cookie });
    assert.match(page.text, /Reis: <a href="\/reis\/namibie-reis\/">Afrikaans Avantuur<\/a>/);
    assert.doesNotMatch(page.text, /Foto verwijderen/);
    const blocked = await request(`/app/fotobibliotheek/${item.id}/verwijderen/`, { cookie: redactie.cookie, form: { _csrf: redactie.csrf } });
    assert.equal(blocked.status, 409);
    assert.match(blocked.text, /wordt nog gebruikt/);
    // Ook gebruik in de vaste inhoud (homepage.json) telt.
    await db.query("UPDATE trips SET hero_image_url = NULL WHERE slug = 'namibie-reis'");
    await fs.writeFile(path.join(dataDir, 'homepage.json'), JSON.stringify({ slides: [{ image: `/media/${item.local_name}` }] }));
    assert.equal((await request(`/app/fotobibliotheek/${item.id}/verwijderen/`, { cookie: redactie.cookie, form: { _csrf: redactie.csrf } })).status, 409);
    await fs.rm(path.join(dataDir, 'homepage.json'));
    // Een onleesbaar bestand (hier een map) telt niet als "niet gebruikt": verwijderen mislukt veilig.
    await fs.mkdir(path.join(dataDir, 'homepage.json'));
    assert.equal((await request(`/app/fotobibliotheek/${item.id}/verwijderen/`, { cookie: redactie.cookie, form: { _csrf: redactie.csrf } })).status, 500);
    assert.equal((await db.query('SELECT id FROM media WHERE id = $1', [item.id])).length, 1, 'foto blijft staan');
    await fs.rm(path.join(dataDir, 'homepage.json'), { recursive: true });
    assert.equal((await request(`/app/fotobibliotheek/${item.id}/verwijderen/`, { cookie: boek.cookie, form: { _csrf: boek.csrf } })).status, 403);
    assert.equal((await request(`/app/fotobibliotheek/${item.id}/verwijderen/`, { cookie: redactie.cookie, form: {} })).status, 403);
    const removed = await request(`/app/fotobibliotheek/${item.id}/verwijderen/`, { cookie: redactie.cookie, form: { _csrf: redactie.csrf } });
    assert.equal(removed.status, 303);
    assert.equal((await db.query('SELECT id FROM media WHERE id = $1', [item.id])).length, 0);
    assert.equal((await db.query('SELECT media_id FROM media_countries WHERE media_id = $1', [item.id])).length, 0);
    const left = await fs.readdir(mediaDir);
    for (const name of files) assert.ok(!left.includes(name), `${name} verwijderd`);
    const [audit] = await db.query("SELECT entity_id FROM audit_log WHERE action = 'media.verwijderd'");
    assert.equal(audit.entity_id, String(item.id));
    assert.equal((await request(`/app/fotobibliotheek/${item.id}/verwijderen/`, { cookie: redactie.cookie, form: { _csrf: redactie.csrf } })).status, 404);
    const [imported] = await db.query("SELECT id FROM media WHERE local_name = 'import-a.jpg'");
    const importPage = await request(`/app/fotobibliotheek/${imported.id}/`, { cookie: redactie.cookie });
    assert.match(importPage.text, /komt uit de import/);
    assert.equal((await request(`/app/fotobibliotheek/${imported.id}/verwijderen/`, { cookie: redactie.cookie, form: { _csrf: redactie.csrf } })).status, 409);
  });

  await t.test('losse bestanden opruimen: alleen bib-bestanden zonder rij en ouder dan de grens', async () => {
    const [item] = await db.query("SELECT local_name FROM media WHERE source = 'upload' ORDER BY id LIMIT 1");
    const orphan = 'bib-0123456789abcdef-400.webp';
    await fs.writeFile(path.join(mediaDir, orphan), 'x');
    await fs.writeFile(path.join(mediaDir, 'bib-0123456789abcdef-800.webp.tmp'), 'x');
    await fs.writeFile(path.join(mediaDir, 'import-c.jpg'), 'x');
    const library = app.locals.mediaLibrary;
    assert.equal(await library.cleanupOrphans(), 0, 'te nieuw');
    assert.equal(await library.cleanupOrphans({ now: Date.now() + 2 * 86400000 }), 2);
    const left = await fs.readdir(mediaDir);
    assert.ok(!left.includes(orphan));
    assert.ok(left.includes('import-c.jpg'), 'importbestanden blijven');
    assert.ok(left.includes(item.local_name), 'bestanden met een rij blijven');
  });

  await t.test('foto\'s uit de import automatisch aan landen koppelen', async () => {
    const insert = async (name) => (await db.query("INSERT INTO media (original_url, local_name, content_type, bytes) VALUES ($1, $2, 'image/jpeg', 1) RETURNING id", [`https://example.nl/${name}`, name]))[0].id;
    const inTrip = await insert('reis_foto.jpg');
    const inGallery = await insert('galerij-1.jpg');
    const onCountryPage = await insert('land-kop.jpg');
    const manual = await insert('handmatig.jpg');
    const unused = await insert('los.jpg');
    const lookalike = await insert('los_x.jpg');
    const [trip] = await db.query(
      "INSERT INTO trips (slug, title, hero_image_url, gallery, body_html) VALUES ('afrika', 'Afrika', '/media/reis_foto.jpg', $1, '<p>tekst</p>') RETURNING id",
      [JSON.stringify([{ url: '/media/galerij-1.jpg' }])],
    );
    await db.query('INSERT INTO trip_category_links (trip_id, category_id) VALUES ($1, $2), ($1, $3), ($1, $4)', [trip.id, namibia.id, botswana.id, hostel.id]);
    await db.query("UPDATE trip_categories SET image_url = '/media/land-kop.jpg' WHERE id = $1", [botswana.id]);
    await db.query("UPDATE trips SET body_html = '<img src=\"/media/handmatig.jpg\"><img src=\"/media/losYx.jpg\">' WHERE id = $1", [trip.id]);
    await db.query('INSERT INTO media_countries (media_id, category_id) VALUES ($1, $2)', [manual, botswana.id]);
    assert.equal((await request('/app/fotobibliotheek/koppelen/', { cookie: boek.cookie, form: { _csrf: boek.csrf } })).status, 403);
    assert.equal((await request('/app/fotobibliotheek/koppelen/', { cookie: redactie.cookie, form: {} })).status, 403);
    const page = await request('/app/fotobibliotheek/?land=zonder', { cookie: redactie.cookie });
    assert.match(page.text, /Automatisch koppelen via de reizen/);
    const response = await request('/app/fotobibliotheek/koppelen/', { cookie: redactie.cookie, form: { _csrf: redactie.csrf } });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/app/fotobibliotheek/?land=zonder&gekoppeld=3');
    const countriesOf = async (id) => (await db.query('SELECT category_id FROM media_countries WHERE media_id = $1 ORDER BY category_id', [id])).map((row) => row.category_id);
    const both = [namibia.id, botswana.id].sort((a, b) => a - b);
    assert.deepEqual(await countriesOf(inTrip), both, 'landen van de reis, geen reistype');
    assert.deepEqual(await countriesOf(inGallery), both);
    assert.deepEqual(await countriesOf(onCountryPage), [botswana.id]);
    assert.deepEqual(await countriesOf(manual), [botswana.id], 'met de hand gekozen land blijft');
    assert.deepEqual(await countriesOf(unused), []);
    assert.deepEqual(await countriesOf(lookalike), [], '_ is geen jokerteken');
    const audits = await db.query("SELECT entity, entity_id FROM audit_log WHERE action = 'media.gekoppeld'");
    assert.deepEqual(audits.map((row) => ({ ...row })), [{ entity: 'media', entity_id: null }], 'één regel, zonder misleidend id');
    const notice = await request('/app/fotobibliotheek/?land=zonder&gekoppeld=3', { cookie: redactie.cookie });
    assert.match(notice.text, /3 foto(&#39;|')s hebben automatisch een land gekregen\./);
    const again = await request('/app/fotobibliotheek/koppelen/', { cookie: redactie.cookie, form: { _csrf: redactie.csrf } });
    assert.equal(again.headers.get('location'), '/app/fotobibliotheek/?land=zonder&gekoppeld=0');
    // Limiet: drie keer per minuut per gebruiker (twee keer gebruikt, plus één weigering zonder token telt niet mee).
    assert.equal((await request('/app/fotobibliotheek/koppelen/', { cookie: redactie.cookie, form: { _csrf: redactie.csrf } })).status, 303);
    assert.equal((await request('/app/fotobibliotheek/koppelen/', { cookie: redactie.cookie, form: { _csrf: redactie.csrf } })).status, 429);
  });

  await t.test('foto\'s in de database: back-up, herstellen van bestanden en aanvullen van oude uploads', async () => {
    const library = app.locals.mediaLibrary;
    const crypto = require('node:crypto');
    const hash = (data) => crypto.createHash('sha256').update(data).digest('hex');
    const [item] = await db.query("SELECT m.id, m.local_name, m.variants, f.width, f.sha256 FROM media m JOIN media_files f ON f.media_id = m.id WHERE m.source = 'upload' ORDER BY m.id LIMIT 1");
    const largest = await fs.readFile(path.join(mediaDir, item.local_name));
    assert.equal(item.sha256, hash(largest), 'grootste variant staat in de database');
    assert.equal(String(item.width), Object.keys(item.variants).sort((a, b) => b - a)[0]);
    // Elke upload heeft een kopie in de database.
    const [{ missingCopies }] = await db.query("SELECT count(*)::int AS \"missingCopies\" FROM media m WHERE m.source = 'upload' AND NOT EXISTS (SELECT 1 FROM media_files f WHERE f.media_id = m.id)");
    assert.equal(missingCopies, 0);
    // Bestanden kwijt (bijv. nieuwe server na het terugzetten van een back-up): de app zet ze terug.
    for (const name of Object.values(item.variants)) await fs.rm(path.join(mediaDir, name));
    const restored = await library.restoreMissingFiles();
    assert.equal(restored.restored, 1);
    assert.equal(restored.failed, 0);
    assert.deepEqual(await fs.readFile(path.join(mediaDir, item.local_name)), largest, 'grootste variant byte voor byte gelijk');
    for (const [width, name] of Object.entries(item.variants)) {
      const metadata = await sharp(path.join(mediaDir, name)).metadata();
      assert.equal(metadata.width, Number(width));
      assert.equal(metadata.format, 'webp');
      assert.equal(metadata.exif, undefined);
    }
    assert.deepEqual(await library.restoreMissingFiles(), { restored: 0, failed: 0 }, 'niets te doen');
    // Beschadigde kopie in de database: niet herstellen.
    const smallest = Object.entries(item.variants).sort((a, b) => a[0] - b[0])[0][1];
    await fs.rm(path.join(mediaDir, smallest));
    await db.query("UPDATE media_files SET sha256 = 'fout' WHERE media_id = $1", [item.id]);
    assert.deepEqual(await library.restoreMissingFiles(), { restored: 0, failed: 1 });
    await db.query('UPDATE media_files SET sha256 = $2 WHERE media_id = $1', [item.id, hash(largest)]);
    assert.equal((await library.restoreMissingFiles()).restored, 1);
    // Een upload van vóór migratie 13 (alleen het bestand) komt alsnog in de database; zonder bestand wordt hij geteld.
    await db.query('DELETE FROM media_files WHERE media_id = $1', [item.id]);
    await db.query("INSERT INTO media (local_name, content_type, bytes, source, variants) VALUES ('bib-ffffffffffffffff-400.webp', 'image/webp', 1, 'upload', '{\"400\": \"bib-ffffffffffffffff-400.webp\"}')");
    // Een bestand dat geen WebP is, telt ook als ontbrekend en houdt de rest niet tegen.
    await fs.writeFile(path.join(mediaDir, 'bib-eeeeeeeeeeeeeeee-400.webp'), 'geen foto');
    await db.query("INSERT INTO media (local_name, content_type, bytes, source, variants) VALUES ('bib-eeeeeeeeeeeeeeee-400.webp', 'image/webp', 1, 'upload', '{\"400\": \"bib-eeeeeeeeeeeeeeee-400.webp\"}')");
    // Zonder breedte in de media-rij haalt de backfill de breedte uit het bestand.
    await db.query('UPDATE media SET width = NULL WHERE id = $1', [item.id]);
    assert.deepEqual(await library.backfillFiles(), { stored: 1, missing: 2 });
    const [copy] = await db.query('SELECT sha256, width FROM media_files WHERE media_id = $1', [item.id]);
    assert.equal(copy.sha256, hash(largest));
    assert.equal(copy.width, (await sharp(largest).metadata()).width);
    await fs.rm(path.join(mediaDir, item.local_name));
    assert.equal((await library.restoreMissingFiles()).restored, 1, 'herstel werkt ook na een backfill zonder breedte');
    assert.deepEqual(await fs.readFile(path.join(mediaDir, item.local_name)), largest);
    // Het onderhoud meldt herstel en problemen in het logboek van de app.
    await fs.rm(path.join(mediaDir, item.local_name));
    const logged = [];
    const logLibrary = createMediaLibrary({ db, mediaDir, appLog: { info: (source, message) => logged.push(['info', source, message]), error: (source, message) => logged.push(['error', source, message]) } });
    await logLibrary.startCleanupTimer();
    assert.ok(logged.some(([level, source, message]) => level === 'info' && source === 'fotobibliotheek' && message === "1 foto('s) hersteld uit de database"), JSON.stringify(logged));
    assert.ok(logged.some(([level, source, message]) => level === 'error' && source === 'fotobibliotheek' && /^2 geüploade foto/.test(message)), JSON.stringify(logged));
    await db.query("DELETE FROM media WHERE local_name IN ('bib-ffffffffffffffff-400.webp', 'bib-eeeeeeeeeeeeeeee-400.webp')");
    // Verwijderen van de foto haalt ook de kopie in de database weg.
    await db.query('DELETE FROM media WHERE id = $1', [item.id]);
    assert.equal((await db.query('SELECT media_id FROM media_files WHERE media_id = $1', [item.id])).length, 0);
  });
});
