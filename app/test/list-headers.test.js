/**
 * Tests voor de laatste vaste inhoud in het CRM (W28, migratie 34): de koppen van de lijstpagina's (velden zonder
 * database, de routes onder `/app/lijstpaginas/` met rechten, 404, CSRF, wijzigen en foto, en de site en het
 * aanmeldformulier die de kop uit de database tonen) en het eenmalig overzetten van `site-content.json` naar de database
 * (koppen alleen als ze nog standaard zijn, reisleiders met galerij en volgorde, precies één keer). Eigen schema.
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
const { validateListHeaderFields, createListHeaders, isListKey, LIST_HEADER_LIMITS, DEFAULT_LIST_HEADERS } = require('../src/cms/list-headers');
const { normalizeSiteContent } = require('../src/site/site-content');
const { transferFixedContent, TRANSFER_PARTS } = require('../src/site/content-transfer');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'list_headers_test';
const MASTER_KEY = Buffer.alloc(32, 35);
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

test('lijstkoppen: velden en standaard (zonder database)', async () => {
  const good = validateListHeaderFields({ pretitle: ' Op  reis ', title: 'Reizen', introduction: 'Tekst\nmet regel' });
  assert.deepEqual(good, { values: { pretitle: 'Op reis', title: 'Reizen', introduction: 'Tekst met regel' }, errors: {} });
  const bad = validateListHeaderFields({ title: '', pretitle: 'x'.repeat(LIST_HEADER_LIMITS.pretitle + 1), introduction: ['lijst'] });
  assert.deepEqual(Object.keys(bad.errors).sort(), ['pretitle', 'title']);
  assert.equal(bad.values.introduction, '');
  assert.ok(isListKey('reis') && !isListKey('toString') && !isListKey(1));
  const headers = createListHeaders({ db: { query: async () => [] } });
  assert.deepEqual(headers.get('blog'), DEFAULT_LIST_HEADERS.blog, 'zonder geladen kopie de standaard');
});

test('lijstkoppen: een databasefout breekt de site niet (vorige kopie of standaard)', async () => {
  let clock = 0;
  let failing = false;
  const row = { key: 'blog', pretitle: 'P', title: 'Eigen blogkop', introduction: '', image_url: null, source: 'crm', updated_at: null };
  const db = { query: async () => { if (failing) throw Object.assign(new Error('weg'), { code: 'ECONNREFUSED' }); return [row]; } };
  const headers = createListHeaders({ db, now: () => clock });
  const originalError = console.error;
  console.error = () => {};
  try {
    await headers.load();
    assert.equal(headers.get('blog').title, 'Eigen blogkop');
    failing = true;
    clock = 61_000;
    await headers.load();
    assert.equal(headers.get('blog').title, 'Eigen blogkop', 'vorige kopie blijft');
    const empty = createListHeaders({ db, now: () => clock });
    await empty.load();
    assert.deepEqual(empty.get('blog'), DEFAULT_LIST_HEADERS.blog, 'nooit geladen: de standaard');
  } finally {
    console.error = originalError;
  }
});

test('lijstkoppen en overzetten', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (testContext) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'avanta-lijstkoppen-'));
  const mediaDir = path.join(dataDir, 'media');
  await fs.mkdir(mediaDir);
  const app = createApp({ db, masterKey: MASTER_KEY, mediaDir, siteContent: { load: () => normalizeSiteContent(null) } });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  testContext.after(async () => { server.close(); await db.close(); await fs.rm(dataDir, { recursive: true, force: true }); });

  const hash = await hashPassword(PASSWORD);
  for (const [email, role] of [['redactie@example.nl', 'redacteur'], ['boekhouding@example.nl', 'boekhouding']]) {
    await db.query('INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)', [email, role, role, hash]);
  }
  const [photo] = await db.query(
    `INSERT INTO media (original_url, local_name, content_type, bytes, source, title, alt_text, variants)
     VALUES (NULL, 'bib-00000000000000aa-2400.webp', 'image/webp', 10, 'upload', 'Kop', 'Kop', '{"800": "bib-00000000000000aa-800.webp", "1600": "bib-00000000000000aa-1600.webp", "2400": "bib-00000000000000aa-2400.webp"}') RETURNING id`,
  );
  await db.query("INSERT INTO trips (slug, title, departure_date, published) VALUES ('ijsland', 'IJsland', '2099-07-01', true)");

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

  const redactie = await login('redactie@example.nl');
  const boekhouding = await login('boekhouding@example.nl');
  const post = (url, form, session = redactie) => request(url, { cookie: session.cookie, form: { _csrf: session.csrf, ...form } });

  await testContext.test('rechten, 404 en CSRF', async () => {
    assert.equal((await request('/app/lijstpaginas/')).status, 303, 'zonder sessie naar inloggen');
    for (const url of ['/app/lijstpaginas/', '/app/lijstpaginas/reis/', '/app/lijstpaginas/reis/foto/']) {
      assert.equal((await request(url, { cookie: boekhouding.cookie })).status, 403, url);
    }
    assert.equal((await post('/app/lijstpaginas/reis/', { title: 'X' }, boekhouding)).status, 403);
    assert.equal((await post('/app/lijstpaginas/reis/foto/', { media_id: String(photo.id) }, boekhouding)).status, 403);
    assert.equal((await request('/app/lijstpaginas/onbekend/', { cookie: redactie.cookie })).status, 404);
    assert.equal((await post('/app/lijstpaginas/onbekend/', { title: 'X' })).status, 404);
    assert.equal((await request('/app/lijstpaginas/reis/', { cookie: redactie.cookie, form: { _csrf: 'fout', title: 'X' } })).status, 403, 'CSRF');
    const list = await request('/app/lijstpaginas/', { cookie: redactie.cookie });
    assert.equal(list.status, 200);
    assert.match(list.text, /href="\/app\/lijstpaginas\/" aria-current="page"/, 'in het menu');
    for (const key of ['reis', 'reisleider', 'blog', 'faq', 'aanmelden']) assert.match(list.text, new RegExp(`/app/lijstpaginas/${key}/`));
    assert.match(list.text, /Standaardtekst/);
  });

  await testContext.test('wijzigen: site en aanmeldformulier tonen de kop uit de database', async () => {
    assert.match((await request('/reis/')).text, /Ons reisaanbod/, 'standaard uit de migratie');
    assert.equal((await post('/app/lijstpaginas/reis/', { title: '' })).status, 422);
    const saved = await post('/app/lijstpaginas/reis/', { pretitle: 'Al 40 jaar', title: 'Alle reizen', introduction: '' });
    assert.equal(saved.status, 303);
    assert.equal(saved.headers.get('location'), '/app/lijstpaginas/reis/?opgeslagen=1');
    const site = (await request('/reis/')).text;
    assert.match(site, /Alle reizen/);
    assert.match(site, /Al 40 jaar/);
    assert.equal((await post('/app/lijstpaginas/aanmelden/', { pretitle: 'Mee!', title: 'Inschrijven', introduction: 'Vul alles in.' })).status, 303);
    const form = (await request('/aanmelden/?reis=ijsland')).text;
    assert.match(form, /Inschrijven/);
    assert.match(form, /Vul alles in\./);
    for (const [key, path, title] of [['reisleider', '/reisleider/', 'Onze gidsen'], ['blog', '/blog/', 'Verhalen'], ['faq', '/faq/', 'Vragen']]) {
      assert.equal((await post(`/app/lijstpaginas/${key}/`, { title })).status, 303);
      assert.match((await request(path)).text, new RegExp(title), path);
    }
    const [row] = await db.query("SELECT source, updated_by FROM list_headers WHERE key = 'reis'");
    assert.equal(row.source, 'crm');
    assert.ok(row.updated_by);
    assert.match((await request('/app/lijstpaginas/', { cookie: redactie.cookie })).text, /Gewijzigd in het CRM/);
  });

  await testContext.test('foto uit de bibliotheek en weer weg', async () => {
    assert.match((await request('/app/lijstpaginas/blog/foto/', { cookie: redactie.cookie })).text, /bib-00000000000000aa-800\.webp/);
    assert.equal((await post('/app/lijstpaginas/blog/foto/', {})).status, 422);
    assert.equal((await post('/app/lijstpaginas/blog/foto/', { media_id: '999999' })).status, 409);
    assert.equal((await post('/app/lijstpaginas/blog/foto/', { media_id: String(photo.id) })).status, 303);
    assert.equal((await db.query("SELECT image_url FROM list_headers WHERE key = 'blog'"))[0].image_url, '/media/bib-00000000000000aa-1600.webp');
    assert.match((await request('/blog/')).text, /bib-00000000000000aa-1600\.webp/);
    assert.match((await request('/app/lijstpaginas/blog/', { cookie: redactie.cookie })).text, /Andere foto kiezen/);
    assert.equal((await post('/app/lijstpaginas/blog/foto/', { geen: '1' })).status, 303);
    assert.equal((await db.query("SELECT image_url FROM list_headers WHERE key = 'blog'"))[0].image_url, null);
    const audits = await db.query("SELECT action, entity, entity_id FROM audit_log WHERE entity = 'list_headers' ORDER BY id");
    assert.ok(audits.some((entry) => entry.action === 'lijstkop.gewijzigd' && entry.entity_id === 'reis'));
    assert.ok(audits.some((entry) => entry.action === 'lijstkop.foto' && entry.entity_id === 'blog'));
  });

  await testContext.test('overzetten uit site-content.json: één keer, wat in het CRM staat blijft', async () => {
    await db.query("INSERT INTO guides (slug, name, published, sort_order) VALUES ('bram', 'Bram', true, 0), ('carla', 'Carla', true, 0), ('anna', 'Anna', true, 0)");
    await db.query("INSERT INTO guides (slug, name, published, managed_in_crm, surname) VALUES ('dirk', 'Dirk', true, true, 'Eigen')");
    const fixed = normalizeSiteContent({
      archives: { reis: { title: 'Uit het bestand' }, faq: { title: 'FAQ uit bestand', image: '/media/faq.jpg' }, aanmelden: { title: 'Ook uit bestand' } },
      guideOrder: ['carla', 'dirk', 'onbekend'],
      guides: {
        carla: { surname: 'de Wit', city: 'Ede', gallery: ['/media/carla-1.jpg'], galleryTitle: 'Carla onderweg' },
        dirk: { surname: 'Bestand', gallery: ['/media/dirk-1.jpg'] },
      },
    });
    assert.deepEqual(await transferFixedContent({ db, siteContent: null }), [], 'zonder bestand niets');
    // Koppen die al in het CRM zijn gewijzigd blijven; één kop nog standaard.
    await db.query("UPDATE list_headers SET source = 'standaard' WHERE key = 'aanmelden'");
    const parts = await transferFixedContent({ db, siteContent: fixed });
    assert.deepEqual(parts.map((part) => part.part), TRANSFER_PARTS);
    const headers = await db.query('SELECT key, title, image_url, source FROM list_headers ORDER BY key');
    const byKey = Object.fromEntries(headers.map((row) => [row.key, row]));
    assert.equal(byKey.reis.title, 'Alle reizen', 'in het CRM gewijzigd: blijft');
    assert.equal(byKey.faq.title, 'Vragen');
    assert.deepEqual([byKey.aanmelden.title, byKey.aanmelden.source], ['Ook uit bestand', 'bestand']);

    const guides = await db.query('SELECT slug, surname, city, managed_in_crm, gallery, gallery_title, sort_order FROM guides ORDER BY sort_order, slug');
    assert.deepEqual(guides.map((guide) => guide.slug), ['carla', 'dirk', 'anna', 'bram'], 'volgorde van de site, daarna op naam');
    const carla = guides[0];
    assert.deepEqual([carla.surname, carla.city, carla.managed_in_crm, carla.gallery_title], ['de Wit', 'Ede', true, 'Carla onderweg']);
    assert.deepEqual(carla.gallery, [{ url: '/media/carla-1.jpg', alt: '' }]);
    const dirk = guides[1];
    assert.equal(dirk.surname, 'Eigen', 'al beheerd: profiel blijft');
    assert.deepEqual(dirk.gallery, [{ url: '/media/dirk-1.jpg', alt: '' }], 'lege galerij aangevuld');
    assert.ok(guides.every((guide) => guide.managed_in_crm), 'alle reisleiders nu in het CRM');
    const list = (await request('/reisleider/')).text;
    assert.ok(list.indexOf('Carla') < list.indexOf('Anna') && list.indexOf('Anna') < list.indexOf('Bram'));
    assert.match((await request('/reisleider/carla/')).text, /carla-1\.jpg/);

    // Tweede keer: niets meer, ook niet als het bestand anders is.
    await db.query("UPDATE guides SET sort_order = 50 WHERE slug = 'carla'");
    assert.deepEqual(await transferFixedContent({ db, siteContent: normalizeSiteContent({ guideOrder: ['carla'] }) }), []);
    assert.equal((await db.query("SELECT sort_order FROM guides WHERE slug = 'carla'"))[0].sort_order, 50);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM content_transfers'))[0].count, TRANSFER_PARTS.length);
  });

  await testContext.test('overzetten zonder volgorde laat de volgorde staan', async () => {
    await db.query('DELETE FROM content_transfers');
    await db.query("UPDATE guides SET gallery = '[]'::jsonb WHERE slug = 'dirk'");
    const parts = await transferFixedContent({ db, siteContent: normalizeSiteContent({ guides: { dirk: { gallery: [] } } }) });
    assert.match(parts.find((part) => part.part === 'reisleiders').summary, /volgorde ongewijzigd/);
    assert.equal((await db.query("SELECT sort_order FROM guides WHERE slug = 'carla'"))[0].sort_order, 50);
  });
});
