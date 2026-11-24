// @ts-check
/**
 * Opdrachtregel voor de sleutelrotatie (in de app-container, zelfde omgeving als de app), bevinding A13:
 *   node src/security/key-rotation-cli.js status            wat er nog met een vorige sleutel is versleuteld
 *   node src/security/key-rotation-cli.js herversleutelen   alles opnieuw versleutelen met de huidige sleutel
 *
 * Vooraf staat de nieuwe sleutel in AVANTA_MASTER_KEY en de oude in AVANTA_MASTER_KEY_PREVIOUS (of in
 * DATA_DIR/master-key en DATA_DIR/master-key.previous); op apps01 regelt `servertaken.sh sleutel-roteren` dat. De
 * opdracht maakt nooit zelf een sleutel aan en toont nooit sleutels of waarden, alleen het sleutel-id en aantallen.
 * Uitgangscode 0 = gelukt (bij `status`: niets meer te doen), 1 = fout of waarden die niet te openen waren, 2 = verkeerd
 * gebruik, 3 = `status` met nog openstaand werk.
 */
const fs = require('node:fs');
const path = require('node:path');
const { createDatabase } = require('../database/db');
const { loadMasterKey, loadPreviousKeys, createVault, keyIdOf } = require('./vault');
const { createPersons } = require('../persons/persons');
const { createKeyRotation } = require('./key-rotation');
const { DATA_DIR } = require('../paths');

/** Uitleg bij verkeerd gebruik. */
const USAGE = 'Gebruik: node src/security/key-rotation-cli.js status|herversleutelen';

/**
 * Leest de hoofdsleutel zonder er een aan te maken (een nieuwe sleutel zou alles onleesbaar maken).
 * @returns {Buffer} Huidige sleutel.
 * @throws {Error} Als er geen sleutel is ingesteld.
 */
function existingMasterKey() {
  const configured = process.env.AVANTA_MASTER_KEY || process.env.AVANTA_MASTER_KEY_FILE || fs.existsSync(path.join(DATA_DIR, 'master-key'));
  if (!configured) throw new Error('Geen hoofdsleutel gevonden (AVANTA_MASTER_KEY, AVANTA_MASTER_KEY_FILE of DATA_DIR/master-key).');
  return loadMasterKey();
}

/**
 * De verbindings-URL van de database.
 * @returns {string} DATABASE_URL (of de inhoud van DATABASE_URL_FILE).
 * @throws {Error} Als er geen verbinding is ingesteld.
 */
function connectionString() {
  const url = process.env.DATABASE_URL || (process.env.DATABASE_URL_FILE ? fs.readFileSync(process.env.DATABASE_URL_FILE, 'utf8').trim() : '');
  if (!url) throw new Error('DATABASE_URL ontbreekt.');
  return url;
}

/**
 * Voert de opdracht uit en schrijft de uitkomst naar de terminal.
 * @param {string[]} args Argumenten na `key-rotation-cli.js`.
 * @param {{db?: object, masterKey?: Buffer, previousKeys?: Buffer[], log?: (line: string) => void}} [overrides] Voor tests.
 * @returns {Promise<number>} Uitgangscode.
 */
async function main(args, overrides = {}) {
  const [command] = args;
  const log = overrides.log || ((line) => console.log(line));
  if (command !== 'status' && command !== 'herversleutelen') {
    console.error(USAGE);
    return 2;
  }
  const masterKey = overrides.masterKey || existingMasterKey();
  const previousKeys = overrides.previousKeys || loadPreviousKeys();
  const vault = createVault(masterKey, { previousKeys });
  const db = /** @type {any} */ (overrides.db || createDatabase(connectionString()));
  try {
    const persons = /** @type {any} */ (createPersons({ vault }));
    const rotation = createKeyRotation({ db, vault, persons });
    log(`Huidige sleutel: ${vault.keyId}; vorige sleutels: ${vault.previousKeys.map(keyIdOf).join(', ') || 'geen'}.`);
    if (command === 'status') {
      const { pending } = await rotation.status();
      const open = Object.values(pending).reduce((sum, count) => sum + count, 0);
      log(`Nog met een vorige sleutel: ${pending.persons} personen, ${pending.bookings} oude aanmeldingen, ${pending.users} tweestapsgeheimen, ${pending.settings} instellingen.`);
      return open ? 3 : 0;
    }
    const counts = await rotation.run();
    log(`Opnieuw versleuteld: ${counts.persons} personen, ${counts.bookings} oude aanmeldingen, ${counts.users} tweestapsgeheimen, ${counts.settings} instellingen.`);
    if (counts.failed) {
      log(`${counts.failed} waarde(n) waren met geen enkele bekende sleutel te openen en zijn blijven staan.`);
      return 1;
    }
    log('Klaar. Bewaar de vorige sleutel zolang er back-ups van vóór de rotatie bestaan.');
    return 0;
  } finally {
    if (!overrides.db) await db.close();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => {
    console.error(`Sleutelrotatie mislukt: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
