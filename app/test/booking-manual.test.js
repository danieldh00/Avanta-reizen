/**
 * Tests voor het handmatig invoeren van een aanmelding (`/app/aanmeldingen/nieuw/`, `booking/manual-routes.js`, F02):
 * rechten (reisleider, boekhouding en redacteur 403), keuze van de reis (vertrokken, volgeboekt, onbekend), dezelfde
 * controle als het formulier (verplichte velden, toestemming bij bijzondere gegevens, ouder of voogd onder de 16),
 * opslaan met persoon, toestemmingen, bedragen, historie en audit, de bevestigingsmail naar wens en het kerkgenootschap
 * alleen met het recht. Draait in een eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { createSettings } = require('../src/beheer/settings');
const { createVault } = require('../src/security/vault');
const { createMailer } = require('../src/mail/mailer');
const { hashPassword } = require('../src/crm/passwords');
const { COOKIE_NAME } = require('../src/crm/auth');
const { hiddenFieldsFor, canEnterManually } = require('../src/booking/manual-routes');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'booking_manual_test';
const MASTER_KEY = Buffer.alloc(32, 37);
const PASSWORD = 'een heel goed wachtwoord';

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
 * Een datum ten opzichte van vandaag.
 * @param {number} days Aantal dagen (negatief = geleden).
 * @returns {string} jjjj-mm-dd.
 */
function daysFromNow(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

/**
 * Een geldig ingevuld formulier voor een volwassen deelnemer.
 * @param {object} [extra] Afwijkende of extra velden.
 * @returns {Record<string, string>} Velden.
 */
function adultForm(extra = {}) {
  return {
    gender: 'vrouw', first_names: 'Anna Maria', call_name: 'Anna', last_name: 'Jansen', birth_date: '1990-05-01', mobile: '0612345678',
    email: 'Anna@Example.nl', street: 'Kerkstraat 1', postal_code: '4461 AB', city: 'Goes', occupation: 'Verpleegkundige',
    nationality: 'Nederlandse', document_type: 'paspoort', earlier_trip: 'nee', credit_card: 'ja', driver_interest: 'nee', driver_before: 'nee',
    payment_choice: 'aanbetaling', consent: 'ja', bron: 'telefoon', toelichting: 'Belde om 10 uur', ...extra,
  };
}

test('rechten en verborgen velden per rol', () => {
  assert.equal(canEnterManually('kantoor'), true);
  assert.equal(canEnterManually('beheerder'), true);
  assert.equal(canEnterManually('reisleider'), false, 'alleen eigen vertrekken');
  assert.equal(canEnterManually('boekhouding'), false);
  assert.equal(canEnterManually('redacteur'), false);
  assert.deepEqual([...hiddenFieldsFor('kantoor')].sort(), ['church', 'consent_religion']);
  assert.deepEqual([...hiddenFieldsFor('beheerder')], []);
});

test('aanmelding handmatig invoeren', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  const settings = createSettings({ db, vault: createVault(MASTER_KEY), env: {} });
  const sent = [];
  const transport = () => ({ sendMail: async (message) => { sent.push(message); return {}; }, close() {} });
  const mailer = createMailer({ settings, createTransport: transport, resolveHost: async () => '8.8.8.8' });
  const app = createApp({ db, masterKey: MASTER_KEY, settings, mailer, wanIp: { peek: () => null, get: async () => ({}) } });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await db.close(); });
  await settings.update({ values: { mailHost: 'smtp.example.nl', mailFromAddress: 'info@example.nl' } });

  const hash = await hashPassword(PASSWORD);
  for (const role of ['kantoor', 'beheerder', 'reisleider', 'boekhouding', 'redacteur']) {
    await db.query('INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)', [`${role}@example.nl`, `Gebruiker ${role}`, role, hash]);
  }
  const [open] = await db.query("INSERT INTO trips (slug, title, trip_code, departure_date, price_cents, deposit_cents, published) VALUES ('albanie', 'Albanië', '27-ALB-1', $1, 79900, 20000, false) RETURNING id", [daysFromNow(60)]);
  const [full] = await db.query("INSERT INTO trips (slug, title, trip_code, departure_date, fully_booked) VALUES ('vol', 'Volle reis', '27-VOL-1', $1, true) RETURNING id", [daysFromNow(30)]);
  const [past] = await db.query("INSERT INTO trips (slug, title, departure_date) VALUES ('weg', 'Vertrokken reis', $1) RETURNING id", [daysFromNow(-3)]);

  const request = async (url, init = {}) => {
    const headers = {};
    if (init.cookie) headers.cookie = `${COOKIE_NAME}=${init.cookie}`;
    let body;
    if (init.form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(init.form).toString();
    }
    const response = await fetch(base + url, { method: init.form ? 'POST' : 'GET', headers, body, redirect: 'manual' });
    const setCookie = response.headers.getSetCookie().find((value) => value.startsWith(`${COOKIE_NAME}=`)) || '';
    return { status: response.status, text: await response.text(), headers: response.headers, cookie: setCookie.split(';')[0].split('=')[1] || '' };
  };
  const login = async (role) => {
    const { cookie } = await request('/app/inloggen/', { form: { email: `${role}@example.nl`, password: PASSWORD } });
    const home = await request('/app/', { cookie });
    return { cookie, csrf: (home.text.match(/name="_csrf" value="([^"]+)"/) || [])[1] };
  };
  const kantoor = await login('kantoor');
  const beheerder = await login('beheerder');
  /**
   * Verstuurt het formulier als kantoor.
   * @param {object} form Velden.
   * @param {object} [session] Sessie.
   * @returns {Promise<object>} Antwoord.
   */
  const submit = (form, session = kantoor) => request('/app/aanmeldingen/nieuw/', { cookie: session.cookie, form: { _csrf: session.csrf, reis: String(open.id), ...form } });

  await t.test('rechten: andere rollen 403, zonder sessie naar inloggen; knop alleen met recht', async () => {
    assert.equal((await request('/app/aanmeldingen/nieuw/')).status, 303);
    for (const role of ['reisleider', 'boekhouding', 'redacteur']) {
      const session = await login(role);
      assert.equal((await request('/app/aanmeldingen/nieuw/', { cookie: session.cookie })).status, 403, role);
      assert.equal((await request('/app/aanmeldingen/nieuw/', { cookie: session.cookie, form: { _csrf: session.csrf, ...adultForm(), reis: String(open.id) } })).status, 403, role);
    }
    assert.match((await request('/app/aanmeldingen/', { cookie: kantoor.cookie })).text, /href="\/app\/aanmeldingen\/nieuw\/">Aanmelding invoeren/);
  });

  await t.test('reis kiezen: alleen reizen die nog vertrekken; vol uitgeschakeld; vertrokken en onbekend geweigerd', async () => {
    const choice = (await request('/app/aanmeldingen/nieuw/', { cookie: kantoor.cookie })).text;
    assert.match(choice, new RegExp(`<option value="${open.id}">[^<]*Albanië \\(27-ALB-1\\) · concept</option>`));
    assert.match(choice, new RegExp(`<option value="${full.id}" disabled>[^<]*Volle reis[^<]*volgeboekt</option>`));
    assert.doesNotMatch(choice, /Vertrokken reis/);
    assert.equal((await request(`/app/aanmeldingen/nieuw/?reis=${past.id}`, { cookie: kantoor.cookie })).status, 409);
    assert.equal((await request(`/app/aanmeldingen/nieuw/?reis=${full.id}`, { cookie: kantoor.cookie })).status, 409);
    assert.equal((await request('/app/aanmeldingen/nieuw/?reis=999999', { cookie: kantoor.cookie })).status, 404);
    const form = (await request(`/app/aanmeldingen/nieuw/?reis=${open.id}`, { cookie: kantoor.cookie })).text;
    assert.match(form, /name="birth_date"/);
    assert.match(form, /name="particulars"/);
    assert.doesNotMatch(form, /name="church"/, 'kantoor heeft geen recht op het kerkgenootschap');
    assert.doesNotMatch(form, /name="email_confirm"/);
    assert.match(form, /De deelnemer \(of de ouder of voogd\) gaat akkoord met de algemene voorwaarden/);
    assert.match((await request(`/app/aanmeldingen/nieuw/?reis=${open.id}`, { cookie: beheerder.cookie })).text, /name="church"/);
  });

  await t.test('zelfde controle als het formulier: verplicht, bron, toestemming bij bijzonderheden, ouder onder de 16', async () => {
    const empty = await submit({ bron: '' });
    assert.equal(empty.status, 422);
    assert.match(empty.text, /Dit veld is verplicht/);
    assert.match(empty.text, /Kies hoe de aanmelding binnenkwam/);
    const noConsent = await submit(adultForm({ particulars: 'Astma' }));
    assert.equal(noConsent.status, 422);
    assert.match(noConsent.text, /Geef toestemming, of laat het veld hierboven leeg/);
    assert.match(noConsent.text, /value="Anna Maria"/, 'ingevulde waarden blijven staan');
    const child = await submit(adultForm({ birth_date: daysFromNow(-365 * 12) }));
    assert.equal(child.status, 422);
    assert.match(child.text, /Verplicht bij een deelnemer jonger dan 16 jaar/);
    assert.equal((await db.query('SELECT count(*)::int AS total FROM bookings'))[0].total, 0);
    assert.equal((await submit({ ...adultForm(), _csrf: 'fout' })).status, 403);
  });

  await t.test('opslaan: aanmelding, persoon, toestemmingen, bedragen, historie, audit en bevestiging', async () => {
    const saved = await submit(adultForm({ particulars: 'Astma', consent_health: 'ja', mail_confirmation: 'ja', church: 'Gereformeerd', consent_religion: 'ja' }));
    assert.equal(saved.status, 303);
    const [booking] = await db.query("SELECT id, reference, status, email, payment_method, person_id, deposit_cents FROM bookings WHERE last_name = 'Jansen'");
    assert.equal(saved.headers.get('location'), `/app/aanmeldingen/${booking.id}/?opgeslagen=handmatig`);
    assert.match(booking.reference, /^AV-\d{4}-[0-9A-F]{8}$/);
    assert.equal(booking.status, 'nieuw');
    assert.equal(booking.email, 'anna@example.nl');
    assert.equal(booking.deposit_cents, 20000);
    const consents = (await db.query('SELECT kind, given_by FROM consents WHERE booking_id = $1 ORDER BY kind', [booking.id])).map((row) => `${row.kind}:${row.given_by}`);
    assert.deepEqual(consents, ['art9_gezondheid:deelnemer', 'voorwaarden:deelnemer'], 'geen toestemming voor het kerkgenootschap: kantoor mag dat veld niet invoeren');
    const [person] = await db.query('SELECT special_data, health_data FROM persons WHERE id = $1', [booking.person_id]);
    assert.equal(person.special_data, null, 'kerkgenootschap niet opgeslagen');
    assert.ok(person.health_data && !person.health_data.includes('Astma'), 'bijzonderheden versleuteld');
    assert.ok((await db.query('SELECT count(*)::int AS total FROM booking_charges WHERE booking_id = $1', [booking.id]))[0].total >= 2);
    const [event] = await db.query('SELECT from_status, to_status, note FROM booking_events WHERE booking_id = $1', [booking.id]);
    assert.deepEqual(event, { from_status: null, to_status: 'nieuw', note: 'Handmatig ingevoerd (telefonisch): Belde om 10 uur' });
    const audit = await db.query("SELECT entity, entity_id FROM audit_log WHERE action = 'aanmelding.handmatig'");
    assert.deepEqual(audit, [{ entity: 'bookings', entity_id: String(booking.id) }]);
    const page = (await request(`/app/aanmeldingen/${booking.id}/?opgeslagen=handmatig`, { cookie: kantoor.cookie })).text;
    assert.match(page, /De aanmelding is ingevoerd/);
    assert.match(page, /Handmatig ingevoerd \(telefonisch\)/);
    // De bevestiging gaat zonder te wachten; even geven.
    for (let i = 0; i < 50 && !sent.length; i++) await new Promise((resolve) => { setTimeout(resolve, 20); });
    assert.equal(sent.length, 1);
    assert.match(String(sent[0].to), /anna@example\.nl/i);
    assert.match((await request('/app/auditlog/', { cookie: beheerder.cookie })).text, /Aanmelding handmatig ingevoerd/);
  });

  await t.test('dubbel verzenden: 409 met de bestaande aanmelding, niets opgeslagen; bewust toch opslaan kan', async () => {
    const [first] = await db.query("SELECT id, reference FROM bookings WHERE last_name = 'Jansen'");
    const again = await submit(adultForm({ email: 'anna@example.nl', last_name: 'JANSEN' }));
    assert.equal(again.status, 409);
    assert.match(again.text, new RegExp(`href="/app/aanmeldingen/${first.id}/">${first.reference}</a>`));
    assert.match(again.text, /name="toch_opslaan"/);
    assert.equal((await db.query("SELECT count(*)::int AS total FROM bookings WHERE lower(last_name) = 'jansen'"))[0].total, 1);
    const second = await submit(adultForm({ toch_opslaan: 'ja' }));
    assert.equal(second.status, 303);
    assert.equal((await db.query("SELECT count(*)::int AS total FROM bookings WHERE lower(last_name) = 'jansen'"))[0].total, 2);
  });

  await t.test('zonder vinkje geen mail; ouder onder de 16 met toestemming van de ouder', async () => {
    sent.length = 0;
    const child = await submit(adultForm({
      first_names: 'Kees', call_name: 'Kees', email: 'kees@example.nl', birth_date: daysFromNow(-365 * 12), bron: 'papier',
      guardian_name: 'Piet Jansen', guardian_relation: 'ouder', guardian_email: 'piet@example.nl', consent_guardian: 'ja',
    }));
    assert.equal(child.status, 303);
    const [booking] = await db.query("SELECT id FROM bookings WHERE first_names = 'Kees'");
    const consents = (await db.query('SELECT kind, given_by FROM consents WHERE booking_id = $1 ORDER BY kind', [booking.id])).map((row) => `${row.kind}:${row.given_by}`);
    assert.deepEqual(consents, ['ouder_voogd:ouder_voogd', 'voorwaarden:ouder_voogd']);
    await new Promise((resolve) => { setTimeout(resolve, 100); });
    assert.equal(sent.length, 0, 'geen bevestiging zonder vinkje');
  });

  await t.test('volgeboekt tijdens het invullen: 409 en niets opgeslagen', async () => {
    await db.query('UPDATE trips SET fully_booked = true WHERE id = $1', [open.id]);
    const before = (await db.query('SELECT count(*)::int AS total FROM bookings'))[0].total;
    const refused = await submit(adultForm({ email: 'laat@example.nl' }));
    assert.equal(refused.status, 409);
    assert.equal((await db.query('SELECT count(*)::int AS total FROM bookings'))[0].total, before);
  });
});
