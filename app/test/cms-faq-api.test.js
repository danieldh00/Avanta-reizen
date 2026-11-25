/**
 * Tests van de JSON-API van de veelgestelde vragen (`/app/api/faq/…`, `cms/faq-api.js`) in de echte app met een
 * sessie: zonder sessie 401, zonder recht 403 (reisleider en boekhouding), onbekend id 404, ongeldige invoer 400 met
 * een melding per veld (ook onbekende velden en een antwoord dat na het opschonen leeg is), vragen en categorieën
 * toevoegen, lezen, wijzigen en verwijderen (categorie alleen leeg), de volgorde, de audit en de limiet op schrijven.
 * Draait in een eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { hashPassword } = require('../src/crm/passwords');
const { COOKIE_NAME } = require('../src/crm/auth');
const { WRITE_LIMIT } = require('../src/cms/faq-api');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'cms_faq_api_test';
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

test('FAQ-API in de echte app', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (testContext) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  const app = createApp({ db, masterKey: Buffer.alloc(32, 45) });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  testContext.after(async () => { server.close(); await db.close(); });

  const hash = await hashPassword(PASSWORD);
  const users = [['redactie@example.nl', 'redacteur'], ['redactie2@example.nl', 'redacteur'], ['leider@example.nl', 'reisleider'], ['boekhouding@example.nl', 'boekhouding']];
  for (const [email, role] of users) {
    await db.query('INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)', [email, role, role, hash]);
  }

  /**
   * Logt in en geeft de sessiecookie.
   * @param {string} email E-mailadres.
   * @returns {Promise<string>} Cookie (`naam=waarde`).
   */
  const login = async (email) => {
    const response = await fetch(`${base}/app/inloggen/`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, password: PASSWORD }).toString(), redirect: 'manual' });
    return response.headers.getSetCookie().find((value) => value.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  };
  const redactie = await login('redactie@example.nl');
  const redactie2 = await login('redactie2@example.nl');
  const leider = await login('leider@example.nl');
  const boekhouding = await login('boekhouding@example.nl');

  /**
   * Doet een verzoek naar de API.
   * @param {string} method Methode.
   * @param {string} path Pad binnen `/app/api`.
   * @param {{cookie?: string, body?: any}} [init] Sessie en JSON-inhoud.
   * @returns {Promise<{status: number, body: any}>} Status en JSON.
   */
  const call = async (method, path, init = {}) => {
    /** @type {Record<string, string>} */
    const headers = { 'x-avanta-api': '1' };
    if (init.cookie) headers.cookie = init.cookie;
    let body;
    if (init.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(init.body);
    }
    const response = await fetch(`${base}/app/api${path}`, { method, headers, body, redirect: 'manual' });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  const as = (cookie) => ({
    get: (path) => call('GET', path, { cookie }),
    post: (path, body) => call('POST', path, { cookie, body }),
    put: (path, body) => call('PUT', path, { cookie, body }),
    delete: (path) => call('DELETE', path, { cookie }),
  });
  const editor = as(redactie);
  const audits = async (action) => (await db.query('SELECT count(*)::int AS count FROM audit_log WHERE action = $1', [action]))[0].count;

  /** @type {Record<string, number>} */
  const ids = {};

  await testContext.test('categorie toevoegen, dubbel en ongeldig', async () => {
    let response = await editor.post('/faq/categorieen/', { naam: '  Reizen ', volgorde: 20 });
    assert.equal(response.status, 201);
    ids.reizen = response.body.id;
    response = await editor.post('/faq/categorieen/', { naam: 'Betalen' });
    assert.equal(response.status, 201);
    ids.betalen = response.body.id;
    response = await editor.post('/faq/categorieen/', { naam: 'reizen' });
    assert.equal(response.status, 400);
    assert.equal(response.body.fout.velden.naam, 'Deze categorie bestaat al.');
    response = await editor.post('/faq/categorieen/', { naam: 'A<b>' });
    assert.equal(response.body.fout.velden.naam, 'Gebruik geen < of >.');
    response = await editor.post('/faq/categorieen/', { naam: 'Goed', volgorde: 1.5, extra: true });
    assert.equal(response.status, 400);
    assert.ok(response.body.fout.velden.volgorde);
    assert.ok(response.body.fout.velden._, 'onbekend veld geweigerd');
    response = await editor.post('/faq/categorieen/', { naam: 12 });
    assert.equal(response.body.fout.velden.naam, 'Vul een naam in.');
    assert.equal(await audits('faq.categorie-nieuw'), 2);
  });

  await testContext.test('vraag toevoegen, lezen en wijzigen; antwoord opgeschoond', async () => {
    let response = await editor.post('/faq/vragen/', { vraag: 'Paspoort nodig?', antwoord: '<p>Ja<script>alert(1)</script></p>', categorieId: ids.reizen, volgorde: 5 });
    assert.equal(response.status, 201);
    ids.paspoort = response.body.id;
    response = await editor.post('/faq/vragen/', { vraag: 'Wat neem ik mee?', antwoord: '<p>Een tent</p>', categorieId: ids.reizen });
    ids.mee = response.body.id;
    response = await editor.post('/faq/vragen/', { vraag: 'Hoe betaal ik?', antwoord: '<p>Via de bank</p>', categorieId: ids.betalen });
    ids.betaal = response.body.id;
    response = await editor.get(`/faq/vragen/${ids.paspoort}/`);
    assert.equal(response.status, 200);
    assert.equal(response.body.vraag, 'Paspoort nodig?');
    assert.equal(response.body.categorieId, ids.reizen);
    assert.equal(response.body.volgorde, 5);
    assert.match(response.body.antwoord, /<p>Ja/);
    assert.doesNotMatch(response.body.antwoord, /script/);

    response = await editor.post('/faq/vragen/', { vraag: '', antwoord: '<script>x</script>', categorieId: 999999 });
    assert.equal(response.status, 400);
    assert.deepEqual(Object.keys(response.body.fout.velden).sort(), ['antwoord', 'vraag']);
    response = await editor.post('/faq/vragen/', { vraag: 'Zonder categorie?', antwoord: '<p>Nee</p>', categorieId: 999999 });
    assert.equal(response.body.fout.velden.categorieId, 'Kies een categorie.', 'categorie die niet bestaat');
    response = await editor.post('/faq/vragen/', { vraag: 'V', antwoord: '<p>a</p>', categorieId: '3' });
    assert.equal(response.body.fout.velden.categorieId, 'Kies een categorie.', 'tekst in plaats van een getal');

    response = await editor.put(`/faq/vragen/${ids.paspoort}/`, { vraag: 'Heb ik een paspoort nodig?', antwoord: '<p>Ja, altijd.</p>', categorieId: ids.betalen, volgorde: 1 });
    assert.equal(response.status, 200);
    const [row] = await db.query('SELECT question, category, managed_in_crm FROM faqs WHERE id = $1', [ids.paspoort]);
    assert.deepEqual(row, { question: 'Heb ik een paspoort nodig?', category: 'Betalen', managed_in_crm: true });
    response = await editor.put(`/faq/vragen/${ids.paspoort}/`, { vraag: 'x', antwoord: '<p>x</p>', categorieId: 999999 });
    assert.equal(response.body.fout.velden.categorieId, 'Kies een categorie.');
    assert.equal(await audits('faq.vraag-nieuw'), 3);
    assert.equal(await audits('faq.vraag-gewijzigd'), 1);
  });

  await testContext.test('overzicht en categorie lezen', async () => {
    const response = await editor.get('/faq/');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.categorieen.map((category) => [category.naam, category.vragen.map((question) => question.vraag)]), [
      ['Betalen', ['Hoe betaal ik?', 'Heb ik een paspoort nodig?']],
      ['Reizen', ['Wat neem ik mee?']],
    ]);
    assert.deepEqual(response.body.los, []);
    assert.equal(response.body.grenzen.antwoord, 20_000);
    const category = await editor.get(`/faq/categorieen/${ids.betalen}/`);
    assert.deepEqual(category.body, { id: ids.betalen, naam: 'Betalen', volgorde: 0, aantalVragen: 2 });
  });

  await testContext.test('onbekend id 404, ook bij schrijven', async () => {
    for (const path of ['/faq/vragen/999999/', '/faq/categorieen/999999/', '/faq/vragen/abc/', '/faq/vragen/0x1/']) {
      assert.equal((await editor.get(path)).status, 404, path);
    }
    assert.equal((await editor.put('/faq/vragen/999999/', { vraag: 'x', antwoord: '<p>x</p>', categorieId: ids.reizen })).status, 404);
    assert.equal((await editor.delete('/faq/vragen/999999/')).status, 404);
    assert.equal((await editor.put('/faq/categorieen/999999/', { naam: 'X' })).status, 404);
    assert.equal((await editor.delete('/faq/categorieen/999999/')).status, 404);
    assert.equal((await editor.put('/faq/categorieen/999999/volgorde/', { vragen: [] })).status, 404);
  });

  await testContext.test('volgorde van categorieën en vragen', async () => {
    let response = await editor.put('/faq/volgorde/', { categorieen: [ids.reizen] });
    assert.equal(response.status, 400, 'niet alle categorieën');
    response = await editor.put('/faq/volgorde/', { categorieen: [ids.reizen, ids.reizen] });
    assert.equal(response.status, 400, 'dubbel');
    response = await editor.put('/faq/volgorde/', { categorieen: [ids.reizen, 'x'] });
    assert.equal(response.status, 400, 'geen getal');
    response = await editor.put('/faq/volgorde/', { categorieen: [ids.reizen, ids.betalen] });
    assert.equal(response.status, 200);
    assert.deepEqual((await editor.get('/faq/')).body.categorieen.map((category) => [category.naam, category.volgorde]), [['Reizen', 10], ['Betalen', 20]]);

    response = await editor.put(`/faq/categorieen/${ids.betalen}/volgorde/`, { vragen: [ids.betaal, ids.mee] });
    assert.equal(response.status, 400, 'vraag uit een andere categorie');
    response = await editor.put(`/faq/categorieen/${ids.betalen}/volgorde/`, { vragen: [ids.betaal, ids.paspoort] });
    assert.equal(response.status, 200);
    const betalen = (await editor.get('/faq/')).body.categorieen.find((category) => category.id === ids.betalen);
    assert.deepEqual(betalen.vragen.map((question) => [question.id, question.volgorde]), [[ids.betaal, 10], [ids.paspoort, 20]]);
    assert.equal(await audits('faq.volgorde-gewijzigd'), 2);

    // Tegelijk een vraag wijzigen en de volgorde zetten: beide lukken (zelfde volgorde van vergrendelen).
    const [edit, order] = await Promise.all([
      editor.put(`/faq/vragen/${ids.betaal}/`, { vraag: 'Hoe betaal ik?', antwoord: '<p>Via de bank</p>', categorieId: ids.betalen }),
      editor.put(`/faq/categorieen/${ids.betalen}/volgorde/`, { vragen: [ids.betaal, ids.paspoort] }),
    ]);
    assert.deepEqual([edit.status, order.status], [200, 200]);
  });

  await testContext.test('categorie hernoemen gaat mee naar de vragen; verwijderen alleen leeg', async () => {
    let response = await editor.put(`/faq/categorieen/${ids.betalen}/`, { naam: 'Betalen en annuleren', volgorde: 30 });
    assert.deepEqual(response.body, { id: ids.betalen, hernoemd: true });
    const rows = await db.query('SELECT DISTINCT category FROM faqs WHERE category_id = $1', [ids.betalen]);
    assert.deepEqual(rows.map((row) => row.category), ['Betalen en annuleren']);
    response = await editor.put(`/faq/categorieen/${ids.betalen}/`, { naam: 'Reizen' });
    assert.equal(response.body.fout.velden.naam, 'Deze categorie bestaat al.');
    response = await editor.delete(`/faq/categorieen/${ids.reizen}/`);
    assert.equal(response.status, 400);
    assert.match(response.body.fout.melding, /nog vragen/);
    assert.equal((await editor.delete(`/faq/vragen/${ids.mee}/`)).status, 204);
    assert.equal((await editor.delete(`/faq/categorieen/${ids.reizen}/`)).status, 204);
    assert.equal((await editor.get(`/faq/categorieen/${ids.reizen}/`)).status, 404);
    assert.equal(await audits('faq.vraag-verwijderd'), 1);
    assert.equal(await audits('faq.categorie-verwijderd'), 1);
  });

  await testContext.test('zonder sessie 401, zonder recht 403', async () => {
    const requests = [
      ['GET', '/faq/'], ['GET', `/faq/vragen/${ids.paspoort}/`], ['POST', '/faq/vragen/'], ['PUT', `/faq/vragen/${ids.paspoort}/`],
      ['DELETE', `/faq/vragen/${ids.paspoort}/`], ['GET', `/faq/categorieen/${ids.betalen}/`], ['POST', '/faq/categorieen/'],
      ['PUT', `/faq/categorieen/${ids.betalen}/`], ['DELETE', `/faq/categorieen/${ids.betalen}/`], ['PUT', '/faq/volgorde/'],
      ['PUT', `/faq/categorieen/${ids.betalen}/volgorde/`],
    ];
    for (const [method, path] of requests) {
      const body = method === 'POST' || method === 'PUT' ? { naam: 'X' } : undefined;
      const anonymous = await call(method, path, { body });
      assert.equal(anonymous.status, 401, `${method} ${path}`);
      for (const cookie of [leider, boekhouding]) {
        const response = await call(method, path, { cookie, body });
        assert.equal(response.status, 403, `${method} ${path}`);
        assert.equal(response.body.fout.code, 'geen-toegang');
      }
    }
    assert.equal((await editor.get(`/faq/vragen/${ids.paspoort}/`)).status, 200, 'niets verwijderd door wie geen recht had');
  });

  await testContext.test('limiet op schrijven per gebruiker', async () => {
    const other = as(redactie2);
    let response;
    for (let attempt = 0; attempt < WRITE_LIMIT; attempt += 1) {
      response = await other.post('/faq/categorieen/', { naam: '' });
      assert.equal(response.status, 400);
    }
    response = await other.post('/faq/categorieen/', { naam: 'Nog een' });
    assert.equal(response.status, 429);
    assert.equal(response.body.fout.code, 'te-veel');
    assert.equal((await other.get('/faq/')).status, 200, 'lezen gaat door');
    assert.equal((await editor.post('/faq/categorieen/', { naam: 'Andere gebruiker' })).status, 201, 'een andere gebruiker telt apart');
  });
});
