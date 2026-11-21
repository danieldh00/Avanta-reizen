/**
 * Tests voor online betalen via Mollie (`crm/mollie.js`, `crm/online-payments.js`, `crm/online-payment-routes.js`):
 * Mollie-koppeling met een nep-fetch (vast adres, sleutel nooit in fouten), betaallink met token (verkeerd token 404),
 * uit zonder instelling of zonder https-adres, betaling starten (tussenpagina naar Mollie, herkomstcontrole, limiet),
 * webhook (onbekend id 200, afwijkend bedrag niet geregistreerd, geslaagd één keer in payments met status door),
 * terugkeerpagina, betaallink in de herinnering en op de betaalpagina in het CRM. Draait in een eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { hashPassword } = require('../src/crm/passwords');
const { COOKIE_NAME } = require('../src/crm/auth');
const { createMollie, isMollieUrl, MollieError, centsFromMollie, mollieAmount } = require('../src/crm/mollie');
const { START_LIMIT } = require('../src/crm/online-payment-routes');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'online_payments_test';
const MASTER_KEY = Buffer.alloc(32, 37);
const PASSWORD = 'een heel goed wachtwoord';
const API_KEY = 'test_abcdefghijklmnopqrstuvwxyz1234';

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
 * Een nep-Mollie: maakt betalingen aan en geeft hun stand terug; onthoudt elk verzoek.
 * @returns {{fetch: Function, calls: object[], remote: Map, failNext: boolean}} Nep-API.
 */
function fakeMollie() {
  const fake = { calls: [], remote: new Map(), failNext: false, counter: 0 };
  fake.fetch = async (url, init) => {
    fake.calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    if (fake.failNext) {
      fake.failNext = false;
      return { ok: false, status: 401, json: async () => ({}) };
    }
    if (init.method === 'POST' && url === 'https://api.mollie.com/v2/payments') {
      const body = JSON.parse(init.body);
      fake.counter += 1;
      const id = `tr_test${fake.counter}ab`;
      fake.remote.set(id, { id, status: 'open', amount: body.amount, metadata: body.metadata });
      return { ok: true, status: 201, json: async () => ({ id, _links: { checkout: { href: `https://www.mollie.com/checkout/select-method/${id}` } } }) };
    }
    const match = /^https:\/\/api\.mollie\.com\/v2\/payments\/(tr_\w+)$/.exec(url);
    if (init.method === 'GET' && match && fake.remote.has(match[1])) return { ok: true, status: 200, json: async () => fake.remote.get(match[1]) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return fake;
}

test('Mollie-koppeling: bedragen, uit zonder sleutel, fouten zonder sleutel', async () => {
  assert.deepEqual(mollieAmount(1250), { currency: 'EUR', value: '12.50' });
  assert.equal(centsFromMollie({ currency: 'EUR', value: '505.00' }), 50500);
  assert.equal(centsFromMollie({ currency: 'USD', value: '5.00' }), null);
  assert.equal(centsFromMollie({ currency: 'EUR', value: '5' }), null);
  assert.equal(isMollieUrl('https://www.mollie.com/checkout/x'), true);
  assert.equal(isMollieUrl('https://x.example/#mollie.com/'), false);
  assert.equal(isMollieUrl('https://evilmollie.com/'), false);
  assert.equal(isMollieUrl('http://www.mollie.com/'), false);
  const values = { mollieEnabled: false, mollieApiKey: API_KEY };
  const settings = { get: (key) => values[key] };
  const fake = fakeMollie();
  const mollie = createMollie({ settings, fetchImpl: fake.fetch });
  assert.equal(mollie.enabled(), false);
  await assert.rejects(mollie.getPayment('tr_test1ab'), (error) => error instanceof MollieError && error.code === 'not_configured');
  values.mollieEnabled = true;
  values.mollieApiKey = 'sk_verkeerd';
  assert.equal(mollie.enabled(), false, 'ongeldige sleutel');
  values.mollieApiKey = API_KEY;
  await assert.rejects(mollie.getPayment('../methods'), (error) => error.code === 'invalid_id');
  fake.failNext = true;
  await assert.rejects(mollie.getPayment('tr_test1ab'), (error) => error.code === 'http_401' && !error.message.includes(API_KEY));
  const created = await mollie.createPayment({ amountCents: 500, description: 'x', redirectUrl: 'https://a.example/', webhookUrl: 'https://a.example/w', metadata: {} });
  assert.match(created.checkoutUrl, /^https:\/\/www\.mollie\.com\//);
  assert.equal(fake.calls.at(-1).headers.authorization, `Bearer ${API_KEY}`);
});

test('online betalen', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  const fake = fakeMollie();
  const mailer = {
    sent: [],
    configured() { return true; },
    async send(message) { this.sent.push(message); return {}; },
    recent() { return []; },
    server() { return {}; },
  };
  const app = createApp({ db, masterKey: MASTER_KEY, mailer, mollieFetch: fake.fetch, now: () => Date.parse('2027-03-01T10:00:00Z') });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await db.close(); });
  const { settings, onlinePayments, paymentReminders } = app.locals;

  const hash = await hashPassword(PASSWORD);
  await db.query("INSERT INTO users (email, name, role, password_hash) VALUES ('kantoor@example.nl', 'Kantoor', 'kantoor', $1)", [hash]);
  await db.query("INSERT INTO trips (slug, title, trip_code, departure_date) VALUES ('albanie', 'Albanië', '27-ALB-1', '2027-06-01')");
  /**
   * Maakt een aanmelding met reissom en SGR (aanbetaling 500 cent open en te laat).
   * @param {string} reference Referentie.
   * @param {string} [status] Status.
   * @returns {Promise<number>} Id.
   */
  const booking = async (reference, status = 'bevestigd') => {
    const [row] = await db.query(
      `INSERT INTO bookings (reference, trip_id, trip_title, trip_code, departure_date, status, gender, first_names, call_name, last_name, email, mobile,
         street, postal_code, city, earlier_trip, credit_card, driver_interest, driver_before, payment_method, payment_choice, consent_at, created_at)
       SELECT $1, t.id, t.title, t.trip_code, t.departure_date, $2, 'man', 'Jan', 'Jan', 'Jansen', 'jan@example.nl', '06', 'Straat 1', '1234 AB', 'Goes',
              false, false, false, false, 'handmatig', 'aanbetaling', now(), '2027-01-10T10:00:00Z' FROM trips t RETURNING id`,
      [reference, status],
    );
    await db.query("INSERT INTO booking_charges (booking_id, kind, amount_cents) VALUES ($1, 'reissom', 50000), ($1, 'sgr', 500)", [row.id]);
    return row.id;
  };
  const openId = await booking('AV-2027-OPEN0001');
  const cancelledId = await booking('AV-2027-ANNU0002', 'geannuleerd');

  /**
   * Doet een verzoek zonder redirects te volgen.
   * @param {string} url Pad.
   * @param {{form?: object, cookie?: string, headers?: object}} [init] Formulier, sessiecookie en extra koppen.
   * @returns {Promise<{status: number, text: string, headers: Headers, cookie: string}>} Antwoord.
   */
  const request = async (url, init = {}) => {
    const headers = { ...(init.headers || {}) };
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
  const path = onlinePayments.pathFor(openId);

  await t.test('uit: geen knop, wel de betaalinstructie; starten 503', async () => {
    assert.equal(onlinePayments.enabled(), false);
    assert.equal(onlinePayments.linkFor(openId), '');
    const page = await request(path);
    assert.equal(page.status, 200);
    assert.match(page.text, /niet beschikbaar/);
    assert.doesNotMatch(page.text, /Betalen met iDEAL/);
    assert.equal((await request(path, { form: {} })).status, 503);
    // Aan met sleutel, maar zonder https-basisadres: nog steeds uit.
    await settings.update({ values: { mollieEnabled: true, mollieApiKey: API_KEY, siteUrl: 'http://localhost:3400' } });
    assert.equal(onlinePayments.enabled(), false);
    await settings.update({ values: { siteUrl: 'https://avanta.example' } });
    assert.equal(onlinePayments.enabled(), true);
  });

  await t.test('betaallink: verkeerd token of id 404, geen naam op de pagina', async () => {
    assert.equal((await request(`/betalen/${openId}-${'A'.repeat(22)}/`)).status, 404);
    assert.equal((await request(`/betalen/${cancelledId}-${path.split('-').pop().replace('/', '')}/`)).status, 404, 'token van een andere aanmelding');
    assert.equal((await request('/betalen/999999-abc/')).status, 404);
    const page = await request(path);
    assert.equal(page.status, 200);
    assert.match(page.text, /AV-2027-OPEN0001/);
    assert.match(page.text, /€5,-/);
    assert.match(page.text, /Betalen met iDEAL/);
    assert.doesNotMatch(page.text, /Jansen|jan@example\.nl/);
    assert.match(page.headers.get('cache-control'), /no-store/);
    const cancelled = await request(onlinePayments.pathFor(cancelledId));
    assert.match(cancelled.text, /niet \(meer\) online betaald/);
    assert.equal((await request(onlinePayments.pathFor(cancelledId), { form: {} })).status, 409);
  });

  await t.test('starten: herkomstcontrole, tussenpagina naar Mollie, regel in de database, geen persoonsgegevens naar Mollie', async () => {
    assert.equal((await request(path, { form: {}, headers: { origin: 'https://evil.example' } })).status, 403);
    const before = fake.calls.length;
    const started = await request(path, { form: {} });
    assert.equal(started.status, 200);
    assert.match(started.text, /https:\/\/www\.mollie\.com\/checkout\/select-method\/tr_test\d+ab/);
    assert.equal(started.headers.get('referrer-policy'), 'no-referrer');
    const call = fake.calls.slice(before).find((entry) => entry.method === 'POST');
    assert.deepEqual(call.body.amount, { currency: 'EUR', value: '5.00' });
    assert.equal(call.body.webhookUrl, 'https://avanta.example/betalen/webhook/');
    assert.equal(call.body.redirectUrl, `https://avanta.example${path}klaar/`);
    assert.deepEqual(call.body.metadata, { bookingId: openId, kind: 'aanbetaling' });
    assert.doesNotMatch(JSON.stringify(call.body), /Jansen|jan@example/);
    const rows = await db.query('SELECT kind, amount_cents, status FROM online_payments WHERE booking_id = $1', [openId]);
    assert.deepEqual(rows, [{ kind: 'aanbetaling', amount_cents: 500, status: 'open' }]);
    // Tweede tabblad of dubbelklik: hetzelfde betaalscherm, geen tweede betaling bij Mollie.
    const posts = fake.calls.filter((entry) => entry.method === 'POST').length;
    const [again, third] = await Promise.all([request(path, { form: {} }), request(path, { form: {} })]);
    assert.equal(again.status, 200);
    assert.equal(third.status, 200);
    assert.equal(fake.calls.filter((entry) => entry.method === 'POST').length, posts, 'open betaling hergebruikt');
    assert.equal((await db.query('SELECT 1 FROM online_payments WHERE booking_id = $1', [openId])).length, 1);
    await db.query("UPDATE online_payments SET status = 'pending' WHERE booking_id = $1", [openId]);
    const busy = await request(path, { form: {} });
    assert.equal(busy.status, 409);
    assert.match(busy.text, /al een betaling voor deze aanmelding in behandeling/);
    await db.query("UPDATE online_payments SET status = 'open' WHERE booking_id = $1", [openId]);
  });

  await t.test('webhook: onbekend 200, afwijkend bedrag niet geregistreerd, geslaagd één keer met status door', async () => {
    assert.equal((await request('/betalen/webhook/', { form: { id: 'tr_onbekend1' } })).status, 200);
    assert.equal((await request('/betalen/webhook/', { form: { id: '../x' } })).status, 200);
    const [{ provider_ref: ref }] = await db.query('SELECT provider_ref FROM online_payments WHERE booking_id = $1', [openId]);
    fake.remote.get(ref).status = 'paid';
    fake.remote.get(ref).paidAt = '2027-03-01T09:30:00+00:00';
    fake.remote.get(ref).amount = { currency: 'EUR', value: '0.01' };
    await request('/betalen/webhook/', { form: { id: ref } });
    assert.equal((await db.query('SELECT 1 FROM payments WHERE booking_id = $1', [openId])).length, 0, 'afwijkend bedrag');
    fake.remote.get(ref).amount = { currency: 'EUR', value: '5.00' };
    fake.failNext = true;
    assert.equal((await request('/betalen/webhook/', { form: { id: ref } })).status, 503, 'Mollie niet bereikbaar: later opnieuw');
    assert.equal((await request('/betalen/webhook/', { form: { id: ref } })).status, 200);
    assert.equal((await request('/betalen/webhook/', { form: { id: ref } })).status, 200, 'tweede melding');
    // Een later binnenkomend, ouder antwoord zet de betaalde stand niet terug.
    fake.remote.get(ref).status = 'pending';
    await request('/betalen/webhook/', { form: { id: ref } });
    assert.equal((await db.query('SELECT status FROM online_payments WHERE provider_ref = $1', [ref]))[0].status, 'paid');
    fake.remote.get(ref).status = 'paid';
    const paid = await db.query('SELECT amount_cents, method, received_on::text AS day, provider_ref, created_by FROM payments WHERE booking_id = $1', [openId]);
    assert.deepEqual(paid, [{ amount_cents: 500, method: 'ideal', day: '2027-03-01', provider_ref: ref, created_by: null }]);
    const [{ status }] = await db.query('SELECT status FROM bookings WHERE id = $1', [openId]);
    assert.equal(status, 'aanbetaald');
    const events = await db.query('SELECT to_status, user_id, note FROM booking_events WHERE booking_id = $1', [openId]);
    assert.equal(events.length, 1);
    assert.match(events[0].note, /online betaling van €5,-/);
    await app.locals.appLog.flush();
    const log = await db.query("SELECT message FROM app_logs WHERE source = 'mollie'");
    assert.ok(log.some((row) => /wijkt af/.test(row.message)));
    assert.ok(log.every((row) => !row.message.includes(API_KEY)));
  });

  await t.test('terugkeerpagina: betaald, en daarna het restant online', async () => {
    const back = await request(`${path}klaar/`);
    assert.match(back.text, /je betaling is ontvangen/);
    const page = await request(path);
    assert.match(page.text, /restant/);
    assert.match(page.text, /€500,-/);
  });

  await t.test('betaallink in de herinnering en op de betaalpagina in het CRM', async () => {
    await db.query('DELETE FROM payments WHERE booking_id = $1', [openId]);
    const outcome = await paymentReminders.send({ bookingId: openId, trigger: 'automatisch', kind: 'aanbetaling' });
    assert.equal(outcome.status, 'ok');
    const mail = mailer.sent.at(-1);
    assert.match(mail.text, new RegExp(`Aanbetaling online betalen: https://avanta\\.example${path}`));
    assert.match(mail.html, new RegExp(`href="https://avanta\\.example${path}"`));
    const login = await request('/app/inloggen/', { form: { email: 'kantoor@example.nl', password: PASSWORD } });
    const crm = await request(`/app/betalingen/${openId}/`, { cookie: login.cookie });
    assert.match(crm.text, /Online betalen/);
    assert.match(crm.text, new RegExp(`https://avanta\\.example${path}`));
    assert.match(crm.text, /Betaald op/);
  });

  await t.test('limiet op starten per aanmelding', async () => {
    let last;
    for (let i = 0; i < START_LIMIT + 1; i++) last = await request(path, { form: {} });
    assert.equal(last.status, 429);
  });
});
