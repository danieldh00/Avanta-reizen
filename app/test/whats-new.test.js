/**
 * Tests van *Wat is er nieuw* (`crm/whats-new.js`, `crm/whats-new-routes.js`): de changelog lezen (nieuws en technische
 * details per versie), de weergave (escaping, code, vet), de lezer met cache, en de route in de echte app: alleen met
 * sessie, voor elke rol, technische details alleen met het recht `systeem`, en de link in het gebruikersmenu.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { toString } = require('../src/site/html');
const { parseReleaseNotes, createChangelogReader, renderWhatsNew, longDate, CHANGELOG_FILE } = require('../src/crm/whats-new');
const { createDatabase } = require('../src/database/db');
const { createApp } = require('../src/server');
const { hashPassword } = require('../src/crm/passwords');
const { COOKIE_NAME } = require('../src/crm/auth');

const SAMPLE = `# Changelog

## 0.3.1 — 2026-11-24 — Teksteditor voor <blokken>

- Je ziet de tekst zoals op de site; **geen** \`<p>\` meer typen.
- Tweede *punt*.

- Nieuwe editor \`public/js/rich-editor.js\` (contenteditable),
  met een opschoner.
- Server ongewijzigd.

## 0.3.0 — 2026-11-20 — Alleen techniek

- \`crm/routes.js\`: limiet per pad,
  ook voor reizen.

## 0.2.9 — 2026-11-19

Losse tekst zonder punt
op twee regels.

## 0.1.0

Startpunt.
`;

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'whats_new_test';
const PASSWORD = 'een heel goed wachtwoord';

test('changelog lezen: nieuws en technische details per versie, nieuwste eerst', () => {
  const releases = parseReleaseNotes(SAMPLE);
  assert.deepEqual(releases.map((release) => release.version), ['0.3.1', '0.3.0', '0.2.9', '0.1.0']);
  assert.deepEqual(releases[0], {
    version: '0.3.1', date: '2026-11-24', title: 'Teksteditor voor <blokken>',
    news: ['Je ziet de tekst zoals op de site; **geen** `<p>` meer typen.', 'Tweede *punt*.'],
    details: ['Nieuwe editor `public/js/rich-editor.js` (contenteditable), met een opschoner.', 'Server ongewijzigd.'],
  });
  assert.deepEqual(releases[1].news, [], 'één blok met vervolgregels is techniek, geen nieuws');
  assert.deepEqual(releases[1].details, ['`crm/routes.js`: limiet per pad, ook voor reizen.']);
  assert.equal(releases[2].title, '');
  assert.deepEqual(releases[2].details, ['Losse tekst zonder punt op twee regels.']);
  assert.deepEqual(releases[3], { version: '0.1.0', date: '', title: '', news: [], details: ['Startpunt.'] });
  assert.deepEqual(parseReleaseNotes(''), []);
  assert.deepEqual(parseReleaseNotes('# Changelog\n\ngeen versies\n'), []);
});

test('changelog lezen: een kopje van een ander niveau sluit de versie af', () => {
  const releases = parseReleaseNotes('## 1.0.0 — 2026-01-01 — A\n\n- nieuws\n\n- techniek\n# Iets anders\n- hoort er niet bij\n');
  assert.deepEqual(releases[0].news, ['nieuws']);
  assert.deepEqual(releases[0].details, ['techniek']);
});

test('de echte changelog is te lezen en heeft per versie een titel', () => {
  const releases = parseReleaseNotes(fs.readFileSync(CHANGELOG_FILE, 'utf8'));
  assert.ok(releases.length > 10);
  assert.equal(releases[0].version, require('../package.json').version, 'bovenaan de draaiende versie');
  assert.ok(releases.filter((release) => release.date).every((release) => /^\d{4}-\d{2}-\d{2}$/.test(release.date)));
});

test('lezer: leest opnieuw na een wijziging, ontbrekend bestand geeft een lege lijst', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wat-is-er-nieuw-'));
  const file = path.join(dir, 'CHANGELOG.md');
  fs.writeFileSync(file, '## 1.0.0 — 2026-01-01 — Eerste\n\n- a\n');
  const read = createChangelogReader(file);
  assert.equal(read()[0].title, 'Eerste');
  assert.equal(read(), read(), 'zelfde resultaat uit de cache');
  fs.writeFileSync(file, '## 1.0.1 — 2026-01-02 — Tweede versie\n\n- b\n');
  fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
  assert.equal(read()[0].title, 'Tweede versie');
  fs.rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(read(), []);
  assert.deepEqual(createChangelogReader(path.join(dir, 'bestaat-niet.md'))(), []);
});

test('weergave: escaping, code, vet en cursief; details alleen als gevraagd', () => {
  const releases = parseReleaseNotes(SAMPLE);
  const forOffice = toString(renderWhatsNew(releases, { currentVersion: '0.3.1', showDetails: false }));
  assert.match(forOffice, /Je werkt met versie <strong>0\.3\.1<\/strong>/);
  assert.match(forOffice, /<h2 class="crm-news__title">Teksteditor voor &lt;blokken&gt;<\/h2>/);
  assert.match(forOffice, /<time datetime="2026-11-24">24 november 2026<\/time>/);
  assert.match(forOffice, /<strong>geen<\/strong> <code>&lt;p&gt;<\/code> meer typen/);
  assert.match(forOffice, /Tweede <em>punt<\/em>\./);
  assert.doesNotMatch(forOffice, /Technische details|rich-editor\.js/);
  assert.match(forOffice, /Onderhoud en verbeteringen achter de schermen\./, 'versie zonder nieuws');
  assert.match(forOffice, /<h2 class="crm-news__title">Versie 0\.2\.9<\/h2>/, 'versie zonder titel');
  assert.doesNotMatch(forOffice, /<p>|<blokken>/);
  const forAdmin = toString(renderWhatsNew(releases, { currentVersion: '0.3.1', showDetails: true }));
  assert.match(forAdmin, /<summary>Technische details<\/summary>/);
  assert.match(forAdmin, /<code>public\/js\/rich-editor\.js<\/code>/);
  assert.doesNotMatch(forAdmin, /Onderhoud en verbeteringen/, 'beheerder ziet de echte details');
  assert.match(toString(renderWhatsNew([], { currentVersion: '1.0.0', showDetails: true })), /nog geen wijzigingen/);
});

test('datum in het Nederlands', () => {
  assert.equal(longDate('2026-01-05'), '5 januari 2026');
  assert.equal(longDate('2026-12-31'), '31 december 2026');
  assert.equal(longDate(''), '');
  assert.equal(longDate('gisteren'), '');
});

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

test('pagina Wat is er nieuw in het CRM', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  await db.migrate();
  const app = createApp({ db, masterKey: Buffer.alloc(32, 43) });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await db.close(); });

  const hash = await hashPassword(PASSWORD);
  const roles = ['beheerder', 'kantoor', 'reisleider', 'redacteur'];
  for (const role of roles) {
    await db.query('INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)', [`${role}@example.nl`, `Gebruiker ${role}`, role, hash]);
  }
  const request = async (url, cookie) => {
    const response = await fetch(base + url, { headers: cookie ? { cookie: `${COOKIE_NAME}=${cookie}` } : {}, redirect: 'manual' });
    return { status: response.status, text: await response.text(), location: response.headers.get('location') };
  };
  const login = async (role) => {
    const response = await fetch(`${base}/app/inloggen/`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: `${role}@example.nl`, password: PASSWORD }).toString(), redirect: 'manual' });
    return response.headers.getSetCookie().find((value) => value.startsWith(`${COOKIE_NAME}=`)).split(';')[0].split('=')[1];
  };
  const version = require('../package.json').version;

  await t.test('zonder sessie naar inloggen', async () => {
    const response = await request('/app/wat-is-er-nieuw/');
    assert.equal(response.status, 303);
    assert.match(response.location, /\/app\/inloggen\//);
  });

  await t.test('elke rol ziet de pagina en de link in het gebruikersmenu; details alleen met recht systeem', async () => {
    for (const role of roles) {
      const cookie = await login(role);
      const page = await request('/app/wat-is-er-nieuw/', cookie);
      assert.equal(page.status, 200, role);
      assert.match(page.text, /<title>Wat is er nieuw - Avanta CRM<\/title>/);
      assert.match(page.text, new RegExp(`Je werkt met versie <strong>${version.replace(/\./g, '\\.')}</strong>`));
      assert.match(page.text, new RegExp(`id="versie-${version.replace(/\./g, '\\.')}"`));
      assert.match(page.text, /<a class="crm-user-item" href="\/app\/wat-is-er-nieuw\/" aria-current="page">/, 'gemarkeerd in het menu');
      const overview = await request('/app/', cookie);
      assert.match(overview.text, /<a class="crm-user-item" href="\/app\/wat-is-er-nieuw\/">.*<span>Wat is er nieuw<\/span><\/a>/, `${role}: link in het gebruikersmenu`);
      if (role === 'beheerder') assert.match(page.text, /<summary>Technische details<\/summary>/);
      else assert.doesNotMatch(page.text, /Technische details/, role);
    }
  });
});
