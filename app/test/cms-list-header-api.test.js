/**
 * Tests van de JSON-API van de koppen van de lijstpagina's (`/app/api/lijstpaginas/…`, `cms/list-header-api.js`) in de
 * echte app met een sessie: zonder sessie 401, zonder recht 403 (reisleider, boekhouding), onbekende sleutel 404,
 * ongeldige invoer 400 met een melding per veld, lezen, wijzigen (de site toont meteen de nieuwe kop), foto kiezen en
 * weghalen, de fotokiezer, de audit, de schermen met de bundel en de limiet op schrijven. Eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startApiApp } = require('./helpers/api-app');
const { WRITE_LIMIT } = require('../src/cms/list-header-api');

const DATABASE_URL = process.env.TEST_DATABASE_URL;

/**
 * Maakt een map met een manifest van Vite waarin de bundel `lijstpaginas` staat.
 * @returns {string} Pad van de map.
 */
function fakeDist() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avanta-web-'));
  fs.mkdirSync(path.join(dir, '.vite'));
  fs.writeFileSync(path.join(dir, '.vite', 'manifest.json'), JSON.stringify({ 'src/modules/lijstpaginas/main.ts': { file: 'assets/lijstpaginas-abc123.js', isEntry: true } }));
  return dir;
}

test('API van de lijstpagina\'s in de echte app', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (testContext) => {
  const app = await startApiApp({ url: DATABASE_URL, schema: 'cms_list_header_api_test', testContext, appOptions: { webDistDir: fakeDist() } });
  const { db, cookies, as, audits } = app;
  const editor = as(cookies.redactie);

  await testContext.test('overzicht met de vijf koppen en de grenzen', async () => {
    const response = await editor.get('/lijstpaginas/');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.koppen.map((header) => header.sleutel).sort(), ['aanmelden', 'blog', 'faq', 'reis', 'reisleider']);
    assert.deepEqual(Object.keys(response.body.grenzen), ['pretitel', 'titel', 'inleiding']);
    const blog = response.body.koppen.find((header) => header.sleutel === 'blog');
    assert.ok(blog.titel);
    assert.ok(blog.bronNaam);
  });

  await testContext.test('lezen, wijzigen en ongeldig; de site toont meteen de nieuwe kop', async () => {
    let response = await editor.get('/lijstpaginas/blog/');
    assert.equal(response.body.naam, 'Blog');
    response = await editor.put('/lijstpaginas/blog/', { pretitel: 'Onderweg', titel: 'Verhalen <van> reizigers', inleiding: 'Lees mee.' });
    assert.equal(response.status, 200);
    assert.equal(response.body.titel, 'Verhalen <van> reizigers');
    assert.equal(response.body.bron, 'crm');
    const site = await (await fetch(`${app.base}/blog/`)).text();
    assert.match(site, /Verhalen &lt;van&gt; reizigers/);
    response = await editor.put('/lijstpaginas/blog/', { titel: '' });
    assert.equal(response.status, 400);
    assert.ok(response.body.fout.velden.titel);
    response = await editor.put('/lijstpaginas/blog/', { titel: 'X'.repeat(121) });
    assert.ok(response.body.fout.velden.titel, 'boven de grens van het formulier');
    response = await editor.put('/lijstpaginas/blog/', { titel: 'X', foto: '/x.jpg' });
    assert.ok(response.body.fout.velden._, 'onbekend veld geweigerd');
    response = await editor.put('/lijstpaginas/blog/', { pretitel: 3, titel: 'X' });
    assert.ok(response.body.fout.velden.pretitel);
    response = await editor.put('/lijstpaginas/faq/', { titel: 'Vragen' });
    assert.equal(response.body.pretitel, '');
    assert.equal(await audits('lijstkop.gewijzigd'), 2);
  });

  await testContext.test('foto kiezen en weghalen; de fotokiezer', async () => {
    const [photo] = await db.query(
      `INSERT INTO media (original_url, local_name, content_type, bytes, source, title, alt_text, variants)
       VALUES (NULL, 'bib-00000000000000ea-1600.webp', 'image/webp', 10, 'upload', 'Kampvuur', 'Een kampvuur', '{"400": "bib-00000000000000ea-400.webp", "1600": "bib-00000000000000ea-1600.webp"}') RETURNING id`,
    );
    let response = await editor.get('/lijstpaginas/reis/fotos/?zoek=kampvuur&pagina=1');
    assert.deepEqual(response.body.photos.map((item) => item.id), [photo.id]);
    assert.equal(response.body.photos[0].url, '/media/bib-00000000000000ea-400.webp');
    assert.equal((await editor.get('/lijstpaginas/reis/fotos/?pagina=0')).status, 400);
    assert.equal((await editor.get('/lijstpaginas/reis/fotos/?land=3')).status, 400, 'onbekende parameter');
    response = await editor.put('/lijstpaginas/reis/foto/', { fotoId: photo.id });
    assert.equal(response.status, 200);
    assert.match(response.body.foto, /^\/media\/bib-00000000000000ea/);
    response = await editor.put('/lijstpaginas/reis/foto/', { fotoId: 999999 });
    assert.equal(response.status, 400);
    assert.match(response.body.fout.melding, /bestaat niet meer/);
    assert.equal((await editor.put('/lijstpaginas/reis/foto/', { fotoId: 'x' })).status, 400);
    response = await editor.put('/lijstpaginas/reis/foto/', { fotoId: null });
    assert.equal(response.body.foto, null);
    assert.equal(await audits('lijstkop.foto'), 2);
  });

  await testContext.test('onbekende sleutel 404', async () => {
    for (const pad of ['/lijstpaginas/home/', '/lijstpaginas/home/foto/', '/lijstpaginas/home/fotos/']) assert.equal((await editor.get(pad)).status, 404, pad);
    assert.equal((await editor.put('/lijstpaginas/home/', { titel: 'X' })).status, 404);
  });

  await testContext.test('zonder sessie 401, zonder recht 403', async () => {
    await app.checkAccess([
      ['GET', '/lijstpaginas/'], ['GET', '/lijstpaginas/blog/'], ['PUT', '/lijstpaginas/blog/'],
      ['PUT', '/lijstpaginas/blog/foto/'], ['GET', '/lijstpaginas/blog/fotos/'],
    ], ['leider', 'boekhouding'], assert);
  });

  await testContext.test('de schermen geven het koppelpunt als de bundel er is', async () => {
    for (const pad of ['/app/lijstpaginas/', '/app/lijstpaginas/blog/', '/app/lijstpaginas/blog/foto/']) {
      const page = await (await fetch(`${app.base}${pad}`, { headers: { cookie: cookies.redactie } })).text();
      assert.match(page, /id="crm-app" data-module="lijstpaginas" data-base="\/app\/lijstpaginas\/"/, pad);
    }
    const page = await (await fetch(`${app.base}/app/lijstpaginas/blog/foto/`, { headers: { cookie: cookies.redactie } })).text();
    assert.match(page, /<title>Foto: Blog/);
  });

  await testContext.test('limiet op schrijven per gebruiker', async () => {
    const other = as(cookies.redactie2);
    for (let attempt = 0; attempt < WRITE_LIMIT; attempt += 1) assert.equal((await other.put('/lijstpaginas/blog/', { titel: '' })).status, 400);
    assert.equal((await other.put('/lijstpaginas/blog/', { titel: 'X' })).status, 429);
    assert.equal((await other.get('/lijstpaginas/')).status, 200, 'lezen gaat door');
  });
});
