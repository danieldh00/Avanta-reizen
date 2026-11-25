/**
 * Tests voor veelgestelde vragen in het CMS (pakket I3, migratie 21): velden controleren (zonder database), de migratie
 * die bestaande categorieën overneemt, de pagina's onder `/app/faq/` (rechten: zonder sessie naar inloggen,
 * reisleider en boekhouding 403, redacteur wel; onbekend id 404; de oude formulieren zijn weg), de volgorde en het
 * opgeschoonde antwoord op de site, en de WordPress-import die vragen uit het CRM laat staan. Wijzigen zelf loopt via
 * de API (`cms-faq-api.test.js`). Draait in een eigen schema.
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
const { validateCategoryFields, validateQuestionFields, FAQ_LIMITS } = require('../src/cms/faqs');
const { store } = require('../tools/import-wordpress');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'cms_faq_test';
const MASTER_KEY = Buffer.alloc(32, 33);
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

test('faq: velden controleren (zonder database)', () => {
  assert.deepEqual(validateCategoryFields({ name: '  Reizen  boeken ', sort_order: '-5' }), { values: { name: 'Reizen boeken', sortOrder: -5 }, errors: {} });
  assert.ok(validateCategoryFields({ name: '' }).errors.name);
  assert.ok(validateCategoryFields({ name: 'A<b>' }).errors.name, 'geen < of >');
  assert.ok(validateCategoryFields({ name: 'x'.repeat(FAQ_LIMITS.category + 1) }).errors.name);
  assert.ok(validateCategoryFields({ name: 'Goed', sort_order: '1.5' }).errors.sort_order);
  const good = validateQuestionFields({ question: ' Wat kost het? ', category_id: '3', answer: '<p>Weinig<script>alert(1)</script></p>', sort_order: '' });
  assert.deepEqual(good.errors, {});
  assert.equal(good.values.question, 'Wat kost het?');
  assert.doesNotMatch(good.values.answerHtml, /script/);
  assert.match(good.values.answerHtml, /<p>Weinig/);
  const bad = validateQuestionFields({ question: '', category_id: 'x', answer: '<script>alert(1)</script>', sort_order: 'a' });
  assert.deepEqual(Object.keys(bad.errors).sort(), ['answer', 'category_id', 'question', 'sort_order']);
  assert.ok(validateQuestionFields({ question: 'V', category_id: '1', answer: 'x'.repeat(FAQ_LIMITS.answer + 1) }).errors.answer);
  assert.ok(validateQuestionFields({ question: ['lijst'], category_id: '1', answer: '<p>a</p>' }).errors.question, 'geen lijst');
});

test('faq in het CRM', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (testContext) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'avanta-faq-'));
  const mediaDir = path.join(dataDir, 'media');
  await fs.mkdir(mediaDir);
  // Zonder bundel van de frontend (ook als `web/dist/` lokaal gebouwd is); met bundel: `web-bundle.test.js`.
  const app = createApp({ db, masterKey: MASTER_KEY, mediaDir, webDistDir: dataDir });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  testContext.after(async () => { server.close(); await db.close(); await fs.rm(dataDir, { recursive: true, force: true }); });

  const hash = await hashPassword(PASSWORD);
  for (const [email, role] of [['leider@example.nl', 'reisleider'], ['redactie@example.nl', 'redacteur'], ['boekhouding@example.nl', 'boekhouding']]) {
    await db.query('INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)', [email, role, role, hash]);
  }

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
  const leider = await login('leider@example.nl');
  const boekhouding = await login('boekhouding@example.nl');
  const post = (url, form, session = redactie) => request(url, { cookie: session.cookie, form: { _csrf: session.csrf, ...form } });
  const audits = async (action) => (await db.query('SELECT count(*)::int AS count FROM audit_log WHERE action = $1', [action]))[0].count;

  await testContext.test('migratie 21: bestaande categorieën worden categorieën, alfabetisch', async () => {
    await db.query(`INSERT INTO faqs (slug, question, answer_html, category, sort_order) VALUES
      ('oud-1', 'Paspoort nodig?', '<p>Ja</p>', 'Reizen', 2), ('oud-2', 'Hoe betaal ik?', '<p>Via de bank</p>', 'Betalen', 1),
      ('oud-3', 'Kan ik annuleren?', '<p>Soms</p>', 'reizen', 1), ('oud-4', 'Zonder?', '<p>Ja</p>', '', 0)`);
    await db.query('DROP INDEX faqs_category_idx; ALTER TABLE faqs DROP COLUMN category_id, DROP COLUMN managed_in_crm, DROP COLUMN updated_at, DROP COLUMN updated_by; DROP TABLE faq_categories; DELETE FROM schema_migrations WHERE id = 21');
    assert.deepEqual(await db.migrate(), [21]);
    assert.deepEqual((await db.query('SELECT name, sort_order FROM faq_categories ORDER BY sort_order')).map((row) => [row.name, row.sort_order]), [['Algemeen', 10], ['Betalen', 20], ['Reizen', 30]]);
    const rows = await db.query('SELECT f.slug, f.category, c.name FROM faqs f JOIN faq_categories c ON c.id = f.category_id ORDER BY f.slug');
    assert.deepEqual(rows.map((row) => [row.slug, row.category, row.name]), [['oud-1', 'Reizen', 'Reizen'], ['oud-2', 'Betalen', 'Betalen'], ['oud-3', 'Reizen', 'Reizen'], ['oud-4', 'Algemeen', 'Algemeen']]);
  });

  await testContext.test('pagina\'s: zonder sessie naar inloggen, reisleider en boekhouding 403, redacteur wel; menu', async () => {
    const [question] = await db.query("SELECT id FROM faqs WHERE slug = 'oud-1'");
    const [category] = await db.query("SELECT id FROM faq_categories WHERE name = 'Reizen'");
    const pages = ['/app/faq/', '/app/faq/nieuw/', `/app/faq/${question.id}/`, `/app/faq/categorieen/${category.id}/`];
    for (const url of pages) {
      assert.equal((await request(url)).status, 303, url);
      for (const session of [leider, boekhouding]) assert.equal((await request(url, { cookie: session.cookie })).status, 403, url);
      const page = await request(url, { cookie: redactie.cookie });
      assert.equal(page.status, 200, url);
      assert.match(page.text, /href="\/app\/faq\/" aria-current="page"/);
      assert.match(page.text, /niet beschikbaar/, 'zonder bundel: melding in plaats van het scherm');
      assert.doesNotMatch(page.text, /Paspoort nodig\?/, 'de inhoud komt via de API');
    }
    assert.match((await request(`/app/faq/categorieen/${category.id}/`, { cookie: redactie.cookie })).text, /<title>Categorie: Reizen - Avanta CRM<\/title>/);
    assert.equal((await request('/app/faq/999999/', { cookie: redactie.cookie })).status, 404);
    assert.equal((await request('/app/faq/categorieen/999999/', { cookie: redactie.cookie })).status, 404);
  });

  await testContext.test('de oude formulieren zijn weg: posten wijzigt niets', async () => {
    const [question] = await db.query("SELECT id FROM faqs WHERE slug = 'oud-1'");
    const [category] = await db.query("SELECT id FROM faq_categories WHERE name = 'Reizen'");
    const before = (await db.query('SELECT count(*)::int AS count FROM faqs'))[0].count;
    for (const url of ['/app/faq/nieuw/', `/app/faq/${question.id}/`, `/app/faq/${question.id}/verwijderen/`, '/app/faq/categorieen/nieuw/', `/app/faq/categorieen/${category.id}/`, `/app/faq/categorieen/${category.id}/verwijderen/`]) {
      const response = await post(url, { question: 'X', category_id: String(category.id), answer: '<p>x</p>', name: 'X', zeker: 'ja' });
      assert.equal(response.status, 404, url);
    }
    assert.equal((await db.query('SELECT count(*)::int AS count FROM faqs'))[0].count, before);
    assert.equal((await db.query('SELECT name FROM faq_categories WHERE id = $1', [category.id]))[0].name, 'Reizen');
  });

  await testContext.test('volgorde, opgeschoond antwoord en hernoemen (via de API)', async () => {
    /**
     * Doet een verzoek naar de JSON-API als redacteur.
     * @param {string} method Methode.
     * @param {string} url Pad binnen `/app/api`.
     * @param {any} body JSON-inhoud.
     * @returns {Promise<any>} JSON.
     */
    const api = async (method, url, body) => {
      const response = await fetch(`${base}/app/api${url}`, { method, headers: { 'x-avanta-api': '1', 'content-type': 'application/json', cookie: `${COOKIE_NAME}=${redactie.cookie}` }, body: JSON.stringify(body) });
      assert.ok(response.ok, `${method} ${url}: ${response.status}`);
      return response.json();
    };
    const category = await api('POST', '/faq/categorieen/', { naam: 'Voorbereiding', volgorde: 5 });
    await api('POST', '/faq/vragen/', { vraag: 'Wat neem ik mee?', categorieId: category.id, antwoord: '<p>Een <strong>slaapzak</strong><script>alert(1)</script></p>', volgorde: 1 });
    // Voorbereiding (5) staat op de site vóór Algemeen (10).
    const site = (await request('/faq/')).text;
    assert.ok(site.indexOf('Voorbereiding') < site.indexOf('Algemeen'));
    assert.match(site, /<strong>slaapzak<\/strong>/);
    assert.doesNotMatch(site, /alert\(1\)/);
    assert.ok(await audits('faq.vraag-nieuw') >= 1);
    // Hernoemen: de vragen uit de import in die categorie worden van het CRM (de import hieronder laat ze staan).
    const [betalen] = await db.query("SELECT id FROM faq_categories WHERE name = 'Betalen'");
    assert.equal((await api('PUT', `/faq/categorieen/${betalen.id}/`, { naam: 'Betalen en annuleren', volgorde: 1 })).hernoemd, true);
    assert.deepEqual((await db.query('SELECT DISTINCT category, managed_in_crm FROM faqs WHERE category_id = $1', [betalen.id])).map((row) => [row.category, row.managed_in_crm]), [['Betalen en annuleren', true]]);
    const renamedSite = (await request('/faq/')).text;
    assert.ok(renamedSite.indexOf('Betalen en annuleren') < renamedSite.indexOf('Voorbereiding'), 'nieuwe naam en volgorde op de site');
    assert.ok(await audits('faq.categorie-gewijzigd') >= 1);
  });

  await testContext.test('de WordPress-import laat vragen uit het CRM staan en vult categorieën', async () => {
    const before = await db.query('SELECT slug FROM faqs WHERE managed_in_crm ORDER BY slug');
    const counts = await store(db, {
      guides: [], categories: [], trips: [], posts: [], pages: [],
      faqs: [
        { slug: 'oud-2', question: 'Overschreven?', answerHtml: '<p>Nee</p>', category: 'Betalen', sortOrder: 1 },
        { slug: 'nieuw-uit-wp', question: 'Nieuw uit WP', answerHtml: '<p>WP</p>', category: 'Groepen <b>', sortOrder: 1 },
      ],
    });
    assert.deepEqual((await db.query('SELECT slug FROM faqs WHERE managed_in_crm ORDER BY slug')).map((row) => row.slug), before.map((row) => row.slug));
    assert.equal((await db.query("SELECT question FROM faqs WHERE slug = 'oud-2'"))[0].question, 'Hoe betaal ik?', 'CRM-vraag blijft');
    const [fresh] = await db.query("SELECT f.category, c.name FROM faqs f JOIN faq_categories c ON c.id = f.category_id WHERE f.slug = 'nieuw-uit-wp'");
    assert.deepEqual([fresh.category, fresh.name], ['Groepen b', 'Groepen b']);
    assert.equal((await db.query("SELECT count(*)::int AS count FROM faqs WHERE slug = 'oud-1'"))[0].count, 0, 'niet-beheerde import-vraag vervangen');
    assert.deepEqual([counts.faq, counts.faqUitCrm], [1, 1]);
    assert.equal((await db.query("SELECT count(*)::int AS count FROM faq_categories WHERE name = 'Betalen'"))[0].count, 0, 'hernoemde categorie komt niet terug');

    // Een vraag zonder categorie staat op de site achter alle categorieën.
    await db.query("INSERT INTO faqs (slug, question, answer_html, category) VALUES ('los', 'Losse vraag?', '<p>Ja</p>', 'Aaa los')");
    const site = (await request('/faq/')).text;
    assert.ok(site.indexOf('Aaa los') > site.indexOf('Groepen b'), 'losse vragen achteraan');
  });
});
