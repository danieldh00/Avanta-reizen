/**
 * Tests voor CRM-PR 1: wachtwoorden (scrypt), rollen en rechten, het ingekorte IP-adres en de installatiecode zonder
 * database; daarna tegen PostgreSQL de eerste beheerder, inloggen (ook mislukt, blokkade, limiet), sessies (cookie,
 * verlopen, uitloggen), CSRF, rechten (403), onbekende gebruiker (404), gebruikersbeheer, de laatste-beheerderregel,
 * wachtwoord wijzigen en het auditlog. De databasetests draaien in een eigen schema, naast de andere testbestanden.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const passwords = require('../src/crm/passwords');
const { roleHasRight, roleNeedsMfa, ROLES, RIGHTS } = require('../src/crm/rights');
const { ipPrefix, hashToken, purgeExpired, COOKIE_NAME } = require('../src/crm/auth');
const { generateSetupCode, normalizeSetupCode, normalizeEmail } = require('../src/crm/routes');
const { loginWithTwoFactor } = require('./helpers/two-factor');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'crm_test';
const MASTER_KEY = Buffer.alloc(32, 7);
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

test('wachtwoorden: hash, controle, rehash en regels', async () => {
  const hash = await passwords.hashPassword('een lang wachtwoord');
  assert.match(hash, /^scrypt\$32768\$8\$1\$[\w-]+\$[\w-]+$/);
  assert.equal(await passwords.verifyPassword('een lang wachtwoord', hash), true);
  assert.equal(await passwords.verifyPassword('een ander wachtwoord', hash), false);
  assert.equal(await passwords.verifyPassword('x'.repeat(passwords.MAX_LENGTH + 1), hash), false);
  assert.equal(await passwords.verifyPassword('iets', 'geen-hash'), false);
  assert.equal(await passwords.verifyPassword('iets', 'scrypt$99999999$8$1$a$b'), false, 'absurde instellingen worden geweigerd');
  assert.equal(passwords.needsRehash(hash), false);
  assert.equal(passwords.needsRehash(hash.replace('$32768$', '$16384$')), true);
  assert.notEqual(await passwords.hashPassword('een lang wachtwoord'), hash, 'elk keer een nieuw zout');
  assert.match(passwords.passwordProblem('kort'), /minimaal 12/);
  assert.match(passwords.passwordProblem('aaaaaaaaaaaaaa'), /verschillende/);
  assert.match(passwords.passwordProblem('Jan@Example.nl', { email: 'jan@example.nl' }), /e-mailadres/);
  assert.match(passwords.passwordProblem(['geen', 'tekst']), /minimaal 12/);
  assert.equal(passwords.passwordProblem('correct paard batterij'), '');
});

test('rollen en rechten', () => {
  assert.equal(roleHasRight('beheerder', 'gebruikers'), true);
  assert.equal(roleHasRight('kantoor', 'gebruikers'), false);
  assert.equal(roleHasRight('kantoor', 'gegevens.religie'), false);
  assert.equal(roleHasRight('boekhouding', 'betalingen'), true);
  assert.equal(roleHasRight('reisleider', 'reizen'), false);
  assert.equal(roleHasRight('onbekend', 'gebruikers'), false);
  assert.equal(roleHasRight('beheerder', 'toString'), false, 'geen rechten via het prototype');
  assert.equal(roleHasRight('__proto__', 'gebruikers'), false);
  assert.deepEqual(ROLES.beheerder.rights, Object.keys(RIGHTS));
  for (const role of Object.values(ROLES)) for (const right of role.rights) assert.ok(Object.hasOwn(RIGHTS, right), right);
  assert.equal(roleNeedsMfa('kantoor'), true);
  assert.equal(roleNeedsMfa('boekhouding'), false);
});

test('ingekort IP-adres, installatiecode en e-mail', () => {
  assert.equal(ipPrefix({ ip: '203.0.113.77' }), '203.0.113.0/24');
  assert.equal(ipPrefix({ ip: '::ffff:198.51.100.9' }), '198.51.100.0/24');
  assert.equal(ipPrefix({ ip: '2001:db8:abcd:12::1' }), '2001:db8:abcd::/48');
  assert.equal(ipPrefix({ ip: '2001:db8::1' }), '2001:db8:0::/48');
  assert.equal(ipPrefix({ ip: '' }), '');
  const code = generateSetupCode();
  assert.match(code, /^[A-HJ-NP-Z2-9]{5}(-[A-HJ-NP-Z2-9]{5}){3}$/);
  assert.notEqual(generateSetupCode(), code);
  assert.equal(normalizeSetupCode(' abcde fghjk-lmnpq-rstuv '), 'ABCDEFGHJKLMNPQRSTUV');
  assert.equal(normalizeEmail(' Jan@Example.NL '), 'jan@example.nl');
  assert.equal(normalizeEmail('geen-adres'), '');
  assert.equal(normalizeEmail(['a@b.nl']), '');
});

test('CRM: installatie, inloggen, rechten en gebruikersbeheer', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();

  let clock = Date.now();
  // Nep-Have I Been Pwned: kent alleen 'gelekt maar lang wachtwoord'; `breachDown` speelt een storing na.
  const breachRequests = [];
  let breachDown = false;
  const breachedHash = crypto.createHash('sha1').update('gelekt maar lang wachtwoord').digest('hex').toUpperCase();
  const passwordCheckFetch = async (url, init) => {
    breachRequests.push({ url, padding: init.headers['Add-Padding'] });
    if (breachDown) throw new Error('netwerk weg');
    const lines = [`${'0'.repeat(35)}:0`];
    if (url.endsWith(breachedHash.slice(0, 5))) lines.push(`${breachedHash.slice(5)}:42`);
    return new Response(lines.join('\r\n'), { status: 200 });
  };
  const app = createApp({ db, masterKey: MASTER_KEY, setupCode: SETUP_CODE, passwordCheckFetch, now: () => clock });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await db.close(); });

  /**
   * Doet een verzoek zonder redirects te volgen.
   * @param {string} path Pad.
   * @param {{method?: string, form?: object, cookie?: string, headers?: object}} [init] Methode, formulier, sessiecookie en koppen.
   * @returns {Promise<{status: number, text: string, headers: Headers, cookie: string}>} Antwoord met de nieuwe sessiecookie (indien gezet).
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
    return { status: response.status, text: await response.text(), headers: response.headers, cookie: setCookie.split(';')[0].split('=')[1] || '', setCookie };
  };

  /** Geheimen van de tweestapsverificatie per e-mailadres (de eerste keer inloggen stelt 2FA in). */
  const secrets = new Map();

  /**
   * Logt in (wachtwoord en tweede stap) en geeft de sessiecookie en het CSRF-token.
   * @param {string} email E-mailadres.
   * @param {string} password Wachtwoord.
   * @returns {Promise<{cookie: string, csrf: string}>} Sessie.
   */
  const login = async (email, password) => {
    const key = email.toLowerCase();
    // Elke code werkt één keer; deze tests loggen vaker in binnen dezelfde 30 seconden van de testklok.
    if (secrets.has(key)) await db.query('UPDATE users SET totp_last_step = NULL WHERE email = $1', [key]);
    const session = await loginWithTwoFactor(request, email, password, {
      secret: secrets.get(key), now: clock, activation: key === 'beheer@example.nl' ? SETUP_CODE : undefined, admin: adminSession,
    });
    secrets.set(key, session.secret);
    return session;
  };

  let adminSession;

  await t.test('zonder gebruikers: installatie open, overzicht stuurt naar inloggen', async () => {
    const home = await request('/app/');
    assert.equal(home.status, 303);
    assert.equal(home.headers.get('location'), '/app/inloggen/');
    assert.equal(home.headers.get('cache-control'), 'no-store');
    assert.equal(home.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.match((await request('/app/inloggen/')).text, /eerste beheerder/);
    assert.equal((await request('/app/installatie/')).status, 200);
  });

  await t.test('installatie: verkeerde code, andere site en ongeldige invoer worden geweigerd', async () => {
    const form = { code: 'XXXXX-XXXXX-XXXXX-XXXXX', name: 'Daniël', email: 'beheer@example.nl', password: ADMIN_PASSWORD, password2: ADMIN_PASSWORD };
    const wrong = await request('/app/installatie/', { form });
    assert.equal(wrong.status, 422);
    assert.match(wrong.text, /installatiecode klopt niet/);
    assert.equal(wrong.cookie, '');
    assert.equal((await request('/app/installatie/', { form: { ...form, code: SETUP_CODE }, headers: { origin: 'https://evil.example' } })).status, 403);
    const mismatch = await request('/app/installatie/', { form: { ...form, code: SETUP_CODE, password2: 'iets anders dan dat' } });
    assert.equal(mismatch.status, 422);
    assert.match(mismatch.text, /niet gelijk/);
    assert.doesNotMatch(mismatch.text, new RegExp(ADMIN_PASSWORD), 'wachtwoord komt niet terug in de pagina');
    const [{ count }] = await db.query('SELECT count(*)::int AS count FROM users');
    assert.equal(count, 0);
  });

  await t.test('installatie: eerste beheerder met de juiste code, daarna dicht', async () => {
    const created = await request('/app/installatie/', {
      form: { code: SETUP_CODE.toLowerCase().replace(/-/g, ' '), name: 'Daniël', email: 'Beheer@Example.nl', password: ADMIN_PASSWORD, password2: ADMIN_PASSWORD },
    });
    assert.equal(created.status, 303);
    assert.equal(created.headers.get('location'), '/app/');
    assert.match(created.setCookie, /HttpOnly/);
    assert.match(created.setCookie, /SameSite=Strict/);
    assert.match(created.setCookie, /Secure/);
    assert.match(created.setCookie, /Path=\/app/);
    const [user] = await db.query('SELECT email, role, password_hash FROM users');
    assert.equal(user.email, 'beheer@example.nl');
    assert.equal(user.role, 'beheerder');
    assert.match(user.password_hash, /^scrypt\$/);
    const [session] = await db.query('SELECT token_hash FROM sessions');
    assert.equal(session.token_hash, hashToken(created.cookie), 'alleen de hash van het token staat in de database');
    assert.equal((await request('/app/installatie/')).status, 404);
    const again = await request('/app/installatie/', { form: { code: SETUP_CODE, name: 'X', email: 'x@example.nl', password: ADMIN_PASSWORD, password2: ADMIN_PASSWORD } });
    assert.equal(again.status, 404);
    assert.doesNotMatch((await request('/app/inloggen/')).text, /eerste beheerder/);
  });

  await t.test('inloggen: fout wachtwoord en onbekend adres geven dezelfde melding', async () => {
    const wrong = await request('/app/inloggen/', { form: { email: 'beheer@example.nl', password: 'fout wachtwoord!!' } });
    const unknown = await request('/app/inloggen/', { form: { email: 'niemand@example.nl', password: 'fout wachtwoord!!' } });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.text, unknown.text.replace('niemand@example.nl', 'beheer@example.nl'));
    assert.equal(wrong.cookie, '');
    assert.equal((await request('/app/inloggen/', { form: { email: 'beheer@example.nl', password: ADMIN_PASSWORD }, headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
    adminSession = await login('BEHEER@example.nl', ADMIN_PASSWORD);
    assert.ok(adminSession.csrf);
    const home = await request('/app/', { cookie: adminSession.cookie });
    assert.equal(home.status, 200);
    assert.match(home.text, /Welkom, Daniël/);
    assert.match(home.text, /href="\/app\/gebruikers\/"/);
  });

  let officeId;
  await t.test('gebruikersbeheer: aanmaken, dubbel adres, CSRF verplicht', async () => {
    const form = { _csrf: adminSession.csrf, name: 'Kantoor Kees', email: 'kees@example.nl', role: 'kantoor', password: 'kantoor wachtwoord 1' };
    assert.equal((await request('/app/gebruikers/nieuw/', { cookie: adminSession.cookie, form: { ...form, _csrf: 'fout' } })).status, 403);
    assert.equal((await request('/app/gebruikers/nieuw/', { cookie: adminSession.cookie, form, headers: { origin: 'https://evil.example' } })).status, 403);
    assert.equal((await request('/app/gebruikers/nieuw/', { form })).status, 401, 'zonder sessie');
    const invalid = await request('/app/gebruikers/nieuw/', { cookie: adminSession.cookie, form: { ...form, role: 'superheld', password: 'kort' } });
    assert.equal(invalid.status, 422);
    assert.match(invalid.text, /Kies een rol/);
    const created = await request('/app/gebruikers/nieuw/', { cookie: adminSession.cookie, form });
    assert.equal(created.status, 303);
    const duplicate = await request('/app/gebruikers/nieuw/', { cookie: adminSession.cookie, form: { ...form, email: 'KEES@example.nl' } });
    assert.equal(duplicate.status, 422);
    assert.match(duplicate.text, /al een gebruiker/);
    const list = await request('/app/gebruikers/', { cookie: adminSession.cookie });
    assert.match(list.text, /Kantoor Kees/);
    [{ id: officeId }] = await db.query("SELECT id FROM users WHERE email = 'kees@example.nl'");
    assert.equal((await request(`/app/gebruikers/${officeId}/`, { cookie: adminSession.cookie })).status, 200);
    assert.equal((await request('/app/gebruikers/999999/', { cookie: adminSession.cookie })).status, 404, 'onbekende gebruiker');
    assert.equal((await request('/app/gebruikers/abc/', { cookie: adminSession.cookie })).status, 404);
  });

  await t.test('rechten: kantoor mag geen gebruikers of auditlog zien (403), wel het overzicht', async () => {
    const office = await login('kees@example.nl', 'kantoor wachtwoord 1');
    const home = await request('/app/', { cookie: office.cookie });
    assert.equal(home.status, 200);
    assert.doesNotMatch(home.text, /href="\/app\/gebruikers\/"/, 'menu verbergt wat niet mag');
    assert.equal((await request('/app/gebruikers/', { cookie: office.cookie })).status, 403);
    assert.equal((await request('/app/auditlog/', { cookie: office.cookie })).status, 403);
    assert.equal((await request(`/app/gebruikers/${officeId}/`, { cookie: office.cookie })).status, 403);
    assert.equal((await request('/app/gebruikers/nieuw/', { cookie: office.cookie, form: { _csrf: office.csrf, name: 'X', email: 'x@example.nl', role: 'beheerder', password: 'wachtwoord van x 1' } })).status, 403);
    assert.equal((await request(`/app/gebruikers/${officeId}/`, { cookie: office.cookie, form: { _csrf: office.csrf, name: 'Kees', email: 'kees@example.nl', role: 'beheerder', active: 'ja' } })).status, 403, 'geen zelfpromotie');
    const [{ role }] = await db.query('SELECT role FROM users WHERE id = $1', [officeId]);
    assert.equal(role, 'kantoor');
  });

  await t.test('blokkeren beëindigt sessies; inloggen geweigerd', async () => {
    const office = await login('kees@example.nl', 'kantoor wachtwoord 1');
    const saved = await request(`/app/gebruikers/${officeId}/`, { cookie: adminSession.cookie, form: { _csrf: adminSession.csrf, name: 'Kantoor Kees', email: 'kees@example.nl', role: 'kantoor' } });
    assert.equal(saved.status, 303);
    assert.equal((await request('/app/', { cookie: office.cookie })).status, 303, 'sessie is weg');
    assert.equal((await request('/app/inloggen/', { form: { email: 'kees@example.nl', password: 'kantoor wachtwoord 1' } })).status, 401);
    await request(`/app/gebruikers/${officeId}/`, { cookie: adminSession.cookie, form: { _csrf: adminSession.csrf, name: 'Kantoor Kees', email: 'kees@example.nl', role: 'kantoor', active: 'ja' } });
  });

  await t.test('laatste actieve beheerder kan niet weg', async () => {
    const [{ id }] = await db.query("SELECT id FROM users WHERE email = 'beheer@example.nl'");
    const demote = await request(`/app/gebruikers/${id}/`, { cookie: adminSession.cookie, form: { _csrf: adminSession.csrf, name: 'Daniël', email: 'beheer@example.nl', role: 'kantoor', active: 'ja' } });
    assert.equal(demote.status, 422);
    assert.match(demote.text, /minstens één actieve beheerder/);
    const disable = await request(`/app/gebruikers/${id}/`, { cookie: adminSession.cookie, form: { _csrf: adminSession.csrf, name: 'Daniël', email: 'beheer@example.nl', role: 'beheerder' } });
    assert.equal(disable.status, 422);
    const [{ role, active }] = await db.query('SELECT role, active FROM users WHERE id = $1', [id]);
    assert.equal(role, 'beheerder');
    assert.equal(active, true);
  });

  await t.test('blokkade na vijf mislukte pogingen geldt per account en IP-reeks, en verloopt', async () => {
    clock += 60 * 60 * 1000; // nieuwe periode voor de limiet per IP
    for (let i = 0; i < 5; i++) await request('/app/inloggen/', { form: { email: 'kees@example.nl', password: `fout wachtwoord ${i}` } });
    assert.equal((await request('/app/inloggen/', { form: { email: 'kees@example.nl', password: 'kantoor wachtwoord 1' } })).status, 401, 'ook met juist wachtwoord geblokkeerd');
    await login('beheer@example.nl', ADMIN_PASSWORD); // een ander account vanaf hetzelfde IP blijft werken
    clock += 16 * 60 * 1000;
    await login('kees@example.nl', 'kantoor wachtwoord 1');
    const reset = await request(`/app/gebruikers/${officeId}/wachtwoord/`, { cookie: adminSession.cookie, form: { _csrf: adminSession.csrf, password: 'nieuw kantoorwachtwoord' } });
    assert.equal(reset.status, 303);
    await login('kees@example.nl', 'nieuw kantoorwachtwoord');
  });

  await t.test('limiet per IP op inloggen (429)', async () => {
    clock += 60 * 60 * 1000;
    let status = 0;
    for (let i = 0; i < 11; i++) status = (await request('/app/inloggen/', { form: { email: 'niemand@example.nl', password: 'x' } })).status;
    assert.equal(status, 429);
    clock += 60 * 60 * 1000;
  });

  await t.test('eigen wachtwoord wijzigen: oude moet kloppen, andere sessies uitgelogd', async () => {
    const other = await login('beheer@example.nl', ADMIN_PASSWORD);
    const wrong = await request('/app/wachtwoord/', { cookie: adminSession.cookie, form: { _csrf: adminSession.csrf, current: 'niet het oude', password: 'nieuw beheerwachtwoord', password2: 'nieuw beheerwachtwoord' } });
    assert.equal(wrong.status, 422);
    const changed = await request('/app/wachtwoord/', { cookie: adminSession.cookie, form: { _csrf: adminSession.csrf, current: ADMIN_PASSWORD, password: 'nieuw beheerwachtwoord', password2: 'nieuw beheerwachtwoord' } });
    assert.equal(changed.status, 303);
    assert.equal((await request('/app/', { cookie: adminSession.cookie })).status, 200, 'huidige sessie blijft');
    assert.equal((await request('/app/', { cookie: other.cookie })).status, 303, 'andere sessie is uitgelogd');
  });

  await t.test('gelekte en veelgebruikte wachtwoorden geweigerd (A09)', async () => {
    // De limiet op wachtwoord wijzigen (5 per kwartier) telt mee: elke poging een nieuw kwartier.
    const change = (password) => { clock += 16 * 60 * 1000; return request('/app/wachtwoord/', { cookie: adminSession.cookie, form: { _csrf: adminSession.csrf, current: 'nieuw beheerwachtwoord', password, password2: password } }); };
    // Lokaal, zonder de dienst te vragen (de controle staat in de tests standaard uit).
    const common = await change('Wachtwoord2026!');
    assert.equal(common.status, 422);
    assert.match(common.text, /te makkelijk te raden/);
    assert.equal((await change('gelekt maar lang wachtwoord')).status, 303, 'zonder Have I Been Pwned geen controle op lekken');
    assert.equal(breachRequests.length, 0);
    // Controle aanzetten in Beheer; het paneel toont de stand.
    const section = await request('/app/beheer/wachtwoorden/', { cookie: adminSession.cookie });
    assert.equal(section.status, 200);
    assert.match(section.text, /alleen lokaal gecontroleerd/);
    assert.equal((await request('/app/beheer/wachtwoorden/', { cookie: adminSession.cookie, form: { _csrf: adminSession.csrf, passwordBreachCheck: 'ja' } })).status, 303);
    const changeFrom = (current, password, minutes = 16) => {
      clock += minutes * 60 * 1000;
      return request('/app/wachtwoord/', { cookie: adminSession.cookie, form: { _csrf: adminSession.csrf, current, password, password2: password } });
    };
    assert.equal((await changeFrom('gelekt maar lang wachtwoord', 'nieuw beheerwachtwoord')).status, 303);
    const breached = await changeFrom('nieuw beheerwachtwoord', 'gelekt maar lang wachtwoord');
    assert.equal(breached.status, 422);
    assert.match(breached.text, /gelekte wachtwoorden/);
    // Alleen de eerste 5 tekens van de hash gaan de deur uit, met opvulling.
    assert.deepEqual(breachRequests.at(-1), { url: `https://api.pwnedpasswords.com/range/${breachedHash.slice(0, 5)}`, padding: 'true' });
    assert.ok(breachRequests.every((entry) => /\/range\/[0-9A-F]{5}$/.test(entry.url)));
    // Ook bij een nieuwe gebruiker door de beheerder.
    const newUser = await request('/app/gebruikers/nieuw/', { cookie: adminSession.cookie, form: { _csrf: adminSession.csrf, name: 'Lek', email: 'lek@example.nl', role: 'boekhouding', active: 'ja', password: 'gelekt maar lang wachtwoord' } });
    assert.equal(newUser.status, 422);
    // Storing: alleen lokaal, wijzigen lukt, één regel in het logboek.
    breachDown = true;
    assert.equal((await changeFrom('nieuw beheerwachtwoord', 'een heel ander wachtwoord')).status, 303);
    assert.equal((await changeFrom('een heel ander wachtwoord', 'nieuw beheerwachtwoord', 1)).status, 303);
    breachDown = false;
    await app.locals.appLog.flush();
    const [logged] = await db.query("SELECT count(*)::int AS n FROM app_logs WHERE source = 'wachtwoordcontrole'");
    assert.equal(logged.n, 1, 'hoogstens één logregel per kwartier');
    const panel = await request('/app/beheer/wachtwoorden/', { cookie: adminSession.cookie });
    assert.match(panel.text, /lokaal en bij Have I Been Pwned/);
    assert.match(panel.text, /komt voor in gelekte wachtwoorden/);
    assert.match(panel.text, /niet bereikbaar/);
    assert.doesNotMatch(panel.text, /gelekt maar lang wachtwoord/);
  });

  await t.test('sessie verloopt na inactiviteit en na de maximale duur', async () => {
    const idle = await login('kees@example.nl', 'nieuw kantoorwachtwoord');
    await db.query("UPDATE sessions SET last_seen_at = now() - interval '9 hours' WHERE token_hash = $1", [hashToken(idle.cookie)]);
    assert.equal((await request('/app/', { cookie: idle.cookie })).status, 303);
    const old = await login('kees@example.nl', 'nieuw kantoorwachtwoord');
    await db.query("UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE token_hash = $1", [hashToken(old.cookie)]);
    assert.equal((await request('/app/', { cookie: old.cookie })).status, 303);
    assert.equal((await request('/app/', { cookie: 'verzonnen-token' })).status, 303);
  });

  await t.test('uitloggen vereist CSRF en verwijdert de sessie', async () => {
    assert.equal((await request('/app/uitloggen/', { cookie: adminSession.cookie, form: { _csrf: 'fout' } })).status, 403);
    const out = await request('/app/uitloggen/', { cookie: adminSession.cookie, form: { _csrf: adminSession.csrf } });
    assert.equal(out.status, 303);
    assert.match(out.setCookie, /Max-Age=0/);
    assert.equal((await request('/app/', { cookie: adminSession.cookie })).status, 303);
    const [{ count }] = await db.query('SELECT count(*)::int AS count FROM sessions WHERE token_hash = $1', [hashToken(adminSession.cookie)]);
    assert.equal(count, 0);
  });

  await t.test('onderhoud ruimt oude auditregels en verlopen sessies op', async () => {
    await db.query("INSERT INTO audit_log (action, created_at) VALUES ('inloggen.mislukt', now() - interval '25 months'), ('inloggen', now() - interval '23 months')");
    const [user] = await db.query("SELECT id FROM users WHERE email = 'kees@example.nl'");
    await db.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('oud', $1, now() - interval '1 day')", [user.id]);
    await purgeExpired(db);
    const [{ old }] = await db.query("SELECT count(*)::int AS old FROM audit_log WHERE created_at < now() - interval '24 months'");
    const [{ recent }] = await db.query("SELECT count(*)::int AS recent FROM audit_log WHERE created_at < now() - interval '22 months'");
    const [{ sessions }] = await db.query("SELECT count(*)::int AS sessions FROM sessions WHERE token_hash = 'oud'");
    assert.equal(old, 0);
    assert.equal(recent, 1, 'regels binnen de termijn blijven');
    assert.equal(sessions, 0);
  });

  await t.test('teller per account over alle IP-reeksen tegen gedistribueerd raden', async () => {
    clock += 2 * 60 * 60 * 1000;
    // Elke poging vanuit een andere IP-reeks (vertrouwde proxy is loopback, dus X-Forwarded-For telt).
    for (let i = 0; i < 30; i++) {
      await request('/app/inloggen/', { form: { email: 'kees@example.nl', password: `fout wachtwoord ${i}` }, headers: { 'x-forwarded-for': `10.${i}.0.1` } });
    }
    const blocked = await request('/app/inloggen/', { form: { email: 'kees@example.nl', password: 'nieuw kantoorwachtwoord' }, headers: { 'x-forwarded-for': '10.200.0.1' } });
    assert.equal(blocked.status, 401, 'ook met juist wachtwoord vanaf een nieuwe reeks dicht');
    clock += 61 * 60 * 1000;
    await login('kees@example.nl', 'nieuw kantoorwachtwoord');
  });

  await t.test('één IP-reeks kan het account niet langdurig dichtzetten', async () => {
    clock += 2 * 60 * 60 * 1000;
    // Een uur lang elk kwartier de maximale 10 pogingen vanuit één IP: alleen die reeks wacht, het account blijft open.
    for (let quarter = 0; quarter < 4; quarter++) {
      for (let i = 0; i < 10; i++) await request('/app/inloggen/', { form: { email: 'kees@example.nl', password: `fout ${quarter}-${i}` }, headers: { 'x-forwarded-for': '10.240.0.1' } });
      clock += 15 * 60 * 1000 + 1000;
    }
    const other = await request('/app/inloggen/', { form: { email: 'kees@example.nl', password: 'nieuw kantoorwachtwoord' }, headers: { 'x-forwarded-for': '10.241.0.1' } });
    assert.equal(other.status, 303, 'vanaf een ander netwerk lukt inloggen');
    clock += 2 * 60 * 60 * 1000;
  });

  await t.test('acht reeksen die elk kwartier proberen zetten het account niet dicht', async () => {
    for (let quarter = 0; quarter < 4; quarter++) {
      for (let range = 0; range < 8; range++) {
        await request('/app/inloggen/', { form: { email: 'kees@example.nl', password: `fout ${quarter}-${range}` }, headers: { 'x-forwarded-for': `10.230.${range}.1` } });
      }
      clock += 15 * 60 * 1000 - 60 * 1000; // vier kwartieren binnen één uur
    }
    const other = await request('/app/inloggen/', { form: { email: 'kees@example.nl', password: 'nieuw kantoorwachtwoord' }, headers: { 'x-forwarded-for': '10.231.0.1' } });
    assert.equal(other.status, 303);
    clock += 2 * 60 * 60 * 1000;
  });

  await t.test('gelijktijdige pogingen omzeilen de teller niet', async () => {
    clock += 2 * 60 * 60 * 1000;
    const [{ last }] = await db.query('SELECT coalesce(max(id), 0) AS last FROM audit_log');
    await Promise.all(Array.from({ length: 10 }, (_, i) => request('/app/inloggen/', {
      form: { email: 'kees@example.nl', password: `fout wachtwoord ${i}` },
      headers: { 'x-forwarded-for': '10.250.0.1' },
    })));
    const rows = await db.query('SELECT action, count(*)::int AS count FROM audit_log WHERE id > $1 GROUP BY action', [last]);
    const counts = Object.fromEntries(rows.map((row) => [row.action, row.count]));
    assert.deepEqual(counts, { 'inloggen.mislukt': 5, 'inloggen.geblokkeerd': 5 }, 'hoogstens 5 echte pogingen, ook parallel');
    clock += 2 * 60 * 60 * 1000;
  });

  await t.test('auditlog: alle acties gelogd zonder persoonsgegevens, zichtbaar voor beheerder', async () => {
    const rows = await db.query('SELECT action, entity, entity_id, ip_prefix, user_id FROM audit_log ORDER BY id');
    const actions = new Set(rows.map((row) => row.action));
    for (const action of ['installatie.mislukt', 'installatie', 'inloggen', 'inloggen.wachtwoord', 'tweestaps.aan', 'inloggen.mislukt', 'inloggen.inactief', 'inloggen.geblokkeerd',
      'gebruiker.aangemaakt', 'gebruiker.uitgeschakeld', 'gebruiker.ingeschakeld', 'gebruiker.wachtwoord', 'wachtwoord.gewijzigd', 'uitloggen']) {
      assert.ok(actions.has(action), action);
    }
    assert.ok(rows.every((row) => row.ip_prefix === null || /^(127\.0|10\.\d+)\.\d+\.0\/24$/.test(row.ip_prefix)), 'alleen ingekorte adressen');
    const dump = JSON.stringify(rows);
    assert.doesNotMatch(dump, /example\.nl|wachtwoord /, 'geen e-mailadressen of wachtwoorden in het log');
    const session = await login('beheer@example.nl', 'nieuw beheerwachtwoord');
    const page = await request('/app/auditlog/', { cookie: session.cookie });
    assert.equal(page.status, 200);
    assert.match(page.text, /Inloggen mislukt/);
    assert.equal((await request('/app/auditlog/?voor=abc', { cookie: session.cookie })).status, 200);
  });

  await t.test('algemene limiet per IP op alles onder /app/ (429)', async () => {
    clock += 60 * 60 * 1000;
    let status = 0;
    for (let i = 0; i < 301 && status !== 429; i++) status = (await request('/app/inloggen/')).status;
    assert.equal(status, 429);
    clock += 60 * 60 * 1000;
  });

  await t.test('onbekende CRM-pagina geeft 404 binnen het CRM', async () => {
    const missing = await request('/app/bestaat-niet/');
    assert.equal(missing.status, 404);
    assert.match(missing.text, /Avanta CRM/);
  });
});
