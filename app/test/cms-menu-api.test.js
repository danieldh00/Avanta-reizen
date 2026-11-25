/**
 * Tests van de JSON-API van de menu's (`/app/api/menus/…`, `cms/menu-api.js`) in de echte app met een sessie: zonder
 * sessie 401, zonder recht 403, onbekend id 404, ongeldige invoer 400 met een melding per veld (ook een onveilig adres
 * en een submenu in de voettekst), toevoegen, lezen, wijzigen en verwijderen (met het submenu), de site die de menu's
 * meteen opnieuw leest, de audit, de schermen met de bundel en de limiet op schrijven. Draait in een eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startApiApp } = require('./helpers/api-app');
const { WRITE_LIMIT } = require('../src/cms/menu-api');

const DATABASE_URL = process.env.TEST_DATABASE_URL;

/**
 * Maakt een map met een manifest van Vite waarin de bundel `menus` staat.
 * @returns {string} Pad van de map.
 */
function fakeDist() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avanta-web-'));
  fs.mkdirSync(path.join(dir, '.vite'));
  fs.writeFileSync(path.join(dir, '.vite', 'manifest.json'), JSON.stringify({ 'src/modules/menus/main.ts': { file: 'assets/menus-abc123.js', isEntry: true } }));
  return dir;
}

test('API van de menu\'s in de echte app', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (testContext) => {
  const app = await startApiApp({ url: DATABASE_URL, schema: 'cms_menu_api_test', testContext, appOptions: { webDistDir: fakeDist() } });
  const { db, cookies, as, audits } = app;
  const editor = as(cookies.redactie);
  /** @type {Record<string, number>} */
  const ids = {};

  await testContext.test('toevoegen en ongeldig', async () => {
    let response = await editor.post('/menus/', { menu: 'hoofd', ouderId: null, tekst: 'Onze reizen', adres: '/reis/', volgorde: 10 });
    assert.equal(response.status, 201);
    ids.reizen = response.body.id;
    response = await editor.post('/menus/', { menu: 'hoofd', ouderId: ids.reizen, tekst: 'Kamperen', adres: '/reis-categorie/kamperen/' });
    assert.equal(response.status, 201);
    ids.kamperen = response.body.id;
    response = await editor.post('/menus/', { menu: 'voet', tekst: 'Privacy', adres: 'https://example.org/privacy' });
    assert.equal(response.status, 201);
    ids.privacy = response.body.id;
    response = await editor.post('/menus/', { menu: 'voet', ouderId: ids.reizen, tekst: 'X', adres: 'javascript:alert(1)' });
    assert.equal(response.status, 400);
    assert.deepEqual(Object.keys(response.body.fout.velden).sort(), ['adres', 'ouderId']);
    response = await editor.post('/menus/', { menu: 'hoofd', ouderId: ids.kamperen, tekst: 'Dieper', adres: '/x/' });
    assert.equal(response.body.fout.velden.ouderId, 'Kies een hoofditem uit het hoofdmenu.', 'geen tweede niveau');
    response = await editor.post('/menus/', { menu: 'zij', tekst: '', adres: '//evil.example/' });
    assert.deepEqual(Object.keys(response.body.fout.velden).sort(), ['adres', 'menu', 'tekst']);
    response = await editor.post('/menus/', { menu: 'hoofd', tekst: 'X', adres: '/x/', volgorde: 10000 });
    assert.equal(response.body.fout.velden.volgorde, 'Vul een heel getal in tussen -9999 en 9999.');
    response = await editor.post('/menus/', { menu: 'hoofd', tekst: 'X', adres: '/x/', extra: 1 });
    assert.ok(response.body.fout.velden._, 'onbekend veld geweigerd');
    assert.equal(await audits('menu.nieuw'), 3);
  });

  await testContext.test('overzicht en één lezen; de site leest de menu\'s meteen', async () => {
    await db.query("INSERT INTO pages (path, title, published) VALUES ('/over-ons/', 'Over ons', true)");
    let response = await editor.get('/menus/');
    assert.equal(response.status, 200);
    const own = new Set(Object.values(ids));
    assert.deepEqual(response.body.menus.map((group) => [group.menu, group.items.filter((item) => own.has(item.id)).map((item) => item.tekst)]), [['hoofd', ['Onze reizen', 'Kamperen']], ['voet', ['Privacy']]]);
    const main = response.body.menus[0].items;
    assert.equal(main[main.findIndex((item) => item.id === ids.reizen) + 1].id, ids.kamperen, 'submenu direct onder het hoofditem');
    assert.deepEqual(main.find((item) => item.id === ids.kamperen), { id: ids.kamperen, menu: 'hoofd', ouderId: ids.reizen, tekst: 'Kamperen', adres: '/reis-categorie/kamperen/', volgorde: 0 });
    assert.ok(response.body.suggesties.some((suggestion) => suggestion.pad === '/over-ons/' && suggestion.titel === 'Over ons'));
    assert.deepEqual(response.body.grenzen, { tekst: 60, adres: 300, items: 40 });
    response = await editor.get(`/menus/${ids.reizen}/`);
    assert.equal(response.body.aantalSubitems, 1);
    const home = await (await fetch(`${app.base}/`)).text();
    assert.match(home, /Onze reizen/);
  });

  await testContext.test('wijzigen', async () => {
    let response = await editor.put(`/menus/${ids.reizen}/`, { menu: 'voet', ouderId: null, tekst: 'Onze reizen', adres: '/reis/' });
    assert.equal(response.body.fout.velden.menu, 'Dit item heeft een submenu en blijft in het hoofdmenu.');
    response = await editor.put(`/menus/${ids.reizen}/`, { menu: 'hoofd', ouderId: ids.reizen, tekst: 'Onze reizen', adres: '/reis/' });
    assert.equal(response.body.fout.velden.ouderId, 'Kies een hoofditem uit het hoofdmenu.', 'niet onder zichzelf');
    response = await editor.put(`/menus/${ids.reizen}/`, { menu: 'hoofd', ouderId: null, tekst: 'Alle reizen', adres: '/reis/', volgorde: 5 });
    assert.deepEqual(response.body, { id: ids.reizen });
    const home = await (await fetch(`${app.base}/`)).text();
    assert.match(home, /Alle reizen/);
    assert.equal(await audits('menu.gewijzigd'), 1);
  });

  await testContext.test('verwijderen met submenu; onbekend id 404', async () => {
    assert.equal((await editor.delete(`/menus/${ids.reizen}/`)).status, 204);
    assert.equal((await editor.get(`/menus/${ids.kamperen}/`)).status, 404, 'het submenu ging mee');
    for (const pad of ['/menus/999999/', '/menus/abc/']) assert.equal((await editor.get(pad)).status, 404, pad);
    assert.equal((await editor.put('/menus/999999/', { menu: 'hoofd', tekst: 'X', adres: '/x/' })).status, 404);
    assert.equal((await editor.delete('/menus/999999/')).status, 404);
    assert.equal(await audits('menu.verwijderd'), 1);
  });

  await testContext.test('zonder sessie 401, zonder recht 403', async () => {
    await app.checkAccess([
      ['GET', '/menus/'], ['POST', '/menus/'], ['GET', `/menus/${ids.privacy}/`], ['PUT', `/menus/${ids.privacy}/`], ['DELETE', `/menus/${ids.privacy}/`],
    ], ['leider', 'boekhouding'], assert);
    assert.equal((await editor.get(`/menus/${ids.privacy}/`)).status, 200, 'niets verwijderd door wie geen recht had');
  });

  await testContext.test('de schermen geven het koppelpunt als de bundel er is', async () => {
    let page = await (await fetch(`${app.base}/app/menus/`, { headers: { cookie: cookies.redactie } })).text();
    assert.match(page, /id="crm-app" data-module="menus" data-base="\/app\/menus\/"/);
    page = await (await fetch(`${app.base}/app/menus/${ids.privacy}/`, { headers: { cookie: cookies.redactie } })).text();
    assert.match(page, /<title>Menu-item: Privacy/);
    // Het eerste scherm krijgt zijn gegevens mee in de pagina, gelijk aan de API: geen extra verzoek vooraf.
    await app.checkPreload('/app/menus/', cookies.redactie, ['/menus/'], assert);
    await app.checkPreload(`/app/menus/${ids.privacy}/`, cookies.redactie, [`/menus/${ids.privacy}/`, '/menus/'], assert);
    assert.equal((await fetch(`${app.base}/app/menus/999999/`, { headers: { cookie: cookies.redactie } })).status, 404);
  });

  await testContext.test('limiet op schrijven per gebruiker', async () => {
    const other = as(cookies.redactie2);
    for (let attempt = 0; attempt < WRITE_LIMIT; attempt += 1) assert.equal((await other.post('/menus/', { menu: 'hoofd', tekst: '', adres: '/x/' })).status, 400);
    const response = await other.post('/menus/', { menu: 'hoofd', tekst: 'X', adres: '/x/' });
    assert.equal(response.status, 429);
    assert.equal((await other.get('/menus/')).status, 200, 'lezen gaat door');
  });
});
