/**
 * Tests voor Beheer > Vindbaarheid, doorverwijzingen en 404-lijst (pakket A3): normaliseren en controleren van paden,
 * de middleware (301/302, querystring, slash), de tellers en hun maximum, het opruimen en de routes onder
 * `/app/beheer/doorverwijzingen/` en `/app/beheer/niet-gevonden/` (recht `systeem`, CSRF, 404, auditlog). De
 * databasetests draaien in een eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { COOKIE_NAME } = require('../src/crm/auth');
const { normalizePath, isReservedPath, validateRedirect, referrerHostOf, MAX_NOT_FOUND_ROWS } = require('../src/site/redirects');
const { likePattern, readablePath } = require('../src/beheer/redirect-routes');
const { filterGroups } = require('../src/beheer/indeling');
const { SETTING_FIELDS } = require('../src/beheer/settings');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'beheer_redirects_test';
const SETUP_CODE = 'ABCDE-FGHJK-LMNPQ-RSTUV';
const ADMIN_PASSWORD = 'correct paard batterij';

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

test('doorverwijzingen: paden normaliseren en controleren', () => {
  assert.equal(normalizePath('/café/'), '/caf%C3%A9/');
  assert.equal(normalizePath('/caf%C3%A9/'), '/caf%C3%A9/');
  assert.equal(normalizePath('/caf%c3%a9/'), '/caf%C3%A9/', 'hoofdletters in de codering');
  assert.equal(normalizePath('/a%2Fb/'), '/a%2Fb/', 'gereserveerde codes blijven staan');
  assert.equal(normalizePath(normalizePath('/a%2Fb/')), '/a%2Fb/', 'herhaalbaar');
  assert.equal(normalizePath('/oud/?utm=1#x'), '/oud/');
  for (const bad of ['', 'oud', '//evil.example/', '/a b', '/a\\b', '/<x>', '/a"b', '/%zz', '/%0a', `/${'x'.repeat(300)}`]) {
    assert.equal(normalizePath(bad), '', bad);
  }
  assert.equal(isReservedPath('/app/'), true);
  assert.equal(isReservedPath('/APP/inloggen/'), true, 'hoofdletterongevoelig');
  assert.equal(isReservedPath('/api'), true);
  assert.equal(isReservedPath('/apple/'), false);

  const ok = validateRedirect({ from: '/oude-reis', to: '/reis/albanie/?bron=oud', status: '302' });
  assert.deepEqual(ok, { values: { fromPath: '/oude-reis', toUrl: '/reis/albanie/?bron=oud', status: 302 }, errors: {} });
  assert.equal(validateRedirect({ from: '/x/', to: 'https://example.org/pad', status: 'iets' }).values.status, 301);
  assert.equal(validateRedirect({ from: '/x/', to: 'https://example.org/pad' }).values.toUrl, 'https://example.org/pad');
  for (const to of ['http://example.org/', 'javascript:alert(1)', '//evil.example/', 'https://user:pw@example.org/', '/a b', '/x?<b>', '', `https://example.org/${'x'.repeat(500)}`]) {
    assert.ok(validateRedirect({ from: '/x/', to }).errors.to, to);
  }
  assert.ok(validateRedirect({ from: '/app/beheer/', to: '/' }).errors.from, 'CRM');
  assert.ok(validateRedirect({ from: '/API/', to: '/' }).errors.from, 'API in hoofdletters');
  assert.ok(validateRedirect({ from: ['/x/'], to: '/' }).errors.from, 'geen lijst');
  assert.ok(validateRedirect({ from: '/x/', to: '/x/?a=1' }).errors.to, 'gelijk aan het oude');

  assert.equal(referrerHostOf('https://www.Google.com/search?q=privé', 'avanta.example'), 'www.google.com');
  assert.equal(referrerHostOf('https://avanta.example/reis/', 'avanta.example:443'), '', 'de eigen site');
  assert.equal(referrerHostOf('ftp://example.org/', 'x'), '');
  assert.equal(referrerHostOf('geen url', 'x'), '');

  assert.equal(likePattern('50%_a\\'), '%50\\%\\_a\\\\%');
  assert.equal(readablePath('/caf%C3%A9/'), '/café/');
  assert.equal(readablePath('/%E0%A4%A/'), '/%E0%A4%A/', 'onleesbaar blijft letterlijk');
  assert.deepEqual(filterGroups('redirect', SETTING_FIELDS).flatMap((group) => group.sections.map((section) => section.id)), ['doorverwijzingen']);
  assert.deepEqual(filterGroups('404', SETTING_FIELDS).flatMap((group) => group.sections.map((section) => section.id)), ['niet-gevonden']);
});

test('doorverwijzingen: middleware, 404-lijst en Beheer-routes', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();

  const app = createApp({ db, masterKey: Buffer.alloc(32, 7), setupCode: SETUP_CODE });
  const { redirects } = app.locals;
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await db.close(); });

  /**
   * Doet een verzoek zonder redirects te volgen.
   * @param {string} path Pad.
   * @param {{form?: object, cookie?: string, headers?: object, method?: string}} [init] Formulier, sessiecookie, koppen en methode.
   * @returns {Promise<{status: number, text: string, headers: Headers, cookie: string}>} Antwoord.
   */
  const request = async (path, init = {}) => {
    const headers = { ...(init.headers || {}) };
    if (init.cookie) headers.cookie = `${COOKIE_NAME}=${init.cookie}`;
    let body;
    if (init.form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(init.form).toString();
    }
    const response = await fetch(base + path, { method: init.method || (init.form ? 'POST' : 'GET'), headers, body, redirect: 'manual' });
    const setCookie = response.headers.getSetCookie().find((value) => value.startsWith(`${COOKIE_NAME}=`)) || '';
    return { status: response.status, text: await response.text(), headers: response.headers, cookie: setCookie.split(';')[0].split('=')[1] || '' };
  };

  /**
   * Haalt het CSRF-token uit een pagina.
   * @param {string} page HTML.
   * @returns {string} Token.
   */
  const csrfFrom = (page) => (page.match(/name="_csrf" value="([^"]+)"/) || [])[1] || '';

  const installed = await request('/app/installatie/', { form: { code: SETUP_CODE, name: 'Daniël', email: 'beheer@example.nl', password: ADMIN_PASSWORD, password2: ADMIN_PASSWORD } });
  const cookie = installed.cookie;
  const csrf = csrfFrom((await request('/app/', { cookie })).text);

  /**
   * Voegt een doorverwijzing toe via Beheer.
   * @param {object} form Velden `from`, `to`, `status`, `note`.
   * @returns {Promise<{status: number, text: string}>} Antwoord.
   */
  const addRedirect = (form) => request('/app/beheer/doorverwijzingen/', { cookie, form: { _csrf: csrf, status: '301', note: '', ...form } });

  await t.test('toegang: zonder recht 403, zonder CSRF 403', async () => {
    await request('/app/gebruikers/nieuw/', { cookie, form: { _csrf: csrf, name: 'Kantoor', email: 'kantoor@example.nl', role: 'kantoor', password: 'kantoor wachtwoord 1' } });
    const office = await request('/app/inloggen/', { form: { email: 'kantoor@example.nl', password: 'kantoor wachtwoord 1' } });
    const officeCsrf = csrfFrom((await request('/app/', { cookie: office.cookie })).text);
    assert.equal((await request('/app/beheer/doorverwijzingen/', { cookie: office.cookie })).status, 403);
    assert.equal((await request('/app/beheer/niet-gevonden/', { cookie: office.cookie })).status, 403);
    assert.equal((await request('/app/beheer/doorverwijzingen/', { cookie: office.cookie, form: { _csrf: officeCsrf, from: '/a/', to: '/b/' } })).status, 403);
    assert.equal((await request('/app/beheer/doorverwijzingen/1/verwijderen', { cookie: office.cookie, form: { _csrf: officeCsrf } })).status, 403);
    assert.equal((await request('/app/beheer/niet-gevonden/leegmaken', { cookie: office.cookie, form: { _csrf: officeCsrf } })).status, 403);
    assert.equal((await request('/app/beheer/niet-gevonden/verwijderen', { cookie: office.cookie, form: { _csrf: officeCsrf, path: '/x/' } })).status, 403);
    assert.equal((await request('/app/beheer/doorverwijzingen/', { cookie, form: { from: '/a/', to: '/b/' } })).status, 403, 'zonder CSRF-token');
    assert.equal((await request('/app/beheer/niet-gevonden/leegmaken', { cookie, form: {} })).status, 403, 'zonder CSRF-token');
    assert.equal((await db.query('SELECT count(*)::int AS count FROM redirects'))[0].count, 0);
  });

  await t.test('toevoegen en doorsturen: 301, querystring, slash, HEAD en 302', async () => {
    const page = await request('/app/beheer/doorverwijzingen/?van=%2Foude-pagina%2F', { cookie });
    assert.equal(page.status, 200);
    assert.match(page.text, /name="from" type="text" value="\/oude-pagina\/"/, 'vooraf ingevuld vanuit de 404-lijst');
    assert.match(page.text, /href="\/app\/beheer\/doorverwijzingen\/" aria-current="page"/);

    assert.equal((await addRedirect({ from: '/oude-reis/', to: '/reis/', note: 'Oude WordPress-pagina' })).status, 303);
    assert.equal((await addRedirect({ from: '/tijdelijk', to: 'https://example.org/actie?x=1', status: '302' })).status, 303);
    const audit = await db.query("SELECT entity, entity_id FROM audit_log WHERE action = 'doorverwijzing.aangemaakt' ORDER BY id");
    assert.equal(audit.length, 2);
    assert.equal(audit[0].entity, 'redirects');

    const moved = await request('/oude-reis/');
    assert.equal(moved.status, 301);
    assert.equal(moved.headers.get('location'), '/reis/');
    assert.equal(moved.headers.get('cache-control'), 'public, max-age=3600');
    assert.equal((await request('/oude-reis')).headers.get('location'), '/reis/', 'zonder slash');
    assert.equal((await request('/oude-reis/?utm_source=x')).headers.get('location'), '/reis/?utm_source=x', 'querystring gaat mee');
    assert.equal((await request('/oude-reis/', { method: 'HEAD' })).status, 301);
    assert.notEqual((await request('/oude-reis/', { method: 'POST', form: { a: '1' } })).status, 301, 'alleen GET en HEAD');
    const temporary = await request('/tijdelijk?y=2');
    assert.equal(temporary.status, 302);
    assert.equal(temporary.headers.get('location'), 'https://example.org/actie?x=1', 'het doel heeft al een querystring');
    assert.equal(temporary.headers.get('cache-control'), 'no-store');
    assert.equal((await request('/tijdelijk/')).status, 404, 'met slash is een ander pad');

    await redirects.flush();
    const [row] = await db.query("SELECT hits, last_hit_at FROM redirects WHERE from_path = '/oude-reis/'");
    assert.equal(row.hits, 4, 'GET, zonder slash, met query en HEAD tellen; POST niet');
    assert.ok(row.last_hit_at);
    const list = await request('/app/beheer/doorverwijzingen/', { cookie });
    assert.match(list.text, /Oude WordPress-pagina/);
    assert.match(list.text, /2 doorverwijzingen\./);
    assert.match((await request('/app/beheer/doorverwijzingen/?filter=tijdel', { cookie })).text, /1 gevonden \(van 2\)/);
    assert.match((await request('/app/beheer/doorverwijzingen/?filter=%25', { cookie })).text, /0 gevonden \(van 2\)/, '% geldt letterlijk');
  });

  await t.test('ongeldig: dubbel, keten, lus, homepage, CRM, notitie', async () => {
    const cases = [
      [{ from: '/oude-reis/', to: '/blog/' }, /bestaat al een doorverwijzing/],
      [{ from: '/reis/', to: '/blog/' }, /Naar dit pad wordt al doorverwezen/],
      [{ from: '/nieuw/', to: '/oude-reis' }, /wordt zelf doorverwezen/],
      [{ from: '/lus/', to: '/lus' }, /komt weer uit bij het oude pad/],
      [{ from: '/', to: '/reis/' }, /homepage/],
      [{ from: '/APP/inloggen/', to: '/reis/' }, /\/app\/ en \/api\//],
      [{ from: '/a/', to: 'http://example.org/' }, /https:\/\//],
      [{ from: '/a/', to: '/b/', note: 'x'.repeat(201) }, /Hoogstens 200/],
      [{ from: '/a/', to: '/b/', note: 'regel\nregel' }, /regeleinden/],
    ];
    for (const [form, message] of cases) {
      const response = await addRedirect(form);
      assert.equal(response.status, 422, JSON.stringify(form));
      assert.match(response.text, message, JSON.stringify(form));
    }
    const twice = await request('/app/beheer/doorverwijzingen/', { cookie, form: new URLSearchParams([['_csrf', csrf], ['from', '/a/'], ['from', '/b/'], ['to', '/c/']]) });
    assert.equal(twice.status, 422, 'een dubbel veld is ongeldig');
    assert.equal((await db.query('SELECT count(*)::int AS count FROM redirects'))[0].count, 2);
  });

  await t.test('verwijderen: onbekend 404, bekend 303 en niet meer doorsturen', async () => {
    assert.equal((await request('/app/beheer/doorverwijzingen/999999/verwijderen', { cookie, form: { _csrf: csrf } })).status, 404);
    assert.equal((await request('/app/beheer/doorverwijzingen/abc/verwijderen', { cookie, form: { _csrf: csrf } })).status, 404);
    const [{ id }] = await db.query("SELECT id FROM redirects WHERE from_path = '/tijdelijk'");
    const deleted = await request(`/app/beheer/doorverwijzingen/${id}/verwijderen`, { cookie, form: { _csrf: csrf } });
    assert.equal(deleted.status, 303);
    assert.notEqual((await request('/tijdelijk')).headers.get('location'), 'https://example.org/actie?x=1', 'niet meer doorgestuurd');
    assert.equal((await db.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'doorverwijzing.verwijderd' AND entity_id = $1", [String(id)]))[0].count, 1);
  });

  await t.test('404-lijst: alleen pad en host, CRM niet, escaping, doorverwijzen haalt de regel weg', async () => {
    await db.query('DELETE FROM not_found_log');
    for (let i = 0; i < 3; i += 1) await request('/bestaat-niet/?email=iemand@example.nl', { headers: { referer: 'https://www.google.com/search?q=avanta' } });
    await request('/%3Cb%3Evet%3C/b%3E/');
    await request('/app/onbekend/');
    await request('/APP/onbekend/');
    await request('/api/onbekend');
    await redirects.flush();
    const rows = await db.query('SELECT path, hits, referrer_host FROM not_found_log ORDER BY path');
    assert.deepEqual(rows.map((row) => [row.path, row.hits, row.referrer_host]), [
      ['/%3Cb%3Evet%3C/b%3E/', 1, ''],
      ['/bestaat-niet/', 3, 'www.google.com'],
    ]);
    await request('/bestaat-niet/');
    await redirects.flush();
    assert.equal((await db.query("SELECT hits, referrer_host FROM not_found_log WHERE path = '/bestaat-niet/'"))[0].hits, 4);
    assert.equal((await db.query("SELECT referrer_host FROM not_found_log WHERE path = '/bestaat-niet/'"))[0].referrer_host, 'www.google.com', 'host blijft staan');

    const page = await request('/app/beheer/niet-gevonden/', { cookie });
    assert.equal(page.status, 200);
    assert.match(page.text, /\/bestaat-niet\/<\/td>\s*<td>4<\/td>/);
    assert.match(page.text, /&lt;b&gt;vet&lt;\/b&gt;/);
    assert.doesNotMatch(page.text, /<b>vet/);
    assert.doesNotMatch(page.text, /iemand@example\.nl|q=avanta/, 'geen querystring');
    assert.match(page.text, /href="\/app\/beheer\/doorverwijzingen\/\?van=%2Fbestaat-niet%2F"/);

    assert.equal((await addRedirect({ from: '/bestaat-niet/', to: '/reis/' })).status, 303);
    assert.equal((await db.query("SELECT count(*)::int AS count FROM not_found_log WHERE path = '/bestaat-niet/'"))[0].count, 0);
    assert.equal((await request('/bestaat-niet/')).status, 301);
  });

  await t.test('404-lijst: regel verwijderen en leegmaken', async () => {
    assert.equal((await request('/app/beheer/niet-gevonden/verwijderen', { cookie, form: { _csrf: csrf, path: '/nooit-gezien/' } })).status, 404);
    assert.equal((await request('/app/beheer/niet-gevonden/verwijderen', { cookie, form: { _csrf: csrf, path: '/%3Cb%3Evet%3C/b%3E/' } })).status, 303);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM not_found_log'))[0].count, 0);
    const [entry] = await db.query("SELECT entity_id FROM audit_log WHERE action = 'niet-gevonden.verwijderd'");
    assert.equal(entry.entity_id, null, 'geen pad in het auditlog');
    await request('/weg-1/');
    await redirects.flush();
    assert.equal((await request('/app/beheer/niet-gevonden/leegmaken', { cookie, form: { _csrf: csrf } })).status, 303);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM not_found_log'))[0].count, 0);
    assert.equal((await db.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'niet-gevonden.geleegd'"))[0].count, 1);
  });

  await t.test('maximum en opruimen', async () => {
    await db.query("INSERT INTO not_found_log (path, hits) SELECT '/vol-' || i || '/', 1 FROM generate_series(1, $1 - 1) AS i", [MAX_NOT_FOUND_ROWS]);
    await request('/nieuw-a/');
    for (let i = 0; i < 2; i += 1) await request('/nieuw-b/');
    await request('/vol-1/');
    await redirects.flush();
    const [{ count }] = await db.query('SELECT count(*)::int AS count FROM not_found_log');
    assert.equal(count, MAX_NOT_FOUND_ROWS, 'niet boven het maximum');
    const added = await db.query("SELECT path FROM not_found_log WHERE path LIKE '/nieuw-%'");
    assert.deepEqual(added.map((row) => row.path), ['/nieuw-b/'], 'de vaakst gevraagde nieuwe eerst');
    assert.equal((await db.query("SELECT hits FROM not_found_log WHERE path = '/vol-1/'"))[0].hits, 2, 'bestaande tellen door');

    await db.query("UPDATE not_found_log SET last_seen_at = now() - interval '91 days' WHERE path <> '/nieuw-b/'");
    await redirects.purge();
    assert.deepEqual((await db.query('SELECT path FROM not_found_log')).map((row) => row.path), ['/nieuw-b/']);
  });
});
