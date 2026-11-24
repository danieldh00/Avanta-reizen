/**
 * Tests voor migratie 33 (alle landen van de wereld bij Reistypes en landen): de vaste lijst (codes en sleutels uniek,
 * slugs geldig) en de migratie zelf op een database zoals na de import: bestaande landen houden naam, slug, reizen en
 * foto's en krijgen hun code (ook onder een andere naam, zoals U.S.A. of Macedonië), ongebruikte restcategorieën
 * verdwijnen (een dubbeling met een 301), gebruikte blijven staan, en alle overige landen komen erbij. Draait in een
 * eigen schema.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createDatabase } = require('../src/database/db');
const { isValidSlug, slugify } = require('../src/trips/slugs');

const MIGRATION_FILE = path.join(__dirname, '..', 'src', 'database', 'migrations', '033-website-alle-landen.js');
const migration = require(MIGRATION_FILE);

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'countries_migration_test';

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
 * De landen uit de migratie: code, naam en sleutels, gelezen uit de SQL van de tijdelijke tabel.
 * @returns {{code: string, name: string, slug: string, keys: string[]}[]} Landen.
 */
function countriesInMigration() {
  const pattern = /\('([A-Z]{2})', '((?:[^']|'')+)', '([a-z0-9-]+)', ARRAY\[([^\]]+)\]::text\[\]\)/g;
  return [...migration.sql.matchAll(pattern)].map((match) => ({
    code: match[1],
    name: match[2].replace(/''/g, "'"),
    slug: match[3],
    keys: [...match[4].matchAll(/'([^']+)'/g)].map((key) => key[1]),
  }));
}

test('migratie 33: de vaste landenlijst', () => {
  const countries = countriesInMigration();
  assert.equal(countries.length, 250, 'alle 249 ISO 3166-1-codes plus Kosovo');
  assert.equal(new Set(countries.map((country) => country.code)).size, countries.length, 'codes uniek');
  assert.equal(new Set(countries.map((country) => country.slug)).size, countries.length, 'slugs uniek');
  const keys = countries.flatMap((country) => country.keys);
  assert.equal(new Set(keys).size, keys.length, 'een sleutel past bij precies één land');
  for (const country of countries) {
    assert.ok(isValidSlug(country.slug), `geldige slug: ${country.slug}`);
    assert.equal(country.slug, slugify(country.name.replace(/'/g, '')), `slug gelijk aan slugify zonder apostrof: ${country.name}`);
    assert.ok(country.keys.every(isValidSlug), `geldige sleutels: ${country.name}`);
  }
  const byCode = new Map(countries.map((country) => [country.code, country]));
  assert.equal(byCode.get('NL').name, 'Nederland');
  assert.equal(byCode.get('SA').name, 'Saoedi-Arabië');
  assert.ok(byCode.get('US').keys.includes('vs') && byCode.get('US').keys.includes('u-s-a'));
  assert.ok(byCode.get('MK').keys.includes('macedonie'));
  assert.equal(byCode.get('XK').name, 'Kosovo');
  assert.equal(byCode.get('BS').slug, 'bahamas');
});

test('migratie 33 op een database zoals na de import', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = createDatabase(DATABASE_URL);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.close();
  const db = createDatabase(withSchema(DATABASE_URL));
  t.after(() => db.close());
  await db.migrate();

  // Terug naar de stand van vóór migratie 33, met categorieën zoals de import ze achterliet.
  await db.query('ALTER TABLE trip_categories DROP COLUMN iso_code');
  await db.query('DELETE FROM trip_categories');
  const insert = async (slug, name, kind) => (await db.query(
    'INSERT INTO trip_categories (slug, name, kind) VALUES ($1, $2, $3) RETURNING id', [slug, name, kind],
  ))[0].id;
  const ids = {
    frankrijk: await insert('frankrijk', 'Frankrijk', 'bestemming'),
    vs: await insert('vs', 'U.S.A.', 'bestemming'),
    macedonie: await insert('macedonie', 'Macedonië', 'bestemming'),
    saudi: await insert('saudi-arabie', 'Saudi-Arabië', 'bestemming'),
    saudi2: await insert('saudi-arabie-2', 'Saudi Arabië', 'overig'),
    schotland: await insert('schotland', 'Schotland', 'bestemming'),
    winter: await insert('wintersport', 'winterreizen', 'bestemming'),
    bestemming: await insert('bestemming', 'Bestemming', 'overig'),
    type: await insert('type', 'Type', 'overig'),
    nan: await insert('nan', 'NaN', 'overig'),
    nederland: await insert('nederland', 'nederland', 'overig'),
    belgie: await insert('belgie', 'belgie', 'overig'),
    usedLeftover: await insert('rest', 'rest', 'overig'),
    kamperen: await insert('kamperen', 'Kampeerreizen', 'type'),
    peruType: await insert('peru', 'Peru als reistype', 'type'),
  };
  const [trip] = await db.query("INSERT INTO trips (slug, title) VALUES ('reis', 'Reis') RETURNING id");
  for (const key of ['frankrijk', 'vs', 'belgie', 'usedLeftover', 'kamperen']) {
    await db.query('INSERT INTO trip_category_links (trip_id, category_id) VALUES ($1, $2)', [trip.id, ids[key]]);
  }
  const [photo] = await db.query(
    `INSERT INTO media (original_url, local_name, content_type, bytes, source, title, alt_text, variants)
     VALUES (NULL, 'bib-0000000000000032-1600.webp', 'image/webp', 10, 'upload', 'Berg', '', '{}') RETURNING id`,
  );
  await db.query('INSERT INTO media_countries (media_id, category_id) VALUES ($1, $2)', [photo.id, ids.macedonie]);

  await db.transaction((client) => client.query(migration.sql));

  const rows = await db.query('SELECT id, slug, name, kind, iso_code FROM trip_categories ORDER BY id');
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  const countries = countriesInMigration();
  assert.equal(rows.filter((row) => row.iso_code).length, countries.length, 'elk land één keer');

  // Bestaande landen: zelfde rij, naam en slug, met code; reizen en foto's blijven.
  assert.deepEqual(bySlug.get('frankrijk'), { id: ids.frankrijk, slug: 'frankrijk', name: 'Frankrijk', kind: 'bestemming', iso_code: 'FR' });
  assert.equal(bySlug.get('vs').iso_code, 'US');
  assert.equal(bySlug.get('vs').name, 'U.S.A.');
  assert.equal(bySlug.get('macedonie').iso_code, 'MK');
  assert.equal(bySlug.get('saudi-arabie').iso_code, 'SA');
  assert.equal(bySlug.get('saudi-arabie').name, 'Saudi-Arabië');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM trip_category_links WHERE trip_id = $1', [trip.id]))[0].n, 5);
  assert.equal((await db.query('SELECT category_id FROM media_countries'))[0].category_id, ids.macedonie);
  // Geen land: blijft zonder code.
  assert.equal(bySlug.get('schotland').iso_code, null);
  assert.equal(bySlug.get('wintersport').iso_code, null);

  // Restjes zonder reizen of foto's weg; de dubbeling verwijst door; een gebruikt restje blijft.
  for (const slug of ['bestemming', 'type', 'nan', 'saudi-arabie-2']) assert.ok(!rows.some((row) => row.id === ids[slug === 'saudi-arabie-2' ? 'saudi2' : slug]), slug);
  const redirects = await db.query('SELECT from_path, to_url FROM redirects ORDER BY from_path');
  assert.deepEqual(redirects, [{ from_path: '/reis-categorie/saudi-arabie-2/', to_url: '/reis-categorie/saudi-arabie/' }]);
  assert.equal(bySlug.get('rest').kind, 'overig', 'gebruikt restje blijft staan');

  // Nederland: het lege restje is weg, het land komt erbij op hetzelfde adres. België (met een reis) wordt het land.
  assert.notEqual(bySlug.get('nederland').id, ids.nederland);
  assert.deepEqual({ ...bySlug.get('nederland'), id: 0 }, { id: 0, slug: 'nederland', name: 'Nederland', kind: 'bestemming', iso_code: 'NL' });
  assert.deepEqual(bySlug.get('belgie'), { id: ids.belgie, slug: 'belgie', name: 'België', kind: 'bestemming', iso_code: 'BE' });

  // Nieuwe landen; een slug die al bij een reistype hoort, krijgt de code erachter.
  assert.equal(bySlug.get('bhutan').name, 'Bhutan');
  assert.equal(bySlug.get('peru').kind, 'type');
  assert.equal(bySlug.get('peru-pe').iso_code, 'PE');
  assert.equal(bySlug.get('kamperen').kind, 'type');

  // De code is uniek en heeft de vorm van twee hoofdletters.
  await assert.rejects(db.query("UPDATE trip_categories SET iso_code = 'FR' WHERE slug = 'bhutan'"), /unique|uniek|duplicate/i);
  await assert.rejects(db.query("UPDATE trip_categories SET iso_code = 'fr' WHERE slug = 'schotland'"), /check/i);
});
