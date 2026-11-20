/**
 * Tests voor de kopie naar Google Drive (pakket C2), met een nep-Google in het geheugen: koppelen (eenmalige state,
 * scope drive.file, terugkeeradres uit het basisadres), synchroniseren (uploaden, bewaartermijn op Drive, alleen eigen
 * back-ups), opnieuw koppelen na een ingetrokken token, ontkoppelen, downloaden en Beheer (rechten, CSRF, terugkeer
 * zonder sessie, audit, nooit tokens in de pagina). De databasetests draaien in een eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { createDrive, GOOGLE, SCOPE } = require('../src/backup/drive');
const { COOKIE_NAME } = require('../src/crm/auth');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'drive_test';
const SETUP_CODE = 'ABCDE-FGHJK-LMNPQ-RSTUV';
const ADMIN_PASSWORD = 'correct paard batterij';
const CLIENT_ID = '123456789012-abcdefghij0123456789.apps.googleusercontent.com';

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

/**
 * Een tijdelijke map die na de test wordt opgeruimd.
 * @param {object} t Testcontext.
 * @returns {string} Pad.
 */
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avanta-drive-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Een nep-Google Drive: OAuth, mappen en bestanden in het geheugen.
 * @returns {{fetchImpl: Function, files: Map, calls: string[], state: object}} Nep-fetch en de inhoud.
 */
function fakeGoogle() {
  const files = new Map();
  const calls = [];
  const state = { refreshTokens: new Set(), revoked: [], nextId: 1, down: false };
  const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push(`${method} ${url}`);
    if (state.down) throw new Error('offline');
    const parsed = new URL(url);
    if (url === GOOGLE.token) {
      const form = new URLSearchParams(init.body);
      if (form.get('client_secret') !== 'goed-secret') return json({ error: 'invalid_client' }, 401);
      if (form.get('grant_type') === 'authorization_code') {
        if (form.get('code') !== 'goede-code') return json({ error: 'invalid_grant' }, 400);
        state.refreshTokens.add('refresh-geheim-1');
        return json({ access_token: 'toegang-1', refresh_token: 'refresh-geheim-1', expires_in: 3600 });
      }
      if (!state.refreshTokens.has(form.get('refresh_token'))) return json({ error: 'invalid_grant' }, 400);
      return json({ access_token: 'toegang-2', expires_in: 3600 });
    }
    if (url === GOOGLE.revoke) {
      const token = new URLSearchParams(init.body).get('token');
      if (!state.refreshTokens.has(token)) return json({ error: 'invalid_token' }, 400);
      state.revoked.push(token);
      state.refreshTokens.delete(token);
      return new Response('', { status: 200 });
    }
    if (!/^Bearer toegang-\d$/.test(init.headers && init.headers.authorization)) return json({ error: { message: 'unauthorized' } }, 401);
    if (parsed.pathname === '/drive/v3/about') return json({ user: { emailAddress: 'kantoor@example.nl' } });
    if (parsed.pathname === '/upload/drive/v3/files' && method === 'POST') {
      const meta = JSON.parse(init.body);
      const id = `upload${state.nextId++}`;
      files.set(id, { ...meta, pending: true });
      return new Response('', { status: 200, headers: { location: `${GOOGLE.upload}/files?uploadType=resumable&upload_id=${id}` } });
    }
    if (parsed.pathname === '/upload/drive/v3/files' && method === 'PUT') {
      const id = parsed.searchParams.get('upload_id');
      const bytes = Buffer.from(await new Response(init.body).arrayBuffer());
      const file = files.get(id);
      files.set(id, { name: file.name, parents: file.parents, bytes, size: bytes.length });
      return json({ id });
    }
    const fileMatch = /^\/drive\/v3\/files\/([\w-]+)$/.exec(parsed.pathname);
    if (fileMatch) {
      const file = files.get(fileMatch[1]);
      if (!file) return json({ error: { message: 'not found' } }, 404);
      if (method === 'DELETE') {
        files.delete(fileMatch[1]);
        return new Response(null, { status: 204 });
      }
      if (parsed.searchParams.get('alt') === 'media') return new Response(file.bytes);
      return json({ id: fileMatch[1], trashed: false });
    }
    if (parsed.pathname === '/drive/v3/files' && method === 'POST') {
      const meta = JSON.parse(init.body);
      const id = `map${state.nextId++}`;
      files.set(id, { ...meta });
      return json({ id });
    }
    if (parsed.pathname === '/drive/v3/files') {
      const query = parsed.searchParams.get('q');
      const parent = /^'([\w-]+)' in parents/.exec(query);
      const result = [...files.entries()]
        .filter(([, file]) => (parent ? (file.parents || []).includes(parent[1]) && !file.pending : file.mimeType && query.includes(`name = '${file.name}'`)))
        .map(([id, file]) => ({ id, name: file.name, size: String(file.size || 0) }));
      return json({ files: result });
    }
    return json({ error: { message: `onbekend: ${method} ${url}` } }, 404);
  };
  return { fetchImpl, files, calls, state };
}

/**
 * Nep-instellingen met `update` (voor de koppeling zonder database).
 * @param {object} values Afwijkende waarden.
 * @returns {object} Instellingen.
 */
function fakeSettings(values = {}) {
  const all = {
    driveEnabled: true, driveClientId: CLIENT_ID, driveClientSecret: 'goed-secret', driveFolderName: 'Avanta back-ups', driveKeepCount: 2,
    driveRefreshToken: '', siteUrl: 'https://avanta.example.nl', ...values,
  };
  const audits = [];
  return {
    audits,
    get: (key) => all[key],
    ready: async () => {},
    update: async (patch, context = {}) => {
      Object.assign(all, patch.values || {});
      for (const key of patch.clear || []) all[key] = '';
      if (context.inTransaction) await context.inTransaction({ query: async () => [] }, Object.keys(patch.values || {}));
    },
  };
}

/**
 * Zet nep-back-ups in een map.
 * @param {string} dir Map.
 * @param {string[]} stamps Tijdstempels `JJJJMMDD-UUMMSS`.
 * @returns {void}
 */
function writeBackups(dir, stamps) {
  for (const stamp of stamps) fs.writeFileSync(path.join(dir, `avanta-${stamp}.dump.enc`), `inhoud ${stamp}`);
}

test('Drive: koppelen met eenmalige state', async (t) => {
  const google = fakeGoogle();
  const settings = fakeSettings();
  const audits = [];
  const drive = createDrive({ settings, dir: tempDir(t), fetchImpl: google.fetchImpl, audit: (entry) => audits.push(entry) });
  assert.equal(drive.redirectUri(), 'https://avanta.example.nl/app/beheer/google-drive/terug/');
  assert.equal(drive.connected(), false);
  assert.throws(() => createDrive({ settings: fakeSettings({ driveClientSecret: '' }), dir: tempDir(t) }).startAuthorization(1), /client-ID en het client-secret/);

  const url = new URL(drive.startAuthorization(7));
  assert.equal(url.origin + url.pathname, GOOGLE.authorize);
  assert.equal(url.searchParams.get('scope'), SCOPE);
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('redirect_uri'), drive.redirectUri());
  const state = url.searchParams.get('state');
  assert.ok(state.length >= 32);

  await assert.rejects(drive.finishAuthorization({ state: 'verzonnen', code: 'goede-code' }), /onbekend of verlopen/);
  const result = await drive.finishAuthorization({ state, code: 'goede-code' });
  assert.deepEqual(result, { userId: 7, account: 'kantoor@example.nl' });
  assert.equal(settings.get('driveRefreshToken'), 'refresh-geheim-1');
  assert.deepEqual(audits, [{ userId: 7, action: 'drive.gekoppeld' }]);
  assert.equal(drive.connected(), true);
  await assert.rejects(drive.finishAuthorization({ state, code: 'goede-code' }), /onbekend of verlopen/, 'state is eenmalig');

  const refused = new URL(drive.startAuthorization(7)).searchParams.get('state');
  await assert.rejects(drive.finishAuthorization({ state: refused, error: 'access_denied' }), /geen toestemming/);
  const badCode = new URL(drive.startAuthorization(7)).searchParams.get('state');
  await assert.rejects(drive.finishAuthorization({ state: badCode, code: 'fout' }), /koppel opnieuw/);

  let clock = Date.now();
  const timed = createDrive({ settings, dir: tempDir(t), fetchImpl: google.fetchImpl, now: () => clock });
  const expired = new URL(timed.startAuthorization(7)).searchParams.get('state');
  clock += 16 * 60 * 1000;
  await assert.rejects(timed.finishAuthorization({ state: expired, code: 'goede-code' }), /verlopen/);
});

test('Drive: synchroniseren, bewaartermijn, opnieuw koppelen en ontkoppelen', async (t) => {
  const google = fakeGoogle();
  google.state.refreshTokens.add('refresh-geheim-1');
  const settings = fakeSettings({ driveRefreshToken: 'refresh-geheim-1' });
  const dir = tempDir(t);
  const drive = createDrive({ settings, dir, fetchImpl: google.fetchImpl });
  writeBackups(dir, ['20261118-020000', '20261119-020000', '20261120-020000']);

  const first = await drive.sync();
  assert.deepEqual(first.uploaded, ['avanta-20261119-020000.dump.enc', 'avanta-20261120-020000.dump.enc'], 'alleen de nieuwste twee');
  assert.deepEqual(first.removed, []);
  const folder = [...google.files.entries()].find(([, file]) => file.mimeType === 'application/vnd.google-apps.folder');
  assert.equal(folder[1].name, 'Avanta back-ups');
  assert.equal(drive.state().folderId, folder[0]);
  const uploaded = [...google.files.values()].filter((file) => file.bytes);
  assert.deepEqual(uploaded.map((file) => file.bytes.toString()).sort(), ['inhoud 20261119-020000', 'inhoud 20261120-020000']);
  assert.ok(uploaded.every((file) => file.parents[0] === folder[0]));

  assert.deepEqual(await drive.sync(), { uploaded: [], removed: [] }, 'niets nieuws');
  // Een bestand van iemand anders in de map blijft staan; de oudste back-up gaat weg.
  google.files.set('vreemd', { name: 'notities.txt', parents: [folder[0]], bytes: Buffer.from('x'), size: 1 });
  writeBackups(dir, ['20261121-020000']);
  const second = await drive.sync();
  assert.deepEqual(second.uploaded, ['avanta-20261121-020000.dump.enc']);
  assert.deepEqual(second.removed, ['avanta-20261119-020000.dump.enc']);
  assert.ok(google.files.has('vreemd'));

  // Downloaden (voor de hersteltest van de Drive-kopie).
  const target = path.join(dir, 'terug.enc');
  assert.deepEqual(await drive.download('avanta-20261121-020000.dump.enc', target), { name: 'avanta-20261121-020000.dump.enc', size: 22 });
  assert.equal(fs.readFileSync(target, 'utf8'), 'inhoud 20261121-020000');
  await assert.rejects(drive.download('avanta-20261119-020000.dump.enc', path.join(dir, 'x')), /staat niet op Google Drive/);
  assert.deepEqual((await drive.listRemote()).map((file) => file.name), ['avanta-20261121-020000.dump.enc', 'avanta-20261120-020000.dump.enc']);

  // De map is weggegooid: een nieuwe map en alles opnieuw.
  google.files.delete(folder[0]);
  for (const [id, file] of google.files) if (file.parents) google.files.delete(id);
  const third = await drive.sync();
  assert.equal(third.uploaded.length, 2);

  // Token ingetrokken bij Google: opnieuw koppelen nodig, de planner wacht.
  google.state.refreshTokens.clear();
  const fresh = createDrive({ settings, dir, fetchImpl: google.fetchImpl });
  await assert.rejects(fresh.sync(), /koppel opnieuw/);
  assert.equal(fresh.state().needsReconnect, true);
  assert.equal(await fresh.syncIfDue(), null);
  assert.ok(JSON.stringify(fs.readFileSync(path.join(dir, 'drive-state.json'), 'utf8')).indexOf('refresh-geheim') === -1, 'geen token in de stand');

  // Google onbereikbaar: fout vastgelegd, de planner wacht een kwartier.
  google.state.refreshTokens.add('refresh-geheim-1');
  let clock = Date.now();
  const timed = createDrive({ settings, dir, fetchImpl: google.fetchImpl, now: () => clock });
  google.state.down = true;
  await assert.rejects(timed.sync(), /niet bereikbaar/);
  google.state.down = false;
  const stateFile = path.join(dir, 'drive-state.json');
  const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  fs.writeFileSync(stateFile, JSON.stringify({ ...saved, needsReconnect: false }));
  clock += 5 * 60 * 1000;
  assert.equal(await timed.syncIfDue(), null, 'binnen een kwartier na een fout');
  clock += 11 * 60 * 1000;
  assert.ok(await timed.syncIfDue(), 'daarna opnieuw');

  // Uit of niet gekoppeld: niets.
  assert.deepEqual(await createDrive({ settings: fakeSettings({ driveEnabled: false, driveRefreshToken: 'x' }), dir, fetchImpl: google.fetchImpl }).sync(), { skipped: 'uit' });
  assert.deepEqual(await createDrive({ settings: fakeSettings(), dir, fetchImpl: google.fetchImpl }).sync(), { skipped: 'niet gekoppeld' });

  await timed.disconnect(3);
  assert.deepEqual(google.state.revoked, ['refresh-geheim-1']);
  assert.equal(settings.get('driveRefreshToken'), '');
  assert.equal(timed.state().account, '');
});

/**
 * Een nep-Google waarvan de volgende upload (PUT) wacht tot `release()` wordt aangeroepen.
 * @returns {{google: object, fetchImpl: Function, started: Promise<void>, release: Function}} Nep-Google met een rem.
 */
function blockingGoogle() {
  const google = fakeGoogle();
  let release;
  let markStarted;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { markStarted = resolve; });
  let blocked = false;
  const fetchImpl = async (url, init = {}) => {
    if (!blocked && init.method === 'PUT') {
      blocked = true;
      markStarted();
      await gate;
    }
    return google.fetchImpl(url, init);
  };
  return { google, fetchImpl, started, release };
}

test('Drive: gelijktijdig synchroniseren, ontkoppelen en opnieuw koppelen', async (t) => {
  // Een nieuwe back-up tijdens een lopende ronde gaat in een extra ronde direct mee.
  const first = blockingGoogle();
  first.google.state.refreshTokens.add('refresh-geheim-1');
  const dir = tempDir(t);
  const drive = createDrive({ settings: fakeSettings({ driveRefreshToken: 'refresh-geheim-1', driveKeepCount: 5 }), dir, fetchImpl: first.fetchImpl });
  writeBackups(dir, ['20261119-020000']);
  const running = drive.sync();
  await first.started;
  writeBackups(dir, ['20261120-020000']);
  const followUp = drive.sync();
  assert.equal(drive.sync(), followUp, 'nog een aanvraag sluit aan bij dezelfde extra ronde');
  first.release();
  assert.deepEqual((await running).uploaded, ['avanta-20261119-020000.dump.enc']);
  assert.deepEqual((await followUp).uploaded, ['avanta-20261120-020000.dump.enc']);
  assert.deepEqual(drive.state().uploaded.map((entry) => entry.name), ['avanta-20261120-020000.dump.enc', 'avanta-20261119-020000.dump.enc']);

  // Ontkoppelen tijdens een lopende ronde: de ronde zet de oude koppeling niet terug.
  const second = blockingGoogle();
  second.google.state.refreshTokens.add('refresh-geheim-1');
  const otherDir = tempDir(t);
  const settings = fakeSettings({ driveRefreshToken: 'refresh-geheim-1' });
  const other = createDrive({ settings, dir: otherDir, fetchImpl: second.fetchImpl });
  writeBackups(otherDir, ['20261120-020000']);
  const syncing = other.sync();
  await second.started;
  await other.disconnect(3);
  second.release();
  await assert.rejects(syncing, /koppeling met Google is intussen gewijzigd/);
  const state = other.state();
  assert.deepEqual([state.folderId, state.account, state.uploaded, state.needsReconnect], ['', '', [], false]);
  assert.match(state.events[0].message, /Ontkoppeld/);

  // Ontkoppelen en opnieuw koppelen tijdens een ronde: de oude ronde doet daarna geen verzoeken meer (geen tweede
  // upload, niets verwijderd) en de nieuwe koppeling blijft in de stand staan.
  const third = blockingGoogle();
  third.google.state.refreshTokens.add('refresh-geheim-1');
  const thirdDir = tempDir(t);
  const relink = createDrive({ settings: fakeSettings({ driveRefreshToken: 'refresh-geheim-1', driveKeepCount: 1 }), dir: thirdDir, fetchImpl: third.fetchImpl });
  writeBackups(thirdDir, ['20261119-020000']);
  const oldRound = relink.sync();
  await third.started;
  writeBackups(thirdDir, ['20261120-020000']);
  await relink.disconnect(3);
  const state3 = new URL(relink.startAuthorization(3)).searchParams.get('state');
  await relink.finishAuthorization({ state: state3, code: 'goede-code' });
  const putsBefore = third.google.calls.filter((call) => call.startsWith('PUT ')).length;
  third.release();
  await assert.rejects(oldRound, /intussen gewijzigd/);
  assert.equal(third.google.calls.filter((call) => call.startsWith('PUT ')).length, putsBefore + 1, 'alleen de al lopende upload');
  assert.equal(third.google.calls.filter((call) => call.startsWith('DELETE ')).length, 0);
  const relinked = relink.state();
  assert.equal(relinked.account, 'kantoor@example.nl');
  assert.deepEqual(relinked.uploaded, []);
  assert.match(relinked.events[0].message, /Gekoppeld/);
  // Een nieuwe ronde met de nieuwe koppeling werkt gewoon.
  assert.deepEqual((await relink.sync()).uploaded, ['avanta-20261120-020000.dump.enc']);
});

test('Drive: één mapzoekactie tegelijk', async (t) => {
  const google = fakeGoogle();
  google.state.refreshTokens.add('refresh-geheim-1');
  const dir = tempDir(t);
  const drive = createDrive({ settings: fakeSettings({ driveRefreshToken: 'refresh-geheim-1' }), dir, fetchImpl: google.fetchImpl });
  writeBackups(dir, ['20261120-020000']);
  await Promise.all([drive.listRemote(), drive.listRemote(), drive.sync()]);
  const folders = [...google.files.values()].filter((file) => file.mimeType === 'application/vnd.google-apps.folder');
  assert.equal(folders.length, 1, 'geen dubbele map op Drive');
});

test('Drive in Beheer', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  const dir = tempDir(t);
  writeBackups(dir, ['20261120-020000']);
  const google = fakeGoogle();
  const app = createApp({ db, masterKey: Buffer.alloc(32, 5), setupCode: SETUP_CODE, backupDir: dir, googleFetch: google.fetchImpl, siteUrl: 'https://avanta.example.nl' });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await db.close(); });

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

  const installed = await request('/app/installatie/', { form: { code: SETUP_CODE, name: 'Daniël', email: 'beheer@example.nl', password: ADMIN_PASSWORD, password2: ADMIN_PASSWORD } });
  const cookie = installed.cookie;
  const csrf = csrfFrom((await request('/app/', { cookie })).text);
  await request('/app/gebruikers/nieuw/', { cookie, form: { _csrf: csrf, name: 'Kantoor', email: 'kantoor@example.nl', role: 'kantoor', password: 'kantoor wachtwoord 1' } });
  const office = await request('/app/inloggen/', { form: { email: 'kantoor@example.nl', password: 'kantoor wachtwoord 1' } });
  const officeCsrf = csrfFrom((await request('/app/', { cookie: office.cookie })).text);

  const page = await request('/app/beheer/google-drive/', { cookie });
  assert.equal(page.status, 200);
  assert.match(page.text, /https:\/\/avanta\.example\.nl\/app\/beheer\/google-drive\/terug\//);
  assert.doesNotMatch(page.text, /Koppelen met Google/, 'zonder client-gegevens geen knop');
  assert.equal((await request('/app/beheer/google-drive/koppelen/', { cookie, form: { _csrf: csrf } })).status, 422);
  for (const action of ['koppelen', 'synchroniseren', 'ontkoppelen']) {
    assert.equal((await request(`/app/beheer/google-drive/${action}/`, { cookie: office.cookie, form: { _csrf: officeCsrf } })).status, 403, action);
    assert.equal((await request(`/app/beheer/google-drive/${action}/`, { cookie, form: { _csrf: 'fout' } })).status, 403, `${action}: CSRF`);
  }
  assert.equal((await request('/app/beheer/google-drive/', { cookie: office.cookie })).status, 403);

  const form = { _csrf: csrf, driveEnabled: 'ja', driveClientId: CLIENT_ID, driveClientSecret: 'goed-secret', driveFolderName: 'Avanta back-ups', driveKeepCount: '30' };
  assert.equal((await request('/app/beheer/google-drive/', { cookie, form: { ...form, driveClientId: 'geen-id' } })).status, 422);
  assert.equal((await request('/app/beheer/google-drive/', { cookie, form: { ...form, driveFolderName: 'a/b' } })).status, 422);
  assert.equal((await request('/app/beheer/google-drive/', { cookie, form })).status, 303);
  assert.equal((await request('/app/beheer/google-drive/synchroniseren/', { cookie, form: { _csrf: csrf } })).status, 422, 'nog niet gekoppeld');

  const start = await request('/app/beheer/google-drive/koppelen/', { cookie, form: { _csrf: csrf } });
  assert.equal(start.status, 200);
  assert.match(start.text, /http-equiv="refresh" content="0; url=https:\/\/accounts\.google\.com/);
  const location = new URL(/href="(https:\/\/accounts\.google\.com[^"]+)"/.exec(start.text)[1].replace(/&amp;/g, '&'));
  assert.equal(location.origin + location.pathname, GOOGLE.authorize);
  const state = location.searchParams.get('state');

  // Terugkeer van Google zonder sessiecookie (SameSite=Strict): alleen de state telt.
  assert.equal((await request('/app/beheer/google-drive/terug/?state=verzonnen&code=goede-code')).status, 400);
  const back = await request(`/app/beheer/google-drive/terug/?state=${encodeURIComponent(state)}&code=goede-code`);
  assert.equal(back.status, 200);
  assert.match(back.text, /http-equiv="refresh" content="1; url=\/app\/beheer\/google-drive\/"/);
  assert.match(back.text, /Gekoppeld met Google Drive \(kantoor@example\.nl\)/);
  assert.equal((await request(`/app/beheer/google-drive/terug/?state=${encodeURIComponent(state)}&code=goede-code`)).status, 400, 'eenmalig');
  const [audit] = await db.query("SELECT u.email FROM audit_log a JOIN users u ON u.id = a.user_id WHERE a.action = 'drive.gekoppeld'");
  assert.equal(audit.email, 'beheer@example.nl');
  const [stored] = await db.query("SELECT value FROM settings WHERE key = 'driveRefreshToken'");
  assert.doesNotMatch(stored.value, /refresh-geheim/, 'versleuteld opgeslagen');

  // De terugkeer startte zelf een ronde; wachten tot die (en een eventuele extra ronde) klaar is.
  await app.locals.drive.sync();
  assert.ok([...google.files.values()].some((file) => file.name === 'avanta-20261120-020000.dump.enc' && file.bytes));
  const synced = await request('/app/beheer/google-drive/synchroniseren/', { cookie, form: { _csrf: csrf } });
  assert.equal(synced.status, 200);
  assert.match(synced.text, /Gesynchroniseerd: 0 geüpload, 0 oude verwijderd/);
  assert.ok([...google.files.values()].some((file) => file.name === 'avanta-20261120-020000.dump.enc' && file.bytes));
  const connectedPage = await request('/app/beheer/google-drive/', { cookie });
  assert.match(connectedPage.text, /Gekoppeld met kantoor@example\.nl/);
  assert.doesNotMatch(connectedPage.text, /refresh-geheim|toegang-|goed-secret/, 'nooit tokens of geheimen in de pagina');
  assert.doesNotMatch((await request('/app/beheer/', { cookie })).text, /Koppeling met Google Drive/, 'het token staat in geen enkel formulier of overzicht');

  // Limiet op Nu synchroniseren: 6 per tien minuten (twee zijn al gebruikt).
  for (let i = 0; i < 4; i += 1) assert.equal((await request('/app/beheer/google-drive/synchroniseren/', { cookie, form: { _csrf: csrf } })).status, 200);
  assert.equal((await request('/app/beheer/google-drive/synchroniseren/', { cookie, form: { _csrf: csrf } })).status, 429);

  // Wie het koppelen begon maar intussen het recht `systeem` kwijt is, kan het niet afronden.
  const pendingStart = await request('/app/beheer/google-drive/koppelen/', { cookie, form: { _csrf: csrf } });
  const pendingState = new URL(/href="(https:\/\/accounts\.google\.com[^"]+)"/.exec(pendingStart.text)[1].replace(/&amp;/g, '&')).searchParams.get('state');
  await db.query("UPDATE users SET role = 'kantoor' WHERE email = 'beheer@example.nl'");
  const refused = await request(`/app/beheer/google-drive/terug/?state=${encodeURIComponent(pendingState)}&code=goede-code`);
  await db.query("UPDATE users SET role = 'beheerder' WHERE email = 'beheer@example.nl'");
  assert.equal(refused.status, 400);
  assert.match(refused.text, /mag \(niet meer\) koppelen/);
  const [linkedAudits] = await db.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'drive.gekoppeld'");
  assert.equal(linkedAudits.count, 1, 'geen tweede koppeling vastgelegd');

  // Intrekken bij Google mislukt: Beheer zegt dat, met de stappen om het zelf te doen.
  google.state.down = true;
  const failedRevoke = await request('/app/beheer/google-drive/ontkoppelen/', { cookie, form: { _csrf: csrf } });
  google.state.down = false;
  assert.equal(failedRevoke.status, 200);
  assert.match(failedRevoke.text, /intrekken bij Google is mislukt.*myaccount\.google\.com\/permissions/);
  assert.match(app.locals.drive.state().events[0].message, /intrekken bij Google is mislukt/);
  assert.equal(app.locals.settings.get('driveRefreshToken'), '');
  // Opnieuw koppelen en dan gewoon ontkoppelen.
  const again = await request('/app/beheer/google-drive/koppelen/', { cookie, form: { _csrf: csrf } });
  const againState = new URL(/href="(https:\/\/accounts\.google\.com[^"]+)"/.exec(again.text)[1].replace(/&amp;/g, '&')).searchParams.get('state');
  assert.equal((await request(`/app/beheer/google-drive/terug/?state=${encodeURIComponent(againState)}&code=goede-code`)).status, 200);
  await app.locals.drive.sync();

  // Het token was bij Google al ingetrokken (400 invalid_token): dat telt als ingetrokken.
  google.state.refreshTokens.clear();
  const removed = await request('/app/beheer/google-drive/ontkoppelen/', { cookie, form: { _csrf: csrf } });
  assert.equal(removed.status, 200);
  assert.match(removed.text, /Ontkoppeld en ingetrokken bij Google/);
  assert.deepEqual(google.state.revoked, [], 'al ingetrokken bij Google');
  assert.ok(google.calls.some((call) => call === `POST ${GOOGLE.revoke}`), 'intrekken wel geprobeerd');
  assert.equal(app.locals.settings.get('driveRefreshToken'), '');
  const [unlinked] = await db.query("SELECT count(*)::int AS count FROM audit_log WHERE action = 'drive.ontkoppeld'");
  assert.equal(unlinked.count, 2);

  // Limiet op de terugkeer van Google: 20 per kwartier per bezoeker.
  let limited = 0;
  for (let i = 0; i < 25 && !limited; i += 1) {
    if ((await request('/app/beheer/google-drive/terug/?state=verzonnen&code=x')).status === 429) limited = i;
  }
  assert.ok(limited > 0, 'na hoogstens 20 pogingen een 429');
});
