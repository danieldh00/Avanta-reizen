/**
 * Tests van het API-fundament onder `/app/api/` (`src/api/`): foutformaat, invoer via het schema, de bescherming
 * tegen andere sites (vaste kop, herkomst, inhoudssoort), JSON in plaats van doorverwijzingen bij 401/403, een
 * onbekend pad, een onverwachte fout met foutcode, onderhoud (503) en de limiet (429), en `GET /app/api/sessie/` in de
 * echte app met een sessie.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createApiRouter, JSON_LIMIT } = require('../src/api/router');
const { sendApiError, API_ERRORS } = require('../src/api/errors');
const { z, parseInput, fieldMessages, idParam } = require('../src/api/schema');
const { createApiGuard, API_HEADER } = require('../src/api/guard');
const { maintenanceGuard } = require('../src/system/maintenance');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { hashPassword } = require('../src/crm/passwords');
const { COOKIE_NAME } = require('../src/crm/auth');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'api_test';
const PASSWORD = 'een heel goed wachtwoord';
const API = { [API_HEADER]: '1' };

/**
 * Start een kleine app met alleen de API-router en een nagebootste sessie (kop `x-test-rol`), voor de tests zonder
 * database.
 * @param {Array<(context: any) => any>} modules API-fabrieken.
 * @param {{errors?: any[]}} [log] Verzamelt de regels van het logboek.
 * @returns {Promise<{base: string, close: () => void}>} Adres en stopfunctie.
 */
async function startApiApp(modules, log = { errors: [] }) {
  const app = express();
  app.use((req, res, next) => {
    const role = req.get('x-test-rol');
    req.user = role ? { id: 1, name: 'Test', email: 'test@example.nl', role } : null;
    req.pending = req.get('x-test-halve-sessie') ? { step: 'code' } : null;
    next();
  });
  const auth = { pendingPath: (req) => (req.pending ? '/app/inloggen/code/' : '') };
  const appLog = { error: (...entry) => log.errors.push(entry) };
  app.use('/app/api', createApiRouter({ auth, appLog, modules, multipartPaths: [/^\/upload\/$/] }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

/**
 * Doet een verzoek en leest het antwoord als JSON.
 * @param {string} url Adres.
 * @param {RequestInit} [init] Opties voor fetch.
 * @returns {Promise<{status: number, body: any, headers: Headers}>} Status, JSON en koppen.
 */
async function call(url, init = {}) {
  const response = await fetch(url, { redirect: 'manual', ...init });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
}

/** Een module voor de tests: lezen met een recht, schrijven met een schema, een fout en een upload. */
const testModule = (context) => {
  const router = express.Router();
  router.get('/proef/', context.requireRight('content'), (req, res) => res.json({ ok: true }));
  router.get('/proef/alles/', context.requireGlobalRight('aanmeldingen'), (req, res) => res.json({ ok: true }));
  router.post('/proef/', context.requireRight('content'), context.validate(z.object({ titel: z.string().trim().min(1, 'Vul een titel in.').max(20) }).strict()), (req, res) => res.status(201).json({ titel: req.input.titel }));
  router.get('/proef/fout/', context.requireLogin, () => { throw new Error('kapot'); });
  router.post('/upload/', context.requireLogin, (req, res) => res.json({ ok: true }));
  return router;
};

test('foutformaat: vaste code, status en melding; extra velden alleen als ze er zijn', () => {
  /** @type {any} */
  const captured = {};
  const res = {
    status(code) { captured.status = code; return this; },
    set(name, value) { captured[name] = value; return this; },
    json(body) { captured.body = body; return this; },
  };
  sendApiError(res, 'geen-toegang');
  assert.equal(captured.status, 403);
  assert.equal(captured['Cache-Control'], 'no-store');
  assert.deepEqual(captured.body, { fout: { code: 'geen-toegang', melding: API_ERRORS['geen-toegang'].message } });
  sendApiError(res, 'fout', { errorCode: 'abcd1234', message: 'Eigen tekst.', fields: { titel: 'Te lang.' }, loginPath: '/app/inloggen/' });
  assert.deepEqual(captured.body, { fout: { code: 'fout', melding: 'Eigen tekst.', velden: { titel: 'Te lang.' }, foutcode: 'abcd1234', naar: '/app/inloggen/' } });
});

test('schema: gecontroleerde waarden of één melding per veld', () => {
  const schema = z.object({ titel: z.string().min(2, 'Te kort.'), vertrek: z.object({ datum: z.string() }) }).strict();
  assert.deepEqual(parseInput(schema, { titel: 'Reis', vertrek: { datum: '2027-01-01' } }), { ok: true, data: { titel: 'Reis', vertrek: { datum: '2027-01-01' } } });
  const result = parseInput(schema, { titel: 'R', extra: 1 });
  assert.equal(result.ok, false);
  assert.equal(result.fields.titel, 'Te kort.');
  assert.ok(result.fields['vertrek'], 'ontbrekend veld');
  assert.ok(result.fields._, 'onbekend veld op het geheel');
  assert.deepEqual(fieldMessages([{ path: ['a'], message: 'eerste' }, { path: ['a'], message: 'tweede' }]), { a: 'eerste' });
  assert.equal(idParam.safeParse('12').data, 12);
  for (const wrong of ['0', '-1', '1.5', 'abc', '99999999999']) assert.equal(idParam.safeParse(wrong).success, false, wrong);
});

test('bescherming: alleen met de vaste kop, van deze site en met JSON bij schrijven', () => {
  const guard = createApiGuard({ multipartPaths: [/^\/upload\/$/] });
  /**
   * Draait de bescherming op een nagebootst verzoek.
   * @param {{method?: string, path?: string, headers?: Record<string, string>, type?: string}} request Verzoek.
   * @returns {{passed: boolean, status?: number, code?: string, cache?: string}} Uitkomst.
   */
  const run = (request) => {
    const headers = { ...request.headers };
    const req = {
      method: request.method || 'GET', path: request.path || '/x/', protocol: 'http',
      get: (name) => (name === 'host' ? 'localhost' : headers[name.toLowerCase()]),
      is: (type) => request.type === type,
    };
    /** @type {any} */
    const outcome = { passed: false };
    const res = {
      status(code) { outcome.status = code; return this; },
      set(name, value) { if (name === 'Cache-Control') outcome.cache = value; return this; },
      json(body) { outcome.code = body.fout.code; return this; },
    };
    guard(req, res, () => { outcome.passed = true; });
    return outcome;
  };
  assert.deepEqual(run({ headers: API }), { passed: true, cache: 'no-store' });
  assert.equal(run({}).code, 'geweigerd', 'zonder kop');
  assert.equal(run({ headers: { [API_HEADER]: 'ja' } }).code, 'geweigerd', 'andere waarde');
  assert.equal(run({ headers: { ...API, 'sec-fetch-site': 'cross-site' } }).code, 'geweigerd');
  assert.equal(run({ headers: { ...API, origin: 'https://evil.example' } }).code, 'geweigerd');
  assert.equal(run({ headers: { ...API, origin: 'http://localhost' } }).passed, true);
  const body = { ...API, 'content-length': '10' };
  assert.equal(run({ method: 'POST', headers: body, type: 'application/json' }).passed, true);
  assert.equal(run({ method: 'POST', headers: body, type: 'application/x-www-form-urlencoded' }).status, 415);
  assert.equal(run({ method: 'PUT', headers: { ...API, 'transfer-encoding': 'chunked' }, type: 'text/plain' }).status, 415);
  assert.equal(run({ method: 'POST', headers: body, type: 'multipart/form-data' }).status, 415, 'upload niet op dit pad');
  assert.equal(run({ method: 'POST', path: '/upload/', headers: body, type: 'multipart/form-data' }).passed, true);
  assert.equal(run({ method: 'DELETE', headers: API }).passed, true, 'zonder inhoud');
});

test('onderhoud: een schrijfverzoek aan de API krijgt 503 in het foutformaat', () => {
  const guard = maintenanceGuard(() => ({ active: true, source: 'update', message: 'Er wordt bijgewerkt.' }));
  /** @type {any} */
  const outcome = {};
  const res = {
    set() { return this; },
    status(code) { outcome.status = code; return this; },
    json(body) { outcome.body = body; return this; },
    send() { outcome.html = true; return this; },
  };
  guard({ method: 'POST', path: '/APP/api/faq/' }, res, () => { outcome.next = true; });
  assert.equal(outcome.status, 503);
  assert.deepEqual(outcome.body, { fout: { code: 'onderhoud', melding: 'Er wordt bijgewerkt.' } });
  guard({ method: 'GET', path: '/app/api/faq/' }, res, () => { outcome.next = true; });
  assert.equal(outcome.next, true, 'lezen blijft werken');
});

test('API-router met een module: rechten, invoer, fouten en grenzen', async (testContext) => {
  const log = { errors: [] };
  const app = await startApiApp([testModule], log);
  testContext.after(app.close);
  const json = (body, headers = {}) => ({ method: 'POST', headers: { ...API, 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

  let response = await call(`${app.base}/app/api/proef/`, { headers: API });
  assert.equal(response.status, 401, 'zonder sessie: 401, geen doorverwijzing');
  assert.deepEqual(response.body.fout, { code: 'niet-ingelogd', melding: 'Log opnieuw in.', naar: '/app/inloggen/' });
  response = await call(`${app.base}/app/api/proef/`, { headers: { ...API, 'x-test-halve-sessie': '1' } });
  assert.equal(response.body.fout.naar, '/app/inloggen/code/', 'halve sessie: naar de tweede stap');
  response = await call(`${app.base}/app/api/proef/`, { headers: { ...API, 'x-test-rol': 'boekhouding' } });
  assert.equal(response.status, 403);
  assert.equal(response.body.fout.code, 'geen-toegang');
  response = await call(`${app.base}/app/api/proef/`, { headers: { ...API, 'x-test-rol': 'redacteur' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  response = await call(`${app.base}/app/api/proef/alles/`, { headers: { ...API, 'x-test-rol': 'reisleider' } });
  assert.equal(response.status, 403, 'recht alleen voor eigen vertrekken telt niet als globaal recht');
  response = await call(`${app.base}/app/api/proef/alles/`, { headers: { ...API, 'x-test-rol': 'kantoor' } });
  assert.equal(response.status, 200);

  const editor = { 'x-test-rol': 'redacteur' };
  response = await call(`${app.base}/app/api/proef/`, json({ titel: '  Noorwegen ' }, editor));
  assert.equal(response.status, 201);
  assert.deepEqual(response.body, { titel: 'Noorwegen' });
  response = await call(`${app.base}/app/api/proef/`, json({ titel: '', extra: true }, editor));
  assert.equal(response.status, 400);
  assert.equal(response.body.fout.code, 'ongeldig');
  assert.equal(response.body.fout.velden.titel, 'Vul een titel in.');
  assert.ok(response.body.fout.velden._);
  response = await call(`${app.base}/app/api/proef/`, json('{"titel":', editor));
  assert.equal(response.status, 400);
  assert.equal(response.body.fout.melding, 'Het verzoek is geen geldige JSON.');
  response = await call(`${app.base}/app/api/proef/`, json(JSON.stringify({ titel: 'x'.repeat(70 * 1024) }), editor));
  assert.equal(response.status, 413, `grens ${JSON_LIMIT}`);
  response = await call(`${app.base}/app/api/proef/`, { method: 'POST', headers: { ...API, ...editor, 'content-type': 'application/x-www-form-urlencoded' }, body: 'titel=x' });
  assert.equal(response.status, 415, 'een gewoon formulier van een andere site komt er niet door');
  response = await call(`${app.base}/app/api/proef/`, { method: 'POST', headers: { ...editor, 'content-type': 'application/json' }, body: '{"titel":"x"}' });
  assert.equal(response.status, 403, 'zonder vaste kop');

  const upload = new FormData();
  upload.append('bestand', new Blob(['x']), 'x.txt');
  response = await call(`${app.base}/app/api/upload/`, { method: 'POST', headers: { ...API, ...editor }, body: upload });
  assert.equal(response.status, 200, 'upload op een toegestaan pad');

  response = await call(`${app.base}/app/api/proef/fout/`, { headers: { ...API, ...editor } });
  assert.equal(response.status, 500);
  assert.match(response.body.fout.foutcode, /^[0-9a-f]{8}$/);
  assert.equal(log.errors.length, 1);
  assert.equal(log.errors[0][0], 'fout');
  assert.equal(log.errors[0][2].errorCode, response.body.fout.foutcode);

  response = await call(`${app.base}/app/api/bestaat-niet/`, { headers: API });
  assert.equal(response.status, 404);
  assert.equal(response.body.fout.code, 'niet-gevonden');
});

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

test('API in de echte app: sessie, rechten, onbekend pad en limiet', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (testContext) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  const app = createApp({ db, masterKey: Buffer.alloc(32, 44) });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  testContext.after(async () => { server.close(); await db.close(); });
  await db.query('INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)', ['redacteur@example.nl', 'Rita Redacteur', 'redacteur', await hashPassword(PASSWORD)]);
  const login = await fetch(`${base}/app/inloggen/`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: 'redacteur@example.nl', password: PASSWORD }).toString(), redirect: 'manual' });
  const cookie = login.headers.getSetCookie().find((value) => value.startsWith(`${COOKIE_NAME}=`)).split(';')[0];

  let response = await call(`${base}/app/api/sessie/`, { headers: API });
  assert.equal(response.status, 401);
  response = await call(`${base}/app/api/sessie/`, { headers: { ...API, cookie } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('content-security-policy'), require('../src/server').BASE_CSP);
  assert.deepEqual(response.body.gebruiker, { naam: 'Rita Redacteur', rol: 'redacteur', rolNaam: 'Redacteur' });
  assert.ok(response.body.rechten.includes('content'));
  assert.ok(!response.body.rechten.includes('systeem'));
  assert.ok(!JSON.stringify(response.body).includes('redacteur@example.nl'), 'geen e-mailadres in het antwoord');
  response = await call(`${base}/app/api/sessie/`, { headers: { cookie } });
  assert.equal(response.status, 403, 'een gewone link naar de API werkt niet');
  response = await call(`${base}/app/api/onbekend/`, { headers: { ...API, cookie } });
  assert.equal(response.status, 404);
  assert.equal(response.body.fout.code, 'niet-gevonden', 'JSON, niet de 404-pagina van het CRM');

  // De algemene limiet van het CRM (300 per minuut) geeft op de API een antwoord in het foutformaat.
  let attempts = 0;
  do {
    response = await call(`${base}/app/api/sessie/`, { headers: API });
    attempts += 1;
  } while (response.status !== 429 && attempts < 310);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
  assert.equal(response.body.fout.code, 'te-veel');
});
