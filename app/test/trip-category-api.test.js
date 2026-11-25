/**
 * Tests van de JSON-API van de reistypes en landen (`/app/api/reistypes-en-landen/…`, `trips/category-api.js`) in de
 * echte app met een sessie: zonder sessie 401, zonder recht 403 (redacteur, boekhouding), onbekend id 404, ongeldige
 * invoer 400 met een melding per veld, aanmaken, lezen, wijzigen (301 bij een nieuwe slug, opgeschoonde tekst, een
 * lange tekst boven de gewone grens), foto kiezen en weghalen, de fotokiezer per land of alle landen, samenvoegen,
 * verwijderen alleen ongebruikt, de audit, de schermen met de bundel en de limiet op schrijven. Eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startApiApp } = require('./helpers/api-app');
const { WRITE_LIMIT } = require('../src/trips/category-api');

const DATABASE_URL = process.env.TEST_DATABASE_URL;

/**
 * Maakt een map met een manifest van Vite waarin de bundel `reistypes` staat.
 * @returns {string} Pad van de map.
 */
function fakeDist() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avanta-web-'));
  fs.mkdirSync(path.join(dir, '.vite'));
  fs.writeFileSync(path.join(dir, '.vite', 'manifest.json'), JSON.stringify({ 'src/modules/reistypes/main.ts': { file: 'assets/reistypes-abc123.js', isEntry: true } }));
  return dir;
}

test('API van reistypes en landen in de echte app', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (testContext) => {
  const users = { planner: 'kantoor', planner2: 'kantoor', redactie: 'redacteur', boekhouding: 'boekhouding' };
  const app = await startApiApp({ url: DATABASE_URL, schema: 'trip_category_api_test', testContext, users, appOptions: { webDistDir: fakeDist() } });
  const { db, cookies, as, audits } = app;
  const editor = as(cookies.planner);
  /** @type {Record<string, number>} */
  const ids = {};
  const [norway] = await db.query("SELECT id FROM trip_categories WHERE iso_code = 'NO'");
  ids.norway = norway.id;

  await testContext.test('overzicht met soorten, iconen en tellingen', async () => {
    const response = await editor.get('/reistypes-en-landen/');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.soorten.map((kind) => kind.meervoud), ['Reistypes', 'Landen', 'Overige categorieën']);
    assert.ok(response.body.items.filter((item) => item.soort === 'bestemming').length > 190, 'alle landen van de wereld');
    const item = response.body.items.find((row) => row.id === ids.norway);
    assert.equal(item.code, 'NO');
    assert.equal(item.icoon, null);
    assert.ok(Object.keys(response.body.iconen).length > 3);
    assert.ok(Array.isArray(Object.values(response.body.iconen)[0]));
  });

  await testContext.test('aanmaken en ongeldig', async () => {
    let response = await editor.post('/reistypes-en-landen/', { naam: 'Zeilreizen', soort: 'type', icoon: '', volgorde: 5, homepage: true, tekst: '<p>Op het water<script>x</script></p>' });
    assert.equal(response.status, 201);
    ids.sailing = response.body.id;
    response = await editor.post('/reistypes-en-landen/', { naam: 'Zeilen dubbel', adres: 'zeilreizen', soort: 'type' });
    assert.equal(response.body.fout.velden.adres, 'Deze slug is al in gebruik.');
    response = await editor.post('/reistypes-en-landen/', { naam: '', adres: 'Met Hoofdletters!', soort: 'planeet', icoon: 'raket', volgorde: 10000 });
    assert.deepEqual(Object.keys(response.body.fout.velden).sort(), ['volgorde']);
    response = await editor.post('/reistypes-en-landen/', { naam: '', adres: 'met spatie', soort: 'planeet', icoon: 'raket' });
    assert.deepEqual(Object.keys(response.body.fout.velden).sort(), ['adres', 'icoon', 'naam', 'soort']);
    response = await editor.post('/reistypes-en-landen/', { naam: 'X', soort: 'type', homepage: 'ja' });
    assert.equal(response.body.fout.velden.homepage, 'Kies ja of nee.');
    response = await editor.post('/reistypes-en-landen/', { naam: 'X', soort: 'type', foto: '/x.jpg' });
    assert.ok(response.body.fout.velden._, 'onbekend veld geweigerd');
    response = await editor.post('/reistypes-en-landen/', { naam: 'Dubbel Noorwegen', adres: 'noorwegen-2', soort: 'bestemming' });
    ids.duplicate = response.body.id;
    assert.equal(await audits('categorie.aangemaakt'), 2);
  });

  await testContext.test('lezen en wijzigen; nieuwe slug verwijst door; lange tekst past', async () => {
    let response = await editor.get(`/reistypes-en-landen/${ids.sailing}/`);
    assert.equal(response.body.pad, '/reis-categorie/zeilreizen/');
    assert.equal(response.body.homepage, true);
    assert.equal(response.body.tekst, '<p>Op het water</p>');
    assert.deepEqual(response.body.samenvoegenMet.map((other) => other.id).includes(ids.sailing), false);
    const longText = `<p>${'é'.repeat(90_000)}</p>`;
    response = await editor.put(`/reistypes-en-landen/${ids.sailing}/`, { naam: 'Zeilen', adres: 'zeilen', soort: 'type', tekst: longText });
    assert.deepEqual(response.body, { id: ids.sailing, verplaatst: true });
    const site = await fetch(`${app.base}/reis-categorie/zeilreizen/`, { redirect: 'manual' });
    assert.equal(site.status, 301);
    response = await editor.put(`/reistypes-en-landen/${ids.sailing}/`, { naam: 'Zeilen', adres: 'zeilen', soort: 'type', tekst: `<p>${'x'.repeat(100_001)}</p>` });
    assert.equal(response.body.fout.velden.tekst, 'De tekst is te lang.');
    response = await editor.put(`/reistypes-en-landen/${ids.sailing}/`, { naam: 'Zeilen', soort: 'type' });
    assert.equal(response.body.verplaatst, false, 'leeg adres = uit de naam, dus hetzelfde');
    assert.equal(await audits('categorie.gewijzigd'), 2);
  });

  await testContext.test('foto kiezen en weghalen; kiezer per land of alle landen', async () => {
    const [photo] = await db.query(
      `INSERT INTO media (original_url, local_name, content_type, bytes, source, title, alt_text, variants)
       VALUES (NULL, 'bib-00000000000000ee-1600.webp', 'image/webp', 10, 'upload', 'Fjord', 'Een fjord', '{"400": "bib-00000000000000ee-400.webp", "1600": "bib-00000000000000ee-1600.webp"}') RETURNING id`,
    );
    await db.query(
      `INSERT INTO media (original_url, local_name, content_type, bytes, source, title, alt_text, variants)
       VALUES (NULL, 'bib-00000000000000ef-1600.webp', 'image/webp', 10, 'upload', 'Strand', 'Een strand', '{"400": "bib-00000000000000ef-400.webp"}')`,
    );
    await db.query('INSERT INTO media_countries (media_id, category_id) VALUES ($1, $2)', [photo.id, ids.norway]);
    let response = await editor.get(`/reistypes-en-landen/${ids.norway}/fotos/`);
    assert.deepEqual(response.body.photos.map((item) => item.title), ['Fjord'], 'alleen dit land');
    assert.deepEqual(response.body.photos[0], { id: photo.id, url: '/media/bib-00000000000000ee-400.webp', title: 'Fjord', alt: 'Een fjord', meta: 'Noorwegen', width: 400, height: 300 });
    response = await editor.get(`/reistypes-en-landen/${ids.norway}/fotos/?alle=1&zoek=strand&pagina=1`);
    assert.deepEqual(response.body.photos.map((item) => item.title), ['Strand']);
    assert.equal(response.body.photos[0].meta, 'Geen land');
    response = await editor.get(`/reistypes-en-landen/${ids.sailing}/fotos/`);
    assert.equal(response.body.photos.length, 2, 'een reistype ziet alle foto\'s');
    assert.equal((await editor.get(`/reistypes-en-landen/${ids.norway}/fotos/?pagina=0`)).status, 400);
    assert.equal((await editor.get(`/reistypes-en-landen/${ids.norway}/fotos/?land=3`)).status, 400, 'onbekende parameter');
    assert.equal((await editor.get('/reistypes-en-landen/999999/fotos/')).status, 404);

    response = await editor.put(`/reistypes-en-landen/${ids.norway}/foto/`, { fotoId: photo.id });
    assert.deepEqual(response.body, { foto: '/media/bib-00000000000000ee-1600.webp' });
    response = await editor.put(`/reistypes-en-landen/${ids.norway}/foto/`, { fotoId: 999999 });
    assert.equal(response.status, 400);
    assert.match(response.body.fout.melding, /bestaat niet meer/);
    response = await editor.put(`/reistypes-en-landen/${ids.norway}/foto/`, { fotoId: null });
    assert.deepEqual(response.body, { foto: null });
    assert.equal((await editor.put('/reistypes-en-landen/999999/foto/', { fotoId: null })).status, 404);
    assert.equal(await audits('categorie.foto'), 2);
  });

  await testContext.test('samenvoegen en verwijderen', async () => {
    let response = await editor.post(`/reistypes-en-landen/${ids.duplicate}/samenvoegen/`, { doelId: ids.sailing });
    assert.match(response.body.fout.melding, /dezelfde soort/);
    response = await editor.post(`/reistypes-en-landen/${ids.duplicate}/samenvoegen/`, { doelId: ids.duplicate });
    assert.equal(response.body.fout.velden.doelId, 'Kies een andere categorie dan deze.');
    response = await editor.post(`/reistypes-en-landen/${ids.duplicate}/samenvoegen/`, { doelId: 999999 });
    assert.equal(response.body.fout.velden.doelId, 'De gekozen categorie bestaat niet meer.');
    response = await editor.post(`/reistypes-en-landen/${ids.duplicate}/samenvoegen/`, {});
    assert.equal(response.status, 400);
    const [trip] = await db.query("INSERT INTO trips (slug, title, departure_date) VALUES ('test-reis', 'Reis', '2099-06-01') RETURNING id");
    await db.query('INSERT INTO trip_category_links (trip_id, category_id) VALUES ($1, $2)', [trip.id, ids.duplicate]);
    response = await editor.post(`/reistypes-en-landen/${ids.duplicate}/samenvoegen/`, { doelId: ids.norway });
    assert.deepEqual(response.body, { doelId: ids.norway });
    assert.equal((await editor.get(`/reistypes-en-landen/${ids.duplicate}/`)).status, 404);
    assert.equal((await fetch(`${app.base}/reis-categorie/noorwegen-2/`, { redirect: 'manual' })).status, 301);
    assert.equal((await editor.post('/reistypes-en-landen/999999/samenvoegen/', { doelId: ids.norway })).status, 404);

    response = await editor.delete(`/reistypes-en-landen/${ids.norway}/`);
    assert.match(response.body.fout.melding, /Voeg samen/);
    assert.equal((await editor.delete(`/reistypes-en-landen/${ids.sailing}/`)).status, 204);
    assert.equal((await editor.delete(`/reistypes-en-landen/${ids.sailing}/`)).status, 404);
    for (const pad of ['/reistypes-en-landen/999999/', '/reistypes-en-landen/abc/']) assert.equal((await editor.get(pad)).status, 404, pad);
    assert.equal((await editor.put('/reistypes-en-landen/999999/', { naam: 'X', soort: 'type' })).status, 404);
    assert.equal(await audits('categorie.samengevoegd'), 1);
    assert.equal(await audits('categorie.verwijderd'), 1);
  });

  await testContext.test('zonder sessie 401, zonder recht 403', async () => {
    const one = `/reistypes-en-landen/${ids.norway}/`;
    await app.checkAccess([
      ['GET', '/reistypes-en-landen/'], ['POST', '/reistypes-en-landen/'], ['GET', one], ['PUT', one], ['DELETE', one],
      ['PUT', `${one}foto/`], ['GET', `${one}fotos/`], ['POST', `${one}samenvoegen/`],
    ], ['redactie', 'boekhouding'], assert);
  });

  await testContext.test('de schermen geven het koppelpunt als de bundel er is', async () => {
    let page = await (await fetch(`${app.base}/app/reistypes-en-landen/`, { headers: { cookie: cookies.planner } })).text();
    assert.match(page, /id="crm-app" data-module="reistypes" data-base="\/app\/reistypes-en-landen\/"/);
    page = await (await fetch(`${app.base}/app/reistypes-en-landen/${ids.norway}/`, { headers: { cookie: cookies.planner } })).text();
    assert.match(page, /<title>Noorwegen/);
    assert.equal((await fetch(`${app.base}/app/reistypes-en-landen/999999/`, { headers: { cookie: cookies.planner } })).status, 404);
  });

  await testContext.test('limiet op schrijven per gebruiker', async () => {
    const other = as(cookies.planner2);
    for (let attempt = 0; attempt < WRITE_LIMIT; attempt += 1) assert.equal((await other.post('/reistypes-en-landen/', { naam: '', soort: 'type' })).status, 400);
    assert.equal((await other.post('/reistypes-en-landen/', { naam: 'X', soort: 'type' })).status, 429);
    assert.equal((await other.get('/reistypes-en-landen/')).status, 200, 'lezen gaat door');
  });
});
