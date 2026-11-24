/**
 * Tests voor de deelnemers in het CRM (`/app/deelnemers/`): rechten per rol (zonder recht 403, reisleider dicht tot
 * zijn eigen vertrekken er zijn), onbekend id → 404, zoeken, *Toon* per blok met audit, NAW en blokken wijzigen,
 * art. 9 alleen met toestemming en intrekken (wist het blok). De databasetests draaien in een eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { createVault } = require('../src/security/vault');
const { createPersons, LEGACY_ART9_TEXT_VERSION } = require('../src/persons/persons');
const { searchPatterns } = require('../src/persons/person-routes');
const { hashPassword } = require('../src/crm/passwords');
const { COOKIE_NAME } = require('../src/crm/auth');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'person_routes_test';
const MASTER_KEY = Buffer.alloc(32, 13);
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

test('zoekpatronen: per woord, met escaping van LIKE-tekens, begrensd', () => {
  assert.deepEqual(searchPatterns('  Jan  de Vries '), { text: 'Jan  de Vries', patterns: ['%jan%', '%de%', '%vries%'] });
  assert.deepEqual(searchPatterns('100%_a\\b').patterns, ['%100\\%\\_a\\\\b%']);
  assert.equal(searchPatterns('a b c d e f g').patterns.length, 5);
  assert.deepEqual(searchPatterns(['x']), { text: '', patterns: [] });
});

test('deelnemers in het CRM', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  const app = createApp({ db, masterKey: MASTER_KEY });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await db.close(); });
  const persons = createPersons({ vault: createVault(MASTER_KEY) });

  const hash = await hashPassword(PASSWORD);
  for (const [email, role] of [['beheer@example.nl', 'beheerder'], ['kantoor@example.nl', 'kantoor'], ['leider@example.nl', 'reisleider'], ['boek@example.nl', 'boekhouding']]) {
    await db.query('INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)', [email, role, role, hash]);
  }

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

  /**
   * Logt in (2FA staat standaard uit) en haalt het CSRF-token op.
   * @param {string} email E-mailadres.
   * @returns {Promise<{cookie: string, csrf: string}>} Sessie.
   */
  const login = async (email) => {
    const response = await request('/app/inloggen/', { form: { email, password: PASSWORD } });
    assert.equal(response.status, 303, `inloggen ${email}`);
    const home = await request('/app/', { cookie: response.cookie });
    return { cookie: response.cookie, csrf: (home.text.match(/name="_csrf" value="([^"]+)"/) || [])[1] };
  };
  const sessions = {};
  for (const role of ['beheer', 'kantoor', 'leider', 'boek']) sessions[role] = await login(`${role}@example.nl`);

  // Twee personen via de opslag van het aanmeldformulier, met art. 9-toestemming voor de eerste.
  const values = {
    gender: 'vrouw', first_names: 'Grietje', call_name: 'Griet', last_name: 'Bakker', email: 'griet@example.nl', mobile: '0612121212',
    phone: '', street: 'Markt 1', postal_code: '4331 AA', city: 'Middelburg', occupation: 'Juf', birth_date: '1990-03-04',
    nationality: 'Nederlandse', document_type: 'paspoort', document_number: 'NX99', church: 'PKN', consent_religion: 'ja',
    particulars: 'Astma', consent_health: 'ja', emergency_phone: '0687654321',
  };
  const personId = await db.transaction(async (client) => {
    const { personId: id } = await persons.savePerson(client, values);
    await persons.recordConsents(client, { personId: id, bookingId: null, values });
    return id;
  });
  const otherId = await db.transaction(async (client) => (await persons.savePerson(client, { ...values, email: 'kees@example.nl', first_names: 'Kees', last_name: 'Zwart', church: '', particulars: '' })).personId);
  const path = `/app/deelnemers/${personId}/`;
  /** Alleen de NAW-velden, zoals het wijzigformulier ze verstuurt. */
  const plain = Object.fromEntries(['gender', 'first_names', 'call_name', 'last_name', 'email', 'mobile', 'phone', 'street', 'postal_code', 'city', 'occupation'].map((name) => [name, values[name]]));

  await t.test('rechten: zonder sessie naar inloggen, reisleider 403, boekhouding alleen lezen, kantoor wel', async () => {
    assert.equal((await request('/app/deelnemers/')).status, 303);
    assert.equal((await request('/app/deelnemers/', { cookie: sessions.leider.cookie })).status, 403, 'reisleider: nog geen eigen-vertrekbeperking');
    assert.equal((await request(path, { cookie: sessions.leider.cookie })).status, 403);
    assert.doesNotMatch((await request('/app/', { cookie: sessions.leider.cookie })).text, /href="\/app\/deelnemers\/"/, 'geen menu-item');
    const readOnly = await request(path, { cookie: sessions.boek.cookie });
    assert.equal(readOnly.status, 200);
    assert.doesNotMatch(readOnly.text, /<form class="form crm-narrow"/, 'boekhouding ziet geen wijzigformulier');
    assert.match(readOnly.text, /Geen toegang met jouw rol/);
    const edit = await request(path, { cookie: sessions.boek.cookie, form: { _csrf: sessions.boek.csrf, ...plain } });
    assert.equal(edit.status, 403);
    assert.equal((await request(path, { cookie: sessions.kantoor.cookie })).status, 200);
    // Blok, intrekken en tonen zonder het juiste recht: 403 en niets veranderd.
    const before = (await db.query('SELECT health_data, updated_at FROM persons WHERE id = $1', [personId]))[0];
    const [consent] = await db.query("SELECT id FROM consents WHERE person_id = $1 AND kind = 'art9_gezondheid'", [personId]);
    for (const role of ['boek', 'leider']) {
      const session = sessions[role];
      assert.equal((await request(`${path}blok/`, { cookie: session.cookie, form: { _csrf: session.csrf, block: 'health_data', particulars: 'Anders' } })).status, 403, `${role}: blok`);
      assert.equal((await request(`${path}toestemming/${consent.id}/intrekken/`, { cookie: session.cookie, form: { _csrf: session.csrf } })).status, 403, `${role}: intrekken`);
      assert.equal((await request(`${path}toon/`, { cookie: session.cookie, form: { _csrf: session.csrf, block: 'health_data' } })).status, 403, `${role}: toon`);
    }
    assert.deepEqual((await db.query('SELECT health_data, updated_at FROM persons WHERE id = $1', [personId]))[0], before);
    assert.equal((await db.query('SELECT withdrawn_at FROM consents WHERE id = $1', [consent.id]))[0].withdrawn_at, null);
    assert.equal((await db.query("SELECT count(*)::int AS total FROM audit_log WHERE action LIKE 'deelnemer.%'"))[0].total, 0);
  });

  await t.test('onbekende deelnemer of toestemming van een ander: 404', async () => {
    assert.equal((await request('/app/deelnemers/999999/', { cookie: sessions.kantoor.cookie })).status, 404);
    const [consent] = await db.query("SELECT id FROM consents WHERE person_id = $1 AND kind = 'art9_gezondheid'", [personId]);
    const other = await request(`/app/deelnemers/${otherId}/toestemming/${consent.id}/intrekken/`, { cookie: sessions.kantoor.cookie, form: { _csrf: sessions.kantoor.csrf } });
    assert.equal(other.status, 404);
    assert.equal((await db.query('SELECT withdrawn_at FROM consents WHERE id = $1', [consent.id]))[0].withdrawn_at, null);
  });

  await t.test('lijst en zoeken: geen bijzondere gegevens, woorden in elke volgorde', async () => {
    const list = await request('/app/deelnemers/?q=middelburg+bakker', { cookie: sessions.kantoor.cookie });
    assert.equal(list.status, 200);
    assert.match(list.text, /Bakker, Griet/);
    assert.doesNotMatch(list.text, /Zwart/);
    assert.doesNotMatch(list.text, /PKN|Astma|NX99|1990/);
    assert.match((await request('/app/deelnemers/?q=%25', { cookie: sessions.kantoor.cookie })).text, /Geen deelnemers gevonden/, '% is geen jokerteken');
    assert.match((await request('/app/deelnemers/?q=%25', { cookie: sessions.kantoor.cookie })).text, />Alle <span class="crm-tabs-count">0<\/span><\/a>/, 'aantallen volgen de zoektekst');
    assert.match((await request('/app/deelnemers/', { cookie: sessions.kantoor.cookie })).text, /href="\/app\/deelnemers\/\?dubbel=1">Mogelijk dubbel <span class="crm-tabs-count">\d+<\/span>/);
    assert.match((await request('/app/deelnemers/', { cookie: sessions.kantoor.cookie })).text, /Zwart/);
  });

  await t.test('detail toont bijzondere gegevens pas na Toon (POST met CSRF), met audit', async () => {
    const page = await request(path, { cookie: sessions.kantoor.cookie });
    assert.doesNotMatch(page.text, /PKN|Astma|NX99|0687654321/);
    assert.equal((await request(`${path}toon/`, { cookie: sessions.kantoor.cookie, form: { block: 'health_data' } })).status, 403, 'zonder CSRF');
    const shown = await request(`${path}toon/`, { cookie: sessions.kantoor.cookie, form: { _csrf: sessions.kantoor.csrf, block: 'health_data' } });
    assert.equal(shown.status, 200);
    assert.match(shown.text, /Astma/);
    assert.doesNotMatch(shown.text, /PKN|NX99/, 'alleen het gevraagde blok');
    const [entry] = await db.query("SELECT action, entity, entity_id FROM audit_log WHERE action LIKE 'deelnemer.toon.%' ORDER BY id DESC LIMIT 1");
    assert.deepEqual(entry, { action: 'deelnemer.toon.gezondheid', entity: 'persons', entity_id: String(personId) });
    const religion = await request(`${path}toon/`, { cookie: sessions.kantoor.cookie, form: { _csrf: sessions.kantoor.csrf, block: 'special_data' } });
    assert.equal(religion.status, 403, 'kantoor heeft geen gegevens.religie');
    assert.equal((await request(`${path}toon/`, { cookie: sessions.kantoor.cookie, form: { _csrf: sessions.kantoor.csrf, block: 'password_hash' } })).status, 400);
    assert.match((await request(`${path}toon/`, { cookie: sessions.beheer.cookie, form: { _csrf: sessions.beheer.csrf, block: 'special_data' } })).text, /PKN/);
    const log = await request('/app/auditlog/', { cookie: sessions.beheer.cookie });
    assert.match(log.text, /Deelnemer: bijzonderheden \(gezondheid\) ingezien/);
    assert.doesNotMatch(log.text, /Astma|PKN/);
  });

  await t.test('NAW wijzigen: gecontroleerd, match_key mee, audit', async () => {
    const bad = await request(path, { cookie: sessions.kantoor.cookie, form: { _csrf: sessions.kantoor.csrf, ...plain, email: 'geen-adres' } });
    assert.equal(bad.status, 422);
    assert.match(bad.text, /geldig e-mailadres/);
    const before = (await db.query('SELECT match_key FROM persons WHERE id = $1', [personId]))[0].match_key;
    const saved = await request(path, { cookie: sessions.kantoor.cookie, form: { _csrf: sessions.kantoor.csrf, ...plain, email: 'Griet.Nieuw@example.nl', city: 'Vlissingen' } });
    assert.equal(saved.status, 303);
    const [row] = await db.query('SELECT email, city, match_key FROM persons WHERE id = $1', [personId]);
    assert.equal(row.email, 'griet.nieuw@example.nl');
    assert.equal(row.city, 'Vlissingen');
    assert.notEqual(row.match_key, before);
    assert.equal(row.match_key, persons.matchKey('griet.nieuw@example.nl', '1990-03-04'));
    assert.equal((await db.query("SELECT count(*)::int AS total FROM audit_log WHERE action = 'deelnemer.gewijzigd'"))[0].total, 1);
  });

  await t.test('blok wijzigen: eigen recht nodig, art. 9 alleen met toestemming', async () => {
    const health = await request(`${path}blok/`, { cookie: sessions.kantoor.cookie, form: { _csrf: sessions.kantoor.csrf, block: 'health_data', particulars: 'Astma, puffer mee' } });
    assert.equal(health.status, 303);
    const [person] = await db.query('SELECT id, health_data FROM persons WHERE id = $1', [personId]);
    assert.equal(persons.openBlock('health_data', person).particulars, 'Astma, puffer mee');
    assert.equal((await request(`${path}blok/`, { cookie: sessions.kantoor.cookie, form: { _csrf: sessions.kantoor.csrf, block: 'special_data', church: 'GKV' } })).status, 403);
    const noConsent = await request(`/app/deelnemers/${otherId}/blok/`, { cookie: sessions.kantoor.cookie, form: { _csrf: sessions.kantoor.csrf, block: 'health_data', particulars: 'Diabetes' } });
    assert.equal(noConsent.status, 422);
    assert.match(noConsent.text, /geen \(geldige\) toestemming/);
    assert.equal((await db.query('SELECT health_data FROM persons WHERE id = $1', [otherId]))[0].health_data, null);
    const identity = await request(`${path}blok/`, { cookie: sessions.kantoor.cookie, form: { _csrf: sessions.kantoor.csrf, block: 'identity_data', birth_date: '1990-03-05', nationality: 'Nederlandse', document_type: 'paspoort' } });
    assert.equal(identity.status, 303);
    assert.equal((await db.query('SELECT match_key FROM persons WHERE id = $1', [personId]))[0].match_key, persons.matchKey('griet.nieuw@example.nl', '1990-03-05'));
  });

  await t.test('toestemming intrekken wist het blok en geldt voor de persoon', async () => {
    const [consent] = await db.query("SELECT id FROM consents WHERE person_id = $1 AND kind = 'art9_gezondheid'", [personId]);
    const response = await request(`${path}toestemming/${consent.id}/intrekken/`, { cookie: sessions.kantoor.cookie, form: { _csrf: sessions.kantoor.csrf } });
    assert.equal(response.status, 303);
    const [person] = await db.query('SELECT health_data, special_data FROM persons WHERE id = $1', [personId]);
    assert.equal(person.health_data, null);
    assert.notEqual(person.special_data, null, 'ander blok blijft');
    assert.ok((await db.query('SELECT withdrawn_at FROM consents WHERE id = $1', [consent.id]))[0].withdrawn_at);
    assert.equal((await db.query("SELECT count(*)::int AS total FROM audit_log WHERE action = 'deelnemer.toestemming.ingetrokken.gezondheid' AND entity_id = $1", [String(personId)]))[0].total, 1);
    assert.equal((await request(`${path}toestemming/${consent.id}/intrekken/`, { cookie: sessions.kantoor.cookie, form: { _csrf: sessions.kantoor.csrf } })).status, 404, 'tweede keer');
    const [terms] = await db.query("SELECT id FROM consents WHERE person_id = $1 AND kind = 'voorwaarden'", [personId]);
    assert.equal((await request(`${path}toestemming/${terms.id}/intrekken/`, { cookie: sessions.kantoor.cookie, form: { _csrf: sessions.kantoor.csrf } })).status, 404, 'voorwaarden niet via dit scherm');
    const again = await request(`${path}blok/`, { cookie: sessions.kantoor.cookie, form: { _csrf: sessions.kantoor.csrf, block: 'health_data', particulars: 'Astma' } });
    assert.equal(again.status, 422, 'na intrekken geen nieuwe gezondheidsgegevens');
    // Gelijktijdig opslaan en intrekken (religie): welke volgorde ook, er blijft nooit een blok zonder toestemming staan.
    const [religion] = await db.query("SELECT id FROM consents WHERE person_id = $1 AND kind = 'art9_religie' AND withdrawn_at IS NULL", [personId]);
    await Promise.all([
      request(`${path}blok/`, { cookie: sessions.beheer.cookie, form: { _csrf: sessions.beheer.csrf, block: 'special_data', church: 'GKV' } }),
      request(`${path}toestemming/${religion.id}/intrekken/`, { cookie: sessions.beheer.cookie, form: { _csrf: sessions.beheer.csrf } }),
    ]);
    assert.equal((await db.query('SELECT special_data FROM persons WHERE id = $1', [personId]))[0].special_data, null);
    // Deterministisch: de test houdt zelf de persoonsrij vast en trekt de toestemming in terwijl het opslaan wacht.
    // Zonder de vergrendeling in de route zou die de (nog geldige) toestemming lezen en het blok alsnog schrijven.
    await db.query("INSERT INTO consents (person_id, kind, text_version) VALUES ($1, 'art9_religie', 'test')", [personId]);
    let pending;
    await db.transaction(async (client) => {
      await client.query('SELECT id FROM persons WHERE id = $1 FOR UPDATE', [personId]);
      pending = request(`${path}blok/`, { cookie: sessions.beheer.cookie, form: { _csrf: sessions.beheer.csrf, block: 'special_data', church: 'GKV' } });
      const settled = await Promise.race([pending.then(() => 'klaar'), new Promise((resolve) => { setTimeout(() => resolve('wacht'), 400); })]);
      assert.equal(settled, 'wacht', 'opslaan wacht op de vergrendelde persoon');
      await client.query("UPDATE consents SET withdrawn_at = now() WHERE person_id = $1 AND kind = 'art9_religie' AND withdrawn_at IS NULL", [personId]);
    });
    assert.equal((await pending).status, 422);
    assert.equal((await db.query('SELECT special_data FROM persons WHERE id = $1', [personId]))[0].special_data, null);
  });

  await t.test('samenvoegen: rechten, 404 zonder markering, keuzes per veld en blok, alles gaat mee', async () => {
    const base = { ...values, email: 'dubbel@example.nl', church: 'PKN', particulars: 'Astma', consent_religion: 'ja', consent_health: 'ja' };
    const keep = await db.transaction(async (client) => {
      const { personId: id } = await persons.savePerson(client, base);
      await persons.recordConsents(client, { personId: id, bookingId: null, values: base });
      return id;
    });
    const changed = { ...base, street: 'Nieuweweg 5', church: 'GKV', particulars: 'Astma en hooikoorts' };
    const removeId = await db.transaction(async (client) => {
      const { personId: id, outcome } = await persons.savePerson(client, changed);
      assert.equal(outcome, 'mogelijk-dubbel');
      const [booking] = await client.query(
        `INSERT INTO bookings (reference, trip_title, gender, first_names, call_name, last_name, email, mobile, street, postal_code, city,
           earlier_trip, credit_card, driver_interest, driver_before, payment_method, payment_choice, consent_at, person_id)
         VALUES ('AV-DUB-1', 'Reis', 'vrouw', 'G', 'G', 'B', 'dubbel@example.nl', '06', 's', 'p', 'c', false, false, false, false, 'handmatig', 'aanbetaling', now(), $1)
         RETURNING id`,
        [id],
      );
      await persons.recordConsents(client, { personId: id, bookingId: booking.id, values: changed });
      return id;
    });
    const mergePath = `/app/deelnemers/${removeId}/samenvoegen/`;
    assert.equal((await request(`/app/deelnemers/${keep}/samenvoegen/`, { cookie: sessions.kantoor.cookie })).status, 404, 'geen markering');
    assert.equal((await request(mergePath, { cookie: sessions.boek.cookie })).status, 403);
    assert.equal((await request(mergePath, { cookie: sessions.leider.cookie })).status, 403);
    const page = await request(mergePath, { cookie: sessions.kantoor.cookie });
    assert.equal(page.status, 200);
    assert.match(page.text, /Nieuweweg 5/);
    assert.doesNotMatch(page.text, /GKV|hooikoorts|PKN/, 'blokwaarden nooit op dit scherm');
    const personPage = (await request(`/app/deelnemers/${removeId}/`, { cookie: sessions.kantoor.cookie })).text;
    assert.match(personPage, /Samenvoegen/);
    assert.match(personPage, /<span class="crm-status crm-status--nieuw">Nieuw<\/span>/, 'status als label, gelijk aan de lijst Aanmeldingen');
    const form = { _csrf: sessions.kantoor.csrf, met: String(keep), veld_street: 'remove', blok_health_data: 'remove', blok_special_data: 'remove' };
    assert.equal((await request(mergePath, { cookie: sessions.kantoor.cookie, form: { ...form, met: String(otherId) } })).status, 409);
    assert.equal((await request(mergePath, { cookie: sessions.kantoor.cookie, form: { ...form, _csrf: 'fout' } })).status, 403);
    const merged = await request(mergePath, { cookie: sessions.kantoor.cookie, form });
    assert.equal(merged.status, 303);
    assert.equal(merged.headers.get('location'), `/app/deelnemers/${keep}/?opgeslagen=samengevoegd`);
    assert.equal((await db.query('SELECT count(*)::int AS total FROM persons WHERE id = $1', [removeId]))[0].total, 0);
    const person = await persons.findPerson(db, keep);
    assert.equal(person.street, 'Nieuweweg 5');
    assert.equal(persons.openBlock('health_data', person).particulars, 'Astma en hooikoorts', 'kantoor mag gezondheid kiezen');
    assert.equal(persons.openBlock('special_data', person).church, 'PKN', 'zonder recht op religie: alleen aanvullen');
    assert.equal((await db.query("SELECT person_id FROM bookings WHERE reference = 'AV-DUB-1'"))[0].person_id, keep);
    assert.equal((await db.query('SELECT count(*)::int AS total FROM consents WHERE person_id = $1', [keep]))[0].total, 6);
    assert.equal((await db.query("SELECT count(*)::int AS total FROM audit_log WHERE action = 'deelnemer.samengevoegd' AND entity_id = $1", [String(keep)]))[0].total, 1);
    const blockAudit = await db.query("SELECT action FROM audit_log WHERE action LIKE 'deelnemer.samengevoegd.%' AND entity_id = $1 ORDER BY action", [String(keep)]);
    assert.deepEqual(blockAudit.map((row) => row.action), ['deelnemer.samengevoegd.gezondheid.remove', 'deelnemer.samengevoegd.identiteit.fill', 'deelnemer.samengevoegd.noodnummer.fill', 'deelnemer.samengevoegd.religie.fill'], 'per blok met gegevens de keuze, zonder recht altijd aanvullen');
    assert.equal((await request(mergePath, { cookie: sessions.kantoor.cookie, form })).status, 404, 'tweede keer');
  });

  await t.test('geen dubbel: markering weg, alleen bij een gemarkeerde persoon', async () => {
    const { personId } = await db.transaction((client) => persons.savePerson(client, { ...values, email: 'kees@example.nl', first_names: 'Kees', last_name: 'Zwart', church: '', particulars: '', street: 'Elders 1' }));
    assert.equal((await persons.findPerson(db, personId)).duplicate_of, otherId);
    const response = await request(`/app/deelnemers/${personId}/niet-dubbel/`, { cookie: sessions.kantoor.cookie, form: { _csrf: sessions.kantoor.csrf } });
    assert.equal(response.status, 303);
    assert.equal((await persons.findPerson(db, personId)).duplicate_of, null);
    assert.equal((await request(`/app/deelnemers/${personId}/niet-dubbel/`, { cookie: sessions.kantoor.cookie, form: { _csrf: sessions.kantoor.csrf } })).status, 404);
    assert.equal((await request(`/app/deelnemers/${personId}/niet-dubbel/`, { cookie: sessions.boek.cookie, form: { _csrf: sessions.boek.csrf } })).status, 403);
  });

  await t.test('toestemming uit een oud formulier telt niet als gegeven, intrekken kan wel', async () => {
    const [legacy] = await db.query("INSERT INTO consents (person_id, kind, text_version, given_at) VALUES ($1, 'art9_gezondheid', $2, '2026-01-02T10:00:00Z') RETURNING id", [otherId, LEGACY_ART9_TEXT_VERSION]);
    const page = await request(`/app/deelnemers/${otherId}/`, { cookie: sessions.kantoor.cookie });
    assert.match(page.text, /niet los gegeven/);
    const save = await request(`/app/deelnemers/${otherId}/blok/`, { cookie: sessions.kantoor.cookie, form: { _csrf: sessions.kantoor.csrf, block: 'health_data', particulars: 'Diabetes' } });
    assert.equal(save.status, 422, 'geen nieuwe gezondheidsgegevens op een oude regel');
    const withdraw = await request(`/app/deelnemers/${otherId}/toestemming/${legacy.id}/intrekken/`, { cookie: sessions.kantoor.cookie, form: { _csrf: sessions.kantoor.csrf } });
    assert.equal(withdraw.status, 303);
    assert.ok((await db.query('SELECT withdrawn_at FROM consents WHERE id = $1', [legacy.id]))[0].withdrawn_at);
  });

  await t.test('samenvoegen: zelfverwijzing 404, wederzijdse verwijzing tegelijk zonder deadlock', async () => {
    const create = (email) => db.transaction(async (client) => (await persons.savePerson(client, { ...values, email, church: '', particulars: '' })).personId);
    const self = await create('zelf@example.nl');
    await db.query('UPDATE persons SET duplicate_of = id WHERE id = $1', [self]);
    assert.equal((await request(`/app/deelnemers/${self}/samenvoegen/`, { cookie: sessions.kantoor.cookie })).status, 404);
    assert.equal((await request(`/app/deelnemers/${self}/samenvoegen/`, { cookie: sessions.kantoor.cookie, form: { _csrf: sessions.kantoor.csrf, met: String(self) } })).status, 404);
    assert.equal((await db.query('SELECT count(*)::int AS total FROM persons WHERE id = $1', [self]))[0].total, 1, 'persoon blijft bestaan');

    const first = await create('wederzijds-a@example.nl');
    const second = await create('wederzijds-b@example.nl');
    await db.query('UPDATE persons SET duplicate_of = $2 WHERE id = $1', [first, second]);
    await db.query('UPDATE persons SET duplicate_of = $1 WHERE id = $2', [first, second]);
    const results = await Promise.all([
      request(`/app/deelnemers/${first}/samenvoegen/`, { cookie: sessions.kantoor.cookie, form: { _csrf: sessions.kantoor.csrf, met: String(second) } }),
      request(`/app/deelnemers/${second}/samenvoegen/`, { cookie: sessions.beheer.cookie, form: { _csrf: sessions.beheer.csrf, met: String(first) } }),
    ]);
    const statuses = results.map((response) => response.status).sort();
    assert.equal(statuses[0], 303, 'één samenvoeging slaagt');
    assert.ok([404, 409].includes(statuses[1]), `de ander krijgt 404 of 409, geen 500 (kreeg ${statuses[1]})`);
    assert.equal((await db.query('SELECT count(*)::int AS total FROM persons WHERE id = ANY($1::int[])', [[first, second]]))[0].total, 1);
    const winner = results.find((response) => response.status === 303).headers.get('location').match(/deelnemers\/(\d+)\//)[1];
    const blockAudit = await db.query("SELECT action FROM audit_log WHERE action LIKE 'deelnemer.samengevoegd.%' AND entity_id = $1", [winner]);
    assert.ok(blockAudit.some((row) => row.action.startsWith('deelnemer.samengevoegd.identiteit.')), 'ingevuld blok wel');
    assert.ok(blockAudit.every((row) => !/\.(religie|gezondheid)\./.test(row.action)), 'lege blokken op het dubbel geven geen auditregel');
  });
});
