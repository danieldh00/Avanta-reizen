/**
 * Tests voor het reizigersaccount (CMS-pakket J2, migratie 23): registreren met bevestigen via link én wachtwoord,
 * inloggen met limieten, uitloggen met CSRF, wachtwoord vergeten en herstellen, meldingen die niet verraden of een adres
 * een account heeft, gescheiden sessies van het CRM, mailbom-limiet, auditlog zonder e-mailadres en het opruimen van
 * onbevestigde accounts. De databasetests draaien in een eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { createAccounts, tokenShapeOk } = require('../src/account/accounts');
const { COOKIE_NAME } = require('../src/account/routes');
const { COOKIE_NAME: CRM_COOKIE } = require('../src/crm/auth');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'account_test';
const MASTER_KEY = Buffer.alloc(32, 23);
const PASSWORD = 'mijn reis naar namibie';

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
 * Wacht tot een voorwaarde waar is (mails gaan op de achtergrond).
 * @param {() => boolean} condition Voorwaarde.
 * @returns {Promise<void>}
 */
async function waitFor(condition) {
  for (let i = 0; i < 100 && !condition(); i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
}

test('tokenvorm: alleen base64url van redelijke lengte', () => {
  assert.equal(tokenShapeOk('a'.repeat(43)), true);
  assert.equal(tokenShapeOk('kort'), false);
  assert.equal(tokenShapeOk('a'.repeat(101)), false);
  assert.equal(tokenShapeOk(`${'a'.repeat(40)}'--`), false);
  assert.equal(tokenShapeOk(['a'.repeat(43)]), false);
});

test('reizigersaccount', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  const sent = [];
  const mailer = { configured: () => true, send: async (message) => { sent.push(message); return {}; }, recent: () => [] };
  let clock = Date.now();
  const app = createApp({ db, masterKey: MASTER_KEY, mailer, now: () => clock });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await db.close(); });

  /**
   * Doet een verzoek; geeft status, tekst en de nieuwe sessiecookie.
   * @param {string} path Pad.
   * @param {{cookie?: string, form?: object, headers?: object, crmCookie?: string}} [init] Cookie, formulier en koppen.
   * @returns {Promise<{status: number, text: string, headers: Headers, cookie: string, location: string}>} Antwoord.
   */
  const request = async (path, init = {}) => {
    const headers = { ...(init.headers || {}) };
    const cookies = [];
    if (init.cookie) cookies.push(`${COOKIE_NAME}=${init.cookie}`);
    if (init.crmCookie) cookies.push(`${CRM_COOKIE}=${init.crmCookie}`);
    if (cookies.length) headers.cookie = cookies.join('; ');
    let body;
    if (init.form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(init.form).toString();
    }
    const response = await fetch(base + path, { method: init.form ? 'POST' : 'GET', headers, body, redirect: 'manual' });
    const setCookie = response.headers.getSetCookie().find((value) => value.startsWith(`${COOKIE_NAME}=`)) || '';
    return { status: response.status, text: await response.text(), headers: response.headers, cookie: setCookie.split(';')[0].split('=')[1] || '', setCookie, location: response.headers.get('location') || '' };
  };

  /**
   * Vult een openbaar formulier in (token van de pagina, honeypot leeg) en verstuurt het na vijf seconden.
   * @param {string} path Pad van het formulier.
   * @param {object} fields Velden.
   * @returns {Promise<object>} Antwoord.
   */
  const submitPublic = async (path, fields) => {
    const page = await request(path);
    const token = (page.text.match(/name="token" value="([^"]+)"/) || [])[1];
    clock += 5000;
    return request(path, { form: { token, website: '', ...fields } });
  };

  /**
   * Het token uit de laatste link in een mail.
   * @param {object} message Mail.
   * @returns {string} Token.
   */
  const linkToken = (message) => decodeURIComponent((message.text.match(/\?token=([A-Za-z0-9_%-]+)/) || [])[1] || '');

  const csrfFrom = (text) => (text.match(/name="_csrf" value="([^"]+)"/) || [])[1];

  await t.test('registreren: onbevestigd account, mail met link; opnieuw registreren maakt de oude link ongeldig', async () => {
    const form = await request('/account/registreren/');
    assert.equal(form.status, 200);
    assert.equal(form.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(form.headers.get('cache-control'), 'no-store');
    assert.match(form.text, /noindex/);
    const weak = await submitPublic('/account/registreren/', { email: 'anna@example.nl', password: 'kort', password2: 'kort' });
    assert.equal(weak.status, 422);
    assert.match(weak.text, /minimaal 12 tekens/);
    const mismatch = await submitPublic('/account/registreren/', { email: 'anna@example.nl', password: PASSWORD, password2: `${PASSWORD}!` });
    assert.equal(mismatch.status, 422);
    const done = await submitPublic('/account/registreren/', { email: 'Anna@Example.nl', password: PASSWORD, password2: PASSWORD });
    assert.equal(done.status, 200);
    assert.match(done.text, /We hebben een mail gestuurd/);
    await waitFor(() => sent.length >= 1);
    assert.equal(sent[0].to, 'anna@example.nl');
    assert.equal(sent[0].kind, 'account-bevestigen');
    const [account] = await db.query('SELECT email, verified_at FROM customer_accounts');
    assert.deepEqual(account, { email: 'anna@example.nl', verified_at: null });
    const firstToken = linkToken(sent[0]);
    assert.ok(firstToken);
    const [original] = await db.query('SELECT password_hash, created_at FROM customer_accounts');
    // Nog eens registreren (onbevestigd, ander wachtwoord): het account blijft gelijk, er komt alleen een nieuwe link.
    clock += 1000;
    await submitPublic('/account/registreren/', { email: 'anna@example.nl', password: 'een ander wachtwoord!', password2: 'een ander wachtwoord!' });
    await waitFor(() => sent.length >= 2);
    assert.match(sent[1].text, /gebruik het wachtwoord van die eerste keer/);
    assert.deepEqual((await db.query('SELECT password_hash, created_at FROM customer_accounts'))[0], original, 'geen nieuw wachtwoord en geen nieuwe opruimtermijn');
    assert.equal((await request(`/account/bevestigen/?token=${encodeURIComponent(firstToken)}`)).status, 200, 'eerste link blijft geldig');
    assert.equal((await db.query('SELECT count(*)::int AS total FROM customer_accounts'))[0].total, 1);
  });

  await t.test('honeypot: dezelfde melding, geen account', async () => {
    const page = await request('/account/registreren/');
    const token = (page.text.match(/name="token" value="([^"]+)"/) || [])[1];
    clock += 5000;
    const bot = await request('/account/registreren/', { form: { token, website: 'spam', email: 'bot@example.nl', password: PASSWORD, password2: PASSWORD } });
    assert.equal(bot.status, 200);
    assert.equal((await db.query("SELECT count(*)::int AS total FROM customer_accounts WHERE email = 'bot@example.nl'"))[0].total, 0);
  });

  await t.test('inloggen vóór bevestigen: weigering alleen met het juiste wachtwoord zichtbaar', async () => {
    const wrong = await request('/account/inloggen/', { form: { email: 'anna@example.nl', password: 'verkeerd wachtwoord!' } });
    assert.equal(wrong.status, 401);
    assert.match(wrong.text, /E-mailadres of wachtwoord klopt niet/);
    const unknown = await request('/account/inloggen/', { form: { email: 'niemand@example.nl', password: PASSWORD } });
    assert.equal(unknown.status, 401);
    assert.match(unknown.text, /E-mailadres of wachtwoord klopt niet/);
    const unverified = await request('/account/inloggen/', { form: { email: 'anna@example.nl', password: PASSWORD } });
    assert.equal(unverified.status, 403);
    assert.match(unverified.text, /Bevestig eerst je e-mailadres/);
    assert.equal(unverified.cookie, '');
  });

  let annaCookie = '';
  await t.test('bevestigen: link plus wachtwoord; verkeerd wachtwoord 401; link werkt één keer', async () => {
    const token = linkToken(sent[1]);
    assert.equal((await request('/account/bevestigen/?token=onzin')).status, 404);
    const page = await request(`/account/bevestigen/?token=${encodeURIComponent(token)}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /Account bevestigen/);
    const wrong = await request('/account/bevestigen/', { form: { token, password: 'een ander wachtwoord!' } });
    assert.equal(wrong.status, 401);
    assert.equal((await db.query('SELECT verified_at FROM customer_accounts'))[0].verified_at, null);
    const ok = await request('/account/bevestigen/', { form: { token, password: PASSWORD } });
    assert.equal(ok.status, 303);
    assert.equal(ok.location, '/account/?welkom=1');
    assert.match(ok.setCookie, /HttpOnly; SameSite=Strict; Secure/);
    assert.match(ok.setCookie, /Path=\/account;/);
    annaCookie = ok.cookie;
    assert.notEqual((await db.query('SELECT verified_at FROM customer_accounts'))[0].verified_at, null);
    assert.equal((await request('/account/bevestigen/', { form: { token, password: PASSWORD } })).status, 404, 'link al gebruikt');
    assert.equal((await request(`/account/bevestigen/?token=${encodeURIComponent(linkToken(sent[0]))}`)).status, 404, 'andere bevestigingslinks vervallen ook');
    const overview = await request('/account/?welkom=1', { cookie: annaCookie });
    assert.equal(overview.status, 200);
    assert.match(overview.text, /Je account is bevestigd/);
    assert.match(overview.text, /anna@example\.nl/);
  });

  await t.test('overzicht zonder sessie naar inloggen; sessies van CRM en reiziger zijn gescheiden', async () => {
    assert.equal((await request('/account/')).location, '/account/inloggen/');
    assert.equal((await request('/account/', { crmCookie: annaCookie })).location, '/account/inloggen/', 'reizigerstoken als CRM-cookie werkt niet op /account/');
    const crm = await request('/app/', { crmCookie: annaCookie });
    assert.equal(crm.status, 303, 'reizigerstoken geeft geen toegang tot het CRM');
    assert.equal(crm.location, '/app/inloggen/');
  });

  await t.test('registreren met een bevestigd adres: zelfde melding, mail met herstellink, wachtwoord ongewijzigd', async () => {
    const [before] = await db.query('SELECT password_hash FROM customer_accounts');
    const count = sent.length;
    clock += 61 * 60 * 1000; // nieuw venster voor de limiet van vijf registraties per uur
    const done = await submitPublic('/account/registreren/', { email: 'anna@example.nl', password: 'een ander wachtwoord', password2: 'een ander wachtwoord' });
    assert.equal(done.status, 200);
    assert.match(done.text, /We hebben een mail gestuurd/);
    await waitFor(() => sent.length > count);
    assert.equal(sent.at(-1).kind, 'account-bestaat');
    assert.match(sent.at(-1).text, /\/account\/wachtwoord-vergeten\//);
    assert.doesNotMatch(sent.at(-1).text, /token=/, 'geen herstellink in deze mail');
    // Vaker registreren met dit adres: hoogstens drie van deze mails per uur, en het quotum voor herstellinks blijft vrij.
    for (let i = 0; i < 3; i += 1) await submitPublic('/account/registreren/', { email: 'anna@example.nl', password: 'een ander wachtwoord', password2: 'een ander wachtwoord' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(sent.filter((message) => message.kind === 'account-bestaat').length, 3);
    assert.equal((await db.query("SELECT count(*)::int AS total FROM customer_tokens WHERE purpose = 'herstellen'"))[0].total, 0);
    assert.equal((await db.query('SELECT password_hash FROM customer_accounts'))[0].password_hash, before.password_hash);
  });

  await t.test('uitloggen: alleen met CSRF-token en van deze site', async () => {
    const login = await request('/account/inloggen/', { form: { email: 'anna@example.nl', password: PASSWORD } });
    assert.equal(login.status, 303);
    const cookie = login.cookie;
    const csrf = csrfFrom((await request('/account/', { cookie })).text);
    assert.ok(csrf);
    assert.equal((await request('/account/uitloggen/', { cookie, form: {} })).status, 403);
    assert.equal((await request('/account/uitloggen/', { form: { _csrf: csrf } })).status, 401);
    assert.equal((await request('/account/uitloggen/', { cookie, form: { _csrf: csrf }, headers: { origin: 'https://evil.example' } })).status, 403);
    const out = await request('/account/uitloggen/', { cookie, form: { _csrf: csrf } });
    assert.equal(out.status, 303);
    assert.equal(out.location, '/account/inloggen/?uitgelogd=1');
    assert.equal((await request('/account/', { cookie })).status, 303, 'sessie is weg');
    assert.equal((await request('/account/inloggen/', { form: { email: 'anna@example.nl', password: PASSWORD }, headers: { origin: 'https://evil.example' } })).status, 403);
  });

  await t.test('wachtwoord vergeten en herstellen: andere sessies vervallen, oude wachtwoord werkt niet meer', async () => {
    const count = sent.length;
    const unknown = await submitPublic('/account/wachtwoord-vergeten/', { email: 'onbekend@example.nl' });
    assert.equal(unknown.status, 200);
    const known = await submitPublic('/account/wachtwoord-vergeten/', { email: 'anna@example.nl' });
    assert.equal(known.status, 200);
    assert.equal(known.text.replace(/name="token" value="[^"]+"/, ''), unknown.text.replace(/name="token" value="[^"]+"/, ''), 'zelfde antwoord voor bekend en onbekend adres');
    await waitFor(() => sent.length > count);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(sent.length, count + 1, 'alleen een mail voor het bekende adres');
    assert.equal(sent.at(-1).kind, 'account-herstellen');
    const token = linkToken(sent.at(-1));
    assert.equal((await request(`/account/wachtwoord-herstellen/?token=${encodeURIComponent(token)}`)).status, 200);
    const weak = await request('/account/wachtwoord-herstellen/', { form: { token, password: 'anna@example.nl', password2: 'anna@example.nl' } });
    assert.equal(weak.status, 422);
    assert.equal(annaCookie.length > 0, true);
    assert.equal((await request('/account/', { cookie: annaCookie })).status, 200, 'oude sessie werkt nog');
    const reset = await request('/account/wachtwoord-herstellen/', { form: { token, password: 'nieuw en heel geheim', password2: 'nieuw en heel geheim' } });
    assert.equal(reset.status, 303);
    assert.equal(reset.location, '/account/?hersteld=1');
    assert.ok(reset.cookie);
    assert.equal((await request('/account/', { cookie: annaCookie })).status, 303, 'andere sessies zijn beëindigd');
    assert.equal((await request('/account/', { cookie: reset.cookie })).status, 200);
    assert.equal((await request('/account/wachtwoord-herstellen/', { form: { token, password: 'nog een keer anders', password2: 'nog een keer anders' } })).status, 404, 'link werkt één keer');
    assert.equal((await request('/account/inloggen/', { form: { email: 'anna@example.nl', password: PASSWORD } })).status, 401);
    assert.equal((await request('/account/inloggen/', { form: { email: 'anna@example.nl', password: 'nieuw en heel geheim' } })).status, 303);
  });

  await t.test('mailbom: hoogstens drie herstellinks per account per uur, ook bij gelijktijdige verzoeken', async () => {
    const [account] = await db.query("SELECT id FROM customer_accounts WHERE email = 'anna@example.nl'");
    const accounts = createAccounts({ db });
    // Er is dit uur al één herstellink (vorige test).
    assert.ok(await accounts.createToken(account.id, 'herstellen'));
    assert.ok(await accounts.createToken(account.id, 'herstellen'));
    assert.equal(await accounts.createToken(account.id, 'herstellen'), '');
    await assert.rejects(accounts.createToken(account.id, 'iets'), /onbekende soort/);
    await db.query("INSERT INTO customer_accounts (email, password_hash) VALUES ('parallel@example.nl', 'x')");
    const [parallel] = await db.query("SELECT id FROM customer_accounts WHERE email = 'parallel@example.nl'");
    const results = await Promise.all(Array.from({ length: 8 }, () => accounts.createToken(parallel.id, 'bevestigen')));
    assert.equal(results.filter(Boolean).length, 3);
    assert.equal((await db.query('SELECT count(*)::int AS total FROM customer_tokens WHERE account_id = $1', [parallel.id]))[0].total, 3);
    assert.equal(await accounts.createToken(999999, 'herstellen'), '', 'onbekend account');
  });

  await t.test('te veel mislukte pogingen: account vanaf deze reeks dicht, ook met het juiste wachtwoord', async () => {
    clock += 61 * 60 * 1000;
    const accountsCount = await submitPublic('/account/registreren/', { email: 'kees@example.nl', password: PASSWORD, password2: PASSWORD });
    assert.equal(accountsCount.status, 200);
    await db.query("UPDATE customer_accounts SET verified_at = now() WHERE email = 'kees@example.nl'");
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await request('/account/inloggen/', { form: { email: 'kees@example.nl', password: `fout wachtwoord ${i}` } })).status, 401);
    }
    clock += 1000;
    const blocked = await request('/account/inloggen/', { form: { email: 'kees@example.nl', password: PASSWORD } });
    assert.equal(blocked.status, 401);
    clock += 16 * 60 * 1000;
    assert.equal((await request('/account/inloggen/', { form: { email: 'kees@example.nl', password: PASSWORD } })).status, 303, 'na het kwartier weer open');
  });

  await t.test('auditlog: acties zonder e-mailadres; CRM toont een omschrijving', async () => {
    const rows = await db.query("SELECT action, entity, entity_id, user_id FROM audit_log WHERE action LIKE 'reiziger.%' ORDER BY id");
    const actions = new Set(rows.map((row) => row.action));
    for (const action of ['reiziger.geregistreerd', 'reiziger.bevestigd', 'reiziger.inloggen', 'reiziger.inloggen.mislukt', 'reiziger.inloggen.onbevestigd', 'reiziger.bevestigen.mislukt', 'reiziger.uitloggen', 'reiziger.wachtwoord-hersteld', 'reiziger.inloggen.geblokkeerd']) {
      assert.ok(actions.has(action), action);
    }
    assert.ok(rows.every((row) => row.user_id === null && row.entity === 'customer_accounts'));
    assert.equal((await db.query("SELECT count(*)::int AS total FROM audit_log WHERE entity_id LIKE '%@%' OR action LIKE '%@%'"))[0].total, 0);
  });

  await t.test('opruimen: onbevestigd na zeven dagen weg, verlopen sessies weg, bevestigd blijft', async () => {
    const accounts = createAccounts({ db });
    await db.query("INSERT INTO customer_accounts (email, password_hash, created_at) VALUES ('oud@example.nl', 'x', now() - interval '8 days')");
    await db.query("INSERT INTO customer_accounts (email, password_hash, created_at, verified_at) VALUES ('blijft@example.nl', 'x', now() - interval '30 days', now() - interval '30 days')");
    const [kees] = await db.query("SELECT id FROM customer_accounts WHERE email = 'kees@example.nl'");
    await db.query("INSERT INTO customer_sessions (token_hash, account_id, expires_at) VALUES ('verlopen', $1, now() - interval '1 minute')", [kees.id]);
    await accounts.purgeExpired();
    const emails = (await db.query('SELECT email FROM customer_accounts ORDER BY email')).map((row) => row.email);
    assert.ok(!emails.includes('oud@example.nl'));
    assert.ok(emails.includes('blijft@example.nl'));
    assert.equal((await db.query("SELECT count(*)::int AS total FROM customer_sessions WHERE token_hash = 'verlopen'"))[0].total, 0);
  });
});
