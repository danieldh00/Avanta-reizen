// @ts-check
/**
 * Databasemigraties (PostgreSQL), positioneel: één bestand per migratie in de map `migrations/`, met de naam
 * `NNN-korte-naam.js` (NNN = het nummer met voorloopnullen). Een nieuwe migratie is een nieuw bestand met het
 * eerstvolgende nummer; dit bestand hoeft daarvoor niet te veranderen, zodat twee takken met elk een eigen migratie
 * niet in hetzelfde bestand werken. Een bestaande migratie verandert nooit meer nadat hij op main staat.
 *
 * `migrations/laatste-migratie.txt` bevat de bestandsnaam van de laatste migratie en verandert bij elke nieuwe
 * migratie mee. Dat is met opzet het ene gedeelde regeltje: nemen twee takken hetzelfde nummer, dan zetten ze er elk
 * een andere bestandsnaam in, geeft git een conflict in dat bestand en kan de tweede niet mergen voordat hij is
 * hernummerd. (Alleen het nummer zou niet werken: twee keer dezelfde wijziging voegt git zonder conflict samen.)
 * `test/migrations.test.js` bewaakt dat de naam klopt.
 */
const fs = require('node:fs');
const path = require('node:path');

/** Map met de migratiebestanden. */
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
/** Bestand met de bestandsnaam van de laatste migratie (zie de kop van dit bestand). */
const LAST_MIGRATION_FILE = path.join(MIGRATIONS_DIR, 'laatste-migratie.txt');
/** Vorm van een bestandsnaam: drie cijfers, een streepje en een naam in kebab-case. */
const FILE_PATTERN = /^(\d{3})-[a-z0-9]+(?:-[a-z0-9]+)*\.js$/;

/**
 * Leest alle migraties uit een map, op volgorde van nummer, en controleert dat de reeks klopt: elke bestandsnaam
 * heeft de vaste vorm, het nummer in de naam is het `id` in het bestand en de nummers lopen zonder gat of dubbele
 * vanaf 1. Een fout hier stopt het starten van de app, zodat een verkeerd genummerde migratie nooit draait.
 * @param {string} [directory] Map met de migratiebestanden (standaard `migrations/` naast dit bestand).
 * @returns {{id: number, name: string, sql: string}[]} De migraties, oplopend op nummer.
 */
function loadMigrations(directory = MIGRATIONS_DIR) {
  const fileNames = fs.readdirSync(directory).filter((fileName) => fileName.endsWith('.js')).sort();
  return fileNames.map((fileName, index) => {
    const match = FILE_PATTERN.exec(fileName);
    if (!match) throw new Error(`migratiebestand ${fileName} heeft niet de vorm NNN-korte-naam.js`);
    // Alleen bestanden uit de eigen migratiemap die aan FILE_PATTERN voldoen (hierboven gecontroleerd).
    // eslint-disable-next-line security/detect-non-literal-require
    const migration = require(path.join(directory, fileName));
    const expectedId = index + 1;
    if (Number(match[1]) !== expectedId) throw new Error(`migratiebestand ${fileName}: verwacht nummer ${expectedId} (nummers lopen door zonder gat of dubbele)`);
    if (migration.id !== expectedId) throw new Error(`migratiebestand ${fileName}: id ${migration.id} hoort ${expectedId} te zijn`);
    if (typeof migration.name !== 'string' || !migration.name || typeof migration.sql !== 'string' || !migration.sql.trim()) {
      throw new Error(`migratiebestand ${fileName}: name en sql zijn verplicht`);
    }
    return { id: migration.id, name: migration.name, sql: migration.sql };
  });
}

const MIGRATIONS = loadMigrations();

module.exports = { MIGRATIONS, loadMigrations, MIGRATIONS_DIR, LAST_MIGRATION_FILE };
