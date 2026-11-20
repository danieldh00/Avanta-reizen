/**
 * Tests voor e-mail (pakket B1): de mailer (verbinding alleen naar een openbaar adres, STARTTLS verplicht, inloggen
 * alleen bij SMTP, geen kop-injectie, overzicht zonder adressen), de meldingen bij fouten, de WAN-IP-opzoeker, de
 * netwerkcontrole en de routes onder Beheer > E-mail > Mailserver (recht `systeem`, CSRF, testmail met limiet en
 * auditlog, WAN-IP). De databasetests draaien in een eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { createMailer, mailFailure, validEmail, scrub } = require('../src/mail/mailer');
const { createWanIp, validIp } = require('../src/mail/wan-ip');
const { isPublicAddress, publicAddress } = require('../src/security/netguard');
const { COOKIE_NAME } = require('../src/crm/auth');
const { loginWithTwoFactor } = require('./helpers/two-factor');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'mail_test';
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

/**
 * Instellingen in het geheugen met de standaardwaarden voor e-mail.
 * @param {object} values Afwijkende waarden.
 * @returns {{get: Function}} Nep-instellingen.
 */
function fakeSettings(values) {
  const all = { mailMode: 'smtp', mailHost: '', mailPort: 587, mailSecure: false, mailUser: '', mailPassword: '', mailFromName: 'Avanta Reizen', mailFromAddress: '', mailReplyTo: '', ...values };
  return { get: (key) => all[key] };
}

/**
 * Een nep-transport van nodemailer dat de opties en berichten bewaart.
 * @param {{fail?: Error}} [behaviour] Fout die `sendMail` gooit.
 * @returns {{createTransport: Function, transports: object[], messages: object[]}} Fabriek en wat er gebeurde.
 */
function fakeTransport(behaviour = {}) {
  const transports = [];
  const messages = [];
  const createTransport = (transportOptions) => {
    const transport = {
      options: transportOptions,
      closed: false,
      sendMail: async (message) => {
        if (behaviour.fail) throw behaviour.fail;
        messages.push(message);
        return { messageId: '<test@example.nl>' };
      },
      verify: async () => true,
      close() { this.closed = true; },
    };
    transports.push(transport);
    return transport;
  };
  return { createTransport, transports, messages };
}

test('netwerkcontrole: alleen openbare adressen', async () => {
  assert.equal(isPublicAddress('8.8.8.8'), true);
  for (const address of ['2002:0a00:0001::1', '2001:0:4136:e378::1', '127.0.0.1', '10.1.2.3', '172.18.0.5', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1', 'geen-ip']) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(await publicAddress('mail.example.nl', { lookup: async () => [{ address: '2a00:1450::1' }, { address: '8.8.4.4' }] }), '8.8.4.4', 'IPv4 eerst');
  await assert.rejects(publicAddress('intern.example.nl', { lookup: async () => [{ address: '8.8.4.4' }, { address: '10.0.0.1' }] }), { code: 'private_host' });
  await assert.rejects(publicAddress('127.0.0.1'), { code: 'private_host' });
});

test('mailer: e-mailadressen en opschonen van meldingen', () => {
  assert.equal(validEmail('info@avantareizen.nl'), true);
  assert.equal(validEmail('info@bücher.de'), true);
  for (const value of ['', 'geen-adres', 'a@b', 'a b@example.nl', 'a@example.nl\r\nBcc: x@y.nl', 'a,b@example.nl', `${'x'.repeat(200)}@example.nl`, 42]) {
    assert.equal(validEmail(value), false, String(value));
  }
  assert.equal(scrub('550 5.1.1 <jan@example.nl>: Recipient\r\nrejected'), '550 5.1.1 <[adres]>: Recipient rejected');
});

test('mailer: niet ingesteld, ongeldige ontvanger en privéadres versturen niets', async () => {
  const transport = fakeTransport();
  const notConfigured = createMailer({ settings: fakeSettings({}), createTransport: transport.createTransport, resolveHost: async () => '8.8.8.8' });
  assert.equal(notConfigured.configured(), false);
  await assert.rejects(notConfigured.send({ to: 'jan@example.nl', subject: 'x', text: 'x', kind: 'testmail' }), { code: 'not_configured' });

  const settings = fakeSettings({ mailHost: 'smtp.example.nl', mailFromAddress: 'info@example.nl' });
  const mailer = createMailer({ settings, createTransport: transport.createTransport, resolveHost: async () => '8.8.8.8' });
  assert.equal(mailer.configured(), true);
  await assert.rejects(mailer.send({ to: 'geen-adres', subject: 'x', text: 'x' }), { code: 'invalid_to' });

  const local = fakeSettings({ mailHost: '127.0.0.1', mailFromAddress: 'info@example.nl' });
  await assert.rejects(createMailer({ settings: local, createTransport: transport.createTransport }).send({ to: 'jan@example.nl', subject: 'x', text: 'x' }), (error) => {
    assert.equal(error.code, 'invalid_host');
    assert.equal(mailFailure(error), 'Versturen mislukt: de mailserver moet een openbaar adres hebben.');
    return true;
  });
  assert.equal(transport.transports.length, 0, 'geen enkele verbinding gemaakt');
  const events = notConfigured.recent();
  assert.equal(events.length, 1);
  assert.equal(events[0].ok, false);
  assert.equal(events[0].kind, 'testmail');
});

test('mailer: SMTP met inloggen, STARTTLS verplicht, certificaat op naam, geen kop-injectie', async () => {
  const transport = fakeTransport();
  const settings = fakeSettings({ mailHost: 'smtp.example.nl', mailUser: 'info@example.nl', mailPassword: 'geheim-wachtwoord', mailFromName: 'Avanta Reizen', mailFromAddress: 'info@example.nl', mailReplyTo: 'kantoor@example.nl' });
  const mailer = createMailer({ settings, createTransport: transport.createTransport, resolveHost: async (host) => (host === 'smtp.example.nl' ? '8.8.8.8' : '') });
  await mailer.send({ kind: 'testmail', to: ' jan@example.nl ', subject: 'Hallo\r\nBcc: x@evil.example', text: 'Tekst' });
  const [created] = transport.transports;
  assert.equal(created.options.host, '8.8.8.8', 'verbinden met het gecontroleerde adres');
  assert.equal(created.options.tls.servername, 'smtp.example.nl', 'certificaat op de naam van de server');
  assert.equal(created.options.servername, 'smtp.example.nl');
  assert.equal(created.options.tls.rejectUnauthorized, true);
  assert.equal(created.options.requireTLS, true);
  assert.deepEqual(created.options.auth, { user: 'info@example.nl', pass: 'geheim-wachtwoord' });
  assert.equal(created.closed, true);
  const [message] = transport.messages;
  assert.deepEqual(message.from, { name: 'Avanta Reizen', address: 'info@example.nl' });
  assert.deepEqual(message.to, ['jan@example.nl']);
  assert.equal(message.replyTo, 'kantoor@example.nl');
  assert.equal(message.subject, 'Hallo Bcc: x@evil.example');
  const [event] = mailer.recent();
  assert.deepEqual({ kind: event.kind, ok: event.ok, message: event.message }, { kind: 'testmail', ok: true, message: 'Verstuurd.' });
  assert.doesNotMatch(JSON.stringify(mailer.recent()), /jan@example\.nl|geheim/, 'geen adressen of wachtwoord in het overzicht');
});

test('mailer: connector logt niet in; SSL/TLS op 465 zonder STARTTLS-eis', async () => {
  const transport = fakeTransport();
  const connector = createMailer({
    settings: fakeSettings({ mailMode: 'connector', mailHost: 'example-nl.mail.protection.outlook.com', mailPort: 25, mailUser: 'blijft@example.nl', mailPassword: 'x', mailFromAddress: 'info@example.nl' }),
    createTransport: transport.createTransport,
    resolveHost: async () => '52.101.0.1',
  });
  await connector.send({ to: 'jan@example.nl', subject: 'x', text: 'x' });
  assert.equal(transport.transports[0].options.auth, undefined);
  assert.equal(transport.transports[0].options.port, 25);
  assert.equal(transport.transports[0].options.requireTLS, true);
  const secure = createMailer({
    settings: fakeSettings({ mailHost: 'smtp.example.nl', mailPort: 465, mailSecure: true, mailFromAddress: 'info@example.nl' }),
    createTransport: transport.createTransport,
    resolveHost: async () => '8.8.8.8',
  });
  await secure.send({ to: 'jan@example.nl', subject: 'x', text: 'x' });
  assert.equal(transport.transports[1].options.secure, true);
  assert.equal(transport.transports[1].options.requireTLS, false);
  assert.equal(transport.transports[1].options.auth, undefined, 'zonder gebruikersnaam geen inlog');
});

test('mailer: leesbare meldingen bij fouten, zonder adressen', async () => {
  const fail = Object.assign(new Error('Invalid login'), { code: 'EAUTH', response: '535 5.7.3 Authentication unsuccessful for info@example.nl' });
  const transport = fakeTransport({ fail });
  const mailer = createMailer({ settings: fakeSettings({ mailHost: 'smtp.example.nl', mailFromAddress: 'info@example.nl' }), createTransport: transport.createTransport, resolveHost: async () => '8.8.8.8' });
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...parts) => warnings.push(parts.join(' '));
  try {
    await assert.rejects(mailer.send({ to: 'jan@example.nl', subject: 'x', text: 'x', kind: 'testmail' }), { code: 'EAUTH' });
  } finally {
    console.warn = originalWarn;
  }
  assert.match(mailFailure(fail), /weigert de inloggegevens.*\(mailserver: 535 5\.7\.3 Authentication unsuccessful for \[adres\]\)/);
  assert.doesNotMatch(warnings.join('\n'), /@/, 'geen adressen in het serverlog');
  assert.match(mailer.recent()[0].message, /inloggegevens/);
  assert.match(mailFailure(Object.assign(new Error('connect ECONNREFUSED 8.8.8.8:587'), { code: 'ESOCKET', mailHost: 'smtp.example.nl', mailPort: 587 })), /smtp\.example\.nl:587 weigert de verbinding/);
  assert.match(mailFailure(Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT', mailHost: 'smtp.example.nl', mailPort: 25 })), /time-out/);
  assert.match(mailFailure(Object.assign(new Error('self-signed certificate'), { code: 'ESOCKET' })), /TLS/);
  assert.match(mailFailure(Object.assign(new Error('x'), { code: 'EENVELOPE', command: 'MAIL FROM' })), /afzenderadres/);
  assert.equal(mailFailure(new Error('iets')), 'Versturen mislukt door een interne fout; de oorzaak staat in het serverlog.');
});

test('WAN-IP: alleen een openbaar IPv4-adres, een uur bewaard, opnieuw hoogstens eens per minuut', async () => {
  let clock = 1_000_000;
  const asked = [];
  const answers = { 'https://a': '10.0.0.1', 'https://b': ' 8.8.8.8\n' };
  const wanIp = createWanIp({ sources: ['https://a', 'https://b'], now: () => clock, fetch: async (url) => { asked.push(url); return answers[url]; } });
  assert.equal(wanIp.peek(), null);
  assert.equal((await wanIp.get()).ip, '8.8.8.8', 'een privéadres wordt overgeslagen');
  assert.deepEqual(asked, ['https://a', 'https://b']);
  clock += 30 * 1000;
  await wanIp.get({ refresh: true });
  assert.equal(asked.length, 2, 'binnen een minuut niet opnieuw');
  clock += 60 * 1000;
  answers['https://a'] = '8.8.4.4';
  assert.equal((await wanIp.get({ refresh: true })).ip, '8.8.4.4');
  clock += 61 * 60 * 1000;
  assert.equal(wanIp.peek(), null, 'na een uur verlopen');
  const broken = createWanIp({ sources: ['https://a'], fetch: async () => { throw new Error('offline'); } });
  await assert.rejects(broken.get(), { code: 'unavailable' });
  assert.equal(validIp('2a00:1450::1'), false, 'geen IPv6');
});

test('Beheer > E-mail: instellingen, testmail, WAN-IP en rechten', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();

  let clock = Date.now();
  const transport = fakeTransport();
  let wanAnswer = '8.8.8.8';
  const wanIp = createWanIp({ sources: ['https://wan'], now: () => clock, fetch: async () => wanAnswer });
  // De mailer krijgt de instellingen van de app zelf: maak de app eerst, dan de mailer op dezelfde instellingen.
  const { createSettings } = require('../src/beheer/settings');
  const { createVault } = require('../src/security/vault');
  const masterKey = Buffer.alloc(32, 5);
  const settings = createSettings({ db, vault: createVault(masterKey), env: {} });
  const mailer = createMailer({ settings, createTransport: transport.createTransport, resolveHost: async () => '8.8.8.8', now: () => clock });
  const app = createApp({ db, masterKey, settings, mailer, wanIp, setupCode: SETUP_CODE, now: () => clock });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await db.close(); });

  /**
   * Doet een verzoek zonder redirects te volgen.
   * @param {string} path Pad.
   * @param {{form?: object, cookie?: string}} [init] Formulier en sessiecookie.
   * @returns {Promise<{status: number, text: string, headers: Headers, cookie: string}>} Antwoord.
   */
  const request = async (path, init = {}) => {
    const headers = {};
    if (init.cookie) headers.cookie = `${COOKIE_NAME}=${init.cookie}`;
    let body;
    if (init.form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(init.form).toString();
    }
    const response = await fetch(base + path, { method: init.form ? 'POST' : 'GET', headers, body, redirect: 'manual' });
    const setCookie = response.headers.getSetCookie().find((value) => value.startsWith(`${COOKIE_NAME}=`)) || '';
    return { status: response.status, text: await response.text(), headers: response.headers, cookie: setCookie.split(';')[0].split('=')[1] || '' };
  };
  const csrfFrom = (text) => (text.match(/name="_csrf" value="([^"]+)"/) || [])[1];

  const installed = await request('/app/installatie/', { form: { code: SETUP_CODE, name: 'Daniël', email: 'beheer@example.nl', password: ADMIN_PASSWORD, password2: ADMIN_PASSWORD } });
  const cookie = installed.cookie;
  const csrf = csrfFrom((await request('/app/', { cookie })).text);
  const mailForm = { _csrf: csrf, mailMode: 'smtp', mailHost: 'smtp.example.nl', mailPort: '587', mailUser: 'info@example.nl', mailPassword: 'app-wachtwoord-1234', mailFromName: 'Avanta Reizen', mailFromAddress: 'info@example.nl', mailReplyTo: '' };

  await t.test('rechten: zonder sessie 401, zonder recht systeem 403', async () => {
    assert.equal((await request('/app/beheer/mailserver/testmail/', { form: { _csrf: 'x', to: 'a@example.nl' } })).status, 401);
    const created = await request('/app/gebruikers/nieuw/', { cookie, form: { _csrf: csrf, name: 'Kantoor', email: 'kantoor@example.nl', role: 'kantoor', password: 'kantoor wachtwoord 1' } });
    assert.equal(created.status, 303);
    const office = await loginWithTwoFactor(request, 'kantoor@example.nl', 'kantoor wachtwoord 1');
    const officeCsrf = csrfFrom((await request('/app/', { cookie: office.cookie })).text);
    assert.equal((await request('/app/beheer/mailserver/', { cookie: office.cookie })).status, 403);
    assert.equal((await request('/app/beheer/mailserver/testmail/', { cookie: office.cookie, form: { _csrf: officeCsrf, to: 'kantoor@example.nl' } })).status, 403);
    assert.equal((await request('/app/beheer/mailserver/wan-ip/', { cookie: office.cookie, form: { _csrf: officeCsrf } })).status, 403);
    assert.equal((await request('/app/beheer/mailserver/testmail/', { cookie, form: { _csrf: 'fout', to: 'a@example.nl' } })).status, 403, 'CSRF');
    assert.equal(transport.messages.length, 0);
  });

  await t.test('niet ingesteld: testmail kan niet', async () => {
    const page = await request('/app/beheer/mailserver/', { cookie });
    assert.equal(page.status, 200);
    assert.match(page.text, /Er is nog geen mailserver ingesteld/);
    assert.match(page.text, /Testmail versturen<\/button>/);
    const tried = await request('/app/beheer/mailserver/testmail/', { cookie, form: { _csrf: csrf, to: 'beheer@example.nl' } });
    assert.equal(tried.status, 422);
    assert.equal(transport.messages.length, 0);
  });

  await t.test('instellingen opslaan: ongeldige server geweigerd, wachtwoord versleuteld en nooit terug', async () => {
    const invalid = await request('/app/beheer/mailserver/', { cookie, form: { ...mailForm, mailHost: 'https://smtp.example.nl:587' } });
    assert.equal(invalid.status, 422);
    assert.doesNotMatch(invalid.text, /app-wachtwoord-1234/, 'het wachtwoord komt niet terug in het formulier');
    const saved = await request('/app/beheer/mailserver/', { cookie, form: mailForm });
    assert.equal(saved.status, 303);
    const page = await request('/app/beheer/mailserver/', { cookie });
    assert.match(page.text, /De mailserver is ingesteld/);
    assert.match(page.text, /Ingesteld \(eindigt op 1234\)/);
    assert.doesNotMatch(page.text, /app-wachtwoord-1234/);
    const [row] = await db.query("SELECT value FROM settings WHERE key = 'mailPassword'");
    assert.doesNotMatch(row.value, /app-wachtwoord/);
  });

  await t.test('testmail: verstuurd, in het auditlog zonder adres, met limiet', async () => {
    const invalid = await request('/app/beheer/mailserver/testmail/', { cookie, form: { _csrf: csrf, to: 'geen adres' } });
    assert.equal(invalid.status, 422);
    assert.match(invalid.text, /Vul een geldig e-mailadres in/);
    const sent = await request('/app/beheer/mailserver/testmail/', { cookie, form: { _csrf: csrf, to: 'test@example.nl' } });
    assert.equal(sent.status, 200);
    assert.match(sent.text, /De testmail is verstuurd/);
    const message = transport.messages.at(-1);
    assert.deepEqual(message.to, ['test@example.nl']);
    assert.deepEqual(message.from, { name: 'Avanta Reizen', address: 'info@example.nl' });
    assert.match(message.subject, /^Testmail van /);
    assert.deepEqual(transport.transports.at(-1).options.auth, { user: 'info@example.nl', pass: 'app-wachtwoord-1234' });
    const audit = await db.query("SELECT action, entity_id FROM audit_log WHERE action LIKE 'mail.%'");
    assert.deepEqual(audit, [{ action: 'mail.test', entity_id: 'mailserver' }]);
    const page = await request('/app/beheer/mailserver/', { cookie });
    assert.match(page.text, /<td>Testmail<\/td>\s*<td>Verstuurd<\/td>/);
    assert.doesNotMatch(page.text.split('Laatste verzendingen')[1], /test@example\.nl/, 'geen adres in het overzicht');
    const statuses = [];
    for (let i = 0; i < 5; i += 1) statuses.push((await request('/app/beheer/mailserver/testmail/', { cookie, form: { _csrf: csrf, to: 'test@example.nl' } })).status);
    assert.deepEqual(statuses, [200, 200, 200, 200, 429]);
    clock += 11 * 60 * 1000;
    assert.equal((await request('/app/beheer/mailserver/testmail/', { cookie, form: { _csrf: csrf, to: 'test@example.nl' } })).status, 200, 'na tien minuten weer');
  });

  await t.test('WAN-IP opzoeken en tonen', async () => {
    const found = await request('/app/beheer/mailserver/wan-ip/', { cookie, form: { _csrf: csrf } });
    assert.equal(found.status, 200);
    assert.match(found.text, /<strong>8\.8\.8\.8<\/strong>/);
    assert.match((await request('/app/beheer/mailserver/', { cookie })).text, /<strong>8\.8\.8\.8<\/strong>/, 'bewaard voor de volgende keer');
    wanAnswer = 'onzin';
    clock += 2 * 60 * 1000;
    const failed = await request('/app/beheer/mailserver/wan-ip/', { cookie, form: { _csrf: csrf } });
    assert.equal(failed.status, 503);
    assert.match(failed.text, /kon niet worden bepaald/);
  });
});
