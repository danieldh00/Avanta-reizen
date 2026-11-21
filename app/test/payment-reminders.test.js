/**
 * Tests voor de betaalherinneringen (migratie 27, `crm/payment-reminders.js`): welke termijn, inhoud zonder bijzondere
 * gegevens; met de hand vanaf de betaalpagina (rechten, CSRF, geen mailserver 503, dubbel 409, geannuleerd of niets
 * open 422, mislukt 502 met regel, audit); de dagelijkse ronde (alleen met de schakelaar, interval en maximum, adres
 * van de persoon); laatste herinnering in het overzicht. Draait in een eigen schema met een nep-mailer.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { hashPassword } = require('../src/crm/passwords');
const { COOKIE_NAME } = require('../src/crm/auth');
const { reminderKind, reminderContent } = require('../src/crm/payment-reminders');
const { REMINDER_LIMIT } = require('../src/crm/payment-routes');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'payment_reminders_test';
const MASTER_KEY = Buffer.alloc(32, 31);
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

test('termijn en inhoud van een herinnering', () => {
  assert.equal(reminderKind({ overdue: 'restant', depositOpenCents: 0, balanceCents: 100 }), 'restant');
  assert.equal(reminderKind({ overdue: '', depositOpenCents: 500, balanceCents: 1000 }), 'aanbetaling');
  assert.equal(reminderKind({ overdue: '', depositOpenCents: 0, balanceCents: 1000 }), 'restant');
  assert.equal(reminderKind({ overdue: '', depositOpenCents: 0, balanceCents: 0 }), '');
  const mail = reminderContent({
    booking: { reference: 'AV-2027-X', trip_title: 'Albanië', departure_date: '2027-06-01', first_names: 'Jan', call_name: 'Jantje' },
    summary: { totalCents: 50500, paidCents: 0, depositOpenCents: 500, balanceCents: 50500, depositDueOn: '2027-02-01', balanceDueOn: '2027-04-20', overdue: 'aanbetaling' },
    kind: 'aanbetaling',
    paymentText: 'Maak over naar NL00 TEST.',
  });
  assert.equal(mail.subject, 'Herinnering: aanbetaling voor Albanië (AV-2027-X)');
  assert.match(mail.content.intro, /Beste Jantje/);
  assert.match(mail.content.intro, /nog niet \(helemaal\) ontvangen/);
  assert.deepEqual(mail.content.rows.find((row) => row[0].startsWith('Nu te betalen')), ['Nu te betalen (aanbetaling)', '€5,-']);
  assert.match(mail.content.body, /NL00 TEST[\s\S]*AV-2027-X/);
});

test('betaalherinneringen', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  const mailer = {
    ready: false, fail: false, sent: [],
    configured() { return this.ready; },
    async send(message) {
      if (this.fail) throw Object.assign(new Error('weigert jan@example.nl'), { code: 'EENVELOPE', command: 'RCPT TO' });
      this.sent.push(message);
      return {};
    },
    recent() { return []; },
    server() { return {}; },
  };
  let clock = Date.parse('2027-03-01T10:00:00Z');
  const app = createApp({ db, masterKey: MASTER_KEY, mailer, now: () => clock });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await db.close(); });
  const { settings, paymentReminders } = app.locals;

  const hash = await hashPassword(PASSWORD);
  for (const [email, role] of [['kantoor@example.nl', 'kantoor'], ['leider@example.nl', 'reisleider']]) {
    await db.query('INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)', [email, role, role, hash]);
  }
  await db.query("INSERT INTO trips (slug, title, trip_code, departure_date) VALUES ('albanie', 'Albanië', '27-ALB-1', '2027-06-01')");
  /**
   * Maakt een aanmelding met reissom en SGR.
   * @param {string} reference Referentie.
   * @param {{status?: string, createdAt?: string, email?: string}} [details] Status, aanmelddatum, e-mailadres.
   * @returns {Promise<number>} Id.
   */
  const booking = async (reference, details = {}) => {
    const [row] = await db.query(
      `INSERT INTO bookings (reference, trip_id, trip_title, trip_code, departure_date, status, gender, first_names, call_name, last_name, email, mobile,
         street, postal_code, city, earlier_trip, credit_card, driver_interest, driver_before, payment_method, payment_choice, consent_at, created_at)
       SELECT $1, t.id, t.title, t.trip_code, t.departure_date, $2, 'man', 'Jan', 'Jan', 'Jansen', $3, '06', 'Straat 1', '1234 AB', 'Goes',
              false, false, false, false, 'handmatig', 'aanbetaling', now(), $4 FROM trips t RETURNING id`,
      [reference, details.status || 'bevestigd', details.email ?? 'jan@example.nl', details.createdAt || '2027-01-10T10:00:00Z'],
    );
    await db.query("INSERT INTO booking_charges (booking_id, kind, amount_cents) VALUES ($1, 'reissom', 50000), ($1, 'sgr', 500)", [row.id]);
    return row.id;
  };
  const lateId = await booking('AV-2027-LAAT0001');
  const cancelledId = await booking('AV-2027-ANNU0002', { status: 'geannuleerd' });

  /**
   * Doet een verzoek zonder redirects te volgen.
   * @param {string} url Pad.
   * @param {{form?: object, cookie?: string}} [init] Formulier en sessiecookie.
   * @returns {Promise<{status: number, text: string, headers: Headers, cookie: string}>} Antwoord.
   */
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
  const login = async (email) => {
    const response = await request('/app/inloggen/', { form: { email, password: PASSWORD } });
    const home = await request('/app/', { cookie: response.cookie });
    return { cookie: response.cookie, csrf: (home.text.match(/name="_csrf" value="([^"]+)"/) || [])[1] };
  };
  const kantoor = await login('kantoor@example.nl');
  const leider = await login('leider@example.nl');
  const remind = (id, session = kantoor) => request(`/app/betalingen/${id}/herinnering/`, { cookie: session.cookie, form: { _csrf: session.csrf } });

  await t.test('met de hand: rechten, CSRF, geen mailserver, geannuleerd', async () => {
    assert.equal((await remind(lateId, leider)).status, 403);
    assert.equal((await request(`/app/betalingen/${lateId}/herinnering/`, { cookie: kantoor.cookie, form: {} })).status, 403, 'zonder CSRF-token');
    assert.equal((await remind(999999)).status, 404);
    const noServer = await remind(lateId);
    assert.equal(noServer.status, 503);
    assert.match(noServer.text, /geen mailserver/);
    mailer.ready = true;
    assert.equal((await remind(cancelledId)).status, 422);
    assert.equal(mailer.sent.length, 0);
  });

  await t.test('met de hand: verstuurd, met regel en audit; dubbel 409', async () => {
    const page = await request(`/app/betalingen/${lateId}/`, { cookie: kantoor.cookie });
    assert.match(page.text, /Herinnering sturen/);
    const response = await remind(lateId);
    assert.equal(response.status, 303);
    assert.equal(mailer.sent.length, 1);
    const [mail] = mailer.sent;
    assert.equal(mail.to, 'jan@example.nl');
    assert.equal(mail.kind, 'herinnering-betaling');
    assert.match(mail.subject, /aanbetaling voor Albanië \(AV-2027-LAAT0001\)/);
    assert.match(mail.text, /€5,-/);
    const [row] = await db.query('SELECT kind, trigger, sent, error, created_by FROM payment_reminders WHERE booking_id = $1', [lateId]);
    assert.deepEqual([row.kind, row.trigger, row.sent, row.error], ['aanbetaling', 'handmatig', true, '']);
    assert.ok(row.created_by);
    const audit = await db.query("SELECT entity_id FROM audit_log WHERE action = 'betaling.herinnering'");
    assert.deepEqual(audit.map((entry) => entry.entity_id), [String(lateId)]);
    const again = await remind(lateId);
    assert.equal(again.status, 409);
    assert.equal(mailer.sent.length, 1);
    assert.match((await request(`/app/betalingen/${lateId}/`, { cookie: kantoor.cookie })).text, /aanbetaling,\s*door kantoor, verstuurd/);
    assert.match((await request('/app/betalingen/?weergave=te-laat', { cookie: kantoor.cookie })).text, /01-03-2027/, 'laatste herinnering in het overzicht');
  });

  await t.test('mislukt: 502, regel zonder adres', async () => {
    clock += 60 * 60 * 1000;
    mailer.fail = true;
    const failed = await remind(lateId);
    assert.equal(failed.status, 502);
    mailer.fail = false;
    const [row] = await db.query('SELECT sent, error FROM payment_reminders WHERE booking_id = $1 ORDER BY id DESC LIMIT 1', [lateId]);
    assert.equal(row.sent, false);
    assert.match(row.error, /Versturen mislukt/);
    assert.doesNotMatch(row.error, /jan@example\.nl/);
  });

  await t.test('niets open: 422', async () => {
    const paidId = await booking('AV-2027-KLAAR003');
    await db.query("INSERT INTO payments (booking_id, amount_cents, method, received_on) VALUES ($1, 50500, 'bank', '2027-02-01')", [paidId]);
    assert.equal((await remind(paidId)).status, 422);
    assert.doesNotMatch((await request(`/app/betalingen/${paidId}/`, { cookie: kantoor.cookie })).text, /Herinnering sturen/);
  });

  await t.test('dagelijkse ronde: alleen met de schakelaar, interval en maximum', async () => {
    await db.query('DELETE FROM payment_reminders');
    mailer.sent.length = 0;
    const personId = (await db.query("INSERT INTO persons (first_names, call_name, last_name, email, match_key) VALUES ('Piet', 'Piet', 'Bakker', 'nieuw@example.nl', 'x') RETURNING id"))[0].id;
    const linkedId = await booking('AV-2027-PERS0004', { email: 'oud@example.nl' });
    await db.query('UPDATE bookings SET person_id = $2 WHERE id = $1', [linkedId, personId]);
    assert.deepEqual(await paymentReminders.runDaily(), { sent: 0, failed: 0, skipped: 0 }, 'schakelaar staat uit');
    await settings.update({ values: { paymentReminderAuto: true, paymentReminderEveryDays: '7', paymentReminderMax: '2' } });
    const newId = await booking('AV-2027-NIEUW005', { status: 'nieuw', email: 'derde@example.nl' });
    const first = await paymentReminders.runDaily();
    assert.equal(first.sent, 2);
    assert.ok(mailer.sent.every((mail) => mail.to !== 'derde@example.nl'), 'nieuwe (niet bevestigde) aanmelding krijgt geen automatische herinnering');
    await db.query("UPDATE bookings SET status = 'geannuleerd' WHERE id = $1", [newId]);
    assert.deepEqual(mailer.sent.map((mail) => mail.to).sort(), ['jan@example.nl', 'nieuw@example.nl'], 'adres van de persoon gaat voor');
    assert.equal((await paymentReminders.runDaily()).sent, 0, 'binnen het interval niets');
    clock += 7 * 24 * 60 * 60 * 1000;
    assert.equal((await paymentReminders.runDaily()).sent, 2);
    clock += 7 * 24 * 60 * 60 * 1000;
    assert.equal((await paymentReminders.runDaily()).sent, 0, 'maximum bereikt');
    const rows = await db.query("SELECT count(*)::int AS total FROM payment_reminders WHERE trigger = 'automatisch' AND sent");
    assert.equal(rows[0].total, 4);
  });

  await t.test('dagelijkse ronde: handmatige en mislukte pogingen tellen mee, geen dubbele mail bij overlap', async () => {
    await db.query('DELETE FROM payment_reminders');
    await db.query("UPDATE bookings SET status = 'geannuleerd' WHERE reference = 'AV-2027-PERS0004'");
    mailer.sent.length = 0;
    // Met de hand vandaag: de ronde slaat deze termijn over (interval vanaf elke poging).
    assert.equal((await remind(lateId)).status, 303);
    assert.equal((await paymentReminders.runDaily()).sent, 0, 'handmatige herinnering telt mee voor het interval');
    // Twee rondes tegelijk: onder het slot maar één mail.
    clock += 7 * 24 * 60 * 60 * 1000;
    const [one, two] = await Promise.all([
      paymentReminders.send({ bookingId: lateId, trigger: 'automatisch', kind: 'aanbetaling' }),
      paymentReminders.send({ bookingId: lateId, trigger: 'automatisch', kind: 'aanbetaling' }),
    ]);
    assert.deepEqual([one.status, two.status].sort(), ['ok', 'te-snel']);
    // Mislukte automatische pogingen tellen voor het maximum (2): daarna stopt de ronde, ook bij een weigerend adres.
    mailer.fail = true;
    clock += 7 * 24 * 60 * 60 * 1000;
    assert.equal((await paymentReminders.runDaily()).failed, 1);
    clock += 7 * 24 * 60 * 60 * 1000;
    assert.deepEqual(await paymentReminders.runDaily(), { sent: 0, failed: 0, skipped: 1 }, 'maximum telt ook mislukte pogingen');
    mailer.fail = false;
  });

  await t.test('limiet op herinneringen met de hand per medewerker', async () => {
    let last;
    for (let i = 0; i < REMINDER_LIMIT; i++) last = await remind(lateId);
    assert.notEqual(last.status, 429);
    assert.equal((await remind(lateId)).status, 429);
  });
});
