/**
 * Tests voor de infobrief aan de deelnemers van een vertrek (`infobrief/`, migratie 32): opgemaakte tekst in de mail
 * (opschonen, volledige adressen, platte tekst), het formulier, rechten (reisleider, boekhouding en redacteur 403),
 * concept opslaan en verwijderen, voorbeeld met eigen CSP, testmail, versturen (bevestigen, aantal, nooit dubbel, ouder
 * of voogd, dubbele adressen, geannuleerd en nieuw), versturen in de achtergrond met limiet, mislukt en opnieuw,
 * afgebroken = niet zeker, verzendoverzicht zonder adressen, export (.xlsx) en audit. Draait in een eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { hashPassword } = require('../src/crm/passwords');
const { COOKIE_NAME } = require('../src/crm/auth');
const { createVault } = require('../src/security/vault');
const { createPersons } = require('../src/persons/persons');
const { mailHtmlFromRichText, plainTextFromRichText, absoluteMailUrl } = require('../src/mail/rich-text');
const { renderMail } = require('../src/mail/layout');
const infobrieven = require('../src/infobrief/infobrieven');
const { createInfobriefSender, STALE_NOTE } = require('../src/infobrief/sender');
const { tripLabel, overviewFileName, TESTMAIL_LIMIT } = require('../src/infobrief/infobrief-routes');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'infobrief_test';
const MASTER_KEY = Buffer.alloc(32, 32);
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

test('opgemaakte tekst in een mail: opschonen, volledige adressen, stijlen en platte tekst', () => {
  const markup = mailHtmlFromRichText(
    '<h2>Paklijst</h2><p>Lees <a href="/reis/albanie/">de reis</a> en <a href="https://example.org/x">dit</a>.<script>alert(1)</script></p>'
    + '<ul><li>Slaapzak</li><li>Zaklamp</li></ul><p><img src="/media/kaart.jpg" alt="Kaart"></p><p onclick="x()">Groet<br>Kantoor</p>'
    + '<table><tr><th>Dag</th><td>Wat</td></tr></table><hr><p><a href="mailto:info@example.nl">info@example.nl</a></p>',
    'https://www.example.nl/',
  );
  assert.doesNotMatch(markup, /script|alert|onclick|loading=/);
  assert.match(markup, /<a style="[^"]+" href="https:\/\/www\.example\.nl\/reis\/albanie\/">/);
  assert.match(markup, /href="https:\/\/example\.org\/x"/);
  assert.match(markup, /<img style="[^"]*max-width:100%[^"]*" src="https:\/\/www\.example\.nl\/media\/kaart\.jpg" alt="Kaart">/);
  assert.match(markup, /<h2 style="/);
  assert.match(markup, /<thead|<table style="/);
  const text = plainTextFromRichText(markup);
  assert.match(text, /^Paklijst\n\nLees de reis \(https:\/\/www\.example\.nl\/reis\/albanie\/\) en dit \(https:\/\/example\.org\/x\)\./);
  assert.match(text, /- Slaapzak\n- Zaklamp/);
  assert.match(text, /\[Kaart\]/);
  assert.match(text, /Groet\nKantoor/);
  assert.match(text, /Dag \| Wat/);
  assert.match(text, /----/);
  assert.match(text, /info@example\.nl$/, 'mailto met het adres als tekst niet dubbel');
  assert.equal(absoluteMailUrl('https://a.nl', '//evil.nl/x'), '//evil.nl/x');
  assert.equal(absoluteMailUrl('https://a.nl', '#boven'), '#boven');
  assert.equal(plainTextFromRichText(''), '');

  const mail = renderMail({ title: 'T', intro: 'Hoi', headerColor: '#a95c4c', siteName: 'Avanta', richHtml: '<p style="x">Vet</p>', richText: 'Vet' });
  assert.match(mail.html, /<p style="x">Vet<\/p>/);
  assert.match(mail.text, /Hoi\n\nVet/);
});

test('formulier van de infobrief en hulpfuncties', () => {
  const ok = infobrieven.parseInput({ onderwerp: '  Infobrief\r\nAlbanië  ', tekst: '<p>Hallo</p><script>x</script>', ouders: 'ja' });
  assert.deepEqual(ok.errors, {});
  assert.deepEqual(ok.values, { subject: 'Infobrief Albanië', bodyHtml: '<p>Hallo</p>', includeNew: false, includeGuardians: true });
  const bad = infobrieven.parseInput({ onderwerp: 'x'.repeat(201), tekst: 'y'.repeat(100_001), nieuw: 'ja' });
  assert.ok(bad.errors.onderwerp && bad.errors.tekst);
  assert.equal(bad.values.subject.length, 200);
  assert.equal(bad.values.bodyHtml, '');
  assert.equal(bad.values.includeNew, true);
  assert.deepEqual(infobrieven.parseInput({}).values, { subject: '', bodyHtml: '', includeNew: false, includeGuardians: false });
  assert.match(infobrieven.readyToSend({ subject: ' ', body_html: '<p>x</p>' }), /onderwerp/);
  assert.match(infobrieven.readyToSend({ subject: 'x', body_html: '<p> </p>' }), /tekst/);
  assert.equal(infobrieven.readyToSend({ subject: 'x', body_html: '<p><img src="/a.jpg" alt=""></p>' }), '');
  assert.equal(tripLabel({ title: 'Albanië', trip_code: '27-ALB', departure_date: '2027-06-01' }), 'Albanië (27-ALB), vertrek 01-06-2027');
  assert.equal(tripLabel({ trip_title: 'IJsland' }), 'IJsland');
  assert.equal(overviewFileName({ id: 4, trip_code: '27 ALB/1' }), 'verzendoverzicht-infobrief-4-27-alb-1.xlsx');
  assert.equal(overviewFileName({ id: 4 }), 'verzendoverzicht-infobrief-4.xlsx');
  assert.equal(infobrieven.recipientName({ role: 'deelnemer', display_name: 'Jan', booking_id: null, anonymized_at: null }), '(aanmelding verwijderd)');
  assert.equal(infobrieven.recipientName({ role: 'deelnemer', display_name: 'Jan', booking_id: 1, anonymized_at: new Date() }), '(gegevens gewist)');
  assert.equal(infobrieven.recipientName({ role: 'ouder_voogd', display_name: 'Jan', booking_id: 1, anonymized_at: null }), 'Ouder of voogd van Jan');
  const persons = { openBlock: () => { throw new Error('kapot'); } };
  const original = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(infobrieven.guardianAddress(persons, { person_id: 3, guardian_data: 'x' }), { email: '', unreadable: true });
  } finally {
    console.error = original;
  }
  assert.deepEqual(infobrieven.guardianAddress(persons, { person_id: null, guardian_data: null }), { email: '', unreadable: false });
});

test('infobrief in het CRM', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (testContext) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  const mailer = {
    ready: false, failFor: new Set(), sent: [],
    configured() { return this.ready; },
    async send(message) {
      if (this.failFor.has(message.to)) throw Object.assign(new Error(`weigert ${message.to}`), { code: 'EENVELOPE', command: 'RCPT TO', response: `550 ${message.to} bestaat niet` });
      this.sent.push(message);
      return {};
    },
    recent() { return []; },
    server() { return {}; },
  };
  let clock = Date.parse('2027-05-01T10:00:00Z');
  const app = createApp({ db, masterKey: MASTER_KEY, mailer, now: () => clock });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const sender = app.locals.infobriefSender;
  testContext.after(async () => { await sender.idle(); server.close(); await db.close(); });
  const persons = createPersons({ vault: createVault(MASTER_KEY) });

  const hash = await hashPassword(PASSWORD);
  for (const role of ['kantoor', 'beheerder', 'reisleider', 'boekhouding', 'redacteur']) {
    await db.query('INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)', [`${role}@example.nl`, `Anna ${role}`, role, hash]);
  }
  const [trip] = await db.query("INSERT INTO trips (slug, title, trip_code, departure_date) VALUES ('albanie', 'Albanië', '27-ALB-1', '2027-06-01') RETURNING id");
  const [other] = await db.query("INSERT INTO trips (slug, title, trip_code, departure_date) VALUES ('oud', 'Oude reis', '20-OUD-1', '2020-06-01') RETURNING id");

  /**
   * Maakt een aanmelding voor Albanië.
   * @param {{reference: string, callName: string, lastName: string, email: string, status?: string, personId?: number}} input Gegevens.
   * @returns {Promise<number>} Id.
   */
  const insertBooking = async (input) => (await db.query(
    `INSERT INTO bookings (reference, trip_id, trip_title, trip_code, gender, first_names, call_name, last_name, email, mobile, street, postal_code, city,
       earlier_trip, credit_card, driver_interest, driver_before, payment_method, payment_choice, consent_at, person_id, status)
     VALUES ($1, $2, 'Albanië', '27-ALB-1', 'man', $3, $3, $4, $5, '0611', 'Straat 1', '1234 AB', 'Goes', false, false, false, false, 'handmatig', 'aanbetaling', now(), $6, $7)
     RETURNING id`,
    [input.reference, trip.id, input.callName, input.lastName, input.email, input.personId || null, input.status || 'bevestigd'],
  ))[0].id;
  const grietId = await db.transaction(async (client) => (await persons.savePerson(client, {
    gender: 'vrouw', first_names: 'Grietje', call_name: 'Griet', last_name: 'Bakker', email: 'griet@example.nl', mobile: '0612',
    street: 'Markt 1', postal_code: '4331 AA', city: 'Middelburg', guardian_name: 'Moeder Bakker', guardian_relation: 'ouder', guardian_email: 'ouder@example.nl',
  })).personId);
  const grietBooking = await insertBooking({ reference: 'AV-1', callName: 'Formulier', lastName: 'Bakker', email: 'oud@example.nl', personId: grietId });
  await insertBooking({ reference: 'AV-2', callName: 'Piet', lastName: 'Jansen', email: 'piet@example.nl', status: 'betaald' });
  await insertBooking({ reference: 'AV-3', callName: 'Nina', lastName: 'Nieuw', email: 'nieuw@example.nl', status: 'nieuw' });
  await insertBooking({ reference: 'AV-4', callName: 'Gerrit', lastName: 'Geannuleerd', email: 'weg@example.nl', status: 'geannuleerd' });
  await insertBooking({ reference: 'AV-5', callName: 'Quinten', lastName: 'Jansen', email: 'PIET@example.nl' });
  await insertBooking({ reference: 'AV-6', callName: 'Zara', lastName: 'Zonder', email: '' });
  const failBooking = await insertBooking({ reference: 'AV-7', callName: 'Fien', lastName: 'Fout', email: 'fout@example.nl' });

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
    const buffer = Buffer.from(await response.arrayBuffer());
    return { status: response.status, text: buffer.toString('utf8'), buffer, headers: response.headers, cookie: setCookie.split(';')[0].split('=')[1] || '' };
  };
  const login = async (role) => {
    const { cookie } = await request('/app/inloggen/', { form: { email: `${role}@example.nl`, password: PASSWORD } });
    const home = await request('/app/', { cookie });
    return { cookie, csrf: (home.text.match(/name="_csrf" value="([^"]+)"/) || [])[1] };
  };
  const kantoor = await login('kantoor');
  const beheerder = await login('beheerder');
  const others = { reisleider: await login('reisleider'), boekhouding: await login('boekhouding'), redacteur: await login('redacteur') };
  const post = (url, form = {}, session = kantoor) => request(url, { cookie: session.cookie, form: { _csrf: session.csrf, ...form } });
  const audits = async (action) => (await db.query('SELECT count(*)::int AS total FROM audit_log WHERE action = $1', [action]))[0].total;
  let infobriefId;

  await testContext.test('rechten: zonder sessie naar inloggen, andere rollen 403 en geen menu-item', async () => {
    assert.equal((await request('/app/infobrieven/')).status, 303);
    const [draft] = await db.query('INSERT INTO infobrieven (trip_id) VALUES ($1) RETURNING id', [trip.id]);
    for (const session of Object.values(others)) {
      assert.equal((await request('/app/infobrieven/', { cookie: session.cookie })).status, 403);
      assert.equal((await request(`/app/infobrieven/${draft.id}/`, { cookie: session.cookie })).status, 403);
      assert.equal((await request(`/app/infobrieven/${draft.id}/voorbeeld/`, { cookie: session.cookie })).status, 403);
      assert.equal((await request(`/app/infobrieven/${draft.id}/verzendoverzicht.xlsx`, { cookie: session.cookie })).status, 403);
      for (const action of ['', 'testmail/', 'versturen/', 'opnieuw/', 'verwijderen/']) {
        assert.equal((await post(`/app/infobrieven/${draft.id}/${action}`, { bevestig: 'ja' }, session)).status, 403, action);
      }
      assert.equal((await post('/app/infobrieven/nieuw/', { reis: String(trip.id) }, session)).status, 403);
      assert.doesNotMatch((await request('/app/', { cookie: session.cookie })).text, /href="\/app\/infobrieven\/"/);
    }
    assert.match((await request('/app/', { cookie: kantoor.cookie })).text, /href="\/app\/infobrieven\/"/);
    assert.equal((await request('/app/infobrieven/', { cookie: beheerder.cookie })).status, 200);
    await db.query('DELETE FROM infobrieven WHERE id = $1', [draft.id]);
  });

  await testContext.test('overzicht en nieuw concept; onbekende reis of infobrief 404, CSRF verplicht', async () => {
    const list = (await request('/app/infobrieven/', { cookie: kantoor.cookie })).text;
    assert.match(list, /Nog geen infobrieven/);
    assert.match(list, /Er is nog geen mailserver ingesteld/);
    assert.match(list, /<option value="\d+">Albanië \(27-ALB-1\), vertrek 01-06-2027 – 6 aanmeldingen<\/option>/, 'geannuleerd telt niet mee');
    assert.doesNotMatch(list, /Oude reis/, 'vertrek ver in het verleden staat er niet bij');
    assert.equal((await post('/app/infobrieven/nieuw/', { reis: '999999' })).status, 404);
    assert.equal((await post('/app/infobrieven/nieuw/', { reis: 'abc' })).status, 404);
    assert.equal((await request('/app/infobrieven/nieuw/', { cookie: kantoor.cookie, form: { reis: String(trip.id) } })).status, 403, 'zonder CSRF');
    const created = await post('/app/infobrieven/nieuw/', { reis: String(trip.id) });
    assert.equal(created.status, 303);
    infobriefId = Number(created.headers.get('location').match(/\/app\/infobrieven\/(\d+)\/$/)[1]);
    assert.equal(await audits('infobrief.aangemaakt'), 1);
    assert.equal((await request('/app/infobrieven/999999/', { cookie: kantoor.cookie })).status, 404);
    assert.equal((await post('/app/infobrieven/999999/versturen/', { bevestig: 'ja' })).status, 404);
    const page = (await request(`/app/infobrieven/${infobriefId}/`, { cookie: kantoor.cookie })).text;
    assert.match(page, /class="cms-richtext"/);
    assert.match(page, /Geef de infobrief eerst een onderwerp/);
    assert.match((await request(`/app/infobrieven/?reis=${trip.id}`, { cookie: kantoor.cookie })).text, /\(nog geen onderwerp\)/);
    assert.match((await request(`/app/infobrieven/?reis=${other.id}`, { cookie: kantoor.cookie })).text, /Nog geen infobrieven/);
  });

  await testContext.test('concept opslaan: opgeschoond, te lang geweigerd, ontvangers geteld', async () => {
    const tooLong = await post(`/app/infobrieven/${infobriefId}/`, { onderwerp: 'x'.repeat(201), tekst: '<p>Hoi</p>' });
    assert.equal(tooLong.status, 422);
    assert.match(tooLong.text, /hoogstens 200 tekens/);
    const saved = await post(`/app/infobrieven/${infobriefId}/`, { onderwerp: 'Infobrief Albanië', tekst: '<p>Neem je <a href="/paklijst/">paklijst</a> mee.</p><script>alert(1)</script>', ouders: 'ja' });
    assert.equal(saved.status, 303);
    assert.match(saved.headers.get('location'), /opgeslagen=opgeslagen/);
    const [row] = await db.query('SELECT subject, body_html, include_guardians, include_new FROM infobrieven WHERE id = $1', [infobriefId]);
    assert.deepEqual(row, { subject: 'Infobrief Albanië', body_html: '<p>Neem je <a href="/paklijst/">paklijst</a> mee.</p>', include_guardians: true, include_new: false });
    const page = (await request(`/app/infobrieven/${infobriefId}/?opgeslagen=opgeslagen`, { cookie: kantoor.cookie })).text;
    assert.match(page, /Het concept is opgeslagen/);
    assert.match(page, /naar <strong>4<\/strong> ontvangers: 3 deelnemers en 1 ouder of voogd/);
    assert.match(page, /2 overgeslagen/);
    assert.match(page, /Quinten Jansen: zelfde e-mailadres als een andere ontvanger/);
    assert.match(page, /Zara Zonder: geen e-mailadres/);
    assert.doesNotMatch(page, /Nina/, 'status nieuw niet zonder vinkje');
    assert.doesNotMatch(page, /piet@example|ouder@example|griet@example/, 'geen adressen van ontvangers op het scherm');
    assert.match(page, /Er is nog geen mailserver ingesteld/);
    assert.doesNotMatch(page, /action="[^"]+\/versturen\/"/, 'zonder mailserver geen verzendknop');
    assert.equal(await audits('infobrief.gewijzigd'), 1);
  });

  await testContext.test('voorbeeld: eigen CSP, aanhef, opgemaakte tekst met volledig adres, versie voor de ouder', async () => {
    const preview = await request(`/app/infobrieven/${infobriefId}/voorbeeld/`, { cookie: kantoor.cookie });
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get('content-security-policy'), /default-src 'none'.*frame-ancestors 'self'/);
    assert.match(preview.text, /Beste \[roepnaam\],/);
    assert.match(preview.text, /href="https?:\/\/[^"]+\/paklijst\/"/);
    assert.doesNotMatch(preview.text, /<script|cid:/);
    const guardian = await request(`/app/infobrieven/${infobriefId}/voorbeeld/?rol=ouder_voogd`, { cookie: kantoor.cookie });
    assert.match(guardian.text, /U ontvangt deze infobrief als ouder of voogd van \[roepnaam van de deelnemer\], die meegaat met Albanië/);
  });

  await testContext.test('testmail: zonder mailserver geweigerd, daarna naar het eigen adres met [Test], limiet', async () => {
    assert.equal((await post(`/app/infobrieven/${infobriefId}/testmail/`)).status, 409);
    mailer.ready = true;
    const sent = await post(`/app/infobrieven/${infobriefId}/testmail/`);
    assert.equal(sent.status, 303);
    assert.match(sent.headers.get('location'), /opgeslagen=testmail/);
    assert.equal(mailer.sent.length, 1);
    assert.equal(mailer.sent[0].to, 'kantoor@example.nl');
    assert.equal(mailer.sent[0].subject, '[Test] Infobrief Albanië');
    assert.match(mailer.sent[0].text, /Beste Anna,/);
    assert.equal(await audits('infobrief.testmail'), 1);
    mailer.failFor.add('kantoor@example.nl');
    const failed = await post(`/app/infobrieven/${infobriefId}/testmail/`);
    assert.equal(failed.status, 502);
    assert.match(failed.text, /Versturen mislukt/);
    mailer.failFor.delete('kantoor@example.nl');
    for (let index = 2; index < TESTMAIL_LIMIT; index++) await post(`/app/infobrieven/${infobriefId}/testmail/`);
    assert.equal((await post(`/app/infobrieven/${infobriefId}/testmail/`)).status, 429);
    mailer.sent.length = 0;
  });

  await testContext.test('versturen: bevestigen en aantal verplicht, één keer, daarna niet meer wijzigen of verwijderen', async () => {
    assert.equal((await post(`/app/infobrieven/${infobriefId}/versturen/`, { aantal: '4' })).status, 422);
    const changed = await post(`/app/infobrieven/${infobriefId}/versturen/`, { aantal: '3', bevestig: 'ja' });
    assert.equal(changed.status, 409);
    assert.match(changed.text, /intussen veranderd \(nu 4\)/);
    mailer.failFor.add('fout@example.nl');
    // Twee keer tegelijk op de knop: één keer in de wachtrij.
    const [first, second] = await Promise.all([
      post(`/app/infobrieven/${infobriefId}/versturen/`, { aantal: '4', bevestig: 'ja' }),
      post(`/app/infobrieven/${infobriefId}/versturen/`, { aantal: '4', bevestig: 'ja' }),
    ]);
    assert.deepEqual([first.status, second.status].sort(), [303, 409]);
    assert.equal(await audits('infobrief.verstuurd'), 1);
    const [{ total }] = await db.query("SELECT count(*)::int AS total FROM infobrief_recipients WHERE infobrief_id = $1 AND status IN ('wachtrij', 'bezig', 'verzonden', 'mislukt')", [infobriefId]);
    assert.equal(total, 4);
    assert.equal((await post(`/app/infobrieven/${infobriefId}/`, { onderwerp: 'Anders', tekst: '<p>x</p>' })).status, 409);
    assert.equal((await post(`/app/infobrieven/${infobriefId}/verwijderen/`, { bevestig: 'ja' })).status, 409);
    assert.equal((await post(`/app/infobrieven/${infobriefId}/versturen/`, { aantal: '4', bevestig: 'ja' })).status, 409);
  });

  await testContext.test('in de achtergrond: adres bij het versturen opgezocht, ouder en deelnemer, mislukt zonder adres', async () => {
    await sender.idle();
    await sender.runOnce();
    const addresses = mailer.sent.map((mail) => mail.to).sort();
    assert.deepEqual(addresses, ['griet@example.nl', 'ouder@example.nl', 'piet@example.nl'], 'adres van de persoon gaat voor het formulier; elk adres één keer');
    const toGriet = mailer.sent.find((mail) => mail.to === 'griet@example.nl');
    assert.equal(toGriet.subject, 'Infobrief Albanië');
    assert.match(toGriet.html, /Beste Griet,/);
    assert.match(toGriet.text, /Neem je paklijst \(https?:\/\/[^)]+\/paklijst\/\) mee\./);
    assert.match(mailer.sent.find((mail) => mail.to === 'ouder@example.nl').text, /ouder of voogd van Griet/);
    const [failed] = await db.query("SELECT status, note FROM infobrief_recipients WHERE booking_id = $1", [failBooking]);
    assert.equal(failed.status, 'mislukt');
    assert.doesNotMatch(failed.note, /@/, 'geen adres in de opmerking');
    const [brief] = await db.query('SELECT status, send_finished_at FROM infobrieven WHERE id = $1', [infobriefId]);
    assert.equal(brief.status, 'verzonden');
    assert.ok(brief.send_finished_at);
    const page = (await request(`/app/infobrieven/${infobriefId}/`, { cookie: kantoor.cookie })).text;
    assert.match(page, /Verzendoverzicht/);
    assert.match(page, /3 verzonden, 1 mislukt, 2 overgeslagen/);
    assert.match(page, /Ouder of voogd van Griet Bakker/);
    assert.match(page, /Anna kantoor/, 'wie verstuurde');
    assert.doesNotMatch(page, /griet@example|ouder@example|piet@example|fout@example/);
    assert.match(page, /Mislukte opnieuw versturen/);
    const list = (await request('/app/infobrieven/', { cookie: kantoor.cookie })).text;
    assert.match(list, /3 \(1 mislukt\)/);
  });

  await testContext.test('opnieuw: alleen mislukte, daarna verzonden; geen dubbele mails', async () => {
    mailer.failFor.clear();
    mailer.sent.length = 0;
    assert.equal((await post(`/app/infobrieven/${infobriefId}/opnieuw/`)).status, 303);
    await sender.idle();
    await sender.runOnce();
    assert.deepEqual(mailer.sent.map((mail) => mail.to), ['fout@example.nl']);
    assert.equal((await post(`/app/infobrieven/${infobriefId}/opnieuw/`)).status, 409, 'niets meer om opnieuw te doen');
    assert.equal(await audits('infobrief.opnieuw'), 1);
    const [brief] = await db.query('SELECT status FROM infobrieven WHERE id = $1', [infobriefId]);
    assert.equal(brief.status, 'verzonden');
  });

  await testContext.test('verzendoverzicht als .xlsx met audit; gewiste aanmelding zonder naam', async () => {
    await db.query("UPDATE bookings SET anonymized_at = now() WHERE id = $1", [grietBooking]);
    const file = await request(`/app/infobrieven/${infobriefId}/verzendoverzicht.xlsx`, { cookie: kantoor.cookie });
    assert.equal(file.status, 200);
    assert.match(file.headers.get('content-type'), /spreadsheetml/);
    assert.match(file.headers.get('content-disposition'), /verzendoverzicht-infobrief-\d+-27-alb-1\.xlsx/);
    assert.equal(file.buffer.subarray(0, 2).toString(), 'PK');
    assert.equal(await audits('infobrief.export'), 1);
    const page = (await request(`/app/infobrieven/${infobriefId}/`, { cookie: kantoor.cookie })).text;
    assert.match(page, /\(gegevens gewist\)/);
    assert.equal((await post(`/app/infobrieven/${infobriefId}/opnieuw/`)).status, 409);
  });

  await testContext.test('concept verwijderen met bevestiging; ook naar status nieuw', async () => {
    const created = await post('/app/infobrieven/nieuw/', { reis: String(trip.id) });
    const id = Number(created.headers.get('location').match(/(\d+)\/$/)[1]);
    await post(`/app/infobrieven/${id}/`, { onderwerp: 'Tweede', tekst: '<p>Nog een</p>', nieuw: 'ja' });
    const page = (await request(`/app/infobrieven/${id}/`, { cookie: kantoor.cookie })).text;
    assert.match(page, /naar <strong>3<\/strong> ontvangers: 3 deelnemers en 0 ouders of voogden/, 'nieuw telt nu mee, gewiste en ouders niet');
    assert.equal((await post(`/app/infobrieven/${id}/verwijderen/`)).status, 422);
    const removed = await post(`/app/infobrieven/${id}/verwijderen/`, { bevestig: 'ja' });
    assert.equal(removed.status, 303);
    assert.equal((await db.query('SELECT id FROM infobrieven WHERE id = $1', [id])).length, 0);
    assert.equal(await audits('infobrief.verwijderd'), 1);
    assert.equal((await post(`/app/infobrieven/${id}/opnieuw/`)).status, 404);
  });

  await testContext.test('verzender: limiet per minuut, zonder mailserver blijft de wachtrij staan, afgebroken = niet zeker', async () => {
    const [brief] = await db.query("INSERT INTO infobrieven (trip_id, subject, body_html, status, send_started_at) VALUES ($1, 'Limiet', '<p>x</p>', 'verzenden', now()) RETURNING id", [trip.id]);
    const ids = await db.query("SELECT id FROM bookings WHERE trip_id = $1 AND status <> 'geannuleerd' AND anonymized_at IS NULL AND email <> '' ORDER BY id", [trip.id]);
    for (const row of ids) await db.query("INSERT INTO infobrief_recipients (infobrief_id, booking_id, role) VALUES ($1, $2, 'deelnemer')", [brief.id, row.id]);
    await db.query("INSERT INTO infobrief_recipients (infobrief_id, booking_id, role) VALUES ($1, NULL, 'deelnemer')", [brief.id]);
    await db.query("INSERT INTO infobrief_recipients (infobrief_id, booking_id, role) SELECT $1, id, 'deelnemer' FROM bookings WHERE reference = 'AV-4'", [brief.id]);
    await db.query("INSERT INTO infobrief_recipients (infobrief_id, booking_id, role) SELECT $1, id, 'ouder_voogd' FROM bookings WHERE reference = 'AV-2'", [brief.id]);
    let time = Date.parse('2027-05-01T12:00:00Z');
    const settings = { get: (key) => (key === 'infobriefPerMinute' ? 2 : app.locals.settings.get(key)) };
    const own = createInfobriefSender({ db, mailer, settings, persons, now: () => time });
    mailer.sent.length = 0;
    mailer.ready = false;
    assert.deepEqual(await own.runOnce(), { sent: 0, failed: 0, skipped: 0 });
    assert.equal(mailer.sent.length, 0);
    mailer.ready = true;
    const firstRound = await own.runOnce();
    assert.equal(firstRound.sent + firstRound.skipped + firstRound.failed, 2, 'hoogstens 2 per minuut');
    assert.deepEqual(await own.runOnce(), { sent: 0, failed: 0, skipped: 0 }, 'binnen dezelfde minuut niets meer');
    for (let round = 0; round < 6; round++) {
      time += 61 * 1000;
      await own.runOnce();
    }
    const notes = await db.query('SELECT status, note FROM infobrief_recipients WHERE infobrief_id = $1 ORDER BY id', [brief.id]);
    assert.ok(notes.every((row) => !['wachtrij', 'bezig'].includes(row.status)));
    assert.ok(notes.some((row) => row.note === 'aanmelding verwijderd'));
    assert.ok(notes.some((row) => row.note === 'aanmelding geannuleerd'));
    assert.ok(notes.some((row) => row.status === 'overgeslagen' && row.note === 'geen e-mailadres'), 'ouder zonder blok');
    assert.equal((await db.query('SELECT status FROM infobrieven WHERE id = $1', [brief.id]))[0].status, 'verzonden');

    // Een regel die door een herstart op "bezig" bleef staan, wordt niet opnieuw verstuurd.
    await db.query("UPDATE infobrieven SET status = 'verzenden' WHERE id = $1", [brief.id]);
    await db.query("UPDATE infobrief_recipients SET status = 'bezig', updated_at = $2 WHERE id = (SELECT min(id) FROM infobrief_recipients WHERE infobrief_id = $1)", [brief.id, new Date(time - 20 * 60 * 1000).toISOString()]);
    mailer.sent.length = 0;
    await own.runOnce();
    assert.equal(mailer.sent.length, 0);
    const [stale] = await db.query('SELECT status, note FROM infobrief_recipients WHERE infobrief_id = $1 ORDER BY id LIMIT 1', [brief.id]);
    assert.deepEqual(stale, { status: 'onzeker', note: STALE_NOTE });
    const page = (await request(`/app/infobrieven/${brief.id}/`, { cookie: kantoor.cookie })).text;
    assert.match(page, /niet zeker verzonden/);
    assert.match(page, /niet vanzelf opnieuw verstuurd/);
    clock += 1;
  });

  await testContext.test('verzender: fout halverwege een ronde laat de rest in de wachtrij; te veel aanmeldingen = niet versturen', async () => {
    const [brief] = await db.query("INSERT INTO infobrieven (trip_id, subject, body_html, status, send_started_at) VALUES ($1, 'Halverwege', '<p>x</p>', 'verzenden', now()) RETURNING id", [trip.id]);
    const ids = await db.query("SELECT id FROM bookings WHERE reference IN ('AV-2', 'AV-3', 'AV-7') ORDER BY id");
    for (const row of ids) await db.query("INSERT INTO infobrief_recipients (infobrief_id, booking_id, role) VALUES ($1, $2, 'deelnemer')", [brief.id, row.id]);
    // Alleen het vastleggen na een geslaagde verzending mislukt: de regel mag dan niet op *mislukt* komen (dan zou
    // *Opnieuw versturen* hem een tweede keer sturen), maar blijft op *bezig*.
    let failures = 1;
    const flaky = {
      query: (sql, params) => {
        if (failures > 0 && sql.includes('SET status = $2, note = $3')) {
          failures--;
          return Promise.reject(Object.assign(new Error('database weg'), { code: 'ECONNRESET' }));
        }
        return db.query(sql, params);
      },
    };
    mailer.ready = true;
    mailer.sent.length = 0;
    const own = createInfobriefSender({ db: flaky, mailer, settings: { get: (key) => (key === 'infobriefPerMinute' ? 10 : app.locals.settings.get(key)) }, persons });
    await assert.rejects(own.runOnce(), /database weg/);
    const statuses = (await db.query('SELECT status FROM infobrief_recipients WHERE infobrief_id = $1 ORDER BY id', [brief.id])).map((row) => row.status);
    assert.deepEqual(statuses, ['bezig', 'wachtrij', 'wachtrij'], 'alleen de ene regel van het moment blijft hangen');
    assert.equal(mailer.sent.length, 1, 'de mail ging één keer weg');
    await own.runOnce();
    const after = (await db.query('SELECT status FROM infobrief_recipients WHERE infobrief_id = $1 ORDER BY id', [brief.id])).map((row) => row.status);
    assert.deepEqual(after, ['bezig', 'verzonden', 'verzonden']);

    const many = { query: async () => Array.from({ length: infobrieven.MAX_BOOKINGS + 1 }, (_, index) => ({ booking_id: index, display_name: 'x', email: `x${index}@example.nl` })) };
    assert.deepEqual(await infobrieven.recipientCandidates(many, { trip_id: 1, include_new: false, include_guardians: true }, persons), { list: [], tooMany: true });
  });

  await testContext.test('verzender: kick schrijft alleen aantallen of de soort fout in het log', async () => {
    const logs = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (line) => logs.push(line);
    console.error = (line) => logs.push(line);
    try {
      const broken = createInfobriefSender({ db: { query: async () => { throw Object.assign(new Error('weg'), { code: 'ECONNREFUSED' }); } }, mailer, settings: { get: () => 5 }, persons });
      broken.kick();
      await broken.idle();
      await new Promise((resolve) => setImmediate(resolve));
      const timer = broken.start();
      clearInterval(timer);
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
    assert.deepEqual(logs, ['infobrief: versturen mislukt (ECONNREFUSED)']);
  });
});
