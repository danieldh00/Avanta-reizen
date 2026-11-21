/**
 * Tests voor pagina's in blokken (CMS-pakket H1, migratie 17): de blokken-motor (controle van velden, opgeschoonde
 * tekst, veilige links, stijlopties, escapen, opgeslagen JSON teruglezen) en de routes onder `/app/paginas/`: rechten
 * (zonder sessie naar inloggen, reisleider 403, redacteur en kantoor wel), onbekend id of blok → 404, CSRF, het
 * concept (site ongewijzigd tot publiceren), voorbeeld, een verouderd formulier → 409, blokken toevoegen, verplaatsen,
 * kopiëren en verwijderen, een foto uit de bibliotheek (vergrendeld, "gebruikt in", verdwenen foto), publiceren met
 * versies (stand van de import als versie 1), terugzetten, weggooien en de auditlog. Draait in een eigen schema.
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
const { sanitizeHtml } = require('../tools/import/sanitize');
const { toString } = require('../src/site/html');
const {
  newBlock, validateBlockForm, normalizeBlocks, renderBlocks, publishedBlocks, blockSummary, mediaIdsOf, youtubeId, loadBlockData,
} = require('../src/cms/blocks');
const { validatePageFields } = require('../src/cms/pages');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'cms_pages_test';
const MASTER_KEY = Buffer.alloc(32, 31);
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
 * HTML van blokken als tekst.
 * @param {object[]} blocks Blokken.
 * @returns {string} HTML.
 */
function rendered(blocks) {
  return toString(renderBlocks(blocks, { title: 'Test' }).body);
}

test('blokken: velden controleren, opschonen en veilige links', () => {
  const text = validateBlockForm(newBlock('tekst'), { f_html: '<p onclick="x()">Hoi<script>alert(1)</script></p>', s_achtergrond: 'terracotta', s_breedte: 'onzin' });
  assert.deepEqual(text.errors, {});
  assert.equal(text.block.data.html, '<p>Hoi</p>');
  assert.equal(text.block.style.achtergrond, 'terracotta');
  assert.equal(text.block.style.breedte, 'smal', 'onbekende keuze wordt de standaard');

  const heading = validateBlockForm(newBlock('kop'), { f_titel: '', f_niveau: 'h1' });
  assert.equal(heading.errors.f_titel, 'Vul dit veld in.');
  assert.equal(heading.block.data.niveau, 'h2', 'onbekende keuze wordt de standaard');

  const buttons = validateBlockForm(newBlock('knoppen'), {
    f_knoppen_0_tekst: 'Contact', f_knoppen_0_link: '/contact/', f_knoppen_0_stijl: 'omlijnd',
    f_knoppen_1_tekst: 'Kwaad', f_knoppen_1_link: 'javascript:alert(1)',
    f_knoppen_2_tekst: 'Onveilig', f_knoppen_2_link: 'http://example.com/',
  });
  assert.ok(buttons.errors.f_knoppen_1_link, 'javascript: geweigerd');
  assert.ok(buttons.errors.f_knoppen_2_link, 'http: geweigerd');
  const good = validateBlockForm(newBlock('knoppen'), { f_knoppen_1_tekst: 'Reizen', f_knoppen_1_link: 'https://example.com/' });
  assert.deepEqual(good.errors, {});
  assert.deepEqual(good.block.data.knoppen, [{ tekst: 'Reizen', link: 'https://example.com/', stijl: 'vol' }], 'lege regels vallen weg');
  assert.ok(validateBlockForm(newBlock('knoppen'), { f_knoppen_0_tekst: 'Zonder adres' }).errors.f_knoppen_0_link);
  assert.ok(validateBlockForm(newBlock('citaat'), { f_tekst: 'x'.repeat(1001) }).errors.f_tekst);
  assert.equal(validateBlockForm(newBlock('citaat'), { f_tekst: ['a', 'b'] }).errors.f_tekst, 'Vul dit veld in.', 'herhaald veld telt als leeg');

  const fields = validatePageFields({ title: '  Over ons  ', pretitle: '', intro: 'Hallo\r\nwereld' });
  assert.deepEqual(fields.errors, {});
  assert.equal(fields.values.title, 'Over ons');
  assert.equal(fields.values.intro, 'Hallo\nwereld');
  assert.ok(validatePageFields({ title: '' }).errors.title);
});

test('blokken: weergave, escapen, stijlen en opgeslagen JSON', () => {
  const heading = validateBlockForm(newBlock('kop'), { f_titel: '<img src=x onerror=alert(1)>', f_subtitel: 'Sub' }).block;
  const html = rendered([heading]);
  assert.doesNotMatch(html, /<img/, 'titel wordt ge-escaped');
  assert.match(html, /<h2 class="cms-heading__title">&lt;img/);
  assert.doesNotMatch(html, /cms-section/, 'standaardstijl: geen omhullende sectie');
  const styled = { ...heading, style: { ...heading.style, achtergrond: 'soil', breedte: 'vol', uitlijning: 'midden' } };
  assert.match(rendered([styled]), /class="cms-section cms-bg--soil cms-width--vol cms-align--midden cms-space-top--geen cms-space-bottom--normaal"/);
  assert.equal(rendered([newBlock('kop')]), '', 'leeg blok toont niets');

  // Opgeslagen JSON: onbekende types en kapotte waarden vallen weg, een stijl buiten de keuzes wordt de standaard.
  const stored = normalizeBlocks([
    { id: 'b000000000001', type: 'script', data: {} },
    null,
    { id: '../x', type: 'citaat', data: { tekst: 'Mooi', bron: 3 }, style: { achtergrond: 'url(x)' } },
    { id: 'b000000000002', type: 'afbeelding', data: { foto: { url: 'javascript:alert(1)' } } },
  ]);
  assert.equal(stored.length, 2);
  assert.match(stored[0].id, /^b[0-9a-f]{12}$/);
  assert.equal(stored[0].data.bron, '');
  assert.equal(stored[0].style.achtergrond, 'geen');
  assert.equal(stored[1].data.foto, null, 'alleen een adres onder /media/');
  assert.equal(rendered([{ type: 'knoppen', id: 'b000000000003', data: { knoppen: [{ tekst: 'x', link: 'javascript:alert(1)' }] } }]), '', 'onveilige link uit oude JSON verdwijnt');

  const photo = { id: 'b000000000004', type: 'afbeelding', data: { foto: { mediaId: 7, url: '/media/bib-00000000000000ab-1600.webp', alt: 'Duin "x"' }, bijschrift: 'Namib' } };
  assert.match(rendered([photo]), /<img src="\/media\/bib-00000000000000ab-1600.webp" alt="Duin &quot;x&quot;" loading="lazy"><figcaption class="cms-image__caption">Namib<\/figcaption>/);
  assert.deepEqual(mediaIdsOf(normalizeBlocks([photo, photo])), [7]);
  assert.equal(blockSummary(normalizeBlocks([photo])[0]), 'Namib');
});

test('blokken: tekst uit de import blijft gelijk, ook na opnieuw opschonen', () => {
  const imported = '<p>Intro</p><p><a href="https://www.youtube-nocookie.com/embed/abcdefghijk" rel="noopener" target="_blank">Bekijk de video</a></p><p>Slot</p>';
  for (const source of [imported, sanitizeHtml(imported)]) {
    const result = renderBlocks([{ id: 'b000000000005', type: 'tekst', data: { html: source } }], { title: 'Test' });
    assert.equal(result.hasVideo, true, 'de video blijft een video');
    assert.match(toString(result.body), /<iframe src="https:\/\/www.youtube-nocookie.com\/embed\/abcdefghijk"/);
  }
  assert.deepEqual(publishedBlocks({ blocks: [], body_html: '<p>Oud</p>', managed_in_crm: false }).map((block) => block.data.html), ['<p>Oud</p>']);
  assert.deepEqual(publishedBlocks({ blocks: [], body_html: '<p>Oud</p>', managed_in_crm: true }), [], 'in het CRM leeggemaakt blijft leeg');
});

test('bloktypes H2: YouTube, video met cookiekeuze, galerij, kolommen, banner', () => {
  assert.equal(youtubeId('https://www.youtube.com/watch?v=abcdefghijk&t=3'), 'abcdefghijk');
  assert.equal(youtubeId('https://youtu.be/abcdefghijk'), 'abcdefghijk');
  assert.equal(youtubeId('https://www.youtube-nocookie.com/embed/abcdefghijk'), 'abcdefghijk');
  assert.equal(youtubeId('https://www.youtube.com/shorts/abcdefghijk'), 'abcdefghijk');
  assert.equal(youtubeId('abcdefghijk'), 'abcdefghijk');
  assert.equal(youtubeId('https://evil.example/watch?v=abcdefghijk'), '');
  assert.equal(youtubeId('javascript:alert(1)'), '');

  const video = validateBlockForm(newBlock('video'), { f_youtube: 'https://youtu.be/abcdefghijk', f_titel: 'Kamp <2026>' });
  assert.deepEqual(video.errors, {});
  assert.equal(video.block.data.youtube, 'abcdefghijk');
  assert.ok(validateBlockForm(newBlock('video'), { f_youtube: 'https://vimeo.com/1' }).errors.f_youtube);
  const videoHtml = toString(renderBlocks([video.block], { title: 'Test' }).body);
  assert.equal(renderBlocks([video.block], { title: 'Test' }).hasVideo, true);
  assert.doesNotMatch(videoHtml, /<iframe/, 'geen iframe vóór de keuze van de bezoeker');
  assert.match(videoHtml, /data-video-consent data-video-id="abcdefghijk"/);
  assert.match(videoHtml, /Kamp &lt;2026&gt;/);
  assert.match(videoHtml, /href="https:\/\/www.youtube.com\/watch\?v=abcdefghijk"/);

  const gallery = newBlock('galerij');
  gallery.data.fotos = [
    { mediaId: 1, url: '/media/a.webp', alt: 'A' }, { mediaId: 2, url: '/media/b.webp', alt: 'B' }, { mediaId: 3, url: '/media/c.webp', alt: 'C' },
  ];
  const reordered = validateBlockForm(gallery, { f_titel: 'Kamp', f_fotos_weg: '1', f_fotos_0_volgorde: '3', f_fotos_2_volgorde: '1' });
  assert.deepEqual(reordered.block.data.fotos.map((image) => image.mediaId), [3, 1], 'weghalen en volgorde');
  assert.deepEqual(mediaIdsOf([reordered.block]), [3, 1]);
  assert.match(toString(renderBlocks([reordered.block], { title: 'Test' }).body), /page-content__gallery[\s\S]*Kamp[\s\S]*\/media\/c.webp/);

  const columns = validateBlockForm(newBlock('kolommen'), { f_kolommen_0_titel: 'Samen', f_kolommen_0_tekst: 'Regel 1', f_kolommen_1_titel: 'Avontuur', f_kolommen_1_linktekst: 'Meer' });
  assert.ok(columns.errors.f_kolommen_1_link, 'linktekst zonder adres');
  const twoColumns = validateBlockForm(newBlock('kolommen'), { f_kolommen_0_titel: 'Samen', f_kolommen_2_titel: 'Geloof' });
  assert.deepEqual(twoColumns.errors, {});
  assert.match(toString(renderBlocks([twoColumns.block], { title: 'Test' }).body), /cms-columns cms-columns--2/);
  assert.equal(newBlock('kolommen').style.breedte, 'normaal', 'eigen standaardbreedte per type');

  const banner = validateBlockForm(newBlock('banner'), { f_titel: 'Ga mee', f_knoptekst: 'Reizen' });
  assert.ok(banner.errors.f_link, 'knop zonder adres');
  const plain = validateBlockForm(newBlock('banner'), { f_titel: 'Ga mee', f_tekst: 'Nu boeken', f_knoptekst: 'Reizen', f_link: '/reis/' }).block;
  assert.match(toString(renderBlocks([plain], { title: 'Test' }).body), /cms-banner cms-banner--plain[\s\S]*href="\/reis\/"/);
  plain.data.foto = { mediaId: 4, url: '/media/bib-0000000000000004-1600.webp', alt: '' };
  assert.match(toString(renderBlocks([plain], { title: 'Test' }).body), /class="page-content__block cms-banner" style="background-image: url\('\/media\/bib-0000000000000004-1600.webp'\)"/);
  plain.data.foto = { mediaId: 4, url: "/media/x'onerror.webp", alt: '' };
  assert.match(toString(renderBlocks([plain], { title: 'Test' }).body), /cms-banner--plain/, 'een adres buiten /media/ wordt geen achtergrond');
});

test('bloktypes H2 met gegevens: reizen, reistypes, bestemmingen en FAQ', async () => {
  const trips = validateBlockForm(newBlock('reizen'), { f_type: 'jeugd', f_land: 'onzin!', f_aantal: '3', f_weergave: 'lijst' });
  assert.ok(trips.errors.f_land, 'alleen een slug');
  const tripBlock = validateBlockForm(newBlock('reizen'), { f_type: 'jeugd', f_aantal: '3', f_beschikbaar: 'verbergen' }).block;
  const calls = [];
  const content = {
    faqs: async () => [{ question: 'Hoe boek ik?', answer_html: '<p>Zo</p>', category: 'Boeken' }, { question: 'Wat kost het?', answer_html: '', category: 'Prijzen' }],
    categories: async (kind) => (kind === 'type'
      ? [{ slug: 'jeugd', name: 'Jeugdreizen', icon: '', show_on_home: false, trip_count: 2 }, { slug: 'plus', name: 'Plusreizen', icon: '', show_on_home: false, trip_count: 0 }]
      : [{ slug: 'namibie', name: 'Namibië', image_url: '/media/n.webp', show_on_home: true, trip_count: 1 }, { slug: 'peru', name: 'Peru', image_url: null, show_on_home: false, trip_count: 3 }]),
    upcomingTrips: async (filter) => { calls.push(filter); return [{ slug: 'reis-a', title: 'Reis A', departure_date: '2099-06-01', trip_code: '99-A', card_image_url: null, fully_booked: false, is_new: false }]; },
  };
  const faqBlock = validateBlockForm(newBlock('faq'), { f_categorie: 'boeken' }).block;
  const blocks = normalizeBlocks([tripBlock, newBlock('reistypes'), newBlock('bestemmingen'), faqBlock]);
  const data = await loadBlockData(blocks, content);
  assert.deepEqual(calls, [{ type: 'jeugd', destination: undefined, onlyAvailable: true, limit: 3 }]);
  const output = toString(renderBlocks(blocks, { title: 'Test', data }).body);
  assert.match(output, /href="\/reis\/reis-a\/"/);
  assert.match(output, /trip-type__title">Jeugdreizen</);
  assert.doesNotMatch(output, /Plusreizen/, 'zonder homepage-keuze: alleen types met reizen');
  assert.match(output, /banner__title">Namibië</);
  assert.doesNotMatch(output, /banner__title">Peru</, 'homepage-keuze gaat voor');
  assert.match(output, /Hoe boek ik\?/);
  assert.doesNotMatch(output, /Wat kost het\?/, 'alleen de gekozen categorie');
  const none = await loadBlockData(normalizeBlocks([newBlock('kop')]), { faqs: () => assert.fail('niet nodig'), categories: () => assert.fail('niet nodig'), upcomingTrips: () => assert.fail('niet nodig') });
  assert.equal(none.trips.size, 0, 'geen queries zonder datablokken');
});

test('pagina\'s in het CRM', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'avanta-paginas-'));
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
  // Zoals na de import en migratie 17: de tekst staat als één tekstblok in blocks.
  const [page] = await db.query(
    `INSERT INTO pages (path, title, intro, body_html, blocks) VALUES ('/over-ons/', 'Over ons', 'Wie we zijn', '<p>Oude tekst</p>',
       '[{"id": "b0000000000aa", "type": "tekst", "data": {"html": "<p>Oude tekst</p>"}, "style": {}}]') RETURNING id`,
  );
  const [photo] = await db.query(
    `INSERT INTO media (original_url, local_name, content_type, bytes, source, title, alt_text, variants)
     VALUES (NULL, 'bib-00000000000000cc-1600.webp', 'image/webp', 10, 'upload', 'Kamp', 'Tenten bij het meer', '{"400": "bib-00000000000000cc-400.webp", "1600": "bib-00000000000000cc-1600.webp"}') RETURNING id`,
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

  const redactie = await login('redactie@example.nl');
  const kantoor = await login('kantoor@example.nl');
  const leider = await login('leider@example.nl');
  const boekhouding = await login('boekhouding@example.nl');
  const pageUrl = `/app/paginas/${page.id}/`;
  const version = async () => (await db.query('SELECT draft_version FROM pages WHERE id = $1', [page.id]))[0].draft_version;
  const audits = async (action) => (await db.query('SELECT count(*)::int AS count FROM audit_log WHERE action = $1', [action]))[0].count;
  const post = async (url, form, session = redactie) => request(url, { cookie: session.cookie, form: { _csrf: session.csrf, versie: String(await version()), ...form } });
  const blocksOf = async (column = 'draft') => {
    const [row] = await db.query(`SELECT ${column === 'draft' ? "draft -> 'blocks'" : 'blocks'} AS blocks FROM pages WHERE id = $1`, [page.id]);
    return row.blocks || [];
  };

  await t.test('rechten: zonder sessie naar inloggen, reisleider en boekhouding 403, redacteur en kantoor wel; menu', async () => {
    assert.equal((await request('/app/paginas/')).status, 303);
    for (const session of [leider, boekhouding]) {
      assert.equal((await request('/app/paginas/', { cookie: session.cookie })).status, 403);
      assert.equal((await request(pageUrl, { cookie: session.cookie })).status, 403);
      assert.equal((await request(`${pageUrl}voorbeeld/`, { cookie: session.cookie })).status, 403);
      assert.equal((await request(`${pageUrl}gegevens/`, { cookie: session.cookie, form: { _csrf: session.csrf, versie: '0', title: 'Overgenomen' } })).status, 403);
      assert.equal((await request(`${pageUrl}publiceren/`, { cookie: session.cookie, form: { _csrf: session.csrf, versie: '0' } })).status, 403);
    }
    const list = await request('/app/paginas/', { cookie: redactie.cookie });
    assert.equal(list.status, 200);
    assert.match(list.text, />Over ons</);
    assert.match(list.text, /href="\/app\/paginas\/"/, 'menu-item voor de redacteur');
    assert.equal((await request('/app/paginas/?q=over', { cookie: kantoor.cookie })).status, 200);
    assert.doesNotMatch((await request('/app/paginas/?q=bestaatniet', { cookie: kantoor.cookie })).text, />Over ons</);
    assert.doesNotMatch((await request('/app/', { cookie: boekhouding.cookie })).text, /\/app\/paginas\//, 'geen menu-item zonder recht');
  });

  await t.test('onbekend id of blok → 404, zonder CSRF → 403', async () => {
    assert.equal((await request('/app/paginas/999999/', { cookie: redactie.cookie })).status, 404);
    assert.equal((await post('/app/paginas/999999/gegevens/', { title: 'x' })).status, 404);
    assert.equal((await post('/app/paginas/999999/publiceren/', {})).status, 404);
    assert.equal((await post(`${pageUrl}blokken/b123456789abc/`, { f_html: 'x' })).status, 404);
    assert.equal((await request(`${pageUrl}blokken/b123456789abc/foto/`, { cookie: redactie.cookie })).status, 404);
    assert.equal((await request(`${pageUrl}gegevens/`, { cookie: redactie.cookie, form: { _csrf: 'fout', versie: '0', title: 'x' } })).status, 403);
  });

  await t.test('concept: de site blijft gelijk tot publiceren; voorbeeld toont het concept; verouderd formulier → 409', async () => {
    const stale = String(await version());
    const saved = await post(`${pageUrl}gegevens/`, { title: 'Over Avanta', pretitle: 'Wie wij zijn', intro: 'Nieuwe inleiding' });
    assert.equal(saved.status, 303);
    assert.match(saved.headers.get('location'), /opgeslagen=1/);
    assert.match((await request('/over-ons/')).text, /Oude tekst/);
    assert.doesNotMatch((await request('/over-ons/')).text, /Nieuwe inleiding/, 'site ongewijzigd');
    const preview = await request(`${pageUrl}voorbeeld/`, { cookie: redactie.cookie });
    assert.equal(preview.status, 200);
    assert.match(preview.text, /Nieuwe inleiding/);
    assert.match(preview.text, /Voorbeeld van het concept/);
    assert.match(preview.headers.get('x-robots-tag'), /noindex/);
    const conflict = await request(`${pageUrl}gegevens/`, { cookie: redactie.cookie, form: { _csrf: redactie.csrf, versie: stale, title: 'Overschreven' } });
    assert.equal(conflict.status, 409);
    assert.match(conflict.text, /intussen gewijzigd/);
    assert.equal((await post(`${pageUrl}gegevens/`, { title: '' })).status, 422);
    const editor = await request(pageUrl, { cookie: redactie.cookie });
    assert.match(editor.text, /Concept met wijzigingen/);
  });

  await t.test('blokken toevoegen, wijzigen, verplaatsen, kopiëren en verwijderen', async () => {
    const added = await post(`${pageUrl}blokken/nieuw/`, { type: 'kop', na: 'begin' });
    assert.equal(added.status, 303);
    let blocks = await blocksOf();
    assert.deepEqual(blocks.map((block) => block.type), ['kop', 'tekst']);
    const headingId = blocks[0].id;
    assert.equal((await post(`${pageUrl}blokken/nieuw/`, { type: 'onbekend' })).status, 422);
    assert.equal((await post(`${pageUrl}blokken/nieuw/`, { type: 'kop', na: 'b999999999999' })).status, 404);

    const invalid = await post(`${pageUrl}blokken/${headingId}/`, { f_titel: '', f_subtitel: 'Zonder titel' });
    assert.equal(invalid.status, 422);
    assert.match(invalid.text, /value="Zonder titel"/, 'ingevulde waarden blijven staan');
    const saved = await post(`${pageUrl}blokken/${headingId}/`, { f_titel: 'Onze <reizen>', f_subtitel: 'Avontuurlijk', f_niveau: 'h2', s_achtergrond: 'grijs', s_breedte: 'normaal', s_uitlijning: 'midden', s_ruimteBoven: 'klein', s_ruimteOnder: 'groot' });
    assert.equal(saved.status, 303);
    blocks = await blocksOf();
    assert.equal(blocks[0].data.titel, 'Onze <reizen>');
    assert.equal(blocks[0].style.achtergrond, 'grijs');
    const preview = await request(`${pageUrl}voorbeeld/`, { cookie: redactie.cookie });
    assert.match(preview.text, /cms-bg--grijs cms-width--normaal cms-align--midden/);
    assert.match(preview.text, /Onze &lt;reizen&gt;/);

    assert.equal((await post(`${pageUrl}blokken/${headingId}/actie/`, { actie: 'omlaag' })).status, 303);
    assert.deepEqual((await blocksOf()).map((block) => block.type), ['tekst', 'kop']);
    assert.equal((await post(`${pageUrl}blokken/${headingId}/actie/`, { actie: 'kopieren' })).status, 303);
    blocks = await blocksOf();
    assert.deepEqual(blocks.map((block) => block.type), ['tekst', 'kop', 'kop']);
    assert.notEqual(blocks[1].id, blocks[2].id, 'kopie krijgt een eigen id');
    assert.equal((await post(`${pageUrl}blokken/${blocks[2].id}/actie/`, { actie: 'verwijderen' })).status, 303);
    assert.equal((await post(`${pageUrl}blokken/${headingId}/actie/`, { actie: 'weg' })).status, 422);
    assert.deepEqual((await blocksOf()).map((block) => block.type), ['tekst', 'kop']);
    const textId = (await blocksOf())[0].id;
    assert.equal((await post(`${pageUrl}blokken/${textId}/`, { f_html: '<h2>Kop</h2><p>Nieuwe tekst<script>x</script></p>' })).status, 303);
    assert.equal((await blocksOf())[0].data.html, '<h2>Kop</h2><p>Nieuwe tekst</p>');
  });

  await t.test('foto uit de bibliotheek: blok en kopfoto, gebruikt in, verdwenen foto', async () => {
    await post(`${pageUrl}blokken/nieuw/`, { type: 'afbeelding' });
    const imageBlock = (await blocksOf()).find((block) => block.type === 'afbeelding');
    const picker = await request(`${pageUrl}blokken/${imageBlock.id}/foto/`, { cookie: redactie.cookie });
    assert.equal(picker.status, 200);
    assert.match(picker.text, new RegExp(`name="media_id" value="${photo.id}"`));
    const textBlock = (await blocksOf()).find((block) => block.type === 'tekst');
    assert.equal((await request(`${pageUrl}blokken/${textBlock.id}/foto/`, { cookie: redactie.cookie })).status, 404, 'tekstblok heeft geen foto');
    assert.equal((await post(`${pageUrl}blokken/${imageBlock.id}/foto/`, { media_id: '999999' })).status, 409);
    assert.equal((await post(`${pageUrl}blokken/${imageBlock.id}/foto/`, { media_id: 'x' })).status, 422);
    assert.equal((await post(`${pageUrl}blokken/${imageBlock.id}/foto/`, { media_id: String(photo.id) })).status, 303);
    const chosen = (await blocksOf()).find((block) => block.id === imageBlock.id).data.foto;
    assert.deepEqual(chosen, { mediaId: photo.id, url: '/media/bib-00000000000000cc-1600.webp', alt: 'Tenten bij het meer', width: null, height: null });
    assert.equal((await post(`${pageUrl}kopfoto/`, { media_id: String(photo.id) })).status, 303);
    const removal = await app.locals.mediaLibrary.remove(photo.id);
    assert.equal(removal.status, 'gebruikt', 'een foto in een concept kan niet weg');
    assert.ok(removal.places.some((place) => place.kind === 'Pagina' && place.href === '/over-ons/'));
  });

  await t.test('publiceren: versies (import als versie 1), site bijgewerkt, verdwenen foto weigert', async () => {
    // Een foto die toch verdwijnt (bijv. direct in de database) houdt publiceren tegen.
    await db.query("UPDATE pages SET draft = jsonb_set(draft, '{imageMediaId}', '999999') WHERE id = $1", [page.id]);
    assert.equal((await post(`${pageUrl}publiceren/`, {})).status, 409);
    await post(`${pageUrl}kopfoto/`, { media_id: String(photo.id) });
    const published = await post(`${pageUrl}publiceren/`, {});
    assert.equal(published.status, 303);
    assert.match(published.headers.get('location'), /opgeslagen=2/);
    const site = await request('/over-ons/');
    assert.match(site.text, /Nieuwe tekst/);
    assert.match(site.text, /Nieuwe inleiding/);
    assert.match(site.text, /cms-bg--grijs/);
    assert.match(site.text, /bib-00000000000000cc-1600\.webp/);
    const [row] = await db.query('SELECT draft, managed_in_crm, title FROM pages WHERE id = $1', [page.id]);
    assert.equal(row.draft, null);
    assert.equal(row.managed_in_crm, true);
    assert.equal(row.title, 'Over Avanta');
    const revisions = await db.query('SELECT version, title, note, published_by IS NULL AS from_import FROM page_revisions WHERE page_id = $1 ORDER BY version', [page.id]);
    assert.deepEqual(revisions.map((revision) => [revision.version, revision.title, revision.from_import]), [[1, 'Over ons', true], [2, 'Over Avanta', false]]);
    assert.equal(revisions[0].note, 'Stand uit de import');
    assert.equal((await post(`${pageUrl}publiceren/`, {})).status, 409, 'niets te publiceren');
    assert.equal((await post(`${pageUrl}concept-weggooien/`, {})).status, 409);
  });

  await t.test('versie terugzetten als concept, weggooien en de auditlog', async () => {
    assert.equal((await post(`${pageUrl}versies/99/terugzetten/`, {})).status, 404);
    assert.equal((await post(`${pageUrl}versies/1/terugzetten/`, {})).status, 303);
    const [draft] = await db.query("SELECT draft ->> 'title' AS title, draft -> 'blocks' -> 0 -> 'data' ->> 'html' AS html FROM pages WHERE id = $1", [page.id]);
    assert.deepEqual(draft, { title: 'Over ons', html: '<p>Oude tekst</p>' });
    assert.match((await request('/over-ons/')).text, /Nieuwe tekst/, 'terugzetten is eerst een concept');
    assert.equal((await post(`${pageUrl}concept-weggooien/`, {})).status, 303);
    assert.equal((await db.query('SELECT draft FROM pages WHERE id = $1', [page.id]))[0].draft, null);
    // Versie 2 had een kopfoto uit de bibliotheek: na terugzetten weet het concept weer welke foto het is.
    assert.equal((await post(`${pageUrl}versies/2/terugzetten/`, {})).status, 303);
    assert.equal((await db.query("SELECT (draft ->> 'imageMediaId')::int AS id FROM pages WHERE id = $1", [page.id]))[0].id, photo.id);
    assert.equal((await post(`${pageUrl}concept-weggooien/`, {})).status, 303);
    assert.ok(await audits('pagina.concept') >= 10);
    assert.equal(await audits('pagina.gepubliceerd'), 1);
    assert.equal(await audits('pagina.versie-terug'), 2);
    assert.equal(await audits('pagina.concept-weg'), 2);
    const log = await request('/app/auditlog/', { cookie: (await login('kantoor@example.nl')).cookie });
    assert.equal(log.status, 403, 'auditlog alleen met recht gebruikers');
  });

  await t.test('H2: galerij met meer foto\'s, video en reizen in het voorbeeld', async () => {
    const [second] = await db.query(
      `INSERT INTO media (original_url, local_name, content_type, bytes, source, title, alt_text, variants)
       VALUES (NULL, 'bib-00000000000000dd-1600.webp', 'image/webp', 10, 'upload', 'Meer', 'Meer', '{"1600": "bib-00000000000000dd-1600.webp"}') RETURNING id`,
    );
    await db.query("INSERT INTO trips (slug, title, departure_date, published) VALUES ('kamp-zweden', 'Kamp Zweden', '2099-07-01', true)");
    await post(`${pageUrl}blokken/nieuw/`, { type: 'galerij' });
    const galleryBlock = (await blocksOf()).find((block) => block.type === 'galerij');
    const picker = await request(`${pageUrl}blokken/${galleryBlock.id}/foto/`, { cookie: redactie.cookie });
    assert.match(picker.text, /type="checkbox" name="media_id"/, 'meer foto\'s tegelijk kiezen');
    const added = await request(`${pageUrl}blokken/${galleryBlock.id}/foto/`, {
      cookie: redactie.cookie, form: [['_csrf', redactie.csrf], ['versie', String(await version())], ['media_id', String(photo.id)], ['media_id', String(second.id)]],
    });
    assert.equal(added.status, 303);
    assert.deepEqual((await blocksOf()).find((block) => block.id === galleryBlock.id).data.fotos.map((image) => image.mediaId), [photo.id, second.id]);
    assert.equal((await post(`${pageUrl}blokken/${galleryBlock.id}/foto/`, { media_id: '999999' })).status, 409);
    assert.equal((await post(`${pageUrl}blokken/${galleryBlock.id}/`, { f_titel: 'Zomer', f_fotos_weg: '0' })).status, 303);
    assert.deepEqual((await blocksOf()).find((block) => block.id === galleryBlock.id).data.fotos.map((image) => image.mediaId), [second.id]);

    await post(`${pageUrl}blokken/nieuw/`, { type: 'video' });
    const videoBlock = (await blocksOf()).find((block) => block.type === 'video');
    assert.equal((await post(`${pageUrl}blokken/${videoBlock.id}/`, { f_youtube: 'https://example.com/x' })).status, 422);
    assert.equal((await post(`${pageUrl}blokken/${videoBlock.id}/`, { f_youtube: 'https://www.youtube.com/watch?v=abcdefghijk', f_titel: 'Zomerkamp' })).status, 303);
    await post(`${pageUrl}blokken/nieuw/`, { type: 'reizen' });
    const preview = await request(`${pageUrl}voorbeeld/`, { cookie: redactie.cookie });
    assert.match(preview.text, /data-video-id="abcdefghijk"/);
    assert.doesNotMatch(preview.text, /<iframe/);
    assert.match(preview.headers.get('content-security-policy'), /frame-src[^;]*youtube-nocookie/);
    assert.match(preview.text, /Kamp Zweden/);
    assert.match(preview.text, /Zomer/);
    const editor = await request(pageUrl, { cookie: redactie.cookie });
    assert.match(editor.text, /<option value="">Alle reistypes<\/option>/);
  });
});
