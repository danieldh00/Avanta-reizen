/**
 * Tests voor Mijn reizen, Mijn gegevens en wachtwoord wijzigen in het reizigersaccount (CMS-pakket J3): alleen de
 * aanmeldingen met het eigen e-mailadres, komende en eerdere reizen, nooit bijzondere gegevens, de code per e-mail vóór
 * export en wachtwoord wijzigen (pogingen, verlopen, per sessie), de Excel-export en de .xlsx-schrijver zelf.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { hashPassword } = require('../src/crm/passwords');
const { COOKIE_NAME } = require('../src/account/routes');
const { createXlsx, defuseFormula, columnName, escapeXml } = require('../src/export/xlsx');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'account_trips_test';
const MASTER_KEY = Buffer.alloc(32, 31);
const PASSWORD = 'op reis met avanta';

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
 * Leest de bestanden uit een zip (alleen wat `createXlsx` maakt: deflate, geen data descriptors).
 * @param {Buffer} buffer Het zip-bestand.
 * @returns {Record<string, string>} Inhoud per bestandsnaam.
 */
function unzip(buffer) {
  const files = {};
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const start = offset + 30 + nameLength;
    const data = zlib.inflateRawSync(buffer.subarray(start, start + size));
    assert.equal(zlib.crc32(data), buffer.readUInt32LE(offset + 14), `crc ${name}`);
    files[name] = data.toString('utf8');
    offset = start + size;
  }
  return files;
}

test('xlsx: zip met werkbladen, escaping, getallen en geen formules', () => {
  assert.equal(columnName(0), 'A');
  assert.equal(columnName(25), 'Z');
  assert.equal(columnName(26), 'AA');
  assert.equal(defuseFormula('=SOM(A1)'), "'=SOM(A1)");
  assert.equal(defuseFormula('-5'), "'-5");
  assert.equal(defuseFormula('Gewoon'), 'Gewoon');
  assert.equal(escapeXml('a<b>&"\u0001'), 'a&lt;b&gt;&amp;&quot;');
  const files = unzip(createXlsx([{ name: 'Reizen/2027', rows: [['Kop', 'Bedrag'], ['<script>', 12.5], ['=HYPERLINK("http://x")', null]] }]));
  assert.ok(files['[Content_Types].xml'].includes('/xl/worksheets/sheet1.xml'));
  assert.match(files['xl/workbook.xml'], /<sheet name="Reizen 2027"/);
  const sheet = files['xl/worksheets/sheet1.xml'];
  assert.match(sheet, /<c r="A1" t="inlineStr" s="1">/);
  assert.match(sheet, /&lt;script&gt;/);
  assert.match(sheet, /<c r="B2"><v>12\.5<\/v><\/c>/);
  assert.match(sheet, /'=HYPERLINK\(&quot;http:\/\/x&quot;\)/);
  assert.doesNotMatch(sheet, /<f>/);
});

test('Mijn reizen en Mijn gegevens', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
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

  const hash = await hashPassword(PASSWORD);
  for (const email of ['anna@example.nl', 'kees@example.nl']) {
    await db.query('INSERT INTO customer_accounts (email, password_hash, verified_at) VALUES ($1, $2, now())', [email, hash]);
  }
  const [future] = await db.query("INSERT INTO trips (slug, title, departure_date) VALUES ('namibie-2099', 'Avontuur in Namibië', '2099-07-01') RETURNING id");
  const [past] = await db.query("INSERT INTO trips (slug, title, departure_date, published) VALUES ('albanie-2020', 'Albanië 2020', '2020-07-01', false) RETURNING id");
  const insertBooking = (reference, tripId, title, date, email, status) => db.query(
    `INSERT INTO bookings (reference, trip_id, trip_title, trip_code, departure_date, status, gender, first_names, call_name, last_name, email, mobile,
       street, postal_code, city, earlier_trip, credit_card, driver_interest, driver_before, payment_method, payment_choice, price_cents, sensitive_data, consent_at)
     VALUES ($1, $2, $3, '99-NAM-1', $4, $5, 'vrouw', 'Anna Maria', 'Anna', 'Jansen', $6, '0612345678', 'Dorpsstraat 1', '4331 AB', 'Middelburg',
       false, false, false, false, 'handmatig', 'aanbetaling', 189900, '', now())`,
    [reference, tripId, title, date, status, email],
  );
  await insertBooking('AV-2099-AAAA0001', future.id, 'Avontuur in Namibië', '2099-07-01', 'Anna@Example.nl', 'aanbetaald');
  await insertBooking('AV-2020-AAAA0002', past.id, 'Albanië 2020', '2020-07-01', 'anna@example.nl', 'betaald');
  await insertBooking('AV-2099-KEES0003', future.id, 'Avontuur in Namibië', '2099-07-01', 'kees@example.nl', 'nieuw');

  /**
   * Doet een verzoek; geeft status, tekst, koppen, nieuwe cookie en de body als buffer.
   * @param {string} path Pad.
   * @param {{cookie?: string, form?: object}} [init] Cookie en formulier.
   * @returns {Promise<object>} Antwoord.
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
    const buffer = Buffer.from(await response.arrayBuffer());
    return { status: response.status, text: buffer.toString('utf8'), buffer, headers: response.headers, cookie: setCookie.split(';')[0].split('=')[1] || '', location: response.headers.get('location') || '' };
  };

  /**
   * Logt in en geeft cookie en CSRF-token.
   * @param {string} email E-mailadres.
   * @returns {Promise<{cookie: string, csrf: string}>} Sessie.
   */
  const login = async (email) => {
    const response = await request('/account/inloggen/', { form: { email, password: PASSWORD } });
    assert.equal(response.status, 303, `inloggen ${email}`);
    const page = await request('/account/', { cookie: response.cookie });
    return { cookie: response.cookie, csrf: (page.text.match(/name="_csrf" value="([^"]+)"/) || [])[1] };
  };
  const anna = await login('anna@example.nl');
  const kees = await login('kees@example.nl');

  await t.test('Mijn reizen: komende en eerdere reizen van het eigen adres, nooit die van een ander', async () => {
    const page = await request('/account/', { cookie: anna.cookie });
    assert.equal(page.status, 200);
    const [upcoming, earlier] = page.text.split('id="eerdere-reizen"');
    assert.match(upcoming, /<a href="\/reis\/namibie-2099\/">Avontuur in Namibië<\/a>/);
    assert.match(upcoming, /AV-2099-AAAA0001/);
    assert.match(upcoming, /Aanbetaald/);
    assert.match(upcoming, /Aanbetaling ontvangen, restant nog te betalen/);
    assert.match(earlier, /Albanië 2020/);
    assert.doesNotMatch(earlier, /href="\/reis\/albanie-2020\/"/, 'offline reis zonder link');
    assert.doesNotMatch(page.text, /KEES0003/, 'aanmelding van een ander adres');
    const other = await request('/account/', { cookie: kees.cookie });
    assert.match(other.text, /AV-2099-KEES0003/);
    assert.doesNotMatch(other.text, /AAAA000/);
    assert.match(other.text, /Nog geen eerdere reizen/);
  });

  await t.test('Mijn gegevens: alleen accountgegevens, nooit naam of adres uit een aanmelding', async () => {
    assert.equal((await request('/account/gegevens/')).location, '/account/inloggen/');
    const page = await request('/account/gegevens/', { cookie: anna.cookie });
    assert.equal(page.status, 200);
    assert.match(page.text, /anna@example\.nl/);
    assert.doesNotMatch(page.text, /Jansen|Dorpsstraat|Middelburg/, 'een aanmelding met dit adres kan van een ander zijn');
    assert.match(page.text, /href="\/account\/code\/\?verder=gegevens"/, 'zonder code eerst de codestap');
  });

  await t.test('export en wachtwoord wijzigen zonder code: naar de codestap of 403', async () => {
    const exportResponse = await request('/account/gegevens/export.xlsx', { cookie: anna.cookie });
    assert.equal(exportResponse.status, 303);
    assert.equal(exportResponse.location, '/account/code/?verder=gegevens');
    assert.equal((await request('/account/wachtwoord/', { cookie: anna.cookie })).location, '/account/code/?verder=wachtwoord');
    assert.equal((await request('/account/wachtwoord/', { cookie: anna.cookie, form: { _csrf: anna.csrf, password: 'nieuw wachtwoord 123', password2: 'nieuw wachtwoord 123' } })).status, 403);
    assert.equal((await request('/account/gegevens/export.xlsx')).location, '/account/inloggen/');
  });

  let code = '';
  await t.test('code per e-mail: verkeerde code telt, vijf keer fout is op, nieuwe code werkt één keer', async () => {
    assert.equal((await request('/account/code/versturen/', { cookie: anna.cookie, form: { next: 'gegevens' } })).status, 403, 'zonder CSRF');
    const sendCode = await request('/account/code/versturen/', { cookie: anna.cookie, form: { _csrf: anna.csrf, next: 'gegevens' } });
    assert.equal(sendCode.status, 303);
    assert.equal(sendCode.location, '/account/code/?verder=gegevens&verstuurd=1');
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(sent.at(-1).to, 'anna@example.nl');
    assert.equal(sent.at(-1).kind, 'account-code');
    const first = sent.at(-1).subject.match(/(\d{6})$/)[1];
    const wrong = first === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i += 1) {
      assert.equal((await request('/account/code/', { cookie: anna.cookie, form: { _csrf: anna.csrf, next: 'gegevens', code: wrong } })).status, 422);
    }
    const fifth = await request('/account/code/', { cookie: anna.cookie, form: { _csrf: anna.csrf, next: 'gegevens', code: wrong } });
    assert.match(fifth.text, /verlopen of te vaak verkeerd/);
    assert.match((await request('/account/code/', { cookie: anna.cookie, form: { _csrf: anna.csrf, next: 'gegevens', code: first } })).text, /verlopen of te vaak verkeerd/, 'ook de goede code werkt niet meer');
    // Een code van Anna werkt niet voor Kees.
    await request('/account/code/versturen/', { cookie: anna.cookie, form: { _csrf: anna.csrf, next: 'gegevens' } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    code = sent.at(-1).subject.match(/(\d{6})$/)[1];
    assert.equal((await request('/account/code/', { cookie: kees.cookie, form: { _csrf: kees.csrf, next: 'gegevens', code } })).status, 422);
    const good = await request('/account/code/', { cookie: anna.cookie, form: { _csrf: anna.csrf, next: 'https://evil.example', code: ` ${code} ` } });
    assert.equal(good.status, 303);
    assert.equal(good.location, '/account/gegevens/', 'alleen vaste bestemmingen');
    assert.equal((await request('/account/code/', { cookie: anna.cookie, form: { _csrf: anna.csrf, next: 'gegevens', code } })).status, 422, 'code werkt één keer');
  });

  await t.test('Excel-export: account en reizen, geen bijzondere gegevens, in het auditlog', async () => {
    const response = await request('/account/gegevens/export.xlsx', { cookie: anna.cookie });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.match(response.headers.get('content-disposition'), /attachment; filename="mijn-gegevens-avanta\.xlsx"/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const files = unzip(response.buffer);
    const all = Object.values(files).join('\n');
    assert.match(files['xl/workbook.xml'], /name="Account".*name="Reizen"/);
    assert.doesNotMatch(all, /Jansen|Dorpsstraat|Middelburg/, 'geen naam of adres uit een aanmelding');
    assert.match(all, /AV-2099-AAAA0001/);
    assert.match(all, /AV-2020-AAAA0002/);
    assert.match(all, /<v>1899<\/v>/);
    assert.doesNotMatch(all, /KEES0003/);
    assert.equal((await db.query("SELECT count(*)::int AS total FROM audit_log WHERE action = 'reiziger.export'"))[0].total, 1);
    // De code geldt per sessie: een tweede sessie van Anna heeft hem niet.
    const second = await login('anna@example.nl');
    assert.equal((await request('/account/gegevens/export.xlsx', { cookie: second.cookie })).status, 303);
  });

  await t.test('code verloopt na een kwartier', async () => {
    await db.query("UPDATE customer_sessions SET step_up_until = now() - interval '1 second'");
    assert.equal((await request('/account/gegevens/export.xlsx', { cookie: anna.cookie })).status, 303);
    await db.query("UPDATE customer_sessions SET step_up_until = now() + interval '15 minutes' WHERE account_id = (SELECT id FROM customer_accounts WHERE email = 'anna@example.nl')");
  });

  await t.test('wachtwoord wijzigen na de code: andere sessies vervallen, deze blijft', async () => {
    const other = await login('anna@example.nl');
    assert.equal((await request('/account/wachtwoord/', { cookie: anna.cookie })).status, 200);
    const weak = await request('/account/wachtwoord/', { cookie: anna.cookie, form: { _csrf: anna.csrf, password: 'kort', password2: 'kort' } });
    assert.equal(weak.status, 422);
    const changed = await request('/account/wachtwoord/', { cookie: anna.cookie, form: { _csrf: anna.csrf, password: 'een nieuw sterk wachtwoord', password2: 'een nieuw sterk wachtwoord' } });
    assert.equal(changed.status, 303);
    assert.equal(changed.location, '/account/?gewijzigd=1');
    assert.equal((await request('/account/', { cookie: anna.cookie })).status, 200);
    assert.equal((await request('/account/', { cookie: other.cookie })).status, 303, 'andere sessie uitgelogd');
    clock += 16 * 60 * 1000;
    assert.equal((await request('/account/inloggen/', { form: { email: 'anna@example.nl', password: PASSWORD } })).status, 401);
    assert.equal((await request('/account/inloggen/', { form: { email: 'anna@example.nl', password: 'een nieuw sterk wachtwoord' } })).status, 303);
  });

  await t.test('hoogstens drie codes per uur per account', async () => {
    const before = sent.length;
    for (let i = 0; i < 3; i += 1) await request('/account/code/versturen/', { cookie: kees.cookie, form: { _csrf: kees.csrf, next: 'wachtwoord' } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(sent.length - before, 3);
    await request('/account/code/versturen/', { cookie: kees.cookie, form: { _csrf: kees.csrf, next: 'wachtwoord' } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(sent.length - before, 3, 'vierde code: geen mail');
  });

  await t.test('opnieuw boeken: alleen eigen aanmeldingen (ingelogd, zelfde adres) vullen het formulier in, nooit bijzondere', async () => {
    const response = await request('/account/inloggen/', { form: { email: 'anna@example.nl', password: 'een nieuw sterk wachtwoord' } });
    assert.equal(response.status, 303);
    const cookie = response.cookie;
    // Aanmeldingen met alleen hetzelfde e-mailadres kunnen van een ander zijn: niets invullen behalve het adres.
    const first = await request('/aanmelden/?reis=namibie-2099', { cookie });
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('cache-control'), 'no-store');
    assert.doesNotMatch(first.text, /Anna Maria|Dorpsstraat/);
    assert.doesNotMatch(first.text, /alvast ingevuld/);
    assert.match(first.text, /value="anna@example\.nl"/);

    /**
     * Verstuurt het aanmeldformulier als de ingelogde reiziger.
     * @param {string} email E-mailadres in het formulier.
     * @param {string} firstNames Voornamen.
     * @returns {Promise<number>} Status.
     */
    const book = async (email, firstNames) => {
      const page = await request('/aanmelden/?reis=namibie-2099', { cookie });
      const token = /name="token" value="([^"]+)"/.exec(page.text)[1];
      clock += 5000;
      const form = new URLSearchParams({
        id: '', reis: 'namibie-2099', token, website: '', gender: 'vrouw', first_names: firstNames, call_name: '', last_name: 'Jansen',
        birth_date: '1999-05-04', mobile: '0612345678', email, email_confirm: email, street: 'Kerkstraat 9', postal_code: '4331 AB',
        city: 'Middelburg', occupation: 'Verpleegkundige', nationality: 'Nederlandse', document_type: 'paspoort', document_number: 'NX1234567',
        earlier_trip: 'nee', credit_card: 'nee', driver_interest: 'nee', driver_before: 'nee', payment_choice: 'aanbetaling', consent: 'ja',
      });
      const result = await fetch(`${base}/aanmelden/`, {
        method: 'POST', redirect: 'manual', body: form.toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'same-origin', cookie: `${COOKIE_NAME}=${cookie}` },
      });
      await result.arrayBuffer();
      return result.status;
    };
    assert.equal(await book('vriendin@example.nl', 'Vriendin'), 303);
    assert.equal(await book('Anna@Example.nl', 'Anna Maria'), 303);
    const rows = await db.query(
      `SELECT b.email, a.email AS account_email FROM bookings b LEFT JOIN customer_accounts a ON a.id = b.customer_account_id
        WHERE b.street = 'Kerkstraat 9' ORDER BY b.created_at`,
    );
    assert.deepEqual(rows.map((row) => [row.email, row.account_email]), [['vriendin@example.nl', null], ['anna@example.nl', 'anna@example.nl']]);

    const page = await request('/aanmelden/?reis=namibie-2099', { cookie });
    assert.match(page.text, /we hebben je gegevens van je vorige aanmelding alvast ingevuld/);
    assert.match(page.text, /value="Anna Maria"/);
    assert.match(page.text, /value="Kerkstraat 9"/);
    assert.doesNotMatch(page.text, /Vriendin/);
    assert.match(page.text, /name="gender" value="vrouw" checked/);
    for (const name of ['birth_date', 'nationality', 'document_number', 'church', 'particulars', 'emergency_phone']) {
      assert.match(page.text, new RegExp(`id="veld-${name}"[^>]*`), name);
      assert.doesNotMatch(page.text, new RegExp(`<(input|textarea) [^>]*value="[^"]+"[^>]*id="veld-${name}"`), `${name} niet ingevuld`);
    }
    assert.match(page.text, /id="veld-particulars"[^>]*><\/textarea>/, 'bijzonderheden leeg');
    // Kees ziet de gegevens van Anna niet, en zonder inloggen wordt niets ingevuld.
    assert.doesNotMatch((await request('/aanmelden/?reis=namibie-2099', { cookie: kees.cookie })).text, /Anna Maria|Kerkstraat/);
    const anonymous = await request('/aanmelden/?reis=namibie-2099');
    assert.doesNotMatch(anonymous.text, /Anna Maria|Kerkstraat/);
    assert.doesNotMatch(anonymous.text, /alvast ingevuld/);
  });
});
