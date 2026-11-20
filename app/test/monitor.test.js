/**
 * Tests voor pakket D3: de bewaking (`system/monitor.js`: controles, incidenten openen/verergeren/herinneren/sluiten,
 * meldingen per mail en webhook, heartbeat, opschonen), het veilige uitgaande verzoek (`security/safe-request.js`:
 * alleen https, alleen openbare adressen, vast adres) en de pagina Beheer > Systeem > Bewaking en meldingen (rechten,
 * CSRF, testmelding, Nu controleren, limieten, geen URL's in de uitvoer). Plus migratie M8. De databasetests draaien in
 * een eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { runChecks, CHECKS } = require('../src/system/monitor');
const { safeRequest, SafeRequestError } = require('../src/security/safe-request');
const { PrivateHostError } = require('../src/security/netguard');
const { COOKIE_NAME } = require('../src/crm/auth');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'monitor_test';
const MASTER_KEY = Buffer.alloc(32, 8);
const SETUP_CODE = 'ABCDE-FGHJK-LMNPQ-RSTUV';
const ADMIN_PASSWORD = 'correct paard batterij';
const HOUR = 60 * 60 * 1000;

/**
 * Een nep-`https.request`: onthoudt de opties en de body en antwoordt met een vaste status.
 * @param {number} status Statuscode van het antwoord.
 * @returns {{request: Function, calls: object[]}} De functie en de aanroepen.
 */
function fakeHttps(status) {
  const calls = [];
  const request = (requestOptions, onResponse) => {
    const outgoing = new EventEmitter();
    const call = { options: requestOptions, body: '' };
    calls.push(call);
    outgoing.write = (chunk) => { call.body += chunk; };
    outgoing.destroy = (error) => outgoing.emit('error', error);
    outgoing.end = () => setImmediate(() => {
      if (status === 'timeout') return outgoing.emit('timeout');
      if (status === 'druppel') return undefined; // de server houdt de verbinding open zonder ooit klaar te zijn
      const response = new EventEmitter();
      response.statusCode = status;
      response.destroy = () => {};
      return onResponse(response);
    });
    return outgoing;
  };
  return { request, calls };
}

test('veilig uitgaand verzoek: alleen https, openbaar adres en vast adres', async () => {
  const publicHost = async () => '93.184.216.34';
  await assert.rejects(safeRequest('http://example.com/x', { resolveHost: publicHost }), { code: 'invalid_url' });
  await assert.rejects(safeRequest('https://gebruiker:geheim@example.com/x', { resolveHost: publicHost }), { code: 'invalid_url' });
  await assert.rejects(safeRequest('geen adres', { resolveHost: publicHost }), { code: 'invalid_url' });
  await assert.rejects(safeRequest('https://intern.example/x', { resolveHost: async (host) => { throw new PrivateHostError(host); } }), { code: 'private_host' });
  await assert.rejects(safeRequest('https://bestaat-niet.example/x', { resolveHost: async () => { throw new Error('ENOTFOUND'); } }), { code: 'network' });

  const ok = fakeHttps(204);
  const result = await safeRequest('https://hooks.example.com/pad?token=abc', { json: { text: 'hallo' }, resolveHost: publicHost, request: ok.request });
  assert.equal(result.status, 204);
  const [call] = ok.calls;
  assert.equal(call.options.method, 'POST');
  assert.equal(call.options.hostname, 'hooks.example.com');
  assert.equal(call.options.servername, 'hooks.example.com');
  assert.equal(call.options.path, '/pad?token=abc');
  assert.deepEqual(JSON.parse(call.body), { text: 'hallo' });
  // De verbinding gaat naar het gecontroleerde adres, wat DNS daarna ook zegt.
  await new Promise((resolve) => call.options.lookup('hooks.example.com', {}, (error, address, family) => {
    assert.equal(address, '93.184.216.34');
    assert.equal(family, 4);
    resolve();
  }));
  await new Promise((resolve) => call.options.lookup('hooks.example.com', { all: true }, (error, list) => {
    assert.deepEqual(list, [{ address: '93.184.216.34', family: 4 }]);
    resolve();
  }));

  const slow = fakeHttps('timeout');
  await assert.rejects(safeRequest('https://hc.example.com/ping', { resolveHost: publicHost, request: slow.request }), (error) => error instanceof SafeRequestError && error.code === 'timeout');
  // Een server die blijft druppelen: de totale tijdslimiet grijpt in, ook zonder stille verbinding.
  const trickle = fakeHttps('druppel');
  const started = Date.now();
  await assert.rejects(safeRequest('https://hc.example.com/ping', { timeoutMs: 50, resolveHost: publicHost, request: trickle.request }), { code: 'timeout' });
  assert.ok(Date.now() - started < 2000);
  await assert.rejects(safeRequest('https://hooks.example.com/', { json: { text: 'x'.repeat(20000) }, resolveHost: publicHost, request: ok.request }), { code: 'too_large' });
});

test('controles zonder database: elke uitkomst', async () => {
  const now = Date.parse('2026-11-25T12:00:00Z');
  const values = { backupEnabled: true, driveEnabled: true, monitorBackupMaxHours: 26, monitorDiskMinPercent: 10, monitorErrorsPerHour: 20 };
  const settings = { get: (key) => values[key] };
  const sources = {
    settings, now, startedAt: now - 100 * HOUR, dataDir: '/data',
    backups: { available: () => true, list: () => [{ createdAt: new Date(now - 30 * HOUR).toISOString() }], status: () => ({ lastRun: null, lastOkAt: '' }) },
    drive: { connected: () => true, state: () => ({ needsReconnect: false, lastOkAt: new Date(now - HOUR).toISOString(), lastFailAt: '', events: [] }) },
    restoreTests: { hostRuns: () => [{ state: 'mislukt', startedAt: new Date(now - HOUR).toISOString(), message: 'Tabel ontbreekt.' }], driveRuns: () => [] },
    mailer: { configured: () => true, recent: () => [{ at: new Date(now), kind: 'testmail', ok: false, message: 'Inloggen geweigerd.' }] },
    statfs: () => ({ blocks: 1000, bsize: 4096, bavail: 150 }),
    db: { query: async () => [{ count: 25 }] },
    systemUpdate: { configured: true, view: () => ({ status: { state: 'mislukt', message: 'Versie klopt niet.' } }) },
  };
  let results = Object.fromEntries((await runChecks(sources)).map((check) => [check.key, check]));
  assert.deepEqual(Object.keys(results), CHECKS.map((check) => check.key));
  assert.equal(results['back-up'].state, 'error');
  assert.match(results['back-up'].message, /langer dan 26 uur/);
  assert.equal(results['google-drive'].state, 'ok');
  assert.equal(results.hersteltest.state, 'error');
  assert.match(results.hersteltest.message, /Tabel ontbreekt/);
  assert.equal(results.mail.state, 'error');
  assert.equal(results.schijf.state, 'warn', '15% vrij: onder het dubbele van 10%');
  assert.equal(results.fouten.state, 'warn');
  assert.equal(results.update.state, 'warn');

  // Andere standen.
  sources.backups = { available: () => true, list: () => [{ createdAt: new Date(now - HOUR).toISOString() }], status: () => ({ lastRun: { at: new Date(now - 10 * 60000).toISOString(), ok: false, message: 'pg_dump mislukt' }, lastOkAt: new Date(now - HOUR).toISOString() }) };
  sources.drive = { connected: () => true, state: () => ({ needsReconnect: true, events: [] }) };
  sources.restoreTests = { hostRuns: () => [{ state: 'geslaagd', startedAt: new Date(now - 9 * 24 * HOUR).toISOString() }], driveRuns: () => [] };
  sources.mailer = { configured: () => false };
  sources.statfs = () => ({ blocks: 1000, bsize: 4096, bavail: 50 });
  sources.db = { query: async () => { throw new Error('database weg met geheim'); } };
  sources.systemUpdate = { configured: false };
  results = Object.fromEntries((await runChecks(sources)).map((check) => [check.key, check]));
  assert.equal(results['back-up'].state, 'warn');
  assert.match(results['back-up'].message, /pg_dump mislukt/);
  assert.equal(results['google-drive'].state, 'error');
  assert.equal(results.hersteltest.state, 'warn');
  assert.equal(results.mail.state, 'uit');
  assert.equal(results.schijf.state, 'error');
  assert.equal(results.fouten.state, 'warn');
  assert.doesNotMatch(results.fouten.message, /geheim/, 'een falende controle toont de fout niet');
  assert.equal(results.update.state, 'uit');

  // Uit of nog niet van toepassing.
  values.backupEnabled = false;
  values.driveEnabled = false;
  values.monitorErrorsPerHour = 0;
  sources.restoreTests = { hostRuns: () => [], driveRuns: () => [] };
  sources.statfs = () => { throw new Error('ENOENT'); };
  results = Object.fromEntries((await runChecks(sources)).map((check) => [check.key, check]));
  assert.equal(results['back-up'].state, 'uit');
  assert.equal(results['google-drive'].state, 'uit');
  assert.equal(results.hersteltest.state, 'uit');
  assert.equal(results.schijf.state, 'warn');
  assert.equal(results.fouten.state, 'uit');

  // Nog geen back-up: pas een incident als de app langer draait dan de drempel.
  values.backupEnabled = true;
  sources.backups = { available: () => true, list: () => [], status: () => ({ lastRun: null, lastOkAt: '' }) };
  sources.startedAt = now - HOUR;
  assert.equal((await runChecks(sources))[0].state, 'ok');
  sources.startedAt = now - 30 * HOUR;
  assert.equal((await runChecks(sources))[0].state, 'error');
});

test('bewaking, meldingen en Beheer > Bewaking', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const url = new URL(DATABASE_URL);
  url.searchParams.set('options', `-c search_path=${SCHEMA}`);
  const db = createDatabase(url.toString());
  await db.migrate();
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avanta-monitor-'));

  let clock = Date.now();
  let freeBlocks = 500;
  const mailEvents = [];
  const sent = [];
  const requests = [];
  let requestStatus = 200;
  const mailer = {
    configured: () => true,
    server: () => ({ mode: 'smtp', host: 'smtp.example.nl', port: 587, secure: false, user: '', fromName: 'Avanta', fromAddress: 'noreply@example.nl', replyTo: '' }),
    recent: () => mailEvents.map((event) => ({ ...event })),
    send: async (message) => { sent.push(message); },
  };
  const backups = {
    available: () => true,
    list: () => [{ name: 'avanta-20261120-030000.avb', size: 10, createdAt: new Date(clock - HOUR).toISOString() }],
    status: () => ({ lastRun: null, lastOkAt: new Date(clock - HOUR).toISOString(), lastFailAt: '', running: false }),
    idle: async () => {}, run: async () => null, runIfDue: async () => null, startTimer: () => null, fileOf: () => null, keyId: 'x', dir: backupDir,
  };
  const app = createApp({
    db, masterKey: MASTER_KEY, setupCode: SETUP_CODE, backupDir, mailer, backups, now: () => clock,
    statfs: () => ({ blocks: 1000, bsize: 4096, bavail: freeBlocks }),
    monitorRequest: async (address, requestOptions) => { requests.push({ address, ...requestOptions }); return { status: requestStatus }; },
  });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await db.close(); fs.rmSync(backupDir, { recursive: true, force: true }); });
  const { monitor, settings } = app.locals;

  /**
   * Doet een verzoek zonder redirects te volgen.
   * @param {string} pathName Pad.
   * @param {{form?: object, cookie?: string}} [init] Formulier en sessiecookie.
   * @returns {Promise<{status: number, text: string, cookie: string}>} Antwoord.
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
    return { status: response.status, text: await response.text(), cookie: setCookie.split(';')[0].split('=')[1] || '' };
  };
  const csrfFrom = (text) => (text.match(/name="_csrf" value="([^"]+)"/) || [])[1];
  const openIncidents = () => db.query('SELECT check_key, severity, notify_count FROM monitor_incidents WHERE resolved_at IS NULL ORDER BY check_key');

  // M8: tabel en hoogstens één open incident per controle.
  const [index] = await db.query("SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND indexname = 'monitor_incidents_open_idx'", [SCHEMA]);
  assert.match(index.indexdef, /UNIQUE INDEX .* WHERE \(resolved_at IS NULL\)/);
  await db.query("INSERT INTO monitor_incidents (check_key, severity, message) VALUES ('test', 'warn', 'a')");
  await assert.rejects(db.query("INSERT INTO monitor_incidents (check_key, severity, message) VALUES ('test', 'error', 'b')"), /duplicate key/);
  await db.query("DELETE FROM monitor_incidents WHERE check_key = 'test'");

  const installed = await request('/app/installatie/', { form: { code: SETUP_CODE, name: 'Daniël', email: 'beheer@example.nl', password: ADMIN_PASSWORD, password2: ADMIN_PASSWORD } });
  const cookie = installed.cookie;
  const csrf = csrfFrom((await request('/app/', { cookie })).text);
  await request('/app/gebruikers/nieuw/', { cookie, form: { _csrf: csrf, name: 'Kantoor', email: 'kantoor@example.nl', role: 'kantoor', password: 'kantoor wachtwoord 1' } });
  const office = await request('/app/inloggen/', { form: { email: 'kantoor@example.nl', password: 'kantoor wachtwoord 1' } });

  await settings.update({ values: { monitorEmail: 'bewaking@example.nl', monitorWebhookUrl: 'https://hooks.example.com/geheim-token', monitorHeartbeatUrl: 'https://hc.example.com/ping/geheim-uuid', siteUrl: 'https://avanta.example.nl' } });
  // Een webhook die geen https is wordt geweigerd.
  await assert.rejects(settings.update({ values: { monitorWebhookUrl: 'http://hooks.example.com/x' } }));

  // Alles in orde: geen incidenten, wel een heartbeat.
  let result = await monitor.run();
  assert.equal(result.notified, 0);
  assert.deepEqual(await openIncidents(), []);
  assert.deepEqual(requests.map((entry) => [entry.address, entry.method]), [['https://hc.example.com/ping/geheim-uuid', 'GET']]);
  requests.length = 0;

  // Schijf bijna vol: ernstig incident, één melding per mail en webhook, geen heartbeat.
  freeBlocks = 50;
  result = await monitor.run();
  assert.equal(result.notified, 1);
  assert.deepEqual(await openIncidents(), [{ check_key: 'schijf', severity: 'error', notify_count: 1 }]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'bewaking@example.nl');
  assert.equal(sent[0].kind, 'bewaking');
  assert.match(sent[0].subject, /1 incident/);
  assert.match(sent[0].text, /Schijfruimte/);
  assert.match(sent[0].text, /https:\/\/avanta\.example\.nl\/app\/beheer\/bewaking\//);
  assert.equal(requests.length, 1, 'alleen de webhook');
  assert.equal(requests[0].address, 'https://hooks.example.com/geheim-token');
  assert.equal(requests[0].json.incidents[0].check, 'schijf');
  assert.equal(requests[0].json.incidents[0].status, 'geopend');
  assert.equal(requests[0].json.text, requests[0].json.content);

  // Volgende ronde: niets nieuws, dus geen melding.
  requests.length = 0;
  result = await monitor.run();
  assert.equal(result.notified, 0);
  assert.equal(sent.length, 1);
  assert.deepEqual(requests, []);

  // Minder ernstig (waarschuwing): geen melding; weer ernstig: "verergerd".
  freeBlocks = 150;
  assert.equal((await monitor.run()).notified, 0);
  assert.equal((await openIncidents())[0].severity, 'warn');
  freeBlocks = 50;
  assert.equal((await monitor.run()).notified, 1);
  assert.equal(requests.at(-1).json.incidents[0].status, 'verergerd');

  // Herinnering na de ingestelde tijd.
  clock += 25 * HOUR;
  assert.equal((await monitor.run()).notified, 1);
  assert.equal(requests.at(-1).json.incidents[0].status, 'herinnering');
  assert.equal((await openIncidents())[0].notify_count, 3);

  // Mail mislukt: een tweede incident; de webhook meldt het ook (de mailer zelf faalt niet in deze test).
  mailEvents.unshift({ at: new Date(clock), kind: 'testmail', ok: false, message: 'Inloggen geweigerd.' });
  assert.equal((await monitor.run()).notified, 1);
  assert.deepEqual((await openIncidents()).map((incident) => incident.check_key), ['mail', 'schijf']);

  // Opgelost: melding "opgelost", gesloten incidenten, weer een heartbeat.
  freeBlocks = 500;
  mailEvents.unshift({ at: new Date(clock), kind: 'testmail', ok: true, message: '' });
  requests.length = 0;
  result = await monitor.run();
  assert.equal(result.notified, 2);
  assert.deepEqual(await openIncidents(), []);
  assert.deepEqual(requests[0].json.incidents.map((item) => item.status), ['opgelost', 'opgelost']);
  assert.match(sent.at(-1).subject, /2 opgelost/);
  assert.equal(requests[1].address, 'https://hc.example.com/ping/geheim-uuid');

  // Fouten in het logboek boven de drempel: waarschuwing.
  await db.query("INSERT INTO app_logs (level, source, message, repeat_count, created_at) VALUES ('error', 'fout', 'x', 25, $1)", [new Date(clock - 60000)]);
  await monitor.run();
  assert.deepEqual(await openIncidents(), [{ check_key: 'fouten', severity: 'warn', notify_count: 1 }]);
  await db.query('DELETE FROM app_logs');
  await monitor.run();
  assert.deepEqual(await openIncidents(), []);
  // De eigen regels van de bewaking tellen niet mee als fouten in de app.
  await db.query("INSERT INTO app_logs (level, source, message, repeat_count, created_at) VALUES ('error', 'bewaking', 'Incident geopend', 25, $1)", [new Date(clock - 60000)]);
  await monitor.run();
  assert.deepEqual(await openIncidents(), []);
  await db.query('DELETE FROM app_logs');

  // Mislukte webhook: in het overzicht en het logboek, zonder het adres.
  requestStatus = 500;
  freeBlocks = 50;
  await monitor.run();
  const failed = monitor.view().deliveries.find((entry) => entry.channel === 'webhook');
  assert.equal(failed.ok, false);
  assert.match(failed.message, /HTTP 500/);
  await app.locals.appLog.flush();
  const logRows = await db.query("SELECT message FROM app_logs WHERE source = 'bewaking'");
  assert.ok(logRows.some((row) => /Melding via webhook mislukt/.test(row.message)));
  assert.ok(logRows.every((row) => !/geheim/.test(row.message)), 'nooit de URL in het logboek');
  requestStatus = 200;

  // Pagina: alleen recht systeem, geen URL's of tokens in de uitvoer.
  assert.equal((await request('/app/beheer/bewaking/', { cookie: office.cookie })).status, 403);
  assert.equal((await request('/app/beheer/bewaking/testen/', { cookie: office.cookie, form: { _csrf: csrf } })).status, 403);
  const page = await request('/app/beheer/bewaking/', { cookie });
  assert.equal(page.status, 200);
  assert.match(page.text, /Schijfruimte/);
  assert.match(page.text, /Er staat 1 incident open/);
  assert.match(page.text, /monitor-state--error/);
  assert.doesNotMatch(page.text, /geheim-token|geheim-uuid/);
  const overview = await request('/app/beheer/', { cookie });
  assert.match(overview.text, /Er staan incidenten open/);

  // Zonder CSRF geweigerd; Nu controleren en testmelding werken, met audit; limiet op de testmelding.
  assert.equal((await request('/app/beheer/bewaking/testen/', { cookie, form: {} })).status, 403);
  freeBlocks = 500;
  const checked = await request('/app/beheer/bewaking/controleren/', { cookie, form: { _csrf: csrf } });
  assert.equal(checked.status, 200);
  assert.match(checked.text, /Alles is opnieuw gecontroleerd/);
  assert.match(checked.text, /Geen open incidenten/);
  const before = sent.length;
  const tested = await request('/app/beheer/bewaking/testen/', { cookie, form: { _csrf: csrf } });
  assert.equal(tested.status, 200);
  assert.match(tested.text, /mail gelukt, webhook gelukt, heartbeat gelukt/);
  assert.equal(sent.length, before + 1);
  assert.match(sent.at(-1).subject, /testmelding/);
  const [audit] = await db.query("SELECT user_id, entity FROM audit_log WHERE action = 'bewaking.test'");
  assert.equal(audit.entity, 'bewaking');
  for (let i = 0; i < 4; i += 1) await request('/app/beheer/bewaking/testen/', { cookie, form: { _csrf: csrf } });
  const limited = await request('/app/beheer/bewaking/testen/', { cookie, form: { _csrf: csrf } });
  assert.equal(limited.status, 429);
  assert.match(limited.text, /Te veel testmeldingen/);

  // Bewaking uit: geen nieuwe incidenten, wel de stand op de pagina.
  await settings.update({ values: { monitorEnabled: false } });
  freeBlocks = 50;
  await monitor.run();
  assert.deepEqual(await openIncidents(), []);
  assert.equal(monitor.view().checks.find((check) => check.key === 'schijf').state, 'error');
  assert.match((await request('/app/beheer/bewaking/', { cookie })).text, /De bewaking staat uit/);

  // Opschonen: gesloten incidenten ouder dan een jaar verdwijnen.
  await settings.update({ values: { monitorEnabled: true } });
  freeBlocks = 500;
  await db.query("INSERT INTO monitor_incidents (check_key, severity, message, opened_at, resolved_at) VALUES ('schijf', 'warn', 'oud', $1, $1)", [new Date(clock - 400 * 24 * HOUR)]);
  await monitor.run();
  assert.deepEqual(await db.query("SELECT id FROM monitor_incidents WHERE message = 'oud'"), []);
});
