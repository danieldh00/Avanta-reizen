/**
 * Tests voor tweestapsverificatie (CRM-PR 2, migratie 9): de TOTP-rekenkern tegen de testvectoren van RFC 6238, de
 * herstelcodes, de QR-code en de kluis met context (AAD) zonder database; daarna tegen PostgreSQL de halve sessie na het
 * wachtwoord (alleen de tweede stap bereikbaar, verloopt na 15 minuten), verplicht instellen, inloggen met code en
 * herstelcode (elk één keer), de activatiecode van de beheerder (zonder die code geen eigen app koppelen; de installatiecode
 * voor de eerste beheerder), de blokkade per account (ook vanaf veel IP-adressen), nieuwe herstelcodes, zelf uitzetten
 * (alleen als het niet verplicht is), de beheerder die 2FA uitzet (zonder recht 403, onbekend 404) en het auditlog.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { createVault } = require('../src/security/vault');
const { hashToken, COOKIE_NAME } = require('../src/crm/auth');
const totp = require('../src/crm/totp');
const qrCode = require('../src/crm/qr-code');
const { loginWithTwoFactor, enableTwoFactor, createActivation, codeFor, csrfFrom } = require('./helpers/two-factor');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'tweestaps_test';
const MASTER_KEY = Buffer.alloc(32, 9);
const SETUP_CODE = 'ABCDE-FGHJK-LMNPQ-RSTUV';
const ADMIN_PASSWORD = 'correct paard batterij';
const OFFICE_PASSWORD = 'kantoor wachtwoord 1';
const BOOKKEEPER_PASSWORD = 'boekhouding wachtwoord 1';

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

test('TOTP volgt de testvectoren van RFC 6238 en weigert hergebruik', () => {
  const secret = totp.toBase32(Buffer.from('12345678901234567890'));
  assert.equal(totp.codeAt(secret, Math.floor(59 / 30)), '287082');
  assert.equal(totp.codeAt(secret, Math.floor(1111111109 / 30)), '081804');
  assert.equal(totp.codeAt(secret, Math.floor(2000000000 / 30)), '279037');
  const now = 1111111109 * 1000;
  const checked = totp.verify(secret, '081 804', { now });
  assert.deepEqual(checked, { ok: true, step: Math.floor(1111111109 / 30) });
  assert.equal(totp.verify(secret, '081804', { now, lastStep: checked.step }).ok, false, 'dezelfde code werkt geen tweede keer');
  assert.equal(totp.verify(secret, codeFor(secret, now, 1), { now }).ok, true, 'één stap speling');
  assert.equal(totp.verify(secret, codeFor(secret, now, 2), { now }).ok, false, 'twee stappen is te veel');
  assert.equal(totp.verify(secret, '000000', { now }).ok, false);
  assert.equal(totp.verify(secret, 'abc', { now }).ok, false);
  assert.equal(totp.verify(secret, ['081804'], { now }).ok, false);
  assert.equal(totp.verify('', '081804', { now }).ok, false);
  assert.equal(totp.fromBase32(totp.toBase32(Buffer.from('avanta'))).toString(), 'avanta');
  assert.match(totp.newSecret(), /^[A-Z2-7]{32}$/);
});

test('herstelcodes: tien stuks, alleen hashes, hoofdletterongevoelig', () => {
  const recovery = totp.newRecoveryCodes();
  assert.equal(recovery.codes.length, totp.RECOVERY_COUNT);
  assert.ok(recovery.codes.every((code) => /^[A-Z2-7]{5}-[A-Z2-7]{5}$/.test(code)));
  assert.ok(recovery.hashes.every((hash, index) => /^[0-9a-f]{64}$/.test(hash) && hash !== recovery.codes[index]));
  assert.equal(totp.matchRecovery(recovery.hashes, recovery.codes[3].toLowerCase()), 3);
  assert.equal(totp.matchRecovery(recovery.hashes, recovery.codes[3].replace('-', ' ')), 3);
  assert.equal(totp.matchRecovery(recovery.hashes, 'AAAAA-AAAAA'), -1);
  assert.equal(totp.matchRecovery(recovery.hashes, '123456'), -1);
  assert.equal(totp.matchRecovery(null, recovery.codes[0]), -1);
});

test('QR-code: vierkant met vinderpatronen, SVG zonder ingevoegde opmaak', () => {
  const uri = totp.otpauthUri({ secret: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', account: 'kees@example.nl', issuer: 'Avanta CRM' });
  assert.match(uri, /^otpauth:\/\/totp\/Avanta%20CRM%3Akees%40example\.nl\?secret=ABCDEFGHIJKLMNOPQRSTUVWXYZ234567&issuer=Avanta%20CRM/);
  const modules = qrCode.matrix(uri);
  assert.ok(modules.length >= 21 && modules.length === modules[0].length);
  assert.equal((modules.length - 17) % 4, 0);
  assert.ok(modules[0].slice(0, 7).every(Boolean) && modules[6].slice(0, 7).every(Boolean));
  const image = qrCode.svg('test', { label: 'QR <code>' });
  assert.match(image, /^<svg[^>]*role="img"/);
  assert.doesNotMatch(image, /<code>/);
});

test('kluis met context: alleen te openen bij hetzelfde record', () => {
  const vault = createVault(MASTER_KEY);
  const sealed = vault.seal('GEHEIM', 'users:totp:1');
  assert.equal(vault.open(sealed, 'users:totp:1'), 'GEHEIM');
  assert.throws(() => vault.open(sealed, 'users:totp:2'));
  assert.throws(() => vault.open(sealed));
  assert.equal(vault.open(vault.seal({ a: 1 })).a, 1, 'zonder context werkt als vanouds');
});

test('CRM: tweestapsverificatie', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();

  let clock = Date.now();
  const app = createApp({ db, masterKey: MASTER_KEY, setupCode: SETUP_CODE, now: () => clock });
  const settings = app.locals.settings;
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await db.close(); });

  /**
   * Doet een verzoek zonder redirects te volgen.
   * @param {string} path Pad.
   * @param {{form?: object, cookie?: string, headers?: object}} [init] Formulier, sessiecookie en koppen.
   * @returns {Promise<{status: number, text: string, headers: Headers, setCookie: string, cookie: string}>} Antwoord.
   */
  const request = async (path, init = {}) => {
    const headers = { ...(init.headers || {}) };
    if (init.cookie) headers.cookie = `${COOKIE_NAME}=${init.cookie}`;
    let body;
    if (init.form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(init.form).toString();
    }
    const response = await fetch(base + path, { method: init.form ? 'POST' : 'GET', headers, body, redirect: 'manual' });
    const setCookie = response.headers.getSetCookie().find((value) => value.startsWith(`${COOKIE_NAME}=`)) || '';
    return { status: response.status, text: await response.text(), headers: response.headers, setCookie, cookie: setCookie.split(';')[0].split('=')[1] || '' };
  };

  /**
   * Een code voor een geheim die nog niet gebruikt is: de testklok gaat een stap van 30 seconden vooruit.
   * @param {string} secret Geheim.
   * @returns {string} Code.
   */
  const freshCode = (secret) => {
    clock += 30 * 1000;
    return codeFor(secret, clock);
  };

  /**
   * Alleen het wachtwoord: geeft de halve sessie.
   * @param {string} email E-mailadres.
   * @param {string} password Wachtwoord.
   * @param {object} [headers] Extra koppen (bijv. een ander IP-adres).
   * @returns {Promise<object>} Antwoord.
   */
  const firstStep = (email, password, headers) => request('/app/inloggen/', { form: { email, password }, headers });

  const installed = await request('/app/installatie/', { form: { code: SETUP_CODE, name: 'Daniël', email: 'beheer@example.nl', password: ADMIN_PASSWORD, password2: ADMIN_PASSWORD } });
  const adminCookie = installed.cookie;
  const adminHome = await request('/app/', { cookie: adminCookie });
  const adminCsrf = csrfFrom(adminHome.text);
  for (const [name, email, role, password] of [['Kees', 'kees@example.nl', 'kantoor', OFFICE_PASSWORD], ['Bea', 'bea@example.nl', 'boekhouding', BOOKKEEPER_PASSWORD]]) {
    const created = await request('/app/gebruikers/nieuw/', { cookie: adminCookie, form: { _csrf: adminCsrf, name, email, role, password } });
    assert.equal(created.status, 303);
  }
  const [{ id: officeId }] = await db.query("SELECT id FROM users WHERE email = 'kees@example.nl'");
  let officeSecret = '';
  let officeRecovery = [];
  let adminAfterSetup = '';

  await t.test('standaard optioneel: inloggen zonder 2FA, aanzetten alleen met een activatiecode', async () => {
    assert.equal(adminHome.status, 200);
    assert.match(adminHome.text, /Tweestapsverificatie staat nog uit voor je account\./, 'herinnering, niet verplicht');
    const direct = await firstStep('kees@example.nl', OFFICE_PASSWORD);
    assert.equal(direct.headers.get('location'), '/app/', 'zonder 2FA direct een volledige sessie');
    const page = await request('/app/tweestaps/', { cookie: direct.cookie });
    assert.match(page.text, /action="\/app\/tweestaps\/activeren\/"/, 'ook ingelogd eerst de activatiecode');
    const csrf = csrfFrom(page.text);
    assert.equal((await request('/app/tweestaps/instellen/', { cookie: direct.cookie, form: { _csrf: csrf } })).headers.get('location'), '/app/tweestaps/');
    assert.equal((await db.query('SELECT totp_secret FROM users WHERE id = $1', [officeId]))[0].totp_secret, null, 'een gelekt wachtwoord koppelt geen eigen app');
    assert.equal((await request('/app/tweestaps/bevestigen/', { cookie: direct.cookie, form: { _csrf: csrf, code: '123456' } })).headers.get('location'), '/app/tweestaps/');
    await request('/app/uitloggen/', { cookie: direct.cookie, form: { _csrf: csrfFrom((await request('/app/', { cookie: direct.cookie })).text) } });
    // De rest van deze tests gaat over verplichte 2FA.
    await settings.update({ values: { mfaRequiredFor: 'iedereen' } });
  });

  await t.test('halve sessie na het wachtwoord: alleen 2FA instellen bereikbaar', async () => {
    const first = await firstStep('kees@example.nl', OFFICE_PASSWORD);
    assert.equal(first.status, 303);
    assert.equal(first.headers.get('location'), '/app/tweestaps/');
    assert.match(first.setCookie, /Max-Age=900/, 'halve sessie geldt 15 minuten');
    const cookie = first.cookie;
    const [row] = await db.query('SELECT mfa_ok FROM sessions WHERE token_hash = $1', [hashToken(cookie)]);
    assert.equal(row.mfa_ok, false);
    for (const path of ['/app/', '/app/wachtwoord/', '/app/beheer/', '/app/gebruikers/']) {
      const response = await request(path, { cookie });
      assert.equal(response.status, 303, path);
      assert.equal(response.headers.get('location'), '/app/tweestaps/', path);
    }
    assert.equal((await request('/app/inloggen/', { cookie })).headers.get('location'), '/app/tweestaps/');
    assert.equal((await request('/app/inloggen/code/', { cookie })).headers.get('location'), '/app/tweestaps/', 'geen codestap zonder 2FA');
    const page = await request('/app/tweestaps/', { cookie });
    assert.equal(page.status, 200);
    assert.match(page.text, /verplicht voor jouw account/);
    assert.doesNotMatch(page.text, /crm-nav/, 'geen menu met een halve sessie');
    const csrf = csrfFrom(page.text);
    assert.equal((await request('/app/wachtwoord/', { cookie, form: { _csrf: csrf, current: OFFICE_PASSWORD, password: 'iets nieuws en lang', password2: 'iets nieuws en lang' } })).status, 401);
    assert.equal((await request('/app/tweestaps/herstelcodes/', { cookie, form: { _csrf: csrf, code: '123456' } })).status, 401);
    assert.equal((await request('/app/tweestaps/instellen/', { cookie, form: { _csrf: 'fout' } })).status, 403, 'CSRF');
    assert.equal((await request('/app/tweestaps/instellen/', { cookie, form: { _csrf: csrf }, headers: { origin: 'https://evil.example' } })).status, 403, 'andere site');
    assert.match(page.text, /action="\/app\/tweestaps\/activeren\/"/, 'eerst de activatiecode');
    const withoutActivation = await request('/app/tweestaps/instellen/', { cookie, form: { _csrf: csrf } });
    assert.equal(withoutActivation.headers.get('location'), '/app/tweestaps/', 'zonder activatiecode niet instellen');
    assert.equal((await db.query('SELECT totp_secret FROM users WHERE id = $1', [officeId]))[0].totp_secret, null, 'geen geheim aangemaakt');
    assert.equal((await request('/app/tweestaps/instellen/', { cookie })).headers.get('location'), '/app/tweestaps/');
    // Uitloggen kan ook met een halve sessie.
    const out = await request('/app/uitloggen/', { cookie, form: { _csrf: csrf } });
    assert.equal(out.status, 303);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM sessions WHERE token_hash = $1', [hashToken(cookie)]))[0].count, 0);
  });

  await t.test('halve sessie verloopt na 15 minuten', async () => {
    const first = await firstStep('kees@example.nl', OFFICE_PASSWORD);
    await db.query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE token_hash = $1", [hashToken(first.cookie)]);
    assert.equal((await request('/app/tweestaps/', { cookie: first.cookie })).headers.get('location'), '/app/inloggen/');
  });

  await t.test('activatiecode: alleen van de beheerder, verloopt, hoort bij de sessie die hem gaf', async () => {
    const first = await firstStep('kees@example.nl', OFFICE_PASSWORD);
    const csrf = csrfFrom((await request('/app/tweestaps/', { cookie: first.cookie })).text);
    const wrong = await request('/app/tweestaps/activeren/', { cookie: first.cookie, form: { _csrf: csrf, activation: 'ABCDE-FGHJK-LMNPQ-RSTUV' } });
    assert.equal(wrong.status, 422, 'zonder uitgegeven code (ook niet de installatiecode van een ander)');
    assert.match(wrong.text, /klopt niet of is verlopen/);
    // Zonder recht geen activatiecode maken.
    const bookkeeperCookie = (await firstStep('bea@example.nl', BOOKKEEPER_PASSWORD)).cookie;
    assert.equal((await request(`/app/gebruikers/${officeId}/activatiecode/`, { cookie: bookkeeperCookie, form: { _csrf: csrfFrom((await request('/app/tweestaps/', { cookie: bookkeeperCookie })).text) } })).status, 401, 'halve sessie');
    assert.equal((await request('/app/gebruikers/999999/activatiecode/', { cookie: adminCookie, form: { _csrf: adminCsrf } })).status, 404);
    const expired = await createActivation(request, { cookie: adminCookie, csrf: adminCsrf }, 'kees@example.nl');
    assert.match(expired, /^[A-HJ-NP-Z2-9]{5}(-[A-HJ-NP-Z2-9]{5}){3}$/);
    const [stored] = await db.query('SELECT totp_activation_hash FROM users WHERE id = $1', [officeId]);
    assert.ok(stored.totp_activation_hash && !stored.totp_activation_hash.includes(expired.replace(/-/g, '')), 'alleen de hash');
    await db.query("UPDATE users SET totp_activation_expires_at = now() - interval '1 second' WHERE id = $1", [officeId]);
    assert.equal((await request('/app/tweestaps/activeren/', { cookie: first.cookie, form: { _csrf: csrf, activation: expired } })).status, 422, 'verlopen');
    const code = await createActivation(request, { cookie: adminCookie, csrf: adminCsrf }, 'kees@example.nl');
    assert.match((await request(`/app/gebruikers/${officeId}/`, { cookie: adminCookie })).text, /Er staat een activatiecode klaar/);
    const activated = await request('/app/tweestaps/activeren/', { cookie: first.cookie, form: { _csrf: csrf, activation: code.toLowerCase() } });
    assert.equal(activated.status, 303);
    assert.equal(activated.headers.get('location'), '/app/tweestaps/instellen/');
    assert.equal((await request('/app/tweestaps/instellen/', { cookie: first.cookie })).status, 200);
    // Een tweede halve sessie (iemand anders met hetzelfde wachtwoord) ziet het geheim niet.
    const other = await firstStep('kees@example.nl', OFFICE_PASSWORD);
    assert.equal((await request('/app/tweestaps/instellen/', { cookie: other.cookie })).headers.get('location'), '/app/tweestaps/');
    const otherCsrf = csrfFrom((await request('/app/tweestaps/', { cookie: other.cookie })).text);
    assert.equal((await request('/app/tweestaps/bevestigen/', { cookie: other.cookie, form: { _csrf: otherCsrf, code: '123456' } })).headers.get('location'), '/app/tweestaps/');
    // De code is bij het activeren verbruikt: dezelfde code werkt niet in een tweede sessie.
    assert.equal((await request('/app/tweestaps/activeren/', { cookie: other.cookie, form: { _csrf: otherCsrf, activation: code } })).status, 422, 'eenmalig');
    const [consumed] = await db.query('SELECT totp_activation_hash FROM users WHERE id = $1', [officeId]);
    assert.equal(consumed.totp_activation_hash, null, 'gewist bij activeren');
  });

  await t.test('instellen: QR-code, verkeerde code geweigerd, daarna nieuwe sessie en herstelcodes', async () => {
    const first = await firstStep('kees@example.nl', OFFICE_PASSWORD);
    const cookie = first.cookie;
    const csrf = csrfFrom((await request('/app/tweestaps/', { cookie })).text);
    const activation = await createActivation(request, { cookie: adminCookie, csrf: adminCsrf }, 'kees@example.nl');
    assert.equal((await request('/app/tweestaps/activeren/', { cookie, form: { _csrf: csrf, activation } })).status, 303);
    const page = await request('/app/tweestaps/instellen/', { cookie });
    assert.match(page.text, /<img class="crm-qr" src="data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+"/);
    const secret = page.text.match(/class="crm-secret">([A-Z2-7 ]+)</)[1].replace(/ /g, '');
    const [stored] = await db.query('SELECT totp_secret, totp_enabled_at FROM users WHERE id = $1', [officeId]);
    assert.equal(stored.totp_enabled_at, null, 'nog niet actief');
    assert.ok(!stored.totp_secret.includes(secret), 'geheim staat versleuteld');
    const wrong = await request('/app/tweestaps/bevestigen/', { cookie, form: { _csrf: csrf, code: '000000' } });
    assert.equal(wrong.status, 422);
    assert.match(wrong.text, /code klopt niet/);
    const confirmed = await request('/app/tweestaps/bevestigen/', { cookie, form: { _csrf: csrf, code: codeFor(secret, clock) } });
    assert.equal(confirmed.status, 200);
    assert.ok(confirmed.cookie && confirmed.cookie !== cookie, 'nieuw sessietoken');
    assert.match(confirmed.setCookie, /Max-Age=86400/);
    officeRecovery = [...confirmed.text.matchAll(/<li><code>([A-Z2-7]{5}-[A-Z2-7]{5})<\/code><\/li>/g)].map((match) => match[1]);
    assert.equal(officeRecovery.length, 10);
    assert.equal((await request('/app/', { cookie })).status, 303, 'de halve sessie bestaat niet meer');
    assert.equal((await request('/app/', { cookie: confirmed.cookie })).status, 200);
    const [enabled] = await db.query('SELECT totp_enabled_at, totp_recovery, totp_activation_hash FROM users WHERE id = $1', [officeId]);
    assert.ok(enabled.totp_enabled_at);
    assert.equal(enabled.totp_activation_hash, null, 'activatiecode verbruikt');
    assert.equal(enabled.totp_recovery.length, 10);
    assert.ok(officeRecovery.every((code) => !enabled.totp_recovery.includes(code)), 'alleen hashes');
    assert.equal((await request('/app/tweestaps/instellen/', { cookie: confirmed.cookie, form: { _csrf: csrfFrom((await request('/app/', { cookie: confirmed.cookie })).text) } })).status, 303);
    assert.ok((await db.query('SELECT totp_enabled_at FROM users WHERE id = $1', [officeId]))[0].totp_enabled_at, 'opnieuw starten verandert een actieve 2FA niet');
    officeSecret = secret;
  });

  await t.test('inloggen met code: halve sessie, geen hergebruik, nieuwe sessie', async () => {
    const first = await firstStep('kees@example.nl', OFFICE_PASSWORD);
    assert.equal(first.headers.get('location'), '/app/inloggen/code/');
    assert.equal((await request('/app/', { cookie: first.cookie })).headers.get('location'), '/app/inloggen/code/');
    assert.equal((await request('/app/tweestaps/', { cookie: first.cookie })).headers.get('location'), '/app/inloggen/code/', '2FA-scherm niet zonder code');
    const csrf = csrfFrom((await request('/app/inloggen/code/', { cookie: first.cookie })).text);
    assert.equal((await request('/app/inloggen/code/', { cookie: first.cookie, form: { _csrf: csrf, code: '1' }, headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
    const wrong = await request('/app/inloggen/code/', { cookie: first.cookie, form: { _csrf: csrf, code: '000000' } });
    assert.equal(wrong.status, 401);
    assert.match(wrong.text, /code klopt niet/);
    const code = freshCode(officeSecret);
    const ok = await request('/app/inloggen/code/', { cookie: first.cookie, form: { _csrf: csrf, code } });
    assert.equal(ok.status, 303);
    assert.equal(ok.headers.get('location'), '/app/');
    assert.notEqual(ok.cookie, first.cookie);
    assert.equal((await request('/app/', { cookie: ok.cookie })).status, 200);
    assert.equal((await request('/app/', { cookie: first.cookie })).status, 303, 'het token van de halve sessie werkt niet meer');

    const again = await firstStep('kees@example.nl', OFFICE_PASSWORD);
    const againCsrf = csrfFrom((await request('/app/inloggen/code/', { cookie: again.cookie })).text);
    assert.equal((await request('/app/inloggen/code/', { cookie: again.cookie, form: { _csrf: againCsrf, code } })).status, 401, 'dezelfde code werkt niet nog eens');
    const [{ last }] = await db.query('SELECT last_login_at AS last FROM users WHERE id = $1', [officeId]);
    assert.ok(last);
  });

  await t.test('herstelcode werkt één keer', async () => {
    const first = await firstStep('kees@example.nl', OFFICE_PASSWORD);
    const csrf = csrfFrom((await request('/app/inloggen/code/', { cookie: first.cookie })).text);
    const used = await request('/app/inloggen/code/', { cookie: first.cookie, form: { _csrf: csrf, code: officeRecovery[0].toLowerCase() } });
    assert.equal(used.status, 303);
    assert.equal(used.headers.get('location'), '/app/tweestaps/?herstelcode=1');
    const page = await request('/app/tweestaps/?herstelcode=1', { cookie: used.cookie });
    assert.match(page.text, /herstelcode; die werkt nu niet meer/);
    assert.match(page.text, /nog <strong>9<\/strong>/);
    const second = await firstStep('kees@example.nl', OFFICE_PASSWORD);
    const secondCsrf = csrfFrom((await request('/app/inloggen/code/', { cookie: second.cookie })).text);
    assert.equal((await request('/app/inloggen/code/', { cookie: second.cookie, form: { _csrf: secondCsrf, code: officeRecovery[0] } })).status, 401);
  });

  await t.test('blokkade per account na vijf verkeerde codes, ook vanaf veel IP-adressen, en verloopt', async () => {
    clock += 60 * 60 * 1000;
    // Eerdere verkeerde codes uit de tests hierboven tellen niet mee (het venster is om).
    await db.query('UPDATE users SET totp_failures = 0, totp_failures_reset_at = NULL WHERE id = $1', [officeId]);
    // Wie het wachtwoord heeft geraden, probeert codes vanaf steeds een ander netwerk.
    for (let i = 0; i < 5; i++) {
      const headers = { 'x-forwarded-for': `10.${i}.0.1` };
      const first = await firstStep('kees@example.nl', OFFICE_PASSWORD, headers);
      const csrf = csrfFrom((await request('/app/inloggen/code/', { cookie: first.cookie, headers })).text);
      assert.equal((await request('/app/inloggen/code/', { cookie: first.cookie, form: { _csrf: csrf, code: String(100000 + i) }, headers })).status, 401);
    }
    const headers = { 'x-forwarded-for': '10.99.0.1' };
    const first = await firstStep('kees@example.nl', OFFICE_PASSWORD, headers);
    const csrf = csrfFrom((await request('/app/inloggen/code/', { cookie: first.cookie, headers })).text);
    const locked = await request('/app/inloggen/code/', { cookie: first.cookie, form: { _csrf: csrf, code: freshCode(officeSecret) }, headers });
    assert.equal(locked.status, 429, 'ook met de juiste code dicht');
    assert.match(locked.text, /Te veel verkeerde codes/);
    const [counter] = await db.query('SELECT totp_failures FROM users WHERE id = $1', [officeId]);
    assert.equal(counter.totp_failures, 6, 'de teller staat in de database (een herstart wist hem niet)');
    // Het kwartier is om.
    await db.query("UPDATE users SET totp_failures_reset_at = now() - interval '1 second' WHERE id = $1", [officeId]);
    const later = await firstStep('kees@example.nl', OFFICE_PASSWORD, headers);
    const laterCsrf = csrfFrom((await request('/app/inloggen/code/', { cookie: later.cookie, headers })).text);
    assert.equal((await request('/app/inloggen/code/', { cookie: later.cookie, form: { _csrf: laterCsrf, code: freshCode(officeSecret) }, headers })).status, 303);
    clock += 60 * 60 * 1000;
  });

  await t.test('nieuwe herstelcodes alleen met een code uit de app; de oude vervallen', async () => {
    clock += 60 * 1000;
    const session = await loginWithTwoFactor(request, 'kees@example.nl', OFFICE_PASSWORD, { secret: officeSecret, now: clock });
    const wrong = await request('/app/tweestaps/herstelcodes/', { cookie: session.cookie, form: { _csrf: session.csrf, code: officeRecovery[1] } });
    assert.equal(wrong.status, 422, 'een herstelcode is hier niet genoeg');
    const renewed = await request('/app/tweestaps/herstelcodes/', { cookie: session.cookie, form: { _csrf: session.csrf, code: freshCode(officeSecret) } });
    assert.equal(renewed.status, 200);
    const fresh = [...renewed.text.matchAll(/<li><code>([A-Z2-7]{5}-[A-Z2-7]{5})<\/code><\/li>/g)].map((match) => match[1]);
    assert.equal(fresh.length, 10);
    const first = await firstStep('kees@example.nl', OFFICE_PASSWORD);
    const csrf = csrfFrom((await request('/app/inloggen/code/', { cookie: first.cookie })).text);
    assert.equal((await request('/app/inloggen/code/', { cookie: first.cookie, form: { _csrf: csrf, code: officeRecovery[1] } })).status, 401, 'oude herstelcode vervallen');
    assert.equal((await request('/app/inloggen/code/', { cookie: first.cookie, form: { _csrf: csrf, code: fresh[0] } })).status, 303);
  });

  await t.test('verplicht voor kantoor: zelf uitzetten kan niet', async () => {
    clock += 60 * 1000;
    const session = await loginWithTwoFactor(request, 'kees@example.nl', OFFICE_PASSWORD, { secret: officeSecret, now: clock });
    const page = await request('/app/tweestaps/', { cookie: session.cookie });
    assert.match(page.text, /uitzetten kan niet/);
    assert.doesNotMatch(page.text, /action="\/app\/tweestaps\/uitzetten\/"/);
    const refused = await request('/app/tweestaps/uitzetten/', { cookie: session.cookie, form: { _csrf: session.csrf, password: OFFICE_PASSWORD, code: freshCode(officeSecret) } });
    assert.equal(refused.status, 403);
    assert.ok((await db.query('SELECT totp_enabled_at FROM users WHERE id = $1', [officeId]))[0].totp_enabled_at);
  });

  await t.test('instelling "alleen bijzondere gegevens": boekhouding zonder 2FA, aanzetten en uitzetten kan', async () => {
    const forced = await firstStep('bea@example.nl', BOOKKEEPER_PASSWORD);
    assert.equal(forced.headers.get('location'), '/app/tweestaps/', 'verplicht voor iedereen');
    await settings.update({ values: { mfaRequiredFor: 'gegevens' } });
    assert.equal((await request('/app/', { cookie: forced.cookie })).status, 200, 'na de wijziging geldt de halve sessie als volledig');
    const direct = await firstStep('bea@example.nl', BOOKKEEPER_PASSWORD);
    assert.equal(direct.headers.get('location'), '/app/');
    const home = await request('/app/', { cookie: direct.cookie });
    assert.match(home.text, /Tweestapsverificatie staat nog uit voor je account\./);
    // Zelf aanzetten (volledige sessie, dus zonder activatiecode): andere sessies vervallen, de huidige blijft.
    const enabled = await enableTwoFactor(request, direct.cookie, { now: clock, admin: { cookie: adminCookie, csrf: adminCsrf }, email: 'bea@example.nl' });
    assert.equal(enabled.cookie, direct.cookie, 'een volledige sessie houdt haar token');
    assert.equal((await request('/app/', { cookie: direct.cookie })).status, 200);
    assert.equal((await request('/app/', { cookie: forced.cookie })).status, 303, 'andere sessie uitgelogd');
    // Nu staat 2FA aan, dus inloggen vraagt de code (ook al is het niet verplicht).
    assert.equal((await firstStep('bea@example.nl', BOOKKEEPER_PASSWORD)).headers.get('location'), '/app/inloggen/code/');
    // Uitzetten vraagt wachtwoord én code.
    const csrf = csrfFrom(home.text);
    assert.equal((await request('/app/tweestaps/uitzetten/', { cookie: direct.cookie, form: { _csrf: csrf, password: 'fout wachtwoord!!', code: freshCode(enabled.secret) } })).status, 422);
    assert.equal((await request('/app/tweestaps/uitzetten/', { cookie: direct.cookie, form: { _csrf: csrf, password: BOOKKEEPER_PASSWORD, code: '000000' } })).status, 422);
    const second = await loginWithTwoFactor(request, 'bea@example.nl', BOOKKEEPER_PASSWORD, { secret: enabled.secret, now: clock += 30 * 1000 });
    const off = await request('/app/tweestaps/uitzetten/', { cookie: direct.cookie, form: { _csrf: csrf, password: BOOKKEEPER_PASSWORD, code: freshCode(enabled.secret) } });
    assert.equal(off.status, 303);
    assert.equal((await request('/app/', { cookie: second.cookie })).status, 303, 'andere sessies vervallen bij uitzetten');
    assert.equal((await request('/app/', { cookie: direct.cookie })).status, 200, 'de huidige sessie blijft');
    const [row] = await db.query("SELECT totp_secret, totp_enabled_at, totp_recovery FROM users WHERE email = 'bea@example.nl'");
    assert.deepEqual(row, { totp_secret: null, totp_enabled_at: null, totp_recovery: [] });
    assert.equal((await firstStep('bea@example.nl', BOOKKEEPER_PASSWORD)).headers.get('location'), '/app/');
    await settings.update({ values: { mfaRequiredFor: 'iedereen' } });
  });

  await t.test('beheerder zet 2FA van een collega uit: sessies weg; zonder recht 403, onbekend 404', async () => {
    clock += 60 * 1000;
    const office = await loginWithTwoFactor(request, 'kees@example.nl', OFFICE_PASSWORD, { secret: officeSecret, now: clock });
    assert.equal((await request(`/app/gebruikers/${officeId}/tweestaps/`, { cookie: office.cookie, form: { _csrf: office.csrf } })).status, 403);
    assert.equal((await request('/app/gebruikers/999999/tweestaps/', { cookie: adminCookie, form: { _csrf: adminCsrf } })).status, 404);
    assert.equal((await request(`/app/gebruikers/${officeId}/tweestaps/`, { cookie: adminCookie, form: { _csrf: 'fout' } })).status, 403);
    const list = await request('/app/gebruikers/', { cookie: adminCookie });
    assert.match(list.text, /<th scope="col">Tweestaps<\/th>/);
    const detail = await request(`/app/gebruikers/${officeId}/`, { cookie: adminCookie });
    assert.match(detail.text, /action="\/app\/gebruikers\/\d+\/tweestaps\/"/);
    const reset = await request(`/app/gebruikers/${officeId}/tweestaps/`, { cookie: adminCookie, form: { _csrf: adminCsrf } });
    assert.equal(reset.status, 303);
    assert.equal((await request('/app/', { cookie: office.cookie })).status, 303, 'collega is uitgelogd');
    assert.equal((await db.query('SELECT totp_secret FROM users WHERE id = $1', [officeId]))[0].totp_secret, null);
    assert.equal((await firstStep('kees@example.nl', OFFICE_PASSWORD)).headers.get('location'), '/app/tweestaps/', 'opnieuw instellen bij het inloggen');
  });

  await t.test('eerste beheerder: installatiecode is de activatiecode', async () => {
    clock += 60 * 60 * 1000; // nieuwe periode voor de inloglimiet per IP
    const first = await firstStep('beheer@example.nl', ADMIN_PASSWORD);
    assert.equal(first.headers.get('location'), '/app/tweestaps/');
    const session = await enableTwoFactor(request, first.cookie, { activation: SETUP_CODE.toLowerCase(), now: clock });
    assert.equal((await request('/app/beheer/', { cookie: session.cookie })).status, 200);
    assert.equal((await request('/app/', { cookie: adminCookie })).status, 303, 'de installatiesessie vervalt bij het instellen');
    adminAfterSetup = session.cookie;
  });

  await t.test('auditlog: alle 2FA-acties, zonder codes of geheimen', async () => {
    const rows = await db.query('SELECT action, entity, entity_id, ip_prefix FROM audit_log ORDER BY id');
    const actions = new Set(rows.map((row) => row.action));
    for (const action of ['inloggen.wachtwoord', 'inloggen.code-mislukt', 'inloggen.code-geblokkeerd', 'inloggen', 'tweestaps.aan',
      'tweestaps.uit', 'tweestaps.herstelcode', 'tweestaps.herstelcodes', 'gebruiker.tweestaps', 'gebruiker.activatiecode',
      'tweestaps.activatie-mislukt', 'uitloggen']) {
      assert.ok(actions.has(action), action);
    }
    const dump = JSON.stringify(rows);
    assert.doesNotMatch(dump, /example\.nl/);
    assert.ok(!dump.includes(officeSecret) && officeRecovery.every((code) => !dump.includes(code)));
    const page = await request('/app/auditlog/', { cookie: adminAfterSetup });
    assert.match(page.text, /Tweestapsverificatie uitgezet door beheerder/);
    assert.match(page.text, /te veel verkeerde codes/);
  });
});
