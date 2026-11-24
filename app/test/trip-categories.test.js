/**
 * Tests voor reistypes en landen beheren (CMS-pakket G1, migratie 14): slugs, controle van de velden, het icoon, en de
 * routes onder `/app/reistypes-en-landen/`: rechten (zonder sessie naar inloggen, zonder recht 403), aanmaken met een
 * dubbele slug, wijzigen met automatische 301, opgeschoonde HTML, foto uit de bibliotheek (vergrendeld, "gebruikt in"),
 * samenvoegen van dubbelingen, verwijderen alleen als ongebruikt, onbekend id → 404, CSRF, de homepage-keuze en de
 * auditlog. Draait in een eigen schema.
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
const { slugify, isValidSlug } = require('../src/trips/slugs');
const { validateCategory } = require('../src/trips/categories');
const { categoryIconName } = require('../src/site/icons');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'trip_categories_test';
const MASTER_KEY = Buffer.alloc(32, 29);
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

test('slugs: maken en controleren', () => {
  assert.equal(slugify('Saoedi-Arabië & Jordanië'), 'saoedi-arabie-jordanie');
  assert.equal(slugify('  --Zuid Afrika--  '), 'zuid-afrika');
  assert.equal(slugify('ë'.repeat(5)), 'eeeee');
  assert.equal(slugify('a'.repeat(100)).length, 80);
  assert.equal(isValidSlug('namibie'), true);
  assert.equal(isValidSlug('saudi-arabie-2'), true);
  assert.equal(isValidSlug('Namibie'), false);
  assert.equal(isValidSlug('a--b'), false);
  assert.equal(isValidSlug('../x'), false);
  assert.equal(isValidSlug(''), false);
});

test('velden van een categorie controleren', () => {
  const ok = validateCategory({ name: ' Namibië ', slug: '', kind: 'bestemming', icon: '', intro: 'Intro', body_html: '<p onclick="x()">Hoi<script>alert(1)</script></p>', sort_order: '3', show_on_home: '1' });
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.values.slug, 'namibie');
  assert.equal(ok.values.sortOrder, 3);
  assert.equal(ok.values.showOnHome, true);
  assert.equal(ok.values.bodyHtml, '<p>Hoi</p>');
  const bad = validateCategory({ name: '', slug: 'Fout!', kind: 'iets', icon: 'onbekend', sort_order: '1.5' });
  assert.deepEqual(Object.keys(bad.errors).sort(), ['icon', 'kind', 'name', 'slug', 'sort_order']);
  assert.equal(validateCategory({ name: 'x', kind: 'type', sort_order: ['1', '2'] }).errors.sort_order, undefined, 'herhaald veld telt als leeg');
});

test('icoon van een reistype: gekozen, anders op de slug', () => {
  assert.equal(categoryIconName({ slug: 'jeugd', icon: '' }), 'jeugd');
  assert.equal(categoryIconName({ slug: 'jeugd', icon: 'vliegreis' }), 'vliegreis');
  assert.equal(categoryIconName({ slug: 'jeugd', icon: 'bestaat-niet' }), 'jeugd');
  assert.equal(categoryIconName({ slug: 'onbekend' }), 'verre-reizen');
});

test('reistypes en landen in het CRM', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (testContext) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  // Begin zonder de lijst met alle landen uit migratie 33: deze test maakt zijn eigen landen.
  await db.query('DELETE FROM trip_categories WHERE iso_code IS NOT NULL');
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'avanta-categorie-'));
  const mediaDir = path.join(dataDir, 'media');
  await fs.mkdir(mediaDir);
  const app = createApp({ db, masterKey: MASTER_KEY, mediaDir });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  testContext.after(async () => { server.close(); await db.close(); await fs.rm(dataDir, { recursive: true, force: true }); });

  const hash = await hashPassword(PASSWORD);
  for (const [email, role] of [['kantoor@example.nl', 'kantoor'], ['leider@example.nl', 'reisleider'], ['redactie@example.nl', 'redacteur']]) {
    await db.query('INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)', [email, role, role, hash]);
  }
  const [namibia] = await db.query("INSERT INTO trip_categories (slug, name, kind) VALUES ('namibie', 'Namibië', 'bestemming') RETURNING id");
  const [double] = await db.query("INSERT INTO trip_categories (slug, name, kind) VALUES ('namibie-2', 'Namibie', 'bestemming') RETURNING id");
  const [hostel] = await db.query("INSERT INTO trip_categories (slug, name, kind) VALUES ('hostel', 'Hostel', 'type') RETURNING id");
  await db.query("INSERT INTO trip_categories (slug, name, kind) VALUES ('jeugd', 'Jeugdreizen', 'type')");
  const [trip] = await db.query("INSERT INTO trips (slug, title, departure_date) VALUES ('reis-a', 'Reis A', '2099-06-01') RETURNING id");
  const [tripB] = await db.query("INSERT INTO trips (slug, title, departure_date) VALUES ('reis-b', 'Reis B', '2099-07-01') RETURNING id");
  await db.query('INSERT INTO trip_category_links (trip_id, category_id) VALUES ($1, $2), ($1, $3), ($4, $3), ($1, $5)', [trip.id, namibia.id, double.id, tripB.id, hostel.id]);
  const [photo] = await db.query(
    `INSERT INTO media (original_url, local_name, content_type, bytes, source, title, variants)
     VALUES (NULL, 'bib-00000000000000aa-1600.webp', 'image/webp', 10, 'upload', 'Duinen', '{"400": "bib-00000000000000aa-400.webp", "1600": "bib-00000000000000aa-1600.webp"}') RETURNING id`,
  );
  await db.query('INSERT INTO media_countries (media_id, category_id) VALUES ($1, $2)', [photo.id, double.id]);

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
  const fields = (extra) => ({ _csrf: kantoor.csrf, name: 'Hostel', slug: 'hostel', kind: 'type', icon: '', intro: '', body_html: '', sort_order: '0', ...extra });

  await testContext.test('rechten: zonder sessie naar inloggen, reisleider en redacteur 403, kantoor wel; menu', async () => {
    assert.equal((await request('/app/reistypes-en-landen/')).status, 303);
    for (const session of [leider, redactie]) {
      assert.equal((await request('/app/reistypes-en-landen/', { cookie: session.cookie })).status, 403);
      assert.equal((await request(`/app/reistypes-en-landen/${hostel.id}/`, { cookie: session.cookie })).status, 403);
      assert.equal((await request(`/app/reistypes-en-landen/${hostel.id}/`, { cookie: session.cookie, form: { ...fields(), _csrf: session.csrf, name: 'Overgenomen' } })).status, 403);
      assert.equal((await request(`/app/reistypes-en-landen/${double.id}/verwijderen/`, { cookie: session.cookie, form: { _csrf: session.csrf } })).status, 403);
    }
    const list = await request('/app/reistypes-en-landen/', { cookie: kantoor.cookie });
    assert.equal(list.status, 200);
    assert.match(list.text, /href="\/app\/reistypes-en-landen\/"/);
    assert.match(list.text, />Namibië</);
    assert.match(list.text, />Hostel</);
    // Landen hebben een kolom met de ISO-code; ook de pagina van een land toont hem.
    await db.query("UPDATE trip_categories SET iso_code = 'NA' WHERE id = $1", [namibia.id]);
    const withCode = await request('/app/reistypes-en-landen/', { cookie: kantoor.cookie });
    assert.match(withCode.text, /<th>Code<\/th>/);
    assert.match(withCode.text, /<td>NA<\/td>/);
    assert.match((await request(`/app/reistypes-en-landen/${namibia.id}/`, { cookie: kantoor.cookie })).text, /<dt>Landcode \(ISO\)<\/dt><dd>NA<\/dd>/);
    assert.doesNotMatch((await request('/app/', { cookie: redactie.cookie })).text, /reistypes-en-landen/, 'redacteur ziet het menu-item niet');
  });

  await testContext.test('onbekend id → 404, zonder CSRF → 403', async () => {
    assert.equal((await request('/app/reistypes-en-landen/999999/', { cookie: kantoor.cookie })).status, 404);
    assert.equal((await request('/app/reistypes-en-landen/999999/', { cookie: kantoor.cookie, form: fields() })).status, 404);
    assert.equal((await request('/app/reistypes-en-landen/999999/foto/', { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, media_id: String(photo.id) } })).status, 404);
    assert.equal((await request('/app/reistypes-en-landen/999999/samenvoegen/', { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, doel: String(hostel.id) } })).status, 404);
    assert.equal((await request('/app/reistypes-en-landen/999999/verwijderen/', { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf } })).status, 404);
    assert.equal((await request(`/app/reistypes-en-landen/${hostel.id}/`, { cookie: kantoor.cookie, form: { ...fields(), _csrf: 'fout' } })).status, 403);
  });

  await testContext.test('aanmaken: slug uit de naam, dubbele slug geweigerd, audit', async () => {
    const form = await request('/app/reistypes-en-landen/', { cookie: kantoor.cookie });
    assert.match(form.text, /<textarea id="veld-body_html" name="body_html" rows="10" class="cms-richtext">/, 'teksteditor');
    const created = await request('/app/reistypes-en-landen/nieuw/', { cookie: kantoor.cookie, form: fields({ name: 'Wintersport', slug: '', icon: 'wintersport' }) });
    assert.equal(created.status, 303);
    const [row] = await db.query("SELECT id, slug, icon FROM trip_categories WHERE name = 'Wintersport'");
    assert.equal(row.slug, 'wintersport');
    assert.equal(row.icon, 'wintersport');
    assert.equal(created.headers.get('location'), `/app/reistypes-en-landen/${row.id}/?opgeslagen=1`);
    assert.equal(await audits('categorie.aangemaakt'), 1);
    const duplicate = await request('/app/reistypes-en-landen/nieuw/', { cookie: kantoor.cookie, form: fields({ name: 'Nog een hostel' }) });
    assert.equal(duplicate.status, 422);
    assert.match(duplicate.text, /al in gebruik/);
    assert.equal((await request('/app/reistypes-en-landen/nieuw/', { cookie: kantoor.cookie, form: fields({ name: '', slug: 'x' }) })).status, 422);
  });

  await testContext.test('wijzigen: andere slug geeft een 301, HTML opgeschoond, homepage-keuze', async () => {
    const saved = await request(`/app/reistypes-en-landen/${hostel.id}/`, {
      cookie: kantoor.cookie,
      form: fields({ name: 'Hostelreizen', slug: 'hostelreizen', icon: 'ov', body_html: '<p>Tekst<img src="x" onerror="alert(1)"></p><script>alert(1)</script>', show_on_home: '1', sort_order: '2' }),
    });
    assert.equal(saved.status, 303);
    assert.match(saved.headers.get('location'), /opgeslagen=2/);
    const [row] = await db.query('SELECT slug, body_html, show_on_home, sort_order FROM trip_categories WHERE id = $1', [hostel.id]);
    assert.equal(row.slug, 'hostelreizen');
    assert.doesNotMatch(row.body_html, /script|onerror/);
    assert.equal(row.show_on_home, true);
    const old = await request('/reis-categorie/hostel/');
    assert.equal(old.status, 301);
    assert.equal(old.headers.get('location'), '/reis-categorie/hostelreizen/');
    assert.equal((await request('/reis-categorie/hostelreizen/')).status, 200);
    // De homepage toont nu alleen het gekozen reistype.
    const home = await request('/');
    assert.match(home.text, /trip-type__title">Hostelreizen</);
    assert.doesNotMatch(home.text, /trip-type__title">Jeugdreizen</);
    // Terug naar de oude slug: geen lus, de oude doorverwijzing vervalt.
    await request(`/app/reistypes-en-landen/${hostel.id}/`, { cookie: kantoor.cookie, form: fields({ name: 'Hostel', slug: 'hostel', show_on_home: '1' }) });
    assert.equal((await request('/reis-categorie/hostel/')).status, 200);
    assert.equal((await request('/reis-categorie/hostelreizen/')).headers.get('location'), '/reis-categorie/hostel/');
    assert.deepEqual(await db.query("SELECT from_path FROM redirects WHERE from_path = '/reis-categorie/hostel/'"), []);
    assert.equal(await audits('categorie.gewijzigd'), 2);
  });

  await testContext.test('foto uit de bibliotheek: standaard de foto\'s van het land, opslaan, gebruikt in, verdwenen foto', async () => {
    const page = await request(`/app/reistypes-en-landen/${double.id}/`, { cookie: kantoor.cookie });
    assert.match(page.text, new RegExp(`name="media_id" value="${photo.id}"`), 'foto van dit land in de kiezer');
    const other = await request(`/app/reistypes-en-landen/${namibia.id}/`, { cookie: kantoor.cookie });
    assert.doesNotMatch(other.text, new RegExp(`name="media_id" value="${photo.id}"`), 'ander land: alleen de eigen foto\'s');
    assert.match((await request(`/app/reistypes-en-landen/${namibia.id}/?foto_land=`, { cookie: kantoor.cookie })).text, new RegExp(`name="media_id" value="${photo.id}"`), 'alle landen');
    const saved = await request(`/app/reistypes-en-landen/${namibia.id}/foto/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, media_id: String(photo.id) } });
    assert.equal(saved.status, 303);
    const [row] = await db.query('SELECT image_url FROM trip_categories WHERE id = $1', [namibia.id]);
    assert.equal(row.image_url, '/media/bib-00000000000000aa-1600.webp');
    const removal = await app.locals.mediaLibrary.remove(photo.id);
    assert.equal(removal.status, 'gebruikt', 'een gekozen foto kan niet weg');
    assert.equal((await request(`/app/reistypes-en-landen/${namibia.id}/foto/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, media_id: '999999' } })).status, 409);
    assert.equal((await request(`/app/reistypes-en-landen/${namibia.id}/foto/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, media_id: 'x' } })).status, 422);
    assert.equal((await request(`/app/reistypes-en-landen/${namibia.id}/foto/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, geen: '1' } })).status, 303);
    assert.equal((await db.query('SELECT image_url FROM trip_categories WHERE id = $1', [namibia.id]))[0].image_url, null);
    assert.equal(await audits('categorie.foto'), 2);
  });

  await testContext.test('een categorie die geen land meer is, kan geen foto\'s krijgen', async () => {
    const [former] = await db.query("INSERT INTO trip_categories (slug, name, kind) VALUES ('was-land', 'Was land', 'bestemming') RETURNING id");
    const changed = await request(`/app/reistypes-en-landen/${former.id}/`, { cookie: kantoor.cookie, form: fields({ name: 'Was land', slug: 'was-land', kind: 'type' }) });
    assert.equal(changed.status, 303, 'zonder foto\'s mag de soort wijzigen');
    const media = await login('kantoor@example.nl');
    const saved = await request(`/app/fotobibliotheek/${photo.id}/`, { cookie: media.cookie, form: { _csrf: media.csrf, title: 'Duinen', alt_text: '', caption: '', photographer: '', land: [String(double.id), String(former.id)] } });
    assert.equal(saved.status, 303);
    assert.deepEqual(await db.query('SELECT category_id FROM media_countries WHERE media_id = $1 ORDER BY category_id', [photo.id]), [{ category_id: double.id }]);
    await db.query('DELETE FROM trip_categories WHERE id = $1', [former.id]);
  });

  await testContext.test('verwijderen alleen als ongebruikt', async () => {
    assert.equal((await request(`/app/reistypes-en-landen/${double.id}/verwijderen/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf } })).status, 409);
    const [unused] = await db.query("SELECT id FROM trip_categories WHERE slug = 'wintersport'");
    assert.equal((await request(`/app/reistypes-en-landen/${unused.id}/verwijderen/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf } })).status, 303);
    assert.deepEqual(await db.query('SELECT id FROM trip_categories WHERE id = $1', [unused.id]), []);
    assert.equal(await audits('categorie.verwijderd'), 1);
  });

  await testContext.test('samenvoegen: reizen en foto\'s naar het doel, bron weg, 301', async () => {
    assert.equal((await request(`/app/reistypes-en-landen/${double.id}/samenvoegen/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, doel: String(double.id) } })).status, 422);
    assert.equal((await request(`/app/reistypes-en-landen/${double.id}/samenvoegen/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, doel: '999999' } })).status, 409);
    // Een land samenvoegen met een reistype mag niet (de foto's zouden aan een reistype gaan hangen).
    const otherKind = await request(`/app/reistypes-en-landen/${double.id}/samenvoegen/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, doel: String(hostel.id) } });
    assert.equal(otherKind.status, 422);
    assert.match(otherKind.text, /dezelfde soort/);
    assert.doesNotMatch(otherKind.text, new RegExp(`<option value="${hostel.id}">`), 'alleen dezelfde soort in de keuzelijst');
    assert.equal((await db.query('SELECT count(*)::int AS count FROM media_countries WHERE category_id = $1', [hostel.id]))[0].count, 0);
    // De soort van een land met foto's wijzigen mag ook niet.
    const kindChange = await request(`/app/reistypes-en-landen/${double.id}/`, { cookie: kantoor.cookie, form: fields({ name: 'Namibie', slug: 'namibie-2', kind: 'type' }) });
    assert.equal(kindChange.status, 422);
    assert.equal((await db.query('SELECT kind FROM trip_categories WHERE id = $1', [double.id]))[0].kind, 'bestemming');
    const merged = await request(`/app/reistypes-en-landen/${double.id}/samenvoegen/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, doel: String(namibia.id) } });
    assert.equal(merged.status, 303);
    assert.equal(merged.headers.get('location'), `/app/reistypes-en-landen/${namibia.id}/?opgeslagen=4`);
    assert.deepEqual(await db.query('SELECT id FROM trip_categories WHERE id = $1', [double.id]), []);
    const links = await db.query('SELECT trip_id FROM trip_category_links WHERE category_id = $1 ORDER BY trip_id', [namibia.id]);
    assert.deepEqual(links.map((link) => link.trip_id), [trip.id, tripB.id]);
    assert.deepEqual(await db.query('SELECT media_id FROM media_countries WHERE category_id = $1', [namibia.id]), [{ media_id: photo.id }]);
    const old = await request('/reis-categorie/namibie-2/');
    assert.equal(old.status, 301);
    assert.equal(old.headers.get('location'), '/reis-categorie/namibie/');
    assert.equal(await audits('categorie.samengevoegd'), 1);
  });
});
