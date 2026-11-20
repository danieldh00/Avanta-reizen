/**
 * Tests voor Beheer (pakket A1): de instellingenlaag (types, controle, volgorde database → omgeving → standaard,
 * versleutelde geheimen, terugzetten), de zoekfunctie van de indeling en de routes onder `/app/beheer/` (alleen recht
 * `systeem`, CSRF, 404, auditlog en het effect van de contactgegevens op de site). De databasetests draaien in een eigen
 * schema, naast de andere testbestanden.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { createVault } = require('../src/security/vault');
const { createSettings, validateValue, coerce, SettingsError, SETTING_FIELDS } = require('../src/beheer/settings');
const { filterGroups, findSection, SECTIONS } = require('../src/beheer/indeling');
const { formatUptime } = require('../src/beheer/routes');
const { roleHasRight } = require('../src/crm/rights');
const { COOKIE_NAME } = require('../src/crm/auth');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'beheer_test';
const MASTER_KEY = Buffer.alloc(32, 9);
const SETUP_CODE = 'ABCDE-FGHJK-LMNPQ-RSTUV';
const ADMIN_PASSWORD = 'correct paard batterij';

/** Instellingen voor de tests van de instellingenlaag (alle types). */
const TEST_FIELDS = {
  title: { type: 'text', label: 'Titel', default: 'Standaard', max: 20 },
  required: { type: 'text', label: 'Verplicht', default: 'x', required: true },
  mail: { type: 'email', label: 'E-mail', default: '' },
  site: { type: 'url', label: 'Adres', default: '', env: 'TEST_SITE' },
  notes: { type: 'textarea', label: 'Notities', default: '', max: 100 },
  enabled: { type: 'bool', label: 'Aan', default: false, env: 'TEST_ENABLED' },
  count: { type: 'int', label: 'Aantal', default: 5, min: 1, max: 10, env: 'TEST_COUNT' },
  mode: { type: 'enum', label: 'Modus', default: 'a', values: ['a', 'b'] },
  token: { type: 'secret', label: 'Sleutel', default: '', min: 8 },
  other: { type: 'secret', label: 'Andere sleutel', default: '' },
};

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

test('instellingen: controle per type', () => {
  assert.equal(validateValue('title', TEST_FIELDS.title, '  Hallo  '), 'Hallo');
  assert.throws(() => validateValue('title', TEST_FIELDS.title, 'x'.repeat(21)), /hoogstens 20/);
  assert.throws(() => validateValue('title', TEST_FIELDS.title, 'regel\nregel'), /ongeldige tekens/);
  assert.throws(() => validateValue('title', TEST_FIELDS.title, ['lijst']), SettingsError);
  assert.throws(() => validateValue('required', TEST_FIELDS.required, '   '), /Vul dit veld in/);
  assert.equal(validateValue('mail', TEST_FIELDS.mail, ' Info@Example.NL '), 'info@example.nl');
  assert.throws(() => validateValue('mail', TEST_FIELDS.mail, 'geen-adres'), /e-mailadres/);
  assert.equal(validateValue('site', TEST_FIELDS.site, 'https://www.example.nl/'), 'https://www.example.nl');
  assert.throws(() => validateValue('site', TEST_FIELDS.site, 'javascript:alert(1)'), /https/);
  assert.throws(() => validateValue('site', TEST_FIELDS.site, 'https://gebruiker:geheim@example.nl'), /gebruikersnaam/);
  assert.equal(validateValue('notes', TEST_FIELDS.notes, 'a\r\nb'), 'a\nb');
  assert.equal(validateValue('enabled', TEST_FIELDS.enabled, 'ja'), true);
  assert.equal(validateValue('enabled', TEST_FIELDS.enabled, ''), false);
  assert.throws(() => validateValue('enabled', TEST_FIELDS.enabled, 'misschien'), SettingsError);
  assert.equal(validateValue('count', TEST_FIELDS.count, ' 7 '), 7);
  assert.throws(() => validateValue('count', TEST_FIELDS.count, '11'), /van 1 tot 10/);
  assert.throws(() => validateValue('count', TEST_FIELDS.count, '2.5'), /geheel getal/);
  assert.equal(validateValue('mode', TEST_FIELDS.mode, 'b'), 'b');
  assert.throws(() => validateValue('mode', TEST_FIELDS.mode, 'c'), /mogelijkheden/);
  assert.throws(() => validateValue('token', TEST_FIELDS.token, 'kort'), /minimaal 8/);
  assert.equal(coerce(TEST_FIELDS.count, '99'), 5, 'een startwaarde buiten de grenzen geeft de standaard');
  assert.equal(coerce(TEST_FIELDS.mail, 'onzin'), '', 'een ongeldige startwaarde geeft de standaard');
  assert.equal(coerce(TEST_FIELDS.enabled, 'true'), true);
});

test('indeling: secties, zoeken en rechten', () => {
  assert.equal(findSection('contact').group, 'Organisatie');
  assert.equal(findSection('bestaat-niet'), undefined);
  assert.equal(findSection('toString'), undefined);
  for (const section of SECTIONS) for (const key of section.fields || []) assert.ok(Object.hasOwn(SETTING_FIELDS, key), key);
  assert.deepEqual(filterGroups('TELEFOON', SETTING_FIELDS).flatMap((group) => group.sections.map((section) => section.id)), ['contact']);
  assert.deepEqual(filterGroups('migratie', SETTING_FIELDS).flatMap((group) => group.sections.map((section) => section.id)), ['overzicht']);
  assert.deepEqual(filterGroups('onvindbaar woord', SETTING_FIELDS), []);
  assert.equal(filterGroups('', SETTING_FIELDS).length, 3);
  assert.equal(roleHasRight('beheerder', 'systeem'), true);
  for (const role of ['kantoor', 'reisleider', 'boekhouding']) assert.equal(roleHasRight(role, 'systeem'), false, role);
  assert.equal(formatUptime(59), '0 minuten');
  assert.equal(formatUptime(2 * 86400 + 3 * 3600 + 60), '2 dagen, 3 uur en 1 minuut');
});

test('Beheer: instellingenlaag en routes', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  const vault = createVault(MASTER_KEY);

  await t.test('instellingenlaag: volgorde, opslaan, geheimen en terugzetten', async () => {
    const env = { TEST_COUNT: '8', TEST_ENABLED: 'true', TEST_SITE: '' };
    const settings = createSettings({ db, vault, env, fields: TEST_FIELDS });
    await settings.ready();
    assert.equal(settings.get('title'), 'Standaard');
    assert.equal(settings.source('title'), 'standaard');
    assert.equal(settings.get('count'), 8);
    assert.equal(settings.source('count'), 'omgeving');
    assert.equal(settings.source('site'), 'standaard', 'een lege omgevingsvariabele telt niet');
    assert.equal(settings.get('enabled'), true);
    assert.throws(() => settings.get('onbekend'), /Onbekende instelling/);
    assert.throws(() => settings.get('__proto__'), /Onbekende instelling/);

    const changed = await settings.update({ values: { title: 'Nieuw', count: '3', enabled: true, token: 'geheim-12345678', mode: 'a' } }, { userId: null });
    assert.deepEqual(changed.sort(), ['count', 'title', 'token'], 'gelijke waarden tellen niet als wijziging');
    assert.equal(settings.get('count'), 3);
    assert.equal(settings.source('count'), 'database');
    assert.deepEqual(settings.view('token'), { set: true, last4: '5678' });
    const [row] = await db.query("SELECT value FROM settings WHERE key = 'token'");
    assert.doesNotMatch(row.value, /geheim-12345678/, 'het geheim staat versleuteld in de database');

    // Een nieuwe laag (zoals na een herstart) leest hetzelfde terug.
    const reloaded = createSettings({ db, vault, env, fields: TEST_FIELDS });
    await reloaded.ready();
    assert.equal(reloaded.get('token'), 'geheim-12345678');
    assert.equal(reloaded.get('title'), 'Nieuw');

    // Een versleutelde waarde die naar een andere instelling is gekopieerd, wordt niet geaccepteerd.
    await db.query("INSERT INTO settings (key, value) SELECT 'other', value FROM settings WHERE key = 'token'");
    const copied = createSettings({ db, vault, env, fields: TEST_FIELDS });
    await copied.ready();
    assert.equal(copied.get('other'), '');
    // Met een andere hoofdsleutel is het geheim onleesbaar en geldt de standaard.
    const otherKey = createSettings({ db, vault: createVault(Buffer.alloc(32, 1)), env, fields: TEST_FIELDS });
    await otherKey.ready();
    assert.equal(otherKey.get('token'), '');
    await db.query("DELETE FROM settings WHERE key = 'other'");

    assert.deepEqual(await settings.update({ values: { token: '' } }), [], 'een leeg geheim laat het geheim staan');
    await assert.rejects(settings.update({ values: { title: 'Goed', count: '42' } }), (error) => error instanceof SettingsError && error.key === 'count');
    assert.equal(settings.get('title'), 'Nieuw', 'bij een fout wordt niets opgeslagen');
    await assert.rejects(settings.update({ values: { onbekend: 'x' } }), SettingsError);
    await assert.rejects(settings.update({ clear: ['title'] }), SettingsError, 'alleen een geheim kan worden geleegd');

    assert.deepEqual(await settings.update({ clear: ['token'] }), ['token']);
    assert.deepEqual(settings.view('token'), { set: false, last4: '' });
    assert.deepEqual((await settings.update({ reset: ['count', 'title'] })).sort(), ['count', 'title']);
    assert.equal(settings.get('count'), 8, 'terug naar de omgeving');
    assert.equal(settings.get('title'), 'Standaard');
    assert.deepEqual(await settings.update({ reset: ['mode'], values: { mode: 'b' } }), [], 'terugzetten gaat voor, ook zonder rij');
    assert.equal(settings.get('mode'), 'a');

    // Mislukt het werk in dezelfde transactie, dan blijft alles zoals het was.
    await assert.rejects(settings.update({ values: { title: 'Weg' } }, { inTransaction: async () => { throw new Error('audit mislukt'); } }), /audit mislukt/);
    assert.equal(settings.get('title'), 'Standaard');
    assert.equal((await db.query("SELECT count(*)::int AS count FROM settings WHERE key = 'title'"))[0].count, 0);
  });

  let clock = Date.now();
  const app = createApp({ db, masterKey: MASTER_KEY, setupCode: SETUP_CODE, now: () => clock });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await db.close(); });

  /**
   * Doet een verzoek zonder redirects te volgen.
   * @param {string} path Pad.
   * @param {{form?: (object|URLSearchParams), cookie?: string, headers?: object}} [init] Formulier, sessiecookie en koppen.
   * @returns {Promise<{status: number, text: string, headers: Headers, cookie: string}>} Antwoord.
   */
  const request = async (path, init = {}) => {
    const headers = { ...(init.headers || {}) };
    if (init.cookie) headers.cookie = `${COOKIE_NAME}=${init.cookie}`;
    let body;
    if (init.form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = (init.form instanceof URLSearchParams ? init.form : new URLSearchParams(init.form)).toString();
    }
    const response = await fetch(base + path, { method: init.form ? 'POST' : 'GET', headers, body, redirect: 'manual' });
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
  assert.equal(installed.status, 303);
  const adminCookie = installed.cookie;
  const adminCsrf = csrfFrom((await request('/app/', { cookie: adminCookie })).text);

  await t.test('toegang: zonder sessie naar inloggen, zonder recht 403, beheerder 200', async () => {
    const anonymous = await request('/app/beheer/');
    assert.equal(anonymous.status, 303);
    assert.equal(anonymous.headers.get('location'), '/app/inloggen/');
    assert.equal((await request('/app/beheer/contact/', { form: { _csrf: 'x', contactPhone: '010 1234567' } })).status, 401);

    const created = await request('/app/gebruikers/nieuw/', { cookie: adminCookie, form: { _csrf: adminCsrf, name: 'Kantoor', email: 'kantoor@example.nl', role: 'kantoor', password: 'kantoor wachtwoord 1' } });
    assert.equal(created.status, 303);
    const office = await request('/app/inloggen/', { form: { email: 'kantoor@example.nl', password: 'kantoor wachtwoord 1' } });
    const officeCsrf = csrfFrom((await request('/app/', { cookie: office.cookie })).text);
    assert.doesNotMatch((await request('/app/', { cookie: office.cookie })).text, /href="\/app\/beheer\/"/, 'geen menu-item zonder recht');
    assert.equal((await request('/app/beheer/', { cookie: office.cookie })).status, 403);
    assert.equal((await request('/app/beheer/contact/', { cookie: office.cookie })).status, 403);
    assert.equal((await request('/app/beheer/bestaat-niet/', { cookie: office.cookie })).status, 403, 'ook een onbekende sectie verraadt niets');
    assert.equal((await request('/app/beheer/contact/', { cookie: office.cookie, form: { _csrf: officeCsrf, contactPhone: '010 1234567', contactEmail: 'x@example.nl' } })).status, 403);

    const overview = await request('/app/beheer/', { cookie: adminCookie });
    assert.equal(overview.status, 200);
    assert.equal(overview.headers.get('cache-control'), 'no-store');
    assert.match(overview.text, /Systeemoverzicht/);
    assert.match(overview.text, new RegExp(require('../package.json').version.replace(/\./g, '\\.')));
    assert.match(overview.text, /6: beheer: doorverwijzingen en 404-lijst/);
    assert.match(overview.text, /Standaardwaarde/);
    assert.match(overview.text, /href="\/app\/beheer\/contact\/"/);
    assert.match((await request('/app/', { cookie: adminCookie })).text, /href="\/app\/beheer\/"/);
  });

  await t.test('zoeken en onbekende sectie', async () => {
    const found = await request('/app/beheer/?zoek=telefoon', { cookie: adminCookie });
    assert.equal(found.status, 200);
    assert.match(found.text, /Contact en organisatie/);
    assert.doesNotMatch(found.text, /<li><a href="\/app\/beheer\/overzicht\/"/);
    const none = await request(`/app/beheer/?zoek=${encodeURIComponent('<script>')}`, { cookie: adminCookie });
    assert.match(none.text, /Niets gevonden voor “&lt;script&gt;”/);
    assert.doesNotMatch(none.text, /<script>/);
    assert.equal((await request('/app/beheer/bestaat-niet/', { cookie: adminCookie })).status, 404);
    assert.equal((await request('/app/beheer/Contact/', { cookie: adminCookie })).status, 404);
    assert.equal((await request('/app/beheer/overzicht/', { cookie: adminCookie, form: { _csrf: adminCsrf } })).status, 404, 'het overzicht heeft geen formulier');
  });

  await t.test('contactgegevens: opslaan, fouten, CSRF, auditlog en effect op de site', async () => {
    const before = await request('/bestaat-niet/');
    assert.match(before.text, /0118 638427/, 'standaard in de voettekst');
    const page = await request('/app/beheer/contact/', { cookie: adminCookie });
    assert.equal(page.status, 200);
    assert.match(page.text, /value="0118 638427"/);

    assert.equal((await request('/app/beheer/contact/', { cookie: adminCookie, form: { contactPhone: '010 1234567', contactEmail: 'a@example.nl' } })).status, 403, 'zonder CSRF-token');
    assert.equal((await request('/app/beheer/contact/', { cookie: adminCookie, form: { _csrf: adminCsrf, contactPhone: '010 1234567', contactEmail: 'a@example.nl' }, headers: { origin: 'https://evil.example' } })).status, 403);

    const invalid = await request('/app/beheer/contact/', { cookie: adminCookie, form: { _csrf: adminCsrf, contactPhone: '010 1234567', contactEmail: 'geen-adres' } });
    assert.equal(invalid.status, 422);
    assert.match(invalid.text, /Vul een geldig e-mailadres in/);
    assert.match(invalid.text, /value="geen-adres"/, 'de invoer blijft staan');
    const empty = await request('/app/beheer/contact/', { cookie: adminCookie, form: { _csrf: adminCsrf, contactPhone: '010 1234567', contactEmail: ' ' } });
    assert.equal(empty.status, 422);
    assert.match(empty.text, /Vul dit veld in/);
    const doubled = new URLSearchParams([['_csrf', adminCsrf], ['contactPhone', '010 1'], ['contactPhone', '010 2'], ['contactEmail', 'a@example.nl']]);
    assert.equal((await request('/app/beheer/contact/', { cookie: adminCookie, form: doubled })).status, 422, 'een dubbel veld is ongeldig');
    assert.equal((await db.query("SELECT count(*)::int AS count FROM settings WHERE key LIKE 'contact%'"))[0].count, 0, 'niets opgeslagen');

    const saved = await request('/app/beheer/contact/', { cookie: adminCookie, form: { _csrf: adminCsrf, contactPhone: '+31 (0)10-1234567', contactEmail: 'Reizen@Example.NL', onbekend: 'genegeerd' } });
    assert.equal(saved.status, 303);
    assert.equal(saved.headers.get('location'), '/app/beheer/contact/?opgeslagen=1');
    const after = await request('/app/beheer/contact/?opgeslagen=1', { cookie: adminCookie });
    assert.match(after.text, /De instellingen zijn opgeslagen/);
    assert.match(after.text, /Ingesteld in Beheer/);
    assert.match(after.text, /name="_reset" value="contactEmail"/);

    const footer = await request('/bestaat-niet/');
    assert.match(footer.text, /href="tel:\+310101234567">\+31 \(0\)10-1234567</);
    assert.match(footer.text, /mailto:reizen@example\.nl/);
    assert.doesNotMatch(footer.text, /0118 638427/);

    const audit = await db.query("SELECT action, entity, entity_id FROM audit_log WHERE entity = 'settings' ORDER BY id");
    assert.deepEqual(audit.map((row) => `${row.action}:${row.entity_id}`).sort(), ['instelling.gewijzigd:contactEmail', 'instelling.gewijzigd:contactPhone']);
    assert.match((await request('/app/auditlog/', { cookie: adminCookie })).text, /Instelling gewijzigd/);

    // Nogmaals opslaan zonder wijziging schrijft niets in het auditlog.
    await request('/app/beheer/contact/', { cookie: adminCookie, form: { _csrf: adminCsrf, contactPhone: '+31 (0)10-1234567', contactEmail: 'reizen@example.nl' } });
    assert.equal((await db.query("SELECT count(*)::int AS count FROM audit_log WHERE entity = 'settings'"))[0].count, 2);

    // Terugzetten: alleen instellingen van deze sectie; een vreemde naam wordt genegeerd.
    const reset = new URLSearchParams([['_csrf', adminCsrf], ['contactPhone', '+31 (0)10-1234567'], ['contactEmail', 'reizen@example.nl'], ['_reset', 'contactPhone'], ['_reset', 'onbekend']]);
    assert.equal((await request('/app/beheer/contact/', { cookie: adminCookie, form: reset })).status, 303);
    assert.match((await request('/bestaat-niet/')).text, /0118 638427/);
    const [last] = await db.query("SELECT action, entity_id FROM audit_log WHERE entity = 'settings' ORDER BY id DESC LIMIT 1");
    assert.deepEqual([last.action, last.entity_id], ['instelling.teruggezet', 'contactPhone']);
  });
});
