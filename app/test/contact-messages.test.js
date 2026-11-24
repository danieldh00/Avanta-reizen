/**
 * Tests voor de berichten in het CRM (`/app/berichten/`, `contact/message-routes.js`, F01): rechten (redacteur,
 * reisleider en boekhouding 403, kantoor wel), teller in het menu, lijst met filter en zoeken, afhandelen met notitie
 * en audit, dubbel afhandelen, weer openen, verwijderen met bevestiging, CSRF en 404. Draait in een eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { hashPassword } = require('../src/crm/passwords');
const { COOKIE_NAME } = require('../src/crm/auth');
const { createMenuCounters } = require('../src/crm/menu-counters');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'contact_messages_test';
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

test('teller in het menu: alleen bij een GET, alleen met het recht, fout = geen teller', async () => {
  const counters = [{ key: 'berichten', right: 'berichten', count: async () => 4 }];
  const run = async (req, list = counters) => {
    await new Promise((resolve) => createMenuCounters({ db: {}, counters: list })(req, {}, resolve));
    return req.user && req.user.counters;
  };
  assert.deepEqual(await run({ method: 'GET', user: { role: 'kantoor' } }), { berichten: 4 });
  assert.equal(await run({ method: 'POST', user: { role: 'kantoor' } }), undefined);
  assert.equal(await run({ method: 'GET', user: { role: 'redacteur' } }), undefined);
  assert.equal(await run({ method: 'GET', user: { role: 'reisleider' } }), undefined);
  assert.equal(await run({ method: 'GET' }), undefined);
  const original = console.error;
  console.error = () => {};
  try {
    assert.equal(await run({ method: 'GET', user: { role: 'kantoor' } }, [{ key: 'berichten', right: 'berichten', count: async () => { throw new Error('weg'); } }]), undefined);
  } finally {
    console.error = original;
  }
});

test('berichten in het CRM', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (testContext) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  const app = createApp({ db, masterKey: MASTER_KEY });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  testContext.after(async () => { server.close(); await db.close(); });

  const hash = await hashPassword(PASSWORD);
  for (const role of ['kantoor', 'beheerder', 'reisleider', 'boekhouding', 'redacteur']) {
    await db.query('INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)', [`${role}@example.nl`, `Gebruiker ${role}`, role, hash]);
  }
  const [trip] = await db.query("INSERT INTO trips (slug, title, trip_code, departure_date) VALUES ('albanie', 'Albanië', '27-ALB-1', '2027-06-01') RETURNING id");
  const insert = async (name, details = {}) => {
    const [row] = await db.query(
      `INSERT INTO contact_messages (name, email, phone, subject, message, trip_slug, consent_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, now(), $7) RETURNING id`,
      [name, `${name.toLowerCase()}@example.nl`, details.phone || '', details.subject || '', details.message || 'Hallo', details.trip || null, details.at || '2026-11-20T10:00:00Z'],
    );
    return row.id;
  };
  const question = await insert('Jansen', { subject: 'Vraag over Albanië', message: 'Regel 1\nRegel 2 <b>vet</b>', phone: '06-12345678', trip: 'albanie' });
  const spam = await insert('Spammer', { subject: 'Goedkope pillen', at: '2026-11-21T10:00:00Z' });
  const gone = await insert('Pietersen', { trip: 'bestaat-niet', at: '2026-11-19T10:00:00Z' });

  const request = async (url, init = {}) => {
    const headers = {};
    if (init.cookie) headers.cookie = `${COOKIE_NAME}=${init.cookie}`;
    let body;
    if (init.form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(init.form).toString();
    }
    const response = await fetch(base + url, { method: init.form ? 'POST' : 'GET', headers, body, redirect: 'manual' });
    const setCookie = response.headers.getSetCookie().find((value) => value.startsWith(`${COOKIE_NAME}=`)) || '';
    return { status: response.status, text: await response.text(), headers: response.headers, cookie: setCookie.split(';')[0].split('=')[1] || '' };
  };
  const login = async (role) => {
    const { cookie } = await request('/app/inloggen/', { form: { email: `${role}@example.nl`, password: PASSWORD } });
    const home = await request('/app/', { cookie });
    return { cookie, csrf: (home.text.match(/name="_csrf" value="([^"]+)"/) || [])[1] };
  };
  const kantoor = await login('kantoor');
  const beheerder = await login('beheerder');
  const others = { reisleider: await login('reisleider'), boekhouding: await login('boekhouding'), redacteur: await login('redacteur') };

  await testContext.test('rechten: zonder sessie naar inloggen, andere rollen 403 en geen menu-item', async () => {
    assert.equal((await request('/app/berichten/')).status, 303);
    for (const session of Object.values(others)) {
      assert.equal((await request('/app/berichten/', { cookie: session.cookie })).status, 403);
      assert.equal((await request(`/app/berichten/${question}/`, { cookie: session.cookie })).status, 403);
      assert.equal((await request(`/app/berichten/${question}/afhandelen/`, { cookie: session.cookie, form: { _csrf: session.csrf } })).status, 403);
      assert.doesNotMatch((await request('/app/', { cookie: session.cookie })).text, /href="\/app\/berichten\/"/);
    }
    assert.equal((await request('/app/berichten/', { cookie: beheerder.cookie })).status, 200);
  });

  await testContext.test('teller in het menu met het aantal nieuwe berichten', async () => {
    const page = (await request('/app/', { cookie: kantoor.cookie })).text;
    assert.match(page, /href="\/app\/berichten\/"[^>]*title="Berichten \(3 nieuw\)"/);
    assert.match(page, /<span class="crm-nav-count"><span aria-hidden="true">3<\/span><span class="visually-hidden">, 3 nieuw<\/span><\/span>/);
  });

  await testContext.test('lijst: standaard nieuw, filter en zoeken', async () => {
    const list = (await request('/app/berichten/', { cookie: kantoor.cookie })).text;
    assert.match(list, /href="\/app\/berichten\/"[^>]*aria-current="page"/);
    assert.ok(list.indexOf('Spammer') < list.indexOf('Jansen'), 'nieuwste eerst');
    assert.match(list, /Pietersen/);
    assert.match(list, /Vraag over een reis/, 'zonder onderwerp, wel een reis');
    const found = (await request('/app/berichten/?q=pillen', { cookie: kantoor.cookie })).text;
    assert.match(found, /Spammer/);
    assert.doesNotMatch(found, /Jansen/);
    assert.match((await request('/app/berichten/?q=%25', { cookie: kantoor.cookie })).text, /Geen berichten gevonden/, '% is geen jokerteken');
    assert.match((await request('/app/berichten/?status=afgehandeld', { cookie: kantoor.cookie })).text, /Geen berichten gevonden/);
  });

  await testContext.test('één bericht: tekst ge-escaped met regeleinden, reis, links', async () => {
    const page = await request(`/app/berichten/${question}/`, { cookie: kantoor.cookie });
    assert.equal(page.status, 200);
    assert.match(page.text, /<div class="crm-message">Regel 1\nRegel 2 &lt;b&gt;vet&lt;\/b&gt;<\/div>/);
    assert.match(page.text, new RegExp(`<a href="/app/reizen/${trip.id}/">Albanië</a> \\(27-ALB-1\\)`));
    assert.match(page.text, /href="mailto:jansen@example.nl"/);
    assert.match(page.text, /href="tel:0612345678"/);
    assert.match((await request(`/app/berichten/${gone}/`, { cookie: kantoor.cookie })).text, /reis bestaat niet meer/);
    assert.equal((await request('/app/berichten/999999/', { cookie: kantoor.cookie })).status, 404);
  });

  await testContext.test('afhandelen met notitie en audit; dubbel afhandelen geeft 409; CSRF verplicht', async () => {
    assert.equal((await request(`/app/berichten/${question}/afhandelen/`, { cookie: kantoor.cookie, form: { _csrf: 'fout' } })).status, 403);
    const done = await request(`/app/berichten/${question}/afhandelen/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, notitie: 'Gebeld\u0000 op maandag' } });
    assert.equal(done.status, 303);
    assert.equal(done.headers.get('location'), `/app/berichten/${question}/?opgeslagen=afgehandeld`);
    const [row] = await db.query('SELECT status, note, handled_at IS NOT NULL AS handled, handled_by FROM contact_messages WHERE id = $1', [question]);
    assert.equal(row.status, 'afgehandeld');
    assert.equal(row.note, 'Gebeld op maandag');
    assert.ok(row.handled);
    const page = (await request(`/app/berichten/${question}/?opgeslagen=afgehandeld`, { cookie: kantoor.cookie })).text;
    assert.match(page, /Het bericht is afgehandeld/);
    assert.match(page, /Gebruiker kantoor/);
    assert.match(page, /Weer op nieuw zetten/);
    const again = await request(`/app/berichten/${question}/afhandelen/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf } });
    assert.equal(again.status, 409);
    const audit = await db.query("SELECT entity, entity_id FROM audit_log WHERE action = 'bericht.afgehandeld'");
    assert.deepEqual(audit, [{ entity: 'contact_messages', entity_id: String(question) }]);
    assert.match((await request('/app/', { cookie: kantoor.cookie })).text, /title="Berichten \(2 nieuw\)"/);
    assert.match((await request('/app/berichten/?status=afgehandeld', { cookie: kantoor.cookie })).text, /Jansen/);
  });

  await testContext.test('weer openen', async () => {
    const reopened = await request(`/app/berichten/${question}/heropenen/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf } });
    assert.equal(reopened.status, 303);
    const [row] = await db.query('SELECT status FROM contact_messages WHERE id = $1', [question]);
    assert.equal(row.status, 'nieuw');
    assert.equal((await request(`/app/berichten/${question}/heropenen/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf } })).status, 409);
    assert.equal((await db.query("SELECT count(*)::int AS total FROM audit_log WHERE action = 'bericht.heropend'"))[0].total, 1);
  });

  await testContext.test('verwijderen alleen met bevestiging; daarna 404', async () => {
    assert.equal((await request(`/app/berichten/${spam}/verwijderen/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf } })).status, 422);
    const removed = await request(`/app/berichten/${spam}/verwijderen/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, bevestig: 'ja' } });
    assert.equal(removed.status, 303);
    assert.equal((await request(`/app/berichten/${spam}/`, { cookie: kantoor.cookie })).status, 404);
    assert.equal((await request(`/app/berichten/${spam}/verwijderen/`, { cookie: kantoor.cookie, form: { _csrf: kantoor.csrf, bevestig: 'ja' } })).status, 404);
    assert.equal((await db.query("SELECT count(*)::int AS total FROM audit_log WHERE action = 'bericht.verwijderd'"))[0].total, 1);
  });

  await testContext.test('auditlog toont de acties met hun omschrijving', async () => {
    const log = (await request('/app/auditlog/', { cookie: beheerder.cookie })).text;
    assert.match(log, /Bericht afgehandeld/);
    assert.match(log, /Bericht verwijderd/);
  });
});
