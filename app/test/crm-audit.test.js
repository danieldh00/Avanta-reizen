/**
 * Tests voor het auditlog in Beheer (`/app/auditlog/`, `crm/audit-routes.js` en `crm/audit-log.js`, F06): rechten
 * (alleen `gebruikers`), filters op gebruiker, actie, soort record, record en periode (hele dagen in Nederlandse tijd),
 * ongeldige filters vallen weg, bladeren met behoud van filters, de export naar Excel met dezelfde filters, de eigen
 * auditregel van de export, de limiet per gebruiker en de weigering boven het maximum. Draait in een eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { hashPassword } = require('../src/crm/passwords');
const { COOKIE_NAME } = require('../src/crm/auth');
const audit = require('../src/crm/audit-log');
const { EXPORT_LIMIT } = require('../src/crm/audit-routes');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'crm_audit_test';
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
 * Pakt een .xlsx (zip) uit tot een object met de tekst per bestand.
 * @param {Buffer} buffer Het bestand.
 * @returns {Record<string, string>} Inhoud per bestandsnaam.
 */
function unzip(buffer) {
  const files = {};
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString();
    const start = offset + 30 + nameLength + extraLength;
    const data = buffer.subarray(start, start + size);
    files[name] = (method === 8 ? zlib.inflateRawSync(data) : data).toString();
    offset = start + size;
  }
  return files;
}

test('auditlog: filters uit de querystring', () => {
  assert.deepEqual(audit.readAuditFilter({ gebruiker: ' 12 ', actie: 'bericht.afgehandeld', soort: 'bookings', record: '7', van: '2026-11-01', tot: '2026-11-30' }),
    { user: '12', action: 'bericht.afgehandeld', entity: 'bookings', record: '7', from: '2026-11-01', to: '2026-11-30' });
  assert.deepEqual(audit.readAuditFilter({ gebruiker: "1' OR 1=1", actie: 'DROP TABLE', soort: 'a-b', record: '1;2', van: '2026-02-30', tot: 'gisteren' }),
    { user: '', action: '', entity: '', record: '', from: '', to: '' });
  assert.deepEqual(audit.readAuditFilter({ gebruiker: ['1', '2'] }).user, '', 'een lijst telt niet');
  assert.equal(audit.readAuditFilter({ gebruiker: 'systeem' }).user, 'systeem');
  const { where, params } = audit.auditWhere(audit.readAuditFilter({ gebruiker: 'systeem', actie: 'inloggen', van: '2026-11-01' }));
  assert.match(where, /a\.user_id IS NULL AND a\.action = \$1 AND a\.created_at >= \(\$2::date\)/);
  assert.deepEqual(params, ['inloggen', '2026-11-01']);
  assert.equal(audit.auditWhere(audit.readAuditFilter({})).where, 'true');
});

test('auditlog in Beheer', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  const app = createApp({ db, masterKey: MASTER_KEY });
  const small = createApp({ db, masterKey: MASTER_KEY, auditExportMax: 2 });
  const server = app.listen(0);
  const smallServer = small.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const smallBase = `http://127.0.0.1:${smallServer.address().port}`;
  t.after(async () => { server.close(); smallServer.close(); await db.close(); });

  const hash = await hashPassword(PASSWORD);
  const users = {};
  for (const role of ['beheerder', 'kantoor', 'reisleider', 'boekhouding', 'redacteur']) {
    const [row] = await db.query('INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id', [`${role}@example.nl`, `Gebruiker ${role}`, role, hash]);
    users[role] = row.id;
  }
  // Vaste regels op bekende tijdstippen (Nederlandse tijd: 1 november 00:30 is 31 oktober 23:30 UTC).
  const insert = (userId, action, entity, entityId, at) => db.query(
    'INSERT INTO audit_log (user_id, action, entity, entity_id, ip_prefix, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [userId, action, entity, entityId, '192.0.2.0/24', at],
  );
  await insert(users.kantoor, 'bericht.afgehandeld', 'contact_messages', '5', '2026-10-31T23:30:00Z');
  await insert(users.kantoor, 'aanmelding.handmatig', 'bookings', '42', '2026-11-10T10:00:00Z');
  await insert(null, 'inloggen.mislukt', null, null, '2026-11-15T22:30:00Z');
  await insert(users.beheerder, 'gebruiker.rol', 'users', String(users.kantoor), '2026-10-31T22:30:00Z');
  await insert(null, 'backup.gemaakt', 'backup', 'avanta-20261124-053008.dump.enc', '2026-11-02T10:00:00Z');

  const request = async (url, init = {}) => {
    const headers = {};
    if (init.cookie) headers.cookie = `${COOKIE_NAME}=${init.cookie}`;
    let body;
    if (init.form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(init.form).toString();
    }
    const response = await fetch((init.base || base) + url, { method: init.form ? 'POST' : 'GET', headers, body, redirect: 'manual' });
    const setCookie = response.headers.getSetCookie().find((value) => value.startsWith(`${COOKIE_NAME}=`)) || '';
    const buffer = Buffer.from(await response.arrayBuffer());
    return { status: response.status, buffer, text: buffer.toString(), headers: response.headers, cookie: setCookie.split(';')[0].split('=')[1] || '' };
  };
  const login = async (role) => (await request('/app/inloggen/', { form: { email: `${role}@example.nl`, password: PASSWORD } })).cookie;
  const beheerder = await login('beheerder');
  const others = { kantoor: await login('kantoor'), reisleider: await login('reisleider'), boekhouding: await login('boekhouding'), redacteur: await login('redacteur') };
  const rowsOf = (page) => (page.match(/<tbody>[\s\S]*?<\/tbody>/) || [''])[0];

  await t.test('rechten: zonder sessie naar inloggen, zonder recht 403 (ook de export)', async () => {
    assert.equal((await request('/app/auditlog/')).status, 303);
    for (const cookie of Object.values(others)) {
      assert.equal((await request('/app/auditlog/', { cookie })).status, 403);
      assert.equal((await request('/app/auditlog/export.xlsx', { cookie })).status, 403);
    }
  });

  await t.test('lijst: alle regels, labels, links naar het record, filterformulier', async () => {
    const page = await request('/app/auditlog/', { cookie: beheerder });
    assert.equal(page.status, 200);
    const body = rowsOf(page.text);
    assert.match(body, /Bericht afgehandeld|bericht\.afgehandeld/);
    assert.match(body, /<a href="\/app\/aanmeldingen\/42\/">Aanmelding #42<\/a>/);
    assert.match(body, /<a href="\/app\/berichten\/5\/">Bericht #5<\/a>/);
    assert.match(page.text, /<form class="crm-audit-filter" method="get" action="\/app\/auditlog\/"/);
    assert.match(page.text, /<option value="contact_messages">Bericht<\/option>/);
    assert.match(page.text, /href="\/app\/auditlog\/export\.xlsx"/);
    assert.doesNotMatch(page.text, /Alles tonen/, 'zonder filter geen knop om te wissen');
    assert.match(body, /<span class="crm-audit-record" title="avanta-20261124-053008\.dump\.enc">Back-up #avanta-20261124…<\/span>/);
  });

  await t.test('filters: gebruiker, systeem, actie, soort, record en periode in Nederlandse tijd', async () => {
    const byUser = rowsOf((await request(`/app/auditlog/?gebruiker=${users.kantoor}`, { cookie: beheerder })).text);
    assert.match(byUser, /Aanmelding #42/);
    assert.doesNotMatch(byUser, /Rol gewijzigd|Inloggen mislukt/);
    const system = (await request('/app/auditlog/?gebruiker=systeem', { cookie: beheerder })).text;
    assert.match(rowsOf(system), /Inloggen mislukt/);
    assert.doesNotMatch(rowsOf(system), /Aanmelding #42/);
    assert.match(system, /<option value="systeem" selected>/);
    assert.match(system, /Alles tonen/);
    const byAction = rowsOf((await request('/app/auditlog/?actie=aanmelding.handmatig', { cookie: beheerder })).text);
    assert.match(byAction, /Aanmelding #42/);
    assert.doesNotMatch(byAction, /Bericht #5/);
    const byRecord = rowsOf((await request('/app/auditlog/?soort=bookings&record=42', { cookie: beheerder })).text);
    assert.match(byRecord, /Aanmelding #42/);
    assert.doesNotMatch(byRecord, /Inloggen mislukt/);
    // 1 november NL = 31-10 23:00 UTC tot 1-11 23:00 UTC: het bericht (23:30 UTC) valt erin, de rolwijziging (22:30 UTC) niet.
    const day = rowsOf((await request('/app/auditlog/?van=2026-11-01&tot=2026-11-01', { cookie: beheerder })).text);
    assert.match(day, /Bericht #5/);
    assert.doesNotMatch(day, /Rol gewijzigd/);
    assert.doesNotMatch(day, /Aanmelding #42/);
    // Tot en met 15 november NL: de mislukte inlog om 23:30 NL telt nog mee.
    assert.match(rowsOf((await request('/app/auditlog/?van=2026-11-15&tot=2026-11-15', { cookie: beheerder })).text), /Inloggen mislukt/);
    assert.match((await request('/app/auditlog/?actie=bestaat.niet', { cookie: beheerder })).text, /Geen regels bij deze filters/);
    const unknown = (await request('/app/auditlog/?soort=onbekend_ding', { cookie: beheerder })).text;
    assert.match(unknown, /<option value="onbekend_ding" selected>onbekend_ding<\/option>/, 'een gekozen soort buiten de vaste lijst blijft gekozen');
    assert.match(rowsOf((await request('/app/auditlog/?record=42', { cookie: beheerder })).text), /Aanmelding #42/, 'record zonder soort');
  });

  await t.test('ongeldige filters vallen weg en komen niet terug in de pagina', async () => {
    const page = await request(`/app/auditlog/?gebruiker=${encodeURIComponent("1' OR '1'='1")}&actie=%3Cscript%3E&van=2026-13-01&record=${encodeURIComponent('"><b>')}`, { cookie: beheerder });
    assert.equal(page.status, 200);
    assert.match(rowsOf(page.text), /Aanmelding #42/);
    assert.doesNotMatch(page.text, /<script>|"><b>/);
  });

  await t.test('bladeren: oudere regels met behoud van de filters', async () => {
    for (let i = 0; i < audit.AUDIT_PAGE_SIZE + 5; i++) await insert(users.kantoor, 'aanmelding.status', 'bookings', '42', '2026-11-20T10:00:00Z');
    const first = (await request('/app/auditlog/?actie=aanmelding.status', { cookie: beheerder })).text;
    const next = first.match(/href="(\/app\/auditlog\/\?[^"]*voor=\d+[^"]*)" rel="next"/);
    assert.ok(next, 'link naar oudere regels');
    const url = next[1].replace(/&amp;/g, '&');
    assert.match(url, /actie=aanmelding\.status/);
    const second = (await request(url, { cookie: beheerder })).text;
    assert.equal((rowsOf(second).match(/<tr>/g) || []).length, 5);
    assert.match(second, /Naar de nieuwste regels/);
    assert.doesNotMatch(second, /rel="next"/);
  });

  await t.test('export: .xlsx met dezelfde filters, eigen auditregel, geen CSV', async () => {
    const response = await request('/app/auditlog/export.xlsx?actie=aanmelding.handmatig', { cookie: beheerder });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.match(response.headers.get('content-disposition'), /^attachment; filename="auditlog-\d{4}-\d{2}-\d{2}\.xlsx"$/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const files = unzip(response.buffer);
    const text = Object.keys(files).filter((name) => name.startsWith('xl/worksheets/')).sort().map((name) => files[name]).join('');
    assert.match(text, /aanmelding\.handmatig/);
    assert.match(text, />42</);
    assert.match(text, /10-11-2026 11:00:00/, 'tijdstip in Nederlandse tijd');
    assert.doesNotMatch(text, /bericht\.afgehandeld/);
    assert.match(text, /Over deze export/);
    assert.match(text, /Gebruiker beheerder/);
    const [row] = await db.query("SELECT user_id, entity FROM audit_log WHERE action = 'export.auditlog'");
    assert.equal(row.user_id, users.beheerder);
    assert.equal(row.entity, null);
    assert.match(rowsOf((await request('/app/auditlog/?actie=export.auditlog', { cookie: beheerder })).text), /Auditlog geëxporteerd \(\.xlsx\)/);
  });

  await t.test('export: boven het maximum een melding in plaats van een onvolledig bestand', async () => {
    const response = await request('/app/auditlog/export.xlsx', { cookie: beheerder, base: smallBase });
    assert.equal(response.status, 422);
    assert.match(response.text, /meer dan 2 regels/);
    assert.equal((await request('/app/auditlog/export.xlsx?actie=aanmelding.handmatig', { cookie: beheerder, base: smallBase })).status, 200);
  });

  await t.test('export: limiet per gebruiker', async () => {
    let status = 200;
    for (let i = 0; i < EXPORT_LIMIT + 1 && status === 200; i++) status = (await request('/app/auditlog/export.xlsx?actie=inloggen.mislukt', { cookie: beheerder })).status;
    assert.equal(status, 429);
    assert.match((await request('/app/auditlog/export.xlsx', { cookie: beheerder })).text, /maximum van 10 exports/);
  });
});
