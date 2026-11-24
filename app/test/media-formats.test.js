/**
 * Tests voor de lichtere formaten van foto's (`media/formats.js`): de index en `srcset`/`sizes` voor de site, het
 * omzetten van importfoto's naar WebP in vaste breedtes en een kleinere JPEG (nooit vergroten, beschadigd bestand
 * overslaan, stoppen bij een bijna volle schijf, losse afgeleide bestanden opruimen) en het uitserveren van de lichtere
 * JPEG onder hetzelfde adres. Het origineel blijft altijd ongewijzigd. Draait in een eigen schema en een eigen map.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { toString } = require('../src/site/html');
const tripViews = require('../src/site/trip-view');
const { renderPageHeader } = require('../src/site/layout');
const homeViews = require('../src/site/home-view');
const { BLOCK_RENDERERS } = require('../src/cms/block-render');
const {
  createImageFormats, createImageIndex, useImageIndex, imageAttributes, sizedImageUrl, scanFormats, FORMAT_DIR,
} = require('../src/media/formats');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'media_formats_test';
const MASTER_KEY = Buffer.alloc(32, 29);
const NAME_A = 'a'.repeat(20);
const NAME_B = 'b'.repeat(20);
const NAME_C = 'c'.repeat(20);
const NAME_D = 'd'.repeat(20);

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
 * Maakt een testfoto met ruis (zodat comprimeren echt iets scheelt).
 * @param {number} width Breedte.
 * @param {number} height Hoogte.
 * @param {'jpeg'|'png'} format Formaat.
 * @returns {Promise<Buffer>} Bestand.
 */
function noisyImage(width, height, format) {
  const image = sharp({ create: { width, height, channels: 3, background: '#c0603a', noise: { type: 'gaussian', mean: 128, sigma: 40 } } });
  return format === 'png' ? image.png().toBuffer() : image.jpeg({ quality: 98 }).toBuffer();
}

test('index: srcset en sizes per soort foto, en zonder versies gewoon het adres', () => {
  const index = createImageIndex();
  useImageIndex(index);
  index.set(NAME_A, { widths: [400, 800, 1600], jpeg: true });
  index.set('bib-0123456789abcdef', { widths: [400, 800], jpeg: false });

  assert.equal(toString(imageAttributes('/media/onbekend.jpg', '100px', 400)), ' src="/media/onbekend.jpg"');
  assert.equal(toString(imageAttributes(`/media/${NAME_B}.jpg`, '100px', 400)), ` src="/media/${NAME_B}.jpg"`);
  assert.equal(
    toString(imageAttributes(`/media/${NAME_A}.jpg`, '(max-width: 768px) 100px, 280px', 400)),
    ` src="/media/${FORMAT_DIR}/${NAME_A}-400.webp" srcset="/media/${FORMAT_DIR}/${NAME_A}-400.webp 400w, /media/${FORMAT_DIR}/${NAME_A}-800.webp 800w, /media/${FORMAT_DIR}/${NAME_A}-1600.webp 1600w" sizes="(max-width: 768px) 100px, 280px"`,
  );
  assert.match(toString(imageAttributes('/media/bib-0123456789abcdef-800.webp', '70px', 400)), /src="\/media\/bib-0123456789abcdef-400\.webp" srcset="\/media\/bib-0123456789abcdef-400\.webp 400w, \/media\/bib-0123456789abcdef-800\.webp 800w"/);

  assert.equal(sizedImageUrl(`/media/${NAME_A}.png`, 1000), `/media/${FORMAT_DIR}/${NAME_A}-1600.webp`);
  assert.equal(sizedImageUrl(`/media/${NAME_A}.jpg`, 5000), `/media/${FORMAT_DIR}/${NAME_A}-1600.webp`, 'groter dan er is: de grootste');
  assert.equal(sizedImageUrl('/media/bib-0123456789abcdef-400.webp', 1600), '/media/bib-0123456789abcdef-800.webp');
  assert.equal(sizedImageUrl('https://example.nl/foto.jpg', 400), 'https://example.nl/foto.jpg');
  assert.equal(sizedImageUrl(undefined, 400), undefined);
  assert.equal(sizedImageUrl(`/media/../${NAME_A}.jpg`, 400), `/media/../${NAME_A}.jpg`, 'geen ander pad dan /media/<naam>');

  // Op de site: de reisleiderslijst laadt een kleine versie pas als hij in beeld komt; de paginakop de versie van 1600.
  const teaser = toString(tripViews.guideTeaser({ slug: 'jan', name: 'Jan', photo_url: `/media/${NAME_A}.jpg`, extra: {} }));
  assert.match(teaser, new RegExp(`<img src="/media/${FORMAT_DIR}/${NAME_A}-400.webp" srcset="[^"]+ 1600w" sizes="[^"]+" alt="" loading="lazy"`));
  assert.doesNotMatch(teaser, /style=/);
  assert.match(toString(renderPageHeader({ title: 'Kop', imageUrl: `/media/${NAME_A}.jpg` })), new RegExp(`url\\('/media/${FORMAT_DIR}/${NAME_A}-1600.webp'\\)`));
  // Homepage en blokken: achtergrondfoto's in de passende versie, foto's met srcset.
  const slides = toString(homeViews.renderSlides([{ title: 'Dia', image: `/media/${NAME_A}.jpg` }]));
  assert.match(slides, new RegExp(`url\\('/media/${FORMAT_DIR}/${NAME_A}-1600.webp'\\)`));
  const destinations = toString(homeViews.renderDestinations({ title: 'T', subtitle: 'S' }, [{ slug: 'namibie', name: 'Namibië', image_url: `/media/${NAME_A}.jpg` }]));
  assert.match(destinations, new RegExp(`url\\('/media/${FORMAT_DIR}/${NAME_A}-800.webp'\\)`));
  const block = toString(BLOCK_RENDERERS.afbeelding({ data: { foto: { url: '/media/bib-0123456789abcdef-800.webp', alt: 'Foto' } } }, {}).markup);
  assert.match(block, /srcset="\/media\/bib-0123456789abcdef-400\.webp 400w, \/media\/bib-0123456789abcdef-800\.webp 800w" sizes="\(max-width: 768px\) 100vw, 800px"/);
  useImageIndex(createImageIndex());
});

test('index op schijf: bibliotheekvarianten en afgeleide bestanden, de rest genegeerd', async () => {
  const mediaDir = await fs.mkdtemp(path.join(os.tmpdir(), 'avanta-formats-scan-'));
  try {
    assert.equal((await scanFormats(mediaDir)).size, 0, 'zonder map formaten');
    await fs.mkdir(path.join(mediaDir, FORMAT_DIR));
    for (const name of ['bib-0123456789abcdef-800.webp', 'bib-0123456789abcdef-400.webp', `${NAME_A}.jpg`, 'leesmij.txt']) await fs.writeFile(path.join(mediaDir, name), 'x');
    for (const name of [`${NAME_A}-800.webp`, `${NAME_A}-400.webp`, `${NAME_A}.jpg`, `${NAME_B}-400.webp.tmp`, 'ander.webp']) await fs.writeFile(path.join(mediaDir, FORMAT_DIR, name), 'x');
    const entries = await scanFormats(mediaDir);
    assert.deepEqual(Object.fromEntries(entries), {
      'bib-0123456789abcdef': { widths: [400, 800], jpeg: false },
      [NAME_A]: { widths: [400, 800], jpeg: true },
    });
  } finally {
    await fs.rm(mediaDir, { recursive: true, force: true });
  }
});

test('importfoto\'s omzetten en de lichtere JPEG uitserveren', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (testContext) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'avanta-formats-'));
  const mediaDir = path.join(dataDir, 'media');
  await fs.mkdir(mediaDir);
  testContext.after(async () => { await db.close(); await fs.rm(dataDir, { recursive: true, force: true }); });

  const bigJpeg = await noisyImage(2600, 1400, 'jpeg');
  const smallPng = await noisyImage(300, 250, 'png');
  await fs.writeFile(path.join(mediaDir, `${NAME_A}.jpg`), bigJpeg);
  await fs.writeFile(path.join(mediaDir, `${NAME_B}.png`), smallPng);
  await fs.writeFile(path.join(mediaDir, `${NAME_C}.jpg`), Buffer.from('geen foto'));
  const insert = 'INSERT INTO media (original_url, local_name, content_type, bytes) VALUES ($1, $2, $3, $4)';
  await db.query(insert, ['https://example.nl/a.jpg', `${NAME_A}.jpg`, 'image/jpeg', bigJpeg.length]);
  await db.query(insert, ['https://example.nl/b.png', `${NAME_B}.png`, 'image/png', smallPng.length]);
  await db.query(insert, ['https://example.nl/c.jpg', `${NAME_C}.jpg`, 'image/jpeg', 9]);
  await db.query(insert, ['https://example.nl/e.jpg', `${'e'.repeat(20)}.jpg`, 'image/jpeg', 9]);
  await db.query(insert, ['https://example.nl/v.mp4', 'video.mp4', 'video/mp4', 9]);
  // Een afgeleid bestand van een foto die niet meer bestaat, en een achtergebleven tijdelijk bestand.
  await fs.mkdir(path.join(mediaDir, FORMAT_DIR));
  await fs.writeFile(path.join(mediaDir, FORMAT_DIR, `${NAME_D}-400.webp`), 'x');
  await fs.writeFile(path.join(mediaDir, FORMAT_DIR, `${NAME_B}-400.webp.tmp`), 'x');
  // Een halve set van een eerdere, onderbroken ronde: alleen de grootste versie. Die wordt afgemaakt.
  await fs.writeFile(path.join(mediaDir, FORMAT_DIR, `${NAME_A}-1600.webp`), 'half');

  const appLog = { info: () => {}, error: () => {} };

  // Bijna volle schijf: niets omzetten, niets opruimen.
  const full = createImageFormats({ db, mediaDir, appLog, pauseMs: 0, statfs: async () => ({ bavail: 10, bsize: 4096 }) });
  assert.deepEqual(await full.convertPending(), { converted: 0, failed: 0, removed: 0, stoppedForDisk: true });

  const formats = createImageFormats({ db, mediaDir, appLog, pauseMs: 0, statfs: async () => ({ bavail: 1e7, bsize: 4096 }) });
  const result = await formats.convertPending();
  assert.deepEqual(result, { converted: 2, failed: 2, removed: 2, stoppedForDisk: false }, 'beschadigd en ontbrekend bestand tellen als mislukt');
  const files = (await fs.readdir(path.join(mediaDir, FORMAT_DIR))).sort();
  assert.deepEqual(files, [`${NAME_A}-1600.webp`, `${NAME_A}-400.webp`, `${NAME_A}-800.webp`, `${NAME_A}.jpg`, `${NAME_B}-300.webp`]);
  const webp = await sharp(path.join(mediaDir, FORMAT_DIR, `${NAME_A}-800.webp`)).metadata();
  assert.equal(webp.format, 'webp');
  assert.equal(webp.width, 800);
  const jpeg = await fs.readFile(path.join(mediaDir, FORMAT_DIR, `${NAME_A}.jpg`));
  assert.ok(jpeg.length < bigJpeg.length * 0.85, 'lichtere JPEG');
  assert.equal((await sharp(jpeg).metadata()).width, 2000, 'niet breder dan 2000');
  assert.deepEqual(await fs.readFile(path.join(mediaDir, `${NAME_A}.jpg`)), bigJpeg, 'origineel ongewijzigd');
  assert.deepEqual(formats.index.get(NAME_B), { widths: [300], jpeg: false }, 'kleine foto niet vergroot, PNG zonder JPEG');
  assert.deepEqual(formats.index.get(NAME_A), { widths: [400, 800, 1600], jpeg: true }, 'halve set afgemaakt');
  assert.notEqual((await fs.readFile(path.join(mediaDir, FORMAT_DIR, `${NAME_A}-1600.webp`))).toString(), 'half');

  // Een tweede ronde doet niets opnieuw.
  assert.deepEqual(await formats.convertPending(), { converted: 0, failed: 2, removed: 0, stoppedForDisk: false });
  assert.equal(await formats.reload(), 2);

  // Via de app: de lichtere JPEG onder hetzelfde adres, de rest gewoon statisch.
  const app = createApp({ db, masterKey: MASTER_KEY, mediaDir });
  const server = app.listen(0);
  testContext.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  await app.locals.services.imageFormats.reload();
  const light = await fetch(`${base}/media/${NAME_A}.jpg`);
  assert.equal(light.status, 200);
  assert.equal(light.headers.get('content-type'), 'image/jpeg');
  assert.match(light.headers.get('cache-control'), /max-age=2592000/);
  assert.deepEqual(Buffer.from(await light.arrayBuffer()), jpeg);
  const png = await fetch(`${base}/media/${NAME_B}.png`);
  assert.deepEqual(Buffer.from(await png.arrayBuffer()), smallPng);
  const variant = await fetch(`${base}/media/${FORMAT_DIR}/${NAME_A}-400.webp`);
  assert.equal(variant.headers.get('content-type'), 'image/webp');
  const broken = await fetch(`${base}/media/${NAME_C}.jpg`);
  assert.equal(Buffer.from(await broken.arrayBuffer()).toString(), 'geen foto', 'zonder lichtere versie het origineel');
  assert.equal((await fetch(`${base}/media/${NAME_A}.jpg`, { method: 'POST' })).status, 404);
  assert.equal((await fetch(`${base}/media/${FORMAT_DIR}/..%2f..%2fpackage.json`)).status, 404);

  // Verdwijnt de lichtere JPEG van schijf, dan valt het adres terug op het origineel.
  await fs.rm(path.join(mediaDir, FORMAT_DIR, `${NAME_A}.jpg`));
  const fallback = await fetch(`${base}/media/${NAME_A}.jpg`);
  assert.deepEqual(Buffer.from(await fallback.arrayBuffer()), bigJpeg);
});

test('omzetten: meldingen in het logboek, ook bij een fout', async () => {
  const mediaDir = await fs.mkdtemp(path.join(os.tmpdir(), 'avanta-formats-log-'));
  const logged = [];
  const appLog = { info: (...args) => logged.push(['info', ...args]), error: (...args) => logged.push(['error', ...args]) };
  try {
    const failing = createImageFormats({ db: { query: async () => { throw Object.assign(new Error('weg'), { code: 'ECONNREFUSED' }); } }, mediaDir, appLog, pauseMs: 0 });
    await assert.rejects(failing.convertPending(), /weg/);
    await failing.runAndLog();
    const rows = [{ local_name: `${NAME_A}.jpg` }, { local_name: 'geen-importnaam.jpg' }];
    const full = createImageFormats({ db: { query: async () => rows }, mediaDir, appLog, pauseMs: 0, statfs: async () => ({ bavail: 0, bsize: 4096 }) });
    await full.runAndLog();
    await fs.writeFile(path.join(mediaDir, `${NAME_A}.jpg`), Buffer.from('kapot'));
    const broken = createImageFormats({ db: { query: async () => rows }, mediaDir, appLog, pauseMs: 0, statfs: async () => ({ bavail: 1e7, bsize: 4096 }) });
    await broken.runAndLog();
    await fs.writeFile(path.join(mediaDir, `${NAME_A}.jpg`), await noisyImage(500, 300, 'jpeg'));
    await broken.runAndLog();
    assert.deepEqual(logged, [
      ['error', 'fotobibliotheek', 'omzetten naar lichtere formaten mislukt (ECONNREFUSED)'],
      ['error', 'fotobibliotheek', 'omzetten naar lichtere formaten gestopt: minder dan 1 GB vrije schijfruimte'],
      ['error', 'fotobibliotheek', "1 importfoto('s) niet om te zetten naar lichtere formaten"],
      ['info', 'fotobibliotheek', "1 importfoto('s) omgezet naar lichtere formaten"],
    ]);
    // Twee rondes tegelijk: de tweede doet niets.
    const slow = createImageFormats({ db: { query: async () => [] }, mediaDir, appLog, pauseMs: 0 });
    const [first, second] = await Promise.all([slow.convertPending(), slow.convertPending()]);
    assert.deepEqual(second, { converted: 0, failed: 0, removed: 0, stoppedForDisk: false });
    assert.equal(first.stoppedForDisk, false);
  } finally {
    await fs.rm(mediaDir, { recursive: true, force: true });
  }
});
