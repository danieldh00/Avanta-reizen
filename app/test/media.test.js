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
const { mediaUrl, titleFromFilename } = require('../src/media/library');

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
  const mediaDir = await fs.mkdtemp(path.join(os.tmpdir(), 'avanta-media-'));
  const app = createApp({ db, masterKey: MASTER_KEY, mediaDir });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await db.close(); await fs.rm(mediaDir, { recursive: true, force: true }); });

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
});
