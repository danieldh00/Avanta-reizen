/**
 * Tests voor de lader van de migraties (`database/migrations.js`), zonder database: de echte map is een sluitende
 * reeks en een verkeerd genummerd of verkeerd genoemd bestand wordt geweigerd.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MIGRATIONS, loadMigrations, MIGRATIONS_DIR } = require('../src/database/migrations');

/**
 * Maakt een tijdelijke map met migratiebestanden.
 * @param {Record<string, string>} files Bestandsnaam → inhoud van het bestand.
 * @returns {string} Pad van de map.
 */
function temporaryMigrations(files) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'avanta-migraties-'));
  for (const [fileName, content] of Object.entries(files)) fs.writeFileSync(path.join(directory, fileName), content);
  return directory;
}

/**
 * Inhoud van een geldig migratiebestand.
 * @param {number} id Nummer van de migratie.
 * @returns {string} De broncode.
 */
const migrationSource = (id) => `module.exports = { id: ${id}, name: 'test ${id}', sql: 'SELECT ${id}' };\n`;

test('migraties: de map is een sluitende reeks vanaf 1, één bestand per migratie', () => {
  const fileNames = fs.readdirSync(MIGRATIONS_DIR).filter((fileName) => fileName.endsWith('.js'));
  assert.equal(MIGRATIONS.length, fileNames.length);
  assert.ok(MIGRATIONS.length >= 28);
  assert.deepEqual(MIGRATIONS.map((migration) => migration.id), MIGRATIONS.map((unused, index) => index + 1));
  assert.equal(MIGRATIONS[0].name, 'content van de website');
  assert.equal(MIGRATIONS[27].name, 'CRM: online betalen');
  for (const migration of MIGRATIONS) assert.deepEqual(Object.keys(migration), ['id', 'name', 'sql']);
});

test('migraties: laden op volgorde van nummer, andere bestanden in de map tellen niet mee', () => {
  const directory = temporaryMigrations({ '002-tweede.js': migrationSource(2), '001-eerste.js': migrationSource(1), 'LEESMIJ.md': 'uitleg' });
  assert.deepEqual(loadMigrations(directory), [{ id: 1, name: 'test 1', sql: 'SELECT 1' }, { id: 2, name: 'test 2', sql: 'SELECT 2' }]);
});

test('migraties: een gat, dubbel nummer, verkeerde naam, afwijkend id of lege sql wordt geweigerd', () => {
  assert.throws(() => loadMigrations(temporaryMigrations({ '001-eerste.js': migrationSource(1), '003-derde.js': migrationSource(3) })), /verwacht nummer 2/);
  assert.throws(() => loadMigrations(temporaryMigrations({ '001-eerste.js': migrationSource(1), '001-ook-eerste.js': migrationSource(1) })), /verwacht nummer 2/);
  assert.throws(() => loadMigrations(temporaryMigrations({ '1-eerste.js': migrationSource(1) })), /NNN-korte-naam/);
  assert.throws(() => loadMigrations(temporaryMigrations({ '001-Eerste_Stap.js': migrationSource(1) })), /NNN-korte-naam/);
  assert.throws(() => loadMigrations(temporaryMigrations({ '001-eerste.js': migrationSource(2) })), /id 2 hoort 1/);
  assert.throws(() => loadMigrations(temporaryMigrations({ '001-eerste.js': "module.exports = { id: 1, name: 'leeg', sql: '  ' };\n" })), /name en sql zijn verplicht/);
});
