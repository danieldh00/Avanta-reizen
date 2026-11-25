/**
 * Testhulp (geen tests): start de echte app in een eigen schema met ingelogde gebruikers en geeft functies om de
 * JSON-API onder `/app/api` aan te roepen. Gedeeld door de tests van de API-routes van de modules.
 */
const { createDatabase } = require('../../src/database/db');
const { createApp } = require('../../src/server');
const { hashPassword } = require('../../src/crm/passwords');
const { COOKIE_NAME } = require('../../src/crm/auth');

const PASSWORD = 'een heel goed wachtwoord';

/** Standaard gebruikers: twee met recht `content` en twee zonder. */
const DEFAULT_USERS = { redactie: 'redacteur', redactie2: 'redacteur', leider: 'reisleider', boekhouding: 'boekhouding' };

/**
 * Voegt een verbindingsoptie toe die het zoekpad op het testschema zet.
 * @param {string} url Verbindings-URL.
 * @param {string} schema Schema.
 * @returns {string} URL met `options=-c search_path=…`.
 */
function withSchema(url, schema) {
  const parsed = new URL(url);
  parsed.searchParams.set('options', `-c search_path=${schema}`);
  return parsed.toString();
}

/**
 * Start de app met een leeg schema, maakt de gebruikers en logt ze in.
 * @param {{url: string, schema: string, testContext: any, users?: Record<string, string>, appOptions?: any}} options
 *   Database, naam van het schema, de testcontext (om af te sluiten), gebruikers (naam → rol) en extra opties voor de app.
 * @returns {Promise<any>} `db`, `base`, `cookies` (per naam), `call`, `as(cookie)`, `audits(actie)`, `checkAccess` en
 *   `checkPreload`.
 */
async function startApiApp(options) {
  const admin = createDatabase(options.url);
  await admin.query(`DROP SCHEMA IF EXISTS ${options.schema} CASCADE`);
  await admin.query(`CREATE SCHEMA ${options.schema}`);
  await admin.close();
  const db = createDatabase(withSchema(options.url, options.schema));
  await db.migrate();
  const app = createApp({ db, masterKey: Buffer.alloc(32, 45), ...options.appOptions });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  options.testContext.after(async () => { server.close(); await db.close(); });

  const hash = await hashPassword(PASSWORD);
  /** @type {Record<string, string>} */
  const cookies = {};
  for (const [name, role] of Object.entries(options.users || DEFAULT_USERS)) {
    const email = `${name}@example.nl`;
    await db.query('INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)', [email, name, role, hash]);
    const response = await fetch(`${base}/app/inloggen/`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, password: PASSWORD }).toString(), redirect: 'manual' });
    cookies[name] = response.headers.getSetCookie().find((value) => value.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  }

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

  /**
   * Functies voor één gebruiker.
   * @param {string} cookie Sessiecookie.
   * @returns {any} `get`, `post`, `put`, `delete`.
   */
  const as = (cookie) => ({
    get: (path) => call('GET', path, { cookie }),
    post: (path, body) => call('POST', path, { cookie, body }),
    put: (path, body) => call('PUT', path, { cookie, body }),
    delete: (path) => call('DELETE', path, { cookie }),
  });

  /**
   * Aantal regels in de audit met een actie.
   * @param {string} action Actie.
   * @returns {Promise<number>} Aantal.
   */
  const audits = async (action) => (await db.query('SELECT count(*)::int AS count FROM audit_log WHERE action = $1', [action]))[0].count;

  /**
   * Controleert dat elke route zonder sessie 401 geeft en zonder recht 403.
   * @param {Array<[string, string]>} requests Methode en pad.
   * @param {string[]} withoutRight Namen van gebruikers zonder het recht.
   * @param {any} assert `node:assert/strict`.
   * @returns {Promise<void>} Klaar.
   */
  const checkAccess = async (requests, withoutRight, assert) => {
    for (const [method, path] of requests) {
      const body = method === 'POST' || method === 'PUT' ? {} : undefined;
      assert.equal((await call(method, path, { body })).status, 401, `${method} ${path}`);
      for (const name of withoutRight) {
        const response = await call(method, path, { cookie: cookies[name], body });
        assert.equal(response.status, 403, `${name}: ${method} ${path}`);
        assert.equal(response.body.fout.code, 'geen-toegang');
      }
    }
  };

  /**
   * Controleert dat een scherm in Vue de antwoorden van zijn eerste GET-verzoeken meestuurt in de pagina
   * (`data-voorgeladen`), precies gelijk aan wat de API op die paden teruggeeft.
   * @param {string} pagePath Pad van de pagina (`/app/…/`).
   * @param {string} cookie Sessiecookie.
   * @param {string[]} apiPaths Paden binnen `/app/api` die voorgeladen moeten zijn.
   * @param {any} assert `node:assert/strict`.
   * @returns {Promise<Record<string, any>>} De voorgeladen antwoorden.
   */
  const checkPreload = async (pagePath, cookie, apiPaths, assert) => {
    const page = await (await fetch(`${base}${pagePath}`, { headers: { cookie } })).text();
    const preloaded = readPreloaded(page);
    assert.deepEqual(Object.keys(preloaded).sort(), [...apiPaths].sort(), pagePath);
    for (const apiPath of apiPaths) {
      const response = await call('GET', apiPath, { cookie });
      assert.equal(response.status, 200, apiPath);
      assert.deepEqual(preloaded[apiPath], response.body, `${pagePath}: ${apiPath} gelijk aan de API`);
    }
    return preloaded;
  };

  return { db, base, cookies, call, as, audits, checkAccess, checkPreload };
}

/**
 * Leest de voorgeladen antwoorden uit de HTML van een pagina (attribuut `data-voorgeladen` van `#crm-app`).
 * @param {string} page HTML van de pagina.
 * @returns {Record<string, any>} Antwoorden per pad; leeg zonder attribuut.
 */
function readPreloaded(page) {
  const match = page.match(/<div id="crm-app"[^>]* data-voorgeladen="([^"]*)"/);
  if (!match) return {};
  const entities = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
  return JSON.parse(match[1].replace(/&(amp|lt|gt|quot|#39);/g, (entity) => entities[entity]));
}

module.exports = { startApiApp, readPreloaded };
