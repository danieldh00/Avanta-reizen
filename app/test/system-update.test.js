/**
 * Tests voor pakket D1: updates vanuit de app (`system/system-update.js`: status van de host saneren, releasenotes,
 * aanvragen, controleren, intrekken, automatisch, afgeronde uitrol), de onderhoudsmodus (host en met de hand: 503 op
 * schrijven, balk, inloggen blijft werken), de servertaken (`system/host-tasks.js`) en de Beheer-pagina's (rechten,
 * CSRF, wachtwoord, audit). De databasetests draaien in een eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { recordFinishedRun, startUpdateSync } = require('../src/beheer/update-routes');
const { createSystemUpdate, parseChangelog, compareVersions, MAINTENANCE_MAX_MS } = require('../src/system/system-update');
const { createHostTasks, HOST_TASKS, HOST_COMMAND } = require('../src/system/host-tasks');
const { COOKIE_NAME } = require('../src/crm/auth');
const { loginWithTwoFactor } = require('./helpers/two-factor');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'system_update_test';
const MASTER_KEY = Buffer.alloc(32, 6);
const SETUP_CODE = 'ABCDE-FGHJK-LMNPQ-RSTUV';
const ADMIN_PASSWORD = 'correct paard batterij';
const CURRENT = 'a'.repeat(40);
const AVAILABLE = 'b'.repeat(40);
const CHANGELOG = `# Changelog

## 0.6.1 — 2026-11-22 — Logboek
- Beheer > Logboek met foutcodes.
  Tweede regel van hetzelfde punt.

## 0.6.0 — 2026-11-21 — Updates vanuit de app
- Nu updaten in Beheer.

## 0.5.0 — 2026-11-20 — Hersteltest
- Oud.
`;

/**
 * Een tijdelijke map die na de test wordt opgeruimd.
 * @param {object} t Testcontext.
 * @returns {string} Pad.
 */
function tempDir(testContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avanta-update-'));
  testContext.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Schrijft een JSON-bestand.
 * @param {string} dir Map.
 * @param {string} name Naam.
 * @param {object} value Inhoud.
 * @returns {void}
 */
function writeJson(dir, name, value) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
}

/**
 * Leest een JSON-bestand.
 * @param {string} dir Map.
 * @param {string} name Naam.
 * @returns {object} Inhoud.
 */
function readJson(dir, name) {
  return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
}

test('releasenotes uit de changelog en versies vergelijken', () => {
  const releases = parseChangelog(CHANGELOG);
  assert.deepEqual(releases.map((release) => release.version), ['0.6.1', '0.6.0', '0.5.0']);
  assert.equal(releases[0].title, 'Logboek');
  assert.equal(releases[0].date, '2026-11-22');
  assert.deepEqual(releases[0].items, ['Beheer > Logboek met foutcodes. Tweede regel van hetzelfde punt.']);
  assert.deepEqual(parseChangelog(null), []);
  assert.ok(compareVersions('0.10.0', '0.9.9') > 0);
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
});

test('koppeling met het hostscript: status, aanvragen, controleren, intrekken en afgeronde uitrol', (testContext) => {
  const statusDir = tempDir(testContext);
  const requestDir = tempDir(testContext);
  let clock = Date.parse('2026-11-22T10:00:00Z');
  const update = createSystemUpdate({ statusDir, requestDir, currentVersion: '0.5.0', now: () => clock });
  assert.deepEqual(createSystemUpdate({ currentVersion: '0.5.0' }).view(), { configured: false, running: '0.5.0' });

  // Niets van de host: geen nieuwere versie.
  assert.equal(update.view().newer, false);
  assert.equal(update.request({ commit: AVAILABLE, byName: 'x' }).error, 'no_update');

  // Status met rommel: alleen geldige waarden komen door.
  writeJson(statusDir, 'status.json', { current: '0.5.0', currentCommit: CURRENT, available: '0.6.1', availableCommit: AVAILABLE, checkedAt: '2026-11-22T09:59:00Z', extra: '<script>' });
  writeJson(statusDir, 'run.json', { state: 'hacked', step: 'rm -rf', message: 'regel1\nregel2', requestId: 'geen-uuid' });
  fs.writeFileSync(path.join(statusDir, 'changelog.md'), CHANGELOG);
  let view = update.view();
  assert.equal(view.newer, true);
  assert.equal(view.status.state, 'idle');
  assert.equal(view.status.step, null);
  assert.equal(view.status.requestId, null);
  assert.equal(view.status.message, 'regel1 regel2');
  assert.deepEqual(view.releases.map((release) => release.version), ['0.6.1', '0.6.0']);

  // Een symlink in de statusmap telt als afwezig.
  fs.rmSync(path.join(statusDir, 'changelog.md'));
  fs.symlinkSync('/etc/hostname', path.join(statusDir, 'changelog.md'));
  assert.deepEqual(update.view().releases, []);

  // Aanvragen: alleen de beschikbare commit.
  assert.equal(update.request({ commit: CURRENT, byName: 'x' }).error, 'changed');
  const out = update.request({ commit: AVAILABLE, byName: 'Daniël\n<b>' });
  assert.ok(out.request);
  const written = readJson(requestDir, 'request.json');
  assert.equal(written.commit, AVAILABLE);
  assert.equal(written.version, '0.6.1');
  assert.equal(written.byName, 'Daniël <b>');
  assert.equal(update.view().pending.commit, AVAILABLE);
  assert.equal(update.request({ commit: AVAILABLE, byName: 'x' }).error, 'pending');
  assert.equal(update.requestCheck({ byName: 'x' }).error, 'pending');
  assert.equal(update.cancel().commit, AVAILABLE);
  assert.equal(fs.existsSync(path.join(requestDir, 'request.json')), false);
  assert.equal(update.cancel(), null);

  // Controleren: één aanvraag, een tweede klik hergebruikt hem; intrekken kan een controle niet.
  assert.deepEqual(update.requestCheck({ byName: 'x' }), { started: true });
  assert.equal(readJson(requestDir, 'request.json').check, true);
  assert.equal(update.view().checking, true);
  assert.equal(update.view().pending, null);
  assert.deepEqual(update.requestCheck({ byName: 'x' }), { started: false });
  assert.equal(update.cancel(), null);
  fs.rmSync(path.join(requestDir, 'request.json'));

  // Een lopende uitrol blokkeert; een te oude "bezig" telt als onderbroken.
  writeJson(statusDir, 'run.json', { state: 'bezig', step: 'back-up', startedAt: new Date(clock - 60000).toISOString(), commit: AVAILABLE });
  assert.equal(update.request({ commit: AVAILABLE, byName: 'x' }).error, 'busy');
  clock += MAINTENANCE_MAX_MS;
  view = update.view();
  assert.equal(view.status.state, 'mislukt');
  assert.match(view.status.message, /onderbroken/);

  // Automatisch: alleen schrijven bij een andere stand.
  assert.equal(update.setAuto(false), true);
  assert.deepEqual(readJson(requestDir, 'policy.json'), { auto: false });
  assert.equal(update.setAuto(false), false);
  assert.equal(update.setAuto(true), true);

  // Afgeronde uitrol: één keer.
  writeJson(statusDir, 'run.json', { state: 'geslaagd', step: 'klaar', version: '0.6.1', commit: AVAILABLE, startedAt: '2026-11-22T10:00:00Z', finishedAt: '2026-11-22T10:02:00Z' });
  const finished = update.finishedRun();
  assert.equal(finished.run.version, '0.6.1');
  assert.ok(update.finishedRun(), 'nog niet vastgelegd: blijft staan');
  update.markAudited(finished.key);
  assert.equal(update.finishedRun(), null);

  // Onderhoudsmodus van de host: twee seconden onthouden, een achtergebleven bestand verloopt.
  clock += 2500;
  writeJson(statusDir, 'maintenance.json', { since: new Date(clock).toISOString(), version: '0.6.1' });
  assert.equal(update.hostMaintenance().active, true);
  fs.rmSync(path.join(statusDir, 'maintenance.json'));
  assert.equal(update.hostMaintenance().active, true, 'nog uit het geheugen');
  clock += 2500;
  assert.equal(update.hostMaintenance().active, false);
  writeJson(statusDir, 'maintenance.json', { since: new Date(clock - MAINTENANCE_MAX_MS - 1000).toISOString() });
  clock += 2500;
  assert.equal(update.hostMaintenance().active, false, 'te oud');
});

test('servertaken: afvinken door de server en met de hand', (testContext) => {
  const statusDir = tempDir(testContext);
  let stored = '';
  const settings = { get: () => stored };
  const tasks = [{ id: '001-een', title: 'Een', description: '', addedAt: '2026-11-20' }, { id: '002-twee', title: 'Twee', description: '', addedAt: '2026-11-21' }];
  const hostTasks = createHostTasks({ statusDir, settings, tasks });
  assert.equal(hostTasks.view().pending, 2);
  assert.match(HOST_COMMAND, /api\.github\.com\/repos\/danieldh00\/Avanta-reizen\/commits\/main/);
  assert.match(HOST_COMMAND, /raw\.githubusercontent\.com\/danieldh00\/Avanta-reizen\/\$REF\//, 'altijd op een vaste commit');
  assert.ok(HOST_TASKS.length >= 1);

  writeJson(statusDir, 'host-tasks.json', { done: { '001-een': '2026-11-22T10:00:00Z', '999-onbekend': '2026-11-22T10:00:00Z', '002-twee': 'geen tijd' }, checkedAt: '2026-11-22T10:00:00Z' });
  let view = hostTasks.view();
  assert.equal(view.tasks[0].doneBy, 'server');
  assert.equal(view.tasks[1].done, false);
  assert.equal(view.checkedAt, '2026-11-22T10:00:00.000Z');

  stored = hostTasks.checkedValue('002-twee', true);
  assert.equal(stored, '002-twee');
  view = hostTasks.view();
  assert.equal(view.tasks[1].doneBy, 'handmatig');
  assert.equal(view.pending, 0);
  stored = hostTasks.checkedValue('002-twee', false);
  assert.equal(stored, '');
  assert.equal(hostTasks.known('003-nee'), false);
});

test('updates, onderhoudsmodus en servertaken in Beheer', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (testContext) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const url = new URL(DATABASE_URL);
  url.searchParams.set('options', `-c search_path=${SCHEMA}`);
  const db = createDatabase(url.toString());
  await db.migrate();
  const statusDir = tempDir(testContext);
  const requestDir = tempDir(testContext);
  let clock = Date.now();
  const systemUpdate = createSystemUpdate({ statusDir, requestDir, currentVersion: '0.5.0', now: () => clock });
  const app = createApp({ db, masterKey: MASTER_KEY, setupCode: SETUP_CODE, systemUpdate, updateStatusDir: statusDir, backupDir: tempDir(testContext) });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  testContext.after(async () => { server.close(); await db.close(); });

  /**
   * Doet een verzoek zonder redirects te volgen.
   * @param {string} pathName Pad.
   * @param {{form?: object, cookie?: string}} [init] Formulier en sessiecookie.
   * @returns {Promise<{status: number, text: string, headers: Headers, cookie: string}>} Antwoord.
   */
  const request = async (pathName, init = {}) => {
    const headers = { 'sec-fetch-site': 'same-origin' };
    if (init.cookie) headers.cookie = `${COOKIE_NAME}=${init.cookie}`;
    let body;
    if (init.form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(init.form).toString();
    }
    const response = await fetch(base + pathName, { method: init.form ? 'POST' : 'GET', headers, body, redirect: 'manual' });
    const setCookie = response.headers.getSetCookie().find((value) => value.startsWith(`${COOKIE_NAME}=`)) || '';
    return { status: response.status, text: await response.text(), headers: response.headers, cookie: setCookie.split(';')[0].split('=')[1] || '' };
  };
  const csrfFrom = (text) => (text.match(/name="_csrf" value="([^"]+)"/) || [])[1];
  const auditCount = async (action) => (await db.query('SELECT count(*)::int AS count FROM audit_log WHERE action = $1', [action]))[0].count;

  const installed = await request('/app/installatie/', { form: { code: SETUP_CODE, name: 'Daniël', email: 'beheer@example.nl', password: ADMIN_PASSWORD, password2: ADMIN_PASSWORD } });
  const cookie = installed.cookie;
  const csrf = csrfFrom((await request('/app/', { cookie })).text);
  await request('/app/gebruikers/nieuw/', { cookie, form: { _csrf: csrf, name: 'Kantoor', email: 'kantoor@example.nl', role: 'kantoor', password: 'kantoor wachtwoord 1' } });
  const office = await loginWithTwoFactor(request, 'kantoor@example.nl', 'kantoor wachtwoord 1', { admin: { cookie, csrf } });
  const officeCsrf = csrfFrom((await request('/app/', { cookie: office.cookie })).text);

  writeJson(statusDir, 'status.json', { current: '0.5.0', currentCommit: CURRENT, available: '0.6.1', availableCommit: AVAILABLE, checkedAt: new Date().toISOString() });
  fs.writeFileSync(path.join(statusDir, 'changelog.md'), CHANGELOG);

  // Rechten: alleen recht systeem; elke POST met CSRF.
  const page = await request('/app/beheer/updates/', { cookie });
  assert.equal(page.status, 200);
  assert.match(page.text, /0\.6\.1 — Logboek/);
  assert.match(page.text, /Nu updaten/);
  assert.doesNotMatch(page.text, /0\.5\.0 — Hersteltest/, 'alleen nieuwere versies');
  assert.equal(fs.existsSync(path.join(requestDir, 'policy.json')), false, 'een GET schrijft niets');
  const { sync, timer } = startUpdateSync({ db, settings: app.locals.settings, systemUpdate });
  clearInterval(timer);
  await sync();
  assert.deepEqual(readJson(requestDir, 'policy.json'), { auto: true }, 'stand doorgegeven aan de host');
  for (const pathName of ['/app/beheer/updates/', '/app/beheer/servertaken/']) assert.equal((await request(pathName, { cookie: office.cookie })).status, 403, pathName);
  for (const action of ['controleren', 'installeren', 'intrekken', 'automatisch', 'onderhoud']) {
    assert.equal((await request(`/app/beheer/updates/${action}/`, { cookie: office.cookie, form: { _csrf: officeCsrf, password: 'kantoor wachtwoord 1', commit: AVAILABLE } })).status, 403, `${action}: recht`);
    assert.equal((await request(`/app/beheer/updates/${action}/`, { cookie, form: { _csrf: 'fout', password: ADMIN_PASSWORD, commit: AVAILABLE } })).status, 403, `${action}: CSRF`);
  }
  assert.equal(fs.existsSync(path.join(requestDir, 'request.json')), false);

  // Nu updaten: verkeerd wachtwoord (in het auditlog), dan goed.
  const wrong = await request('/app/beheer/updates/installeren/', { cookie, form: { _csrf: csrf, password: 'fout wachtwoord', commit: AVAILABLE } });
  assert.equal(wrong.status, 422);
  assert.match(wrong.text, /Je wachtwoord klopt niet/);
  assert.equal(await auditCount('update.wachtwoord-fout'), 1);
  assert.equal((await request('/app/beheer/updates/installeren/', { cookie, form: { _csrf: csrf, password: ADMIN_PASSWORD, commit: CURRENT } })).status, 409, 'andere commit');
  const started = await request('/app/beheer/updates/installeren/', { cookie, form: { _csrf: csrf, password: ADMIN_PASSWORD, commit: AVAILABLE } });
  assert.equal(started.status, 303);
  assert.equal(readJson(requestDir, 'request.json').commit, AVAILABLE);
  assert.deepEqual((await db.query("SELECT entity_id FROM audit_log WHERE action = 'update.aangevraagd'")).map((row) => row.entity_id), ['0.6.1']);
  assert.match((await request('/app/beheer/updates/', { cookie })).text, /aangevraagd door Daniël/);

  // Intrekken, controleren.
  assert.equal((await request('/app/beheer/updates/intrekken/', { cookie, form: { _csrf: csrf } })).status, 303);
  assert.equal(fs.existsSync(path.join(requestDir, 'request.json')), false);
  assert.equal(await auditCount('update.ingetrokken'), 1);
  assert.equal((await request('/app/beheer/updates/intrekken/', { cookie, form: { _csrf: csrf } })).status, 404);
  assert.equal((await request('/app/beheer/updates/controleren/', { cookie, form: { _csrf: csrf } })).status, 303);
  assert.equal(readJson(requestDir, 'request.json').check, true);
  assert.equal((await request('/app/beheer/updates/controleren/', { cookie, form: { _csrf: csrf } })).status, 303);
  assert.equal(await auditCount('update.controle'), 1, 'tweede klik hergebruikt de controle');
  fs.rmSync(path.join(requestDir, 'request.json'));

  // Automatisch uit: instelling, policy.json en auditlog.
  assert.equal((await request('/app/beheer/updates/automatisch/', { cookie, form: { _csrf: csrf } })).status, 303);
  assert.equal(app.locals.settings.get('updateAuto'), false);
  assert.deepEqual(readJson(requestDir, 'policy.json'), { auto: false });
  assert.deepEqual((await db.query("SELECT entity_id FROM audit_log WHERE action = 'instelling.gewijzigd'")).map((row) => row.entity_id), ['updateAuto']);

  // Afgeronde uitrol van de host: één keer in het auditlog (zonder gebruiker), ook bij gelijktijdige rondes; een
  // mislukte auditregel wordt later opnieuw geprobeerd.
  writeJson(statusDir, 'run.json', { state: 'geslaagd', step: 'klaar', version: '0.6.1', commit: AVAILABLE, startedAt: '2026-11-22T10:00:00Z', finishedAt: '2026-11-22T10:02:00Z', automatic: true });
  const failingDb = { query: async () => { throw new Error('database weg'); } };
  await assert.rejects(recordFinishedRun(failingDb, systemUpdate));
  const results = await Promise.all([recordFinishedRun(db, systemUpdate), recordFinishedRun(db, systemUpdate)]);
  assert.deepEqual(results.sort(), [false, true]);
  assert.equal(await recordFinishedRun(db, systemUpdate), false);
  assert.deepEqual(await db.query("SELECT user_id, entity_id FROM audit_log WHERE action = 'update.geslaagd'"), [{ user_id: null, entity_id: '0.6.1' }]);
  // Onthouden op schijf mislukt (map niet schrijfbaar): na twee rondes toch precies één regel.
  const unwritable = { finishedRun: () => ({ run: { state: 'mislukt', version: '0.6.2', commit: AVAILABLE }, key: 'onschrijfbaar-1' }), markAudited: () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); } };
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(await recordFinishedRun(db, unwritable), true);
    assert.equal(await recordFinishedRun(db, unwritable), false);
  } finally {
    console.error = originalError;
  }
  assert.equal((await db.query("SELECT entity_id FROM audit_log WHERE action = 'update.mislukt' AND entity_id = '0.6.2'")).length, 1);

  // Onderhoudsmodus van de host: schrijven geeft 503 (ook het contactformulier), lezen werkt met een balk, inloggen blijft.
  writeJson(statusDir, 'maintenance.json', { since: new Date(clock).toISOString(), version: '0.6.1' });
  clock += 2500;
  const home = await request('/');
  assert.equal(home.status, 200);
  assert.match(home.text, /maintenance-banner/);
  assert.equal(home.headers.get('x-avanta-maintenance'), 'update');
  const blocked = await request('/app/gebruikers/nieuw/', { cookie, form: { _csrf: csrf, name: 'X', email: 'x@example.nl', role: 'kantoor', password: 'nog een wachtwoord 1' } });
  assert.equal(blocked.status, 503);
  assert.equal(blocked.headers.get('retry-after'), '60');
  assert.match(blocked.text, /update geïnstalleerd/);
  assert.equal((await request('/contact/', { form: { naam: 'x' } })).status, 503);
  assert.equal((await request('/app/beheer/updates/onderhoud/', { cookie, form: { _csrf: csrf } })).status, 503, 'tijdens een update ook het uitzetten niet');
  assert.notEqual((await request('/app/inloggen/', { form: { email: 'kantoor@example.nl', password: 'kantoor wachtwoord 1' } })).status, 503);
  assert.notEqual((await request('/app/inloggen', { form: { email: 'kantoor@example.nl', password: 'kantoor wachtwoord 1' } })).status, 503, 'ook zonder slash');
  assert.match((await request('/app/', { cookie })).text, /maintenance-banner/);
  fs.rmSync(path.join(statusDir, 'maintenance.json'));
  clock += 2500;

  // Onderhoudsmodus met de hand: eigen tekst; uitzetten blijft mogelijk.
  assert.equal((await request('/app/beheer/updates/onderhoud/', { cookie, form: { _csrf: csrf, maintenanceMode: 'ja', maintenanceMessage: 'Verhuizing naar een nieuwe server.' } })).status, 303);
  const manualHome = await request('/');
  assert.match(manualHome.text, /Verhuizing naar een nieuwe server\./);
  assert.equal(manualHome.headers.get('x-avanta-maintenance'), 'handmatig');
  assert.equal((await request('/app/beheer/updates/automatisch/', { cookie, form: { _csrf: csrf, updateAuto: 'ja' } })).status, 503);
  assert.equal((await request('/app/beheer/updates/onderhoud/', { cookie, form: { _csrf: csrf, maintenanceMessage: '' } })).status, 303);
  assert.doesNotMatch((await request('/')).text, /maintenance-banner/);
  assert.equal((await request('/app/beheer/updates/onderhoud/', { cookie, form: { _csrf: csrf, maintenanceMessage: 'x'.repeat(301) } })).status, 422);

  // Servertaken: vast commando, afvinken met de hand (audit), onbekende taak 404, server-afvinking telt.
  const tasksPage = await request('/app/beheer/servertaken/', { cookie });
  assert.equal(tasksPage.status, 200);
  assert.match(tasksPage.text, /TASKS_REF=&quot;\$REF&quot; bash &quot;\$T&quot; openstaand/);
  assert.match(tasksPage.text, /vervang <code>openstaand<\/code> door <code>schijf<\/code>/);
  const id = HOST_TASKS[0].id;
  assert.equal((await request(`/app/beheer/servertaken/${id}/`, { cookie: office.cookie, form: { _csrf: officeCsrf, done: 'ja' } })).status, 403);
  assert.equal((await request(`/app/beheer/servertaken/${id}/`, { cookie, form: { _csrf: 'fout', done: 'ja' } })).status, 403);
  assert.equal((await request('/app/beheer/servertaken/999-bestaat-niet/', { cookie, form: { _csrf: csrf, done: 'ja' } })).status, 404);
  const invalid = await request(`/app/beheer/servertaken/${id}/`, { cookie, form: { _csrf: csrf, done: 'misschien' } });
  assert.equal(invalid.status, 400);
  assert.match(invalid.text, /Ongeldige keuze/);
  assert.equal((await request(`/app/beheer/servertaken/${id}/`, { cookie, form: { _csrf: csrf, done: 'ja' } })).status, 303);
  assert.match((await request('/app/beheer/servertaken/', { cookie })).text, /Met de hand afgevinkt/);
  assert.equal(await auditCount('servertaak.afgevinkt'), 1);
  assert.equal((await request(`/app/beheer/servertaken/${id}/`, { cookie, form: { _csrf: csrf, done: 'nee' } })).status, 303);
  assert.equal(await auditCount('servertaak.heropend'), 1);
  writeJson(statusDir, 'host-tasks.json', { done: { [id]: '2026-11-22T10:00:00Z' }, checkedAt: '2026-11-22T10:00:00Z' });
  assert.match((await request('/app/beheer/servertaken/', { cookie })).text, /Gedaan door de server/);
});
