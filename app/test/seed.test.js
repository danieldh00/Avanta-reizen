/**
 * Tests voor de testdata (`src/dev/seed/`, wachtlijstpunt W00): de blokkade op productie, het vullen (reizen met één
 * reisleider, versleutelde personen, statussen die bij de betalingen passen), niet dubbel vullen, opnieuw vullen en
 * verwijderen zonder echte gegevens te raken, en dat de site de testdata toont.
 * De databasetest draait in een eigen schema en wordt overgeslagen zonder TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { createVault } = require('../src/security/vault');
const { createPersons } = require('../src/persons/persons');
const { summarize, statusMismatch, nextBookingStatus, localDay } = require('../src/payments/payments');
const { verifyPassword, hashPassword } = require('../src/crm/passwords');
const { normalizeSiteContent } = require('../src/site/site-content');
const { runSeed, seedBlockReason, createRandom, emailPart } = require('../src/dev/seed/seed');
const { main, countLines } = require('../src/dev/seed/cli');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'seed_test';
const MASTER_KEY = Buffer.alloc(32, 44);
const TODAY = '2026-11-23';
const PASSWORD = 'een-test-wachtwoord-voor-de-seed';

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
 * Instellingen zoals `beheer/settings.js` ze geeft, met vaste waarden.
 * @param {Record<string, *>} values Afwijkende waarden.
 * @returns {{get: Function}} Instellingen.
 */
function fakeSettings(values = {}) {
  const all = { siteUrl: 'https://avanta.den-hollander.com', seoIndexing: false, paymentDepositDays: 7, paymentBalanceDaysBefore: 42, ...values };
  return { get: (key) => all[key] };
}

test('testdata: blokkade op productie (zonder database)', () => {
  const allowed = { siteUrl: 'https://avanta.den-hollander.com', indexing: false, confirmed: true };
  assert.equal(seedBlockReason(allowed), '');
  assert.equal(seedBlockReason({ ...allowed, siteUrl: 'http://localhost:3400' }), '');
  assert.match(seedBlockReason({ ...allowed, confirmed: false }), /--testomgeving/);
  for (const siteUrl of ['https://www.avantareizen.nl', 'https://avantareizen.nl/', 'https://WWW.AvantaReizen.NL', 'https://beta.avantareizen.nl']) {
    assert.match(seedBlockReason({ ...allowed, siteUrl }), /productiesite/, siteUrl);
  }
  assert.equal(seedBlockReason({ ...allowed, siteUrl: 'https://avantareizen.nl.example.com' }), '', 'alleen het echte domein');
  for (const siteUrl of ['', 'geen adres', null]) assert.match(seedBlockReason({ ...allowed, siteUrl }), /niet ingesteld of ongeldig/);
  assert.match(seedBlockReason({ ...allowed, indexing: true }), /indexeren/);
});

test('testdata: hulpfuncties en opdrachtregel (zonder database)', async () => {
  const first = createRandom(7);
  const second = createRandom(7);
  assert.deepEqual([first.next(), first.int(1, 6), first.hex(8)], [second.next(), second.int(1, 6), second.hex(8)], 'zelfde startwaarde, zelfde reeks');
  for (let i = 0; i < 200; i++) {
    const value = first.int(3, 5);
    assert.ok(value >= 3 && value <= 5);
  }
  assert.equal(emailPart('van den Berg'), 'vandenberg');
  assert.equal(emailPart('Ünal-Çelik'), 'unalcelik');
  assert.deepEqual(countLines('Kop', { a: 2, b: 0 }), ['Kop', '  a: 2']);
  assert.deepEqual(countLines('Kop', {}), []);
  const errors = [];
  const original = console.error;
  console.error = (line) => errors.push(line);
  try {
    assert.equal(await main([]), 2);
    assert.equal(await main(['vullen', '--force']), 2);
    assert.equal(await main(['wissen', '--testomgeving']), 2);
    assert.equal(await main(['verwijderen', 'vullen', '--testomgeving']), 2, 'precies één opdracht');
    assert.equal(await main(['vullen', 'vullen', '--testomgeving']), 2);
  } finally {
    console.error = original;
  }
  assert.match(errors.join('\n'), /<vullen\|opnieuw\|verwijderen> --testomgeving/);
});

test('testdata in de database', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (testContext) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  const vault = createVault(MASTER_KEY);
  const passwordHash = await hashPassword(PASSWORD);
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'avanta-seed-'));
  testContext.after(async () => { await db.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const seed = (mode, settings = fakeSettings(), confirmed = true) => runSeed({ db, vault, settings, mode, confirmed, passwordHash, today: TODAY });

  // Echte gegevens die nooit geraakt mogen worden: een reis, een persoon met aanmelding en een FAQ-categorie met
  // dezelfde naam als in de testdata (met een eigen vraag).
  const [realTrip] = await db.query("INSERT INTO trips (slug, title, departure_date) VALUES ('echte-reis', 'Echte reis', '2027-06-01') RETURNING id");
  const [realPerson] = await db.query("INSERT INTO persons (first_names, call_name, last_name, email, match_key) VALUES ('Echt', 'Echt', 'Persoon', 'echt@voorbeeld.nl', 'x') RETURNING id");
  await db.query(
    `INSERT INTO bookings (reference, trip_id, trip_title, gender, first_names, call_name, last_name, email, mobile, street, postal_code, city,
       earlier_trip, credit_card, driver_interest, driver_before, payment_method, payment_choice, person_id, consent_at)
     VALUES ('AV-2026-ECHT0001', $1, 'Echte reis', 'man', 'Echt', 'Echt', 'Persoon', 'echt@voorbeeld.nl', '0600000000', 'Straat 1', '1234 AB', 'Plaats',
       false, false, false, false, 'handmatig', 'aanbetaling', $2, now())`,
    [realTrip.id, realPerson.id],
  );
  const [faqCategory] = await db.query("INSERT INTO faq_categories (name, sort_order) VALUES ('Onderweg', 1) RETURNING id");
  await db.query("INSERT INTO faqs (slug, question, answer_html, category, category_id) VALUES ('echte-vraag', 'Echte vraag?', '<p>Ja.</p>', 'Onderweg', $1)", [faqCategory.id]);
  // Een echte, lege categorie met een naam zoals in de testdata (zonder "(test)") blijft ook staan.
  const [emptyCategory] = await db.query("INSERT INTO faq_categories (name, sort_order) VALUES ('Boeken en betalen', 2) RETURNING id");

  /**
   * Telt de echte gegevens.
   * @returns {Promise<object>} Aantallen.
   */
  const realCounts = async () => (await db.query(
    `SELECT (SELECT count(*)::int FROM trips WHERE slug = 'echte-reis') AS trips, (SELECT count(*)::int FROM persons WHERE email = 'echt@voorbeeld.nl') AS persons,
            (SELECT count(*)::int FROM bookings WHERE reference = 'AV-2026-ECHT0001') AS bookings, (SELECT count(*)::int FROM faqs WHERE slug = 'echte-vraag') AS faqs,
            (SELECT count(*)::int FROM faq_categories WHERE id IN (${Number(faqCategory.id)}, ${Number(emptyCategory.id)})) AS categories`,
  ))[0];
  const untouched = { trips: 1, persons: 1, bookings: 1, faqs: 1, categories: 2 };

  await testContext.test('weigert op productie, bij indexeren en zonder bevestiging; er verandert niets', async () => {
    for (const [settings, confirmed] of [[fakeSettings({ siteUrl: 'https://www.avantareizen.nl' }), true], [fakeSettings({ seoIndexing: true }), true], [fakeSettings(), false]]) {
      const result = await seed('vullen', settings, confirmed);
      assert.equal(result.ok, false);
      assert.ok(result.reason);
    }
    const [{ count }] = await db.query("SELECT count(*)::int AS count FROM trips WHERE slug LIKE 'test-%'");
    assert.equal(count, 0);
  });

  await testContext.test('vullen: alle soorten, met realistische samenhang', async () => {
    const result = await seed('vullen');
    assert.equal(result.ok, true);
    for (const label of ['reistypes en landen', 'reisleiders', 'reizen', 'gebruikers', 'personen', 'aanmeldingen', 'betalingen', 'blogberichten', 'veelgestelde vragen', "pagina's", 'berichten']) {
      assert.ok(result.added[label] > 0, label);
    }

    const guides = await db.query("SELECT t.slug, count(g.guide_id)::int AS guides FROM trips t LEFT JOIN trip_guides g ON g.trip_id = t.id WHERE t.slug LIKE 'test-%' GROUP BY t.slug");
    assert.ok(guides.every((row) => row.guides === 1), 'elke reis precies één reisleider');
    const links = await db.query("SELECT t.slug, array_agg(c.kind ORDER BY c.kind) AS kinds FROM trips t JOIN trip_category_links l ON l.trip_id = t.id JOIN trip_categories c ON c.id = l.category_id WHERE t.slug LIKE 'test-%' GROUP BY t.slug");
    assert.ok(links.every((row) => row.kinds.join() === 'bestemming,type'), 'elke reis een land en een reistype');

    const statuses = new Set((await db.query("SELECT DISTINCT status FROM bookings WHERE email LIKE '%@example.com'")).map((row) => row.status));
    assert.deepEqual([...statuses].sort(), ['aanbetaald', 'betaald', 'bevestigd', 'geannuleerd', 'nieuw']);
    const [full] = await db.query("SELECT t.capacity, count(b.id)::int AS active FROM trips t JOIN bookings b ON b.trip_id = t.id AND b.status <> 'geannuleerd' WHERE t.slug = 'test-tirol-wintersport' GROUP BY t.capacity");
    assert.equal(full.active, full.capacity, 'één reis is vol');
    const pastOpen = await db.query("SELECT b.id FROM bookings b WHERE b.email LIKE '%@example.com' AND b.departure_date <= $1 AND b.status NOT IN ('betaald', 'geannuleerd')", [TODAY]);
    assert.equal(pastOpen.length, 0, 'geweest = betaald of geannuleerd');

    // Elke status past bij de betalingen, zoals het CRM ze berekent; en er is achterstand om te testen.
    const bookings = await db.query("SELECT id, status, created_at, payment_choice, departure_date, deposit_cents, person_id FROM bookings WHERE email LIKE '%@example.com'");
    const overdue = new Set();
    for (const booking of bookings) {
      const charges = await db.query('SELECT kind, amount_cents FROM booking_charges WHERE booking_id = $1', [booking.id]);
      const payments = await db.query('SELECT amount_cents, received_on FROM payments WHERE booking_id = $1', [booking.id]);
      const summary = summarize({ booking, charges, payments, terms: { depositDays: 7, balanceDaysBefore: 42 }, today: TODAY });
      assert.equal(statusMismatch(booking.status, summary.state), '', `aanmelding ${booking.id}`);
      assert.equal(nextBookingStatus(booking.status, summary.state), null, `aanmelding ${booking.id} loopt niet achter`);
      assert.ok(payments.every((payment) => localDay(payment.received_on) <= TODAY), 'geen betaling in de toekomst');
      if (summary.overdue) overdue.add(summary.overdue);
    }
    assert.deepEqual([...overdue].sort(), ['aanbetaling', 'restant']);
    const events = await db.query("SELECT e.to_status FROM booking_events e JOIN bookings b ON b.id = e.booking_id WHERE b.email LIKE '%@example.com' AND b.status = 'betaald'");
    assert.ok(events.some((event) => event.to_status === 'betaald'), 'statusgeschiedenis');

    // Personen: versleutelde blokken te openen met de sleutel van de app, art. 9 alleen met toestemming.
    const persons = createPersons({ vault });
    const rows = await db.query("SELECT id, email, duplicate_of, identity_data, special_data, health_data, emergency_data FROM persons WHERE email LIKE '%@example.com'");
    assert.ok(rows.some((row) => row.duplicate_of), 'één mogelijk dubbel');
    const consents = await db.query("SELECT person_id, kind FROM consents WHERE kind LIKE 'art9_%'");
    for (const row of rows) {
      assert.match(row.email, /^[a-z0-9.]+@example\.com$/);
      assert.match(persons.openBlock('identity_data', row).birth_date, /^\d{4}-\d{2}-\d{2}$/);
      if (row.special_data) assert.ok(consents.some((consent) => consent.person_id === row.id && consent.kind === 'art9_religie'), 'kerkgenootschap met toestemming');
      if (row.health_data) assert.ok(consents.some((consent) => consent.person_id === row.id && consent.kind === 'art9_gezondheid'), 'bijzonderheden met toestemming');
    }

    const users = await db.query("SELECT role, password_hash, guide_id FROM users WHERE email LIKE '%@example.com' ORDER BY role");
    assert.deepEqual(users.map((user) => user.role), ['beheerder', 'boekhouding', 'kantoor', 'redacteur', 'reisleider']);
    assert.equal(await verifyPassword(PASSWORD, users[0].password_hash), true);
    assert.ok(users.find((user) => user.role === 'reisleider').guide_id, 'reisleider gekoppeld');
    assert.deepEqual(await realCounts(), untouched);
  });

  await testContext.test('niet dubbel vullen', async () => {
    const result = await seed('vullen');
    assert.equal(result.ok, false);
    assert.match(result.reason, /al testdata/);
  });

  await testContext.test('de site toont de testdata', async () => {
    const mediaDir = path.join(dataDir, 'media');
    await fs.mkdir(mediaDir, { recursive: true });
    const app = createApp({ db, masterKey: MASTER_KEY, mediaDir, siteContent: { load: () => normalizeSiteContent({}) } });
    const server = app.listen(0);
    testContext.after(() => server.close());
    const base = `http://127.0.0.1:${server.address().port}`;
    const trip = await fetch(`${base}/reis/test-noorwegen-fjorden/`);
    assert.equal(trip.status, 200);
    assert.match(await trip.text(), /Jongerenreis Noorse fjorden/);
    assert.equal((await fetch(`${base}/reis/test-namibie-concept/`)).status, 404, 'concept niet op de site');
    const guide = await fetch(`${base}/reisleider/test-marieke/`);
    assert.equal(guide.status, 200);
    const page = await fetch(`${base}/test-praktische-informatie/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Hoeveel moet ik aanbetalen/);
    const post = await fetch(`${base}/test-terugblik-slovenie/`);
    assert.equal(post.status, 200);
    assert.equal((await fetch(`${base}/test-jongerenweekend/`)).status, 404, 'ingepland bericht nog niet zichtbaar');
  });

  await testContext.test('opnieuw: dezelfde aantallen, echte gegevens blijven', async () => {
    const before = await db.query("SELECT (SELECT count(*)::int FROM bookings WHERE email LIKE '%@example.com') AS bookings, (SELECT count(*)::int FROM persons WHERE email LIKE '%@example.com') AS persons");
    const result = await seed('opnieuw');
    assert.equal(result.ok, true);
    assert.equal(result.removed.aanmeldingen, before[0].bookings);
    assert.equal(result.added.aanmeldingen, before[0].bookings, 'zelfde testdata bij elke run');
    assert.equal(result.added.personen, before[0].persons);
    assert.deepEqual(await realCounts(), untouched);
  });

  await testContext.test('verwijderen: alle testdata weg, echte gegevens en echte FAQ-categorieën met dezelfde naam blijven, audit met alleen de opdracht', async () => {
    const result = await seed('verwijderen');
    assert.equal(result.ok, true);
    assert.deepEqual(result.added, {});
    const [left] = await db.query(
      `SELECT (SELECT count(*)::int FROM trips WHERE slug LIKE 'test-%') + (SELECT count(*)::int FROM guides WHERE slug LIKE 'test-%')
            + (SELECT count(*)::int FROM trip_categories WHERE slug LIKE 'test-%') + (SELECT count(*)::int FROM posts WHERE slug LIKE 'test-%')
            + (SELECT count(*)::int FROM post_terms WHERE slug LIKE 'test-%') + (SELECT count(*)::int FROM pages WHERE path LIKE '/test-%')
            + (SELECT count(*)::int FROM faqs WHERE slug LIKE 'test-%') + (SELECT count(*)::int FROM persons WHERE email LIKE '%@example.com')
            + (SELECT count(*)::int FROM bookings WHERE email LIKE '%@example.com') + (SELECT count(*)::int FROM users WHERE email LIKE '%@example.com') AS total,
              (SELECT count(*)::int FROM faq_categories WHERE name LIKE '%(test)') AS emptied`,
    );
    assert.equal(left.total, 0);
    assert.equal(left.emptied, 0, 'lege testcategorieën weg');
    assert.deepEqual(await realCounts(), untouched);
    const audit = await db.query("SELECT user_id, action, entity, entity_id, ip_prefix FROM audit_log WHERE entity = 'testdata' ORDER BY id");
    assert.deepEqual(audit.map((row) => row.action), ['testdata.vullen', 'testdata.opnieuw', 'testdata.verwijderen']);
    assert.ok(audit.every((row) => row.user_id === null && row.entity_id === null && row.ip_prefix === null));
    assert.equal((await seed('verwijderen')).ok, true, 'verwijderen zonder testdata kan ook');
  });
});
