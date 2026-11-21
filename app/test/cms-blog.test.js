/**
 * Tests voor blogberichten in het CMS (pakket I1, migratie 19): gegevens controleren, datum en tijd in Nederland, de
 * automatische samenvatting, en de routes onder `/app/blog/`: rechten (zonder sessie naar inloggen, reisleider en
 * boekhouding 403, redacteur en kantoor wel), onbekend id of blok → 404, CSRF, het concept (site ongewijzigd tot
 * publiceren), voorbeeld, verouderd formulier → 409, blokken (homepage-secties geweigerd), uitgelichte afbeelding uit
 * de bibliotheek, publiceren met versies (stand van de import als versie 1), inplannen (niet zichtbaar tot de datum),
 * nieuw bericht, adres wijzigen met 301, offline/online, verwijderen, de auditlog en de WordPress-import die een
 * bericht uit het CRM laat staan. Draait in een eigen schema.
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
const { newBlock, validateBlockForm } = require('../src/cms/blocks');
const { validatePostFields, blocksText, isLocalDateTime, toLocalDateTime, fromLocalDateTime, editablePostState, postStatus } = require('../src/cms/posts');
const { store } = require('../tools/import-wordpress');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'cms_blog_test';
const MASTER_KEY = Buffer.alloc(32, 32);
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

test('blog: gegevens, datum en tijd in Nederland en de samenvatting (zonder database)', () => {
  const fields = validatePostFields({ title: '  Op reis  ', intro: 'Hallo\r\nwereld', excerpt: ' Kort ', post_date: '2026-07-01T09:30', seo_title: 'Zoek' });
  assert.deepEqual(fields.errors, {});
  assert.equal(fields.values.title, 'Op reis');
  assert.equal(fields.values.intro, 'Hallo\nwereld');
  assert.equal(fields.values.excerpt, 'Kort');
  assert.equal(fields.values.postDate, '2026-07-01T09:30');
  assert.ok(validatePostFields({ title: '' }).errors.title);
  assert.ok(validatePostFields({ title: 'x'.repeat(201) }).errors.title);
  assert.ok(validatePostFields({ title: 'T', excerpt: 'x'.repeat(401) }).errors.excerpt);
  assert.ok(validatePostFields({ title: 'T', seo_title: 'x'.repeat(71) }).errors.seo_title);
  for (const bad of ['2026-02-30T10:00', '2026-07-01 09:30', '1999-01-01T00:00', '2026-07-01T24:00', "2026-07-01T09:30'"]) {
    assert.ok(validatePostFields({ title: 'T', post_date: bad }).errors.post_date, bad);
    assert.equal(isLocalDateTime(bad), false, bad);
  }
  assert.equal(validatePostFields({ title: 'T', post_date: ['a'] }).values.postDate, '', 'herhaald veld telt als leeg');

  // Zomer- en wintertijd: 1 juli 09:30 is 07:30 UTC, 1 januari 09:30 is 08:30 UTC.
  assert.equal(fromLocalDateTime('2026-07-01T09:30').toISOString(), '2026-07-01T07:30:00.000Z');
  assert.equal(fromLocalDateTime('2026-01-01T09:30').toISOString(), '2026-01-01T08:30:00.000Z');
  assert.equal(toLocalDateTime('2026-07-01T07:30:00Z'), '2026-07-01T09:30');
  assert.equal(toLocalDateTime(null), '');
  assert.equal(fromLocalDateTime('onzin'), null);

  const text = validateBlockForm(newBlock('tekst'), { f_html: '<p>Eerste <strong>dag</strong></p><p><a href="https://www.youtube-nocookie.com/embed/abcdefghijk" rel="noopener" target="_blank">Bekijk de video</a></p>' }).block;
  const quote = validateBlockForm(newBlock('citaat'), { f_tekst: 'Mooi was het' }).block;
  assert.equal(blocksText([text, quote]).replace(/\s+/g, ' ').trim(), 'Eerste dag Mooi was het');

  const imported = editablePostState({ title: 'Oud', intro: '', excerpt: 'Samenvatting', image_url: '/media/a.jpg', blocks: [], body_html: '<p>Tekst</p>', managed_in_crm: false, seo_title: '', seo_description: '', published_at: '2020-05-01T10:00:00Z', draft: null });
  assert.equal(imported.blocks[0].type, 'tekst', 'tekst uit de import wordt één tekstblok');
  assert.equal(imported.postDate, '2020-05-01T12:00');
  assert.equal(editablePostState({ title: 'T', draft: { title: 'C', postDate: 'kapot', imageUrl: 'javascript:x', blocks: 'x' } }).imageUrl, null);
  assert.equal(postStatus({ published: true, scheduled: true }), 'ingepland');
  assert.equal(postStatus({ published: false, scheduled: true }), 'offline');
});

test('blog in het CRM', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'avanta-blog-'));
  const mediaDir = path.join(dataDir, 'media');
  await fs.mkdir(mediaDir);
  const app = createApp({ db, masterKey: MASTER_KEY, mediaDir });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await db.close(); await fs.rm(dataDir, { recursive: true, force: true }); });

  const hash = await hashPassword(PASSWORD);
  for (const [email, role] of [['kantoor@example.nl', 'kantoor'], ['leider@example.nl', 'reisleider'], ['redactie@example.nl', 'redacteur'], ['boekhouding@example.nl', 'boekhouding']]) {
    await db.query('INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)', [email, role, role, hash]);
  }
  // Zoals na de import: geen blokken, de tekst staat in body_html.
  const [imported] = await db.query(
    `INSERT INTO posts (legacy_id, slug, title, intro, excerpt, body_html, image_url, published_at)
     VALUES (501, 'kamp-in-zweden', 'Kamp in Zweden', 'Wat een week', 'Samenvatting uit de import', '<p>Oude tekst over Zweden</p>', NULL, '2025-08-01T10:00:00Z') RETURNING id`,
  );
  const [photo] = await db.query(
    `INSERT INTO media (original_url, local_name, content_type, bytes, source, title, alt_text, variants)
     VALUES (NULL, 'bib-00000000000000dd-1600.webp', 'image/webp', 10, 'upload', 'Meer', 'Kano op het meer', '{"400": "bib-00000000000000dd-400.webp", "1600": "bib-00000000000000dd-1600.webp"}') RETURNING id`,
  );
  await db.query("INSERT INTO pages (path, title) VALUES ('/over-ons/', 'Over ons')");

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
  const kantoor = await login('kantoor@example.nl');
  const leider = await login('leider@example.nl');
  const boekhouding = await login('boekhouding@example.nl');
  const postUrl = `/app/blog/${imported.id}/`;
  const version = async (id = imported.id) => (await db.query('SELECT draft_version FROM posts WHERE id = $1', [id]))[0].draft_version;
  const audits = async (action) => (await db.query('SELECT count(*)::int AS count FROM audit_log WHERE action = $1', [action]))[0].count;
  const send = async (url, form, options = {}) => {
    const session = options.session || redactie;
    return request(url, { cookie: session.cookie, form: { _csrf: session.csrf, versie: String(await version(options.id)), ...form } });
  };
  const draftBlocks = async (id = imported.id) => ((await db.query("SELECT draft -> 'blocks' AS blocks FROM posts WHERE id = $1", [id]))[0].blocks || []);

  await t.test('rechten: zonder sessie naar inloggen, reisleider en boekhouding 403, redacteur en kantoor wel; menu', async () => {
    assert.equal((await request('/app/blog/')).status, 303);
    for (const session of [leider, boekhouding]) {
      assert.equal((await request('/app/blog/', { cookie: session.cookie })).status, 403);
      assert.equal((await request(postUrl, { cookie: session.cookie })).status, 403);
      assert.equal((await request(`${postUrl}voorbeeld/`, { cookie: session.cookie })).status, 403);
      assert.equal((await request('/app/blog/nieuw/', { cookie: session.cookie, form: { _csrf: session.csrf, title: 'X' } })).status, 403);
      assert.equal((await request(`${postUrl}gegevens/`, { cookie: session.cookie, form: { _csrf: session.csrf, versie: '0', title: 'Overgenomen' } })).status, 403);
      assert.equal((await request(`${postUrl}publiceren/`, { cookie: session.cookie, form: { _csrf: session.csrf, versie: '0' } })).status, 403);
      assert.equal((await request(`${postUrl}blokken/nieuw/`, { cookie: session.cookie, form: { _csrf: session.csrf, versie: '0', type: 'kop' } })).status, 403);
    }
    const list = await request('/app/blog/', { cookie: redactie.cookie });
    assert.equal(list.status, 200);
    assert.match(list.text, />Kamp in Zweden</);
    assert.match(list.text, /href="\/app\/blog\/"/, 'menu-item voor de redacteur');
    assert.equal((await request('/app/blog/?q=zweden&status=online', { cookie: kantoor.cookie })).status, 200);
    assert.doesNotMatch((await request('/app/blog/?q=bestaatniet', { cookie: kantoor.cookie })).text, />Kamp in Zweden</);
    assert.doesNotMatch((await request('/app/blog/?status=offline', { cookie: kantoor.cookie })).text, />Kamp in Zweden</);
    assert.match((await request('/app/blog/?status=onzin', { cookie: kantoor.cookie })).text, />Kamp in Zweden</, 'onbekend filter = alle');
    assert.doesNotMatch((await request('/app/', { cookie: boekhouding.cookie })).text, /\/app\/blog\//, 'geen menu-item zonder recht');
  });

  await t.test('onbekend id of blok → 404, zonder CSRF → 403', async () => {
    assert.equal((await request('/app/blog/999999/', { cookie: redactie.cookie })).status, 404);
    assert.equal((await request('/app/blog/999999/voorbeeld/', { cookie: redactie.cookie })).status, 404);
    assert.equal((await request('/app/blog/999999/gegevens/', { cookie: redactie.cookie, form: { _csrf: redactie.csrf, versie: '0', title: 'x' } })).status, 404);
    assert.equal((await request('/app/blog/999999/publiceren/', { cookie: redactie.cookie, form: { _csrf: redactie.csrf, versie: '0' } })).status, 404);
    assert.equal((await send(`${postUrl}blokken/b123456789abc/`, { f_html: 'x' })).status, 404);
    assert.equal((await request(`${postUrl}blokken/b123456789abc/foto/`, { cookie: redactie.cookie })).status, 404);
    assert.equal((await request(`${postUrl}gegevens/`, { cookie: redactie.cookie, form: { _csrf: 'fout', versie: '0', title: 'x' } })).status, 403);
  });

  await t.test('concept: site gelijk tot publiceren, voorbeeld, verouderd formulier → 409, homepage-blok geweigerd', async () => {
    const editor = await request(postUrl, { cookie: redactie.cookie });
    assert.match(editor.text, /value="2025-08-01T12:00"/, 'publicatiedatum in Nederlandse tijd');
    assert.doesNotMatch(editor.text, /option value="home-slider"/, 'geen homepage-secties');
    const stale = String(await version());
    const saved = await send(`${postUrl}gegevens/`, { title: 'Kamp in Zweden 2025', intro: 'Nieuwe inleiding', excerpt: '', post_date: '2025-08-01T12:00' });
    assert.equal(saved.status, 303);
    assert.doesNotMatch((await request('/kamp-in-zweden/')).text, /Nieuwe inleiding/, 'site ongewijzigd');
    const preview = await request(`${postUrl}voorbeeld/`, { cookie: redactie.cookie });
    assert.equal(preview.status, 200);
    assert.match(preview.text, /Nieuwe inleiding/);
    assert.match(preview.text, /Oude tekst over Zweden/);
    assert.match(preview.text, /Voorbeeld van het concept/);
    const conflict = await request(`${postUrl}gegevens/`, { cookie: redactie.cookie, form: { _csrf: redactie.csrf, versie: stale, title: 'Overschreven' } });
    assert.equal(conflict.status, 409);
    const invalid = await send(`${postUrl}gegevens/`, { title: 'T', post_date: '2026-13-01T10:00' });
    assert.equal(invalid.status, 422);
    assert.match(invalid.text, /Vul een geldige datum en tijd in/);
    assert.equal((await send(`${postUrl}blokken/nieuw/`, { type: 'home-slider' })).status, 422);
    assert.equal((await send(`${postUrl}blokken/nieuw/`, { type: 'onbekend' })).status, 422);
  });

  await t.test('blokken, uitgelichte afbeelding en publiceren met versies', async () => {
    assert.equal((await send(`${postUrl}blokken/nieuw/`, { type: 'citaat' })).status, 303);
    let blocks = await draftBlocks();
    assert.deepEqual(blocks.map((block) => block.type), ['tekst', 'citaat']);
    assert.equal((await send(`${postUrl}blokken/${blocks[1].id}/`, { f_tekst: 'Onvergetelijk <script>', f_bron: 'Anna' })).status, 303);
    assert.equal((await send(`${postUrl}blokken/${blocks[1].id}/actie/`, { actie: 'omhoog' })).status, 303);
    blocks = await draftBlocks();
    assert.deepEqual(blocks.map((block) => block.type), ['citaat', 'tekst']);

    const picker = await request(`${postUrl}kopfoto/`, { cookie: redactie.cookie });
    assert.equal(picker.status, 200);
    assert.match(picker.text, /Uitgelichte afbeelding kiezen/);
    assert.equal((await send(`${postUrl}kopfoto/`, { media_id: '999999' })).status, 409, 'verdwenen foto');
    assert.equal((await send(`${postUrl}kopfoto/`, { media_id: String(photo.id) })).status, 303);
    const [{ draft }] = await db.query('SELECT draft FROM posts WHERE id = $1', [imported.id]);
    assert.equal(draft.imageUrl, '/media/bib-00000000000000dd-1600.webp');
    assert.equal(draft.imageMediaId, photo.id);

    const published = await send(`${postUrl}publiceren/`, {});
    assert.equal(published.status, 303);
    assert.match(published.headers.get('location'), /opgeslagen=2/);
    const page = await request('/kamp-in-zweden/');
    assert.equal(page.status, 200);
    assert.match(page.text, /Onvergetelijk &lt;script&gt;/);
    assert.match(page.text, /Nieuwe inleiding/);
    assert.match(page.text, /bib-00000000000000dd-1600\.webp/);
    const [row] = await db.query('SELECT managed_in_crm, draft, excerpt, published_at FROM posts WHERE id = $1', [imported.id]);
    assert.equal(row.managed_in_crm, true);
    assert.equal(row.draft, null);
    assert.match(row.excerpt, /^Onvergetelijk <script> Oude tekst over Zweden \.\.\.$/, 'lege samenvatting wordt het begin van de tekst');
    assert.equal(new Date(row.published_at).toISOString(), '2025-08-01T10:00:00.000Z');
    const revisions = await db.query('SELECT version, note, title FROM post_revisions WHERE post_id = $1 ORDER BY version', [imported.id]);
    assert.deepEqual(revisions.map((revision) => [revision.version, revision.note, revision.title]), [[1, 'Stand uit de import', 'Kamp in Zweden'], [2, '', 'Kamp in Zweden 2025']]);
    assert.match((await request('/blog/')).text, /Onvergetelijk &lt;script&gt; Oude tekst/, 'samenvatting in de lijst');
    assert.equal(await audits('blog.gepubliceerd'), 1);
    assert.ok(await audits('blog.concept') >= 4);

    // Versie 1 terugzetten en weggooien.
    assert.equal((await send(`${postUrl}versies/1/terugzetten/`, {})).status, 303);
    assert.equal((await db.query("SELECT draft ->> 'title' AS title FROM posts WHERE id = $1", [imported.id]))[0].title, 'Kamp in Zweden');
    assert.equal((await send(`${postUrl}versies/99/terugzetten/`, {})).status, 404);
    assert.equal((await send(`${postUrl}concept-weggooien/`, {})).status, 303);
    assert.equal((await send(`${postUrl}concept-weggooien/`, {})).status, 409, 'geen concept meer');
    assert.equal((await send(`${postUrl}publiceren/`, {})).status, 409);
    assert.match((await request('/kamp-in-zweden/')).text, /Onvergetelijk/, 'site blijft de gepubliceerde stand');

    // De foto is nu in gebruik.
    const usage = await request(`/app/fotobibliotheek/${photo.id}/`, { cookie: redactie.cookie });
    assert.match(usage.text, /Kamp in Zweden 2025/);
  });

  await t.test('nieuw bericht: offline, inplannen, adres wijzigen met 301, offline en verwijderen', async () => {
    assert.equal((await request('/app/blog/nieuw/', { cookie: redactie.cookie })).status, 200);
    for (const [slug, message] of [['over-ons', /staat een pagina/], ['kamp-in-zweden', /al een bericht/], ['blog', /gebruikt de site zelf/], ['Hoofd Letters', /kleine letters/]]) {
      const refused = await request('/app/blog/nieuw/', { cookie: redactie.cookie, form: { _csrf: redactie.csrf, title: 'Nieuw', slug } });
      assert.equal(refused.status, 422, slug);
      assert.match(refused.text, message);
    }
    await db.query("INSERT INTO redirects (from_path, to_url, status) VALUES ('/oud-verslag/', '/blog/', 301)");
    assert.equal((await request('/app/blog/nieuw/', { cookie: redactie.cookie, form: { _csrf: redactie.csrf, title: 'Oud verslag' } })).status, 422, 'adres met doorverwijzing');
    const created = await request('/app/blog/nieuw/', { cookie: redactie.cookie, form: { _csrf: redactie.csrf, title: 'Winterkamp in Noorwegen' } });
    assert.equal(created.status, 303);
    const id = Number(created.headers.get('location').match(/\/app\/blog\/(\d+)\//)[1]);
    const url = `/app/blog/${id}/`;
    assert.equal((await db.query('SELECT slug, published FROM posts WHERE id = $1', [id]))[0].slug, 'winterkamp-in-noorwegen');
    assert.equal((await request('/winterkamp-in-noorwegen/')).status, 404, 'nieuw bericht staat offline');
    assert.equal((await send(`${url}online/`, { stand: 'online' }, { id })).status, 422, 'nooit gepubliceerd');

    // Inplannen: publicatiedatum in de toekomst.
    assert.equal((await send(`${url}blokken/nieuw/`, { type: 'tekst' }, { id })).status, 303);
    const [textBlock] = await draftBlocks(id);
    assert.equal((await send(`${url}blokken/${textBlock.id}/`, { f_html: '<p>Sneeuw en noorderlicht</p>' }, { id })).status, 303);
    assert.equal((await send(`${url}gegevens/`, { title: 'Winterkamp in Noorwegen', excerpt: 'Een eigen samenvatting', post_date: '2099-01-15T08:00' }, { id })).status, 303);
    const scheduled = await send(`${url}publiceren/`, {}, { id });
    assert.match(scheduled.headers.get('location'), /opgeslagen=12/);
    assert.equal((await request('/winterkamp-in-noorwegen/')).status, 404, 'ingepland: nog niet zichtbaar');
    assert.doesNotMatch((await request('/blog/')).text, /Winterkamp/);
    assert.doesNotMatch((await request('/sitemap.xml')).text, /winterkamp/);
    assert.match((await request('/app/blog/?status=ingepland', { cookie: redactie.cookie })).text, />Winterkamp in Noorwegen</);
    assert.match((await request(url, { cookie: redactie.cookie })).text, /ingepland voor 15-01-2099/);
    // De datum is bereikt.
    await db.query("UPDATE posts SET published_at = now() - interval '1 minute' WHERE id = $1", [id]);
    const visible = await request('/winterkamp-in-noorwegen/');
    assert.equal(visible.status, 200);
    assert.match(visible.text, /Sneeuw en noorderlicht/);
    assert.match((await request('/blog/')).text, /Een eigen samenvatting/);

    // Adres wijzigen: 301 vanaf het oude adres, menu gaat mee.
    await db.query("INSERT INTO menu_items (menu, label, href, sort_order) VALUES ('voet', 'Winter', '/winterkamp-in-noorwegen/', 99)");
    assert.equal((await send(`${url}adres/`, { slug: 'over-ons' }, { id })).status, 422);
    assert.equal((await send(`${url}adres/`, { slug: 'winterkamp-noorwegen' }, { id })).status, 303);
    const moved = await request('/winterkamp-in-noorwegen/');
    assert.equal(moved.status, 301);
    assert.equal(moved.headers.get('location'), '/winterkamp-noorwegen/');
    assert.equal((await request('/winterkamp-noorwegen/')).status, 200);
    assert.equal((await db.query("SELECT href FROM menu_items WHERE label = 'Winter'"))[0].href, '/winterkamp-noorwegen/');

    // Offline, verwijderen (eerst uit het menu), en een bericht uit de import niet.
    assert.equal((await send(`${url}verwijderen/`, { zeker: 'ja' }, { id })).status, 422, 'eerst offline');
    assert.equal((await send(`${url}online/`, { stand: 'offline' }, { id })).status, 303);
    assert.equal((await request('/winterkamp-noorwegen/')).status, 404);
    assert.equal((await send(`${url}verwijderen/`, { zeker: 'ja' }, { id })).status, 422, 'staat nog in een menu');
    await db.query("DELETE FROM menu_items WHERE label = 'Winter'");
    assert.equal((await send(`${url}verwijderen/`, {}, { id })).status, 422, 'vinkje nodig');
    const removed = await send(`${url}verwijderen/`, { zeker: 'ja' }, { id });
    assert.equal(removed.status, 303);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM posts WHERE id = $1', [id]))[0].count, 0);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM post_revisions WHERE post_id = $1', [id]))[0].count, 0);
    assert.equal(await audits('blog.verwijderd'), 1);
    assert.equal((await send(`${postUrl}online/`, { stand: 'offline' })).status, 303);
    assert.equal((await send(`${postUrl}verwijderen/`, { zeker: 'ja' })).status, 422, 'bericht uit de import blijft');
    assert.equal((await send(`${postUrl}online/`, { stand: 'online' })).status, 303);
  });

  await t.test('geïmporteerd bericht zonder samenvatting houdt na een adreswijziging zijn samenvatting', async () => {
    const [plain] = await db.query(
      `INSERT INTO posts (legacy_id, slug, title, excerpt, body_html, published_at)
       VALUES (503, 'zonder-samenvatting', 'Zonder samenvatting', '', '<p>Tekst uit WordPress over kanoën</p>', '2025-07-01T10:00:00Z') RETURNING id`,
    );
    assert.equal((await send(`/app/blog/${plain.id}/adres/`, { slug: 'met-nieuw-adres' }, { id: plain.id })).status, 303);
    assert.equal((await db.query('SELECT managed_in_crm FROM posts WHERE id = $1', [plain.id]))[0].managed_in_crm, true);
    assert.match((await request('/blog/')).text, /Tekst uit WordPress over kano/);
  });

  await t.test('de WordPress-import laat een bericht uit het CRM staan', async () => {
    const data = {
      guides: [], categories: [], trips: [], pages: [], faqs: [],
      posts: [
        { legacyId: 501, slug: 'kamp-in-zweden', title: 'Uit WordPress', intro: '', excerpt: '', bodyHtml: '<p>WP</p>', imageUrl: null, categories: [], publishedAt: '2025-08-01T10:00:00Z' },
        { legacyId: 502, slug: 'nieuw-uit-wp', title: 'Nieuw uit WP', intro: '', excerpt: '', bodyHtml: '<p>WP</p>', imageUrl: null, categories: ['Reizen'], publishedAt: '2025-09-01T10:00:00Z' },
      ],
    };
    await store(db, data);
    const rows = await db.query('SELECT slug, title FROM posts WHERE legacy_id IN (501, 502) ORDER BY legacy_id');
    assert.deepEqual(rows.map((row) => [row.slug, row.title]), [['kamp-in-zweden', 'Kamp in Zweden 2025'], ['nieuw-uit-wp', 'Nieuw uit WP']]);
  });
});
