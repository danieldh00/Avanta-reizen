/**
 * Tests voor veelgestelde vragen in het CMS (pakket I3, migratie 21): velden controleren (zonder database), de migratie
 * die bestaande categorieën overneemt, en de routes onder `/app/faq/`: rechten (zonder sessie naar inloggen,
 * reisleider en boekhouding 403, redacteur wel), onbekend id → 404, CSRF, categorie en vraag toevoegen, wijzigen
 * (naam gaat mee naar de vragen, volgorde op de site), verwijderen (categorie alleen leeg), het antwoord zonder
 * scripts, de auditlog en de WordPress-import die vragen uit het CRM laat staan. Draait in een eigen schema.
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
const { normalizeSiteContent } = require('../src/site/site-content');

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

test('faq in het CRM', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'avanta-faq-'));
  const mediaDir = path.join(dataDir, 'media');
  await fs.mkdir(mediaDir);
  const siteContent = { load: () => normalizeSiteContent({}) };
  const app = createApp({ db, masterKey: MASTER_KEY, mediaDir, siteContent });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await db.close(); await fs.rm(dataDir, { recursive: true, force: true }); });

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

  await t.test('migratie 21: bestaande categorieën worden categorieën, alfabetisch', async () => {
    await db.query(`INSERT INTO faqs (slug, question, answer_html, category, sort_order) VALUES
      ('oud-1', 'Paspoort nodig?', '<p>Ja</p>', 'Reizen', 2), ('oud-2', 'Hoe betaal ik?', '<p>Via de bank</p>', 'Betalen', 1),
      ('oud-3', 'Kan ik annuleren?', '<p>Soms</p>', 'reizen', 1), ('oud-4', 'Zonder?', '<p>Ja</p>', '', 0)`);
    await db.query('DROP INDEX faqs_category_idx; ALTER TABLE faqs DROP COLUMN category_id, DROP COLUMN managed_in_crm, DROP COLUMN updated_at, DROP COLUMN updated_by; DROP TABLE faq_categories; DELETE FROM schema_migrations WHERE id = 21');
    assert.deepEqual(await db.migrate(), [21]);
    assert.deepEqual((await db.query('SELECT name, sort_order FROM faq_categories ORDER BY sort_order')).map((row) => [row.name, row.sort_order]), [['Algemeen', 10], ['Betalen', 20], ['Reizen', 30]]);
    const rows = await db.query('SELECT f.slug, f.category, c.name FROM faqs f JOIN faq_categories c ON c.id = f.category_id ORDER BY f.slug');
    assert.deepEqual(rows.map((row) => [row.slug, row.category, row.name]), [['oud-1', 'Reizen', 'Reizen'], ['oud-2', 'Betalen', 'Betalen'], ['oud-3', 'Reizen', 'Reizen'], ['oud-4', 'Algemeen', 'Algemeen']]);
  });

  await t.test('rechten: zonder sessie naar inloggen, reisleider en boekhouding 403, redacteur wel; menu', async () => {
    const [question] = await db.query("SELECT id FROM faqs WHERE slug = 'oud-1'");
    const [category] = await db.query("SELECT id FROM faq_categories WHERE name = 'Reizen'");
    assert.equal((await request('/app/faq/')).status, 303);
    for (const session of [leider, boekhouding]) {
      assert.equal((await request('/app/faq/', { cookie: session.cookie })).status, 403);
      assert.equal((await request('/app/faq/nieuw/', { cookie: session.cookie })).status, 403);
      assert.equal((await request(`/app/faq/${question.id}/`, { cookie: session.cookie })).status, 403);
      assert.equal((await post('/app/faq/nieuw/', { question: 'X', category_id: String(category.id), answer: '<p>x</p>' }, session)).status, 403);
      assert.equal((await post(`/app/faq/${question.id}/verwijderen/`, { zeker: 'ja' }, session)).status, 403);
      assert.equal((await post('/app/faq/categorieen/nieuw/', { name: 'X' }, session)).status, 403);
      assert.equal((await post(`/app/faq/categorieen/${category.id}/`, { name: 'X' }, session)).status, 403);
    }
    const overview = await request('/app/faq/', { cookie: redactie.cookie });
    assert.equal(overview.status, 200);
    assert.match(overview.text, /href="\/app\/faq\/" aria-current="page"/);
    assert.match(overview.text, /Paspoort nodig\?/);
    assert.equal((await request('/app/faq/999999/', { cookie: redactie.cookie })).status, 404);
    assert.equal((await request('/app/faq/categorieen/999999/', { cookie: redactie.cookie })).status, 404);
    assert.equal((await post('/app/faq/999999/', { question: 'X', category_id: String(category.id), answer: '<p>x</p>' })).status, 404);
    assert.equal((await post('/app/faq/categorieen/999999/verwijderen/', { zeker: 'ja' })).status, 404);
    assert.equal((await request('/app/faq/categorieen/nieuw/', { cookie: redactie.cookie, form: { _csrf: 'fout', name: 'X' } })).status, 403, 'CSRF');
  });

  await t.test('categorie en vraag toevoegen, wijzigen en verwijderen; volgorde op de site', async () => {
    assert.equal((await post('/app/faq/categorieen/nieuw/', { name: 'betalen' })).status, 422, 'bestaat al (hoofdletters tellen niet)');
    const created = await post('/app/faq/categorieen/nieuw/', { name: 'Voorbereiding', sort_order: '5' });
    assert.equal(created.status, 303);
    const [category] = await db.query("SELECT id FROM faq_categories WHERE name = 'Voorbereiding'");
    assert.equal(created.headers.get('location'), `/app/faq/?melding=1#categorie-${category.id}`);

    assert.equal((await post('/app/faq/nieuw/', { question: 'Wat neem ik mee?', category_id: '999999', answer: '<p>Veel</p>' })).status, 422, 'onbekende categorie');
    const refused = await post('/app/faq/nieuw/', { question: '', category_id: String(category.id), answer: '' });
    assert.equal(refused.status, 422);
    assert.match(refused.text, /Vul een vraag in/);
    for (const attempt of [1, 2]) {
      assert.equal((await post('/app/faq/nieuw/', { question: 'Wat neem ik mee?', category_id: String(category.id), answer: '<p>Een <strong>slaapzak</strong><script>alert(1)</script></p>', sort_order: String(attempt) })).status, 303);
    }
    const added = await db.query('SELECT id, slug, answer_html, category, managed_in_crm FROM faqs WHERE category_id = $1 ORDER BY sort_order', [category.id]);
    assert.deepEqual(added.map((row) => row.slug), ['wat-neem-ik-mee', 'wat-neem-ik-mee-2'], 'unieke slug');
    assert.ok(added.every((row) => row.managed_in_crm && row.category === 'Voorbereiding' && !/script/.test(row.answer_html)));

    // Voorbereiding (5) staat op de site vóór Algemeen (10); de vragen op volgorde.
    let site = await request('/faq/');
    assert.ok(site.text.indexOf('Voorbereiding') < site.text.indexOf('Algemeen'));
    assert.match(site.text, /<strong>slaapzak<\/strong>/);
    assert.doesNotMatch(site.text, /alert\(1\)/);

    // Vraag wijzigen naar een andere categorie; formulier toont de bestaande waarden.
    const [betalen] = await db.query("SELECT id FROM faq_categories WHERE name = 'Betalen'");
    assert.match((await request(`/app/faq/${added[1].id}/`, { cookie: redactie.cookie })).text, /value="Wat neem ik mee\?"/);
    assert.equal((await post(`/app/faq/${added[1].id}/`, { question: 'Wanneer betaal ik?', category_id: String(betalen.id), answer: '<p>Voor vertrek</p>', sort_order: '0' })).status, 303);
    assert.deepEqual((await db.query('SELECT question, category FROM faqs WHERE id = $1', [added[1].id]))[0], { question: 'Wanneer betaal ik?', category: 'Betalen' });

    // Categorie hernoemen: de naam gaat mee naar de vragen; ook de import-vragen worden dan van het CRM.
    const renamed = await post(`/app/faq/categorieen/${betalen.id}/`, { name: 'Betalen en annuleren', sort_order: '1' });
    assert.equal(renamed.headers.get('location'), `/app/faq/?melding=4#categorie-${betalen.id}`);
    assert.deepEqual((await db.query('SELECT DISTINCT category, managed_in_crm FROM faqs WHERE category_id = $1', [betalen.id])).map((row) => [row.category, row.managed_in_crm]), [['Betalen en annuleren', true]]);
    assert.equal((await post(`/app/faq/categorieen/${betalen.id}/`, { name: 'Reizen' })).status, 422, 'naam bestaat al');
    site = await request('/faq/');
    assert.ok(site.text.indexOf('Betalen en annuleren') < site.text.indexOf('Voorbereiding'));

    // Verwijderen: vinkje nodig; een categorie met vragen niet.
    assert.equal((await post(`/app/faq/${added[0].id}/verwijderen/`, {})).status, 422);
    assert.equal((await post(`/app/faq/${added[0].id}/verwijderen/`, { zeker: 'ja' })).status, 303);
    assert.equal((await post(`/app/faq/categorieen/${category.id}/verwijderen/`, { zeker: 'ja' })).status, 303, 'nu leeg');
    const full = await post(`/app/faq/categorieen/${betalen.id}/verwijderen/`, { zeker: 'ja' });
    assert.equal(full.status, 422);
    assert.match(full.text, /nog vragen/);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM faq_categories WHERE id = $1', [betalen.id]))[0].count, 1);

    for (const action of ['faq.vraag-nieuw', 'faq.vraag-gewijzigd', 'faq.vraag-verwijderd', 'faq.categorie-nieuw', 'faq.categorie-gewijzigd', 'faq.categorie-verwijderd']) {
      assert.ok(await audits(action) >= 1, action);
    }
  });

  await t.test('de WordPress-import laat vragen uit het CRM staan en vult categorieën', async () => {
    const before = await db.query('SELECT slug FROM faqs WHERE managed_in_crm ORDER BY slug');
    await store(db, {
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
  });
});
