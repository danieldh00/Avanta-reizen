/**
 * Tests voor de mail-opmaak en de meldingen aan kantoor (pakket B2): e-mailveilige HTML met escaping en een
 * platte-tekstversie, de contrastcontrole van de kleur, meldingen die alleen gaan als ze aan staan, nooit bijzondere
 * gegevens van een aanmelding, en het effect van het contact- en aanmeldformulier (melding zonder de bezoeker te laten
 * wachten; een mislukte melding verandert niets aan de inzending). De databasetests draaien in een eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { createSettings, validateValue, SETTING_FIELDS } = require('../src/beheer/settings');
const { createVault } = require('../src/security/vault');
const { createMailer } = require('../src/mail/mailer');
const { renderMail, contrastWithWhite, LOGO_CID } = require('../src/mail/layout');
const { createNotifications } = require('../src/mail/notifications');
const { COOKIE_NAME } = require('../src/crm/auth');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'mail_meldingen_test';
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
 * Een nep-mailer die verzonden berichten bewaart.
 * @param {{configured?: boolean, fail?: boolean}} [behaviour] Of er een server is en of versturen mislukt.
 * @returns {{configured: Function, send: Function, sent: object[]}} Nep-mailer.
 */
function fakeMailer(behaviour = {}) {
  const sent = [];
  return {
    sent,
    configured: () => behaviour.configured !== false,
    send: async (message) => {
      if (behaviour.fail) throw Object.assign(new Error('weg'), { code: 'ETIMEDOUT' });
      sent.push(message);
      return {};
    },
  };
}

/**
 * Instellingen in het geheugen voor de meldingen.
 * @param {object} values Afwijkende waarden.
 * @returns {{get: Function}} Nep-instellingen.
 */
function fakeSettings(values) {
  const all = { notifyEmail: 'kantoor@example.nl', notifyContact: true, notifyBooking: true, mailHeaderColor: '#a95c4c', mailFooterText: 'Avanta Reizen', siteName: 'Avanta reizen', ...values };
  return { get: (key) => all[key] };
}

/**
 * Wacht tot een voorwaarde waar is (de meldingen gaan op de achtergrond).
 * @param {() => boolean} condition Voorwaarde.
 * @returns {Promise<void>}
 */
async function waitFor(condition) {
  for (let i = 0; i < 100 && !condition(); i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
}

test('mail-opmaak: escaping, platte tekst, logo als bijlage en contrast', () => {
  const mail = renderMail({
    title: 'Titel <b>', intro: 'Regel 1\nRegel 2', rows: [['Naam', '<script>alert(1)</script>'], ['Leeg', ''], ['Telefoon', undefined]],
    body: 'Bericht "met" <img src=x onerror=alert(1)>', headerColor: '#a95c4c', footerText: 'Voet\nRegel', siteName: 'Avanta',
  });
  assert.doesNotMatch(mail.html, /<script>|<img src=x/, 'invoer wordt nooit HTML');
  assert.match(mail.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(mail.html, /Regel 1<br>Regel 2/);
  assert.match(mail.html, /background:#a95c4c/);
  assert.match(mail.html, new RegExp(`src="cid:${LOGO_CID}"`));
  assert.doesNotMatch(mail.html, />Leeg</, 'lege rijen vallen weg');
  assert.equal(mail.attachments[0].cid, LOGO_CID);
  assert.match(mail.text, /^Titel <b>\n\nRegel 1\nRegel 2\n\nNaam: <script>alert\(1\)<\/script>\n\nBericht/);
  assert.match(mail.text, /\n--\nVoet\nRegel\n$/);
  assert.ok(contrastWithWhite('#a95c4c') >= 4.5);
  assert.equal(validateValue('mailHeaderColor', SETTING_FIELDS.mailHeaderColor, '#A95C4C'), '#A95C4C');
  assert.throws(() => validateValue('mailHeaderColor', SETTING_FIELDS.mailHeaderColor, '#f3ede6'), /te licht/);
  assert.throws(() => validateValue('mailHeaderColor', SETTING_FIELDS.mailHeaderColor, 'red; x'), /#a95c4c/);
  assert.throws(() => validateValue('mailFooterText', SETTING_FIELDS.mailFooterText, '1\n2\n3\n4\n5\n6\n7'), /6 regels/);
});

test('meldingen: alleen als ze aan staan, met adres en server; aanmelding zonder bijzondere gegevens', async () => {
  const trip = { title: '8 dagen Albanië', trip_code: '27-AKO-56', departure_date: '2027-07-01' };
  const values = { call_name: 'Anna', last_name: 'Jansen', email: 'anna@example.nl', mobile: '0612345678', city: 'Middelburg', travel_with: '', payment_choice: 'aanbetaling', church: 'PKN', particulars: 'Notenallergie', birth_date: '1999-05-04', document_number: 'NX1234567' };

  for (const [settings, mailer, reason] of [
    [fakeSettings({ notifyEmail: '' }), fakeMailer(), 'geen kantooradres'],
    [fakeSettings({ notifyBooking: false }), fakeMailer(), 'melding uit'],
    [fakeSettings({}), fakeMailer({ configured: false }), 'geen mailserver'],
  ]) {
    assert.equal(await createNotifications({ mailer, settings }).booking({ reference: 'AV-2027-0000000A', trip, values }), false, reason);
    assert.equal(mailer.sent.length, 0, reason);
  }
  assert.equal(await createNotifications({ mailer: fakeMailer({ fail: true }), settings: fakeSettings({}) }).booking({ reference: 'AV-2027-0000000A', trip, values }), false, 'een fout wordt niet gegooid');

  const mailer = fakeMailer();
  const notifications = createNotifications({ mailer, settings: fakeSettings({}) });
  assert.equal(await notifications.booking({ reference: 'AV-2027-0000000A', trip, values }), true);
  const [message] = mailer.sent;
  assert.equal(message.to, 'kantoor@example.nl');
  assert.equal(message.replyTo, 'anna@example.nl');
  assert.equal(message.kind, 'melding-aanmelding');
  assert.equal(message.subject, 'Nieuwe aanmelding AV-2027-0000000A: 8 dagen Albanië');
  assert.match(message.text, /Naam: Anna Jansen\nE-mail: anna@example\.nl/);
  assert.match(message.text, /Betaling: Aanbetaling/);
  assert.doesNotMatch(message.text + message.html, /PKN|Notenallergie|1999|NX1234567/, 'nooit bijzondere gegevens');

  assert.equal(await notifications.contactMessage({ name: 'Jan', email: 'jan@example.nl', phone: '', subject: 'Vraag', message: 'Hoi' }, null), true);
  assert.equal(mailer.sent[1].subject, 'Nieuw bericht via de website: Vraag');
  assert.equal(mailer.sent[1].replyTo, 'jan@example.nl');
});

test('meldingen vanuit het contact- en aanmeldformulier, en Beheer', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  const departure = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  await db.query("INSERT INTO trips (legacy_id, slug, title, body_html, trip_code, departure_date, price_cents, fully_booked) VALUES (1001, '8-dagen-albanie', '8 dagen Albanië', '', '27-AKO-56', $1, 79900, false)", [departure]);
  await db.query("INSERT INTO pages (path, title, body_html) VALUES ('/contact/', 'Contact', '<p>Bel ons</p>'), ('/bedankt-voor-je-aanmelding/', 'Bedankt', '<p>Dank</p>')");

  let clock = Date.now();
  const masterKey = Buffer.alloc(32, 7);
  const settings = createSettings({ db, vault: createVault(masterKey), env: {} });
  const sent = [];
  let failing = false;
  const transport = () => ({
    sendMail: async (message) => {
      if (failing) throw Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' });
      sent.push(message);
      return {};
    },
    close() {},
  });
  const mailer = createMailer({ settings, createTransport: transport, resolveHost: async () => '8.8.8.8', now: () => clock });
  const app = createApp({ db, masterKey, settings, mailer, wanIp: { peek: () => null, get: async () => ({}) }, setupCode: SETUP_CODE, now: () => clock });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await db.close(); });

  /**
   * Doet een verzoek zonder redirects te volgen.
   * @param {string} path Pad.
   * @param {{form?: (object|URLSearchParams), cookie?: string}} [init] Formulier en sessiecookie.
   * @returns {Promise<{status: number, text: string, headers: Headers, cookie: string}>} Antwoord.
   */
  const request = async (path, init = {}) => {
    const headers = { 'sec-fetch-site': 'same-origin' };
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
  const tokenFrom = (text) => /name="token" value="([^"]+)"/.exec(text)[1];

  const installed = await request('/app/installatie/', { form: { code: SETUP_CODE, name: 'Daniël', email: 'beheer@example.nl', password: ADMIN_PASSWORD, password2: ADMIN_PASSWORD } });
  const cookie = installed.cookie;
  const csrf = ((await request('/app/', { cookie })).text.match(/name="_csrf" value="([^"]+)"/) || [])[1];
  await settings.update({ values: { mailHost: 'smtp.example.nl', mailFromAddress: 'info@example.nl' } });

  await t.test('Beheer: meldingen en opmaak instellen, voorbeeld bekijken', async () => {
    assert.equal((await request('/app/beheer/meldingen/', { cookie, form: { _csrf: csrf, notifyEmail: 'geen adres', notifyContact: 'ja', notifyBooking: 'ja' } })).status, 422);
    assert.equal((await request('/app/beheer/meldingen/', { cookie, form: { _csrf: csrf, notifyEmail: 'Kantoor@Example.nl', notifyContact: 'ja', notifyBooking: 'ja' } })).status, 303);
    assert.equal(settings.get('notifyEmail'), 'kantoor@example.nl');
    assert.equal((await request('/app/beheer/mail-opmaak/', { cookie, form: { _csrf: csrf, mailHeaderColor: '#ffffff', mailFooterText: 'x' } })).status, 422);
    assert.equal((await request('/app/beheer/mail-opmaak/', { cookie, form: { _csrf: csrf, mailHeaderColor: '#2f2e33', mailFooterText: 'Avanta Reizen\nMiddelburg' } })).status, 303);
    const preview = await request('/app/beheer/mail-opmaak/voorbeeld/', { cookie });
    assert.equal(preview.status, 200);
    assert.match(preview.text, /background:#2f2e33/);
    assert.match(preview.text, /src="\/images\/logo\.png"/);
    assert.match(preview.text, /Avanta Reizen<br>Middelburg/);
    assert.equal((await request('/app/beheer/mail-opmaak/voorbeeld/')).status, 303, 'zonder sessie naar inloggen');
    const created = await request('/app/gebruikers/nieuw/', { cookie, form: { _csrf: csrf, name: 'Kantoor', email: 'kantoor@example.nl', role: 'kantoor', password: 'kantoor wachtwoord 1' } });
    assert.equal(created.status, 303);
    const office = await request('/app/inloggen/', { form: { email: 'kantoor@example.nl', password: 'kantoor wachtwoord 1' } });
    assert.equal((await request('/app/beheer/mail-opmaak/voorbeeld/', { cookie: office.cookie })).status, 403, 'zonder recht systeem');
    assert.equal((await request('/app/beheer/meldingen/', { cookie: office.cookie })).status, 403);
  });

  await t.test('contactformulier: bericht opgeslagen en melding naar kantoor met antwoordadres van de afzender', async () => {
    const page = await request('/contact/?reis=8-dagen-albanie');
    clock += 5000;
    const response = await request('/contact/', { form: { reis: '8-dagen-albanie', token: tokenFrom(page.text), website: '', name: 'Test Persoon', phone: '0612345678', email: 'Test@Example.nl', subject: '', message: 'Hallo,\nIk heb een vraag.', consent: 'ja' } });
    assert.equal(response.status, 303);
    await waitFor(() => sent.length >= 1);
    const [message] = sent;
    assert.deepEqual(message.to, ['kantoor@example.nl']);
    assert.equal(message.replyTo, 'Test@Example.nl');
    assert.equal(message.subject, 'Nieuw bericht via de website: Test Persoon');
    assert.match(message.text, /Reis: 8 dagen Albanië/);
    assert.match(message.text, /Hallo,\nIk heb een vraag\./);
    assert.equal(message.attachments[0].cid, LOGO_CID);
  });

  await t.test('aanmelding: melding zonder bijzondere gegevens; een mislukte melding laat de aanmelding staan', async () => {
    const fill = async () => {
      const page = await request('/aanmelden/?id=1001');
      return {
        id: '1001', reis: '', token: tokenFrom(page.text), website: '',
        gender: 'vrouw', first_names: 'Anna Maria', call_name: 'Anna', last_name: 'Jansen', birth_date: '1999-05-04',
        mobile: '0612345678', email: 'anna@example.nl', email_confirm: 'anna@example.nl', street: 'Dorpsstraat 1',
        postal_code: '4331 ab', city: 'Middelburg', occupation: 'Verpleegkundige', church: 'PKN', nationality: 'Nederlandse',
        document_type: 'paspoort', document_number: 'NX1234567', particulars: 'Notenallergie', earlier_trip: 'nee',
        credit_card: 'ja', driver_interest: 'ja', driver_before: 'nee', payment_choice: 'totaal', consent: 'ja',
      };
    };
    const form = await fill();
    clock += 5000;
    assert.equal((await request('/aanmelden/', { form })).status, 303);
    await waitFor(() => sent.length >= 2);
    const message = sent[1];
    const [booking] = await db.query('SELECT reference FROM bookings');
    assert.equal(message.subject, `Nieuwe aanmelding ${booking.reference}: 8 dagen Albanië`);
    assert.match(message.text, /Naam: Anna Jansen/);
    assert.match(message.text, /Betaling: Totaalbedrag/);
    assert.doesNotMatch(message.text + message.html, /PKN|Notenallergie|1999|NX1234567|Anna Maria/);

    failing = true;
    const warn = console.warn;
    console.warn = () => {};
    try {
      const second = await fill();
      clock += 5000;
      assert.equal((await request('/aanmelden/', { form: second })).status, 303, 'de bezoeker merkt niets');
      await waitFor(() => mailer.recent()[0].ok === false);
    } finally {
      console.warn = warn;
    }
    assert.equal((await db.query('SELECT COUNT(*)::int AS total FROM bookings'))[0].total, 2);
    const page = await request('/app/beheer/mailserver/', { cookie });
    assert.match(page.text, /Melding aanmelding<\/td>\s*<td>Versturen mislukt: smtp\.example\.nl:587 geeft geen antwoord/);
    assert.doesNotMatch(page.text.split('Laatste verzendingen')[1], /anna@example\.nl|kantoor@example\.nl/);
  });
});
