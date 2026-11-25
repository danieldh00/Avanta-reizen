/**
 * Tests van de JSON-API van de categorieën en tags van het blog (`/app/api/blog-indeling/…`, `cms/post-term-api.js`)
 * in de echte app met een sessie: zonder sessie 401, zonder recht 403, onbekend id 404, ongeldige invoer 400 met een
 * melding per veld, toevoegen, lezen, wijzigen (nieuw adres met een doorverwijzing) en verwijderen, de audit, de
 * schermen met en zonder bundel en de limiet op schrijven. Draait in een eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startApiApp } = require('./helpers/api-app');
const { WRITE_LIMIT } = require('../src/cms/post-term-api');

const DATABASE_URL = process.env.TEST_DATABASE_URL;

/**
 * Maakt een map met een manifest van Vite waarin de bundel `blog-indeling` staat.
 * @returns {string} Pad van de map.
 */
function fakeDist() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avanta-web-'));
  fs.mkdirSync(path.join(dir, '.vite'));
  fs.writeFileSync(path.join(dir, '.vite', 'manifest.json'), JSON.stringify({
    'src/modules/blog-indeling/main.ts': { file: 'assets/blog-indeling-abc123.js', isEntry: true },
  }));
  return dir;
}

test('API van categorieën en tags in de echte app', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (testContext) => {
  const app = await startApiApp({ url: DATABASE_URL, schema: 'cms_post_term_api_test', testContext, appOptions: { webDistDir: fakeDist() } });
  const { db, cookies, as, audits } = app;
  const editor = as(cookies.redactie);
  /** @type {Record<string, number>} */
  const ids = {};

  await testContext.test('toevoegen, dubbel en ongeldig', async () => {
    let response = await editor.post('/blog-indeling/', { soort: 'categorie', naam: '  Reisverslagen ', inleiding: 'Verhalen', volgorde: 20 });
    assert.equal(response.status, 201);
    ids.verslagen = response.body.id;
    response = await editor.post('/blog-indeling/', { soort: 'tag', naam: 'Noorwegen', adres: 'noorwegen' });
    assert.equal(response.status, 201);
    ids.noorwegen = response.body.id;
    response = await editor.post('/blog-indeling/', { soort: 'tag', naam: 'Ander', adres: 'noorwegen' });
    assert.equal(response.status, 400);
    assert.equal(response.body.fout.velden.adres, 'Dit adres bestaat al.');
    response = await editor.post('/blog-indeling/', { soort: 'categorie', naam: 'Noorwegen' });
    assert.equal(response.status, 201, 'zelfde adres bij een andere soort mag');
    ids.categorieNoorwegen = response.body.id;
    response = await editor.post('/blog-indeling/', { soort: 'tag', naam: '', adres: 'Met Hoofdletters', volgorde: 1.5 });
    assert.deepEqual(Object.keys(response.body.fout.velden).sort(), ['volgorde']);
    response = await editor.post('/blog-indeling/', { soort: 'tag', naam: '', adres: 'Met Hoofdletters' });
    assert.deepEqual(Object.keys(response.body.fout.velden).sort(), ['adres', 'naam']);
    response = await editor.post('/blog-indeling/', { soort: 'rubriek', naam: 'X' });
    assert.equal(response.body.fout.velden.soort, 'Kies categorie of tag.');
    response = await editor.post('/blog-indeling/', { soort: 'tag', naam: 'X', afbeelding: 'x.jpg' });
    assert.ok(response.body.fout.velden._, 'onbekend veld geweigerd');
    response = await editor.post('/blog-indeling/', { soort: 'tag', naam: 'X'.repeat(101) });
    assert.equal(response.body.fout.velden.naam, 'Maximaal 100 tekens.');
    assert.equal(await audits('blog-indeling.nieuw'), 3);
  });

  await testContext.test('overzicht en één lezen', async () => {
    await db.query("INSERT INTO posts (slug, title, published) VALUES ('test-bericht', 'Bericht', true)");
    await db.query("INSERT INTO post_term_links (post_id, term_id) SELECT id, $1 FROM posts WHERE slug = 'test-bericht'", [ids.verslagen]);
    let response = await editor.get('/blog-indeling/');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.soorten.map((group) => [group.soort, group.voorvoegsel, group.items.map((item) => item.naam)]), [
      ['categorie', '/category/', ['Noorwegen', 'Reisverslagen']],
      ['tag', '/tag/', ['Noorwegen']],
    ]);
    const verslagen = response.body.soorten[0].items.find((item) => item.id === ids.verslagen);
    assert.deepEqual(verslagen, { id: ids.verslagen, naam: 'Reisverslagen', adres: 'reisverslagen', berichten: 1, volgorde: 20 });
    assert.equal(response.body.grenzen.naam, 100);
    response = await editor.get(`/blog-indeling/${ids.verslagen}/`);
    assert.equal(response.body.soortNaam, 'Categorie');
    assert.equal(response.body.inleiding, 'Verhalen');
    assert.equal(response.body.adres, 'reisverslagen');
  });

  await testContext.test('wijzigen: nieuw adres verwijst door', async () => {
    let response = await editor.put(`/blog-indeling/${ids.verslagen}/`, { naam: 'Reisverslagen', adres: 'verslagen', inleiding: '', volgorde: 5 });
    assert.deepEqual(response.body, { id: ids.verslagen, verplaatst: true });
    const [redirect] = await db.query('SELECT to_url FROM redirects WHERE from_path = $1', ['/category/reisverslagen/']);
    assert.equal(redirect.to_url, '/category/verslagen/');
    const site = await fetch(`${app.base}/category/reisverslagen/`, { redirect: 'manual' });
    assert.equal(site.status, 301, 'de doorverwijzing is meteen actief');
    response = await editor.put(`/blog-indeling/${ids.verslagen}/`, { naam: 'Reisverslagen', adres: 'verslagen' });
    assert.deepEqual(response.body, { id: ids.verslagen, verplaatst: false });
    response = await editor.put(`/blog-indeling/${ids.verslagen}/`, { naam: 'X', adres: 'noorwegen' });
    assert.equal(response.body.fout.velden.adres, 'Dit adres bestaat al.');
    response = await editor.put(`/blog-indeling/${ids.verslagen}/`, { naam: '' });
    assert.equal(response.body.fout.velden.naam, 'Vul een naam in.');
    response = await editor.put(`/blog-indeling/${ids.verslagen}/`, { naam: 'X', soort: 'tag' });
    assert.ok(response.body.fout.velden._, 'de soort verandert niet');
    assert.equal(await audits('blog-indeling.gewijzigd'), 2);
  });

  await testContext.test('verwijderen; onbekend id 404', async () => {
    assert.equal((await editor.delete(`/blog-indeling/${ids.categorieNoorwegen}/`)).status, 204);
    assert.equal((await editor.get(`/blog-indeling/${ids.categorieNoorwegen}/`)).status, 404);
    for (const pad of ['/blog-indeling/999999/', '/blog-indeling/abc/']) assert.equal((await editor.get(pad)).status, 404, pad);
    assert.equal((await editor.put('/blog-indeling/999999/', { naam: 'X' })).status, 404);
    assert.equal((await editor.delete('/blog-indeling/999999/')).status, 404);
    assert.equal(await audits('blog-indeling.verwijderd'), 1);
  });

  await testContext.test('zonder sessie 401, zonder recht 403', async () => {
    await app.checkAccess([
      ['GET', '/blog-indeling/'], ['POST', '/blog-indeling/'], ['GET', `/blog-indeling/${ids.noorwegen}/`],
      ['PUT', `/blog-indeling/${ids.noorwegen}/`], ['DELETE', `/blog-indeling/${ids.noorwegen}/`],
    ], ['leider', 'boekhouding'], assert);
    assert.equal((await editor.get(`/blog-indeling/${ids.noorwegen}/`)).status, 200, 'niets verwijderd door wie geen recht had');
  });

  await testContext.test('de schermen geven het koppelpunt als de bundel er is', async () => {
    let response = await fetch(`${app.base}/app/blog/categorieen-en-tags/`, { headers: { cookie: cookies.redactie } });
    let page = await response.text();
    assert.match(page, /id="crm-app" data-module="blog-indeling" data-base="\/app\/blog\/categorieen-en-tags\/"/);
    assert.match(page, /\/bundel\/assets\/blog-indeling-abc123\.js/);
    response = await fetch(`${app.base}/app/blog/categorieen-en-tags/${ids.noorwegen}/`, { headers: { cookie: cookies.redactie } });
    page = await response.text();
    assert.match(page, /<title>Tag: Noorwegen/);
    assert.match(page, /data-module="blog-indeling"/);
    response = await fetch(`${app.base}/app/blog/categorieen-en-tags/999999/`, { headers: { cookie: cookies.redactie } });
    assert.equal(response.status, 404);
    response = await fetch(`${app.base}/app/blog/categorieen-en-tags/`, { headers: { cookie: cookies.leider }, redirect: 'manual' });
    assert.equal(response.status, 403);
  });

  await testContext.test('limiet op schrijven per gebruiker', async () => {
    const other = as(cookies.redactie2);
    let response;
    for (let attempt = 0; attempt < WRITE_LIMIT; attempt += 1) {
      response = await other.post('/blog-indeling/', { soort: 'tag', naam: '' });
      assert.equal(response.status, 400);
    }
    response = await other.post('/blog-indeling/', { soort: 'tag', naam: 'Nog een' });
    assert.equal(response.status, 429);
    assert.equal((await other.get('/blog-indeling/')).status, 200, 'lezen gaat door');
    assert.equal((await editor.post('/blog-indeling/', { soort: 'tag', naam: 'Andere gebruiker' })).status, 201, 'een andere gebruiker telt apart');
  });
});
