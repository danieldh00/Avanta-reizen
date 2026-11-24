// @ts-check
/**
 * Opdrachtregel voor de testdata (wachtlijstpunt W00), in de app-container (zelfde omgeving als de app):
 *   node src/dev/seed/cli.js vullen --testomgeving        testdata toevoegen (weigert als die er al staat)
 *   node src/dev/seed/cli.js opnieuw --testomgeving       bestaande testdata verwijderen en opnieuw vullen
 *   node src/dev/seed/cli.js verwijderen --testomgeving   alleen de testdata verwijderen
 *
 * Draait alleen als `--testomgeving` is meegegeven, het basisadres van de site niet het productiedomein is en
 * zoekmachines de site niet mogen indexeren (`dev/seed/seed.js`, `seedBlockReason`). Daniël draait hem via het vaste
 * commando met `servertaken.sh testdata` (zie `deploy/apps01/servertaken.sh`).
 *
 * De testgebruikers (één per rol, `<rol>@example.com`) krijgen één nieuw, willekeurig wachtwoord dat alleen hier
 * getoond wordt; in de database staat alleen de scrypt-hash. De uitvoer bevat verder alleen aantallen.
 * Uitgangscode 0 = gelukt, 1 = fout, 2 = verkeerd gebruik of geweigerd.
 */
const fs = require('node:fs');
const path = require('node:path');
const { createDatabase } = require('../../database/db');
const { loadMasterKey, createVault } = require('../../security/vault');
const { createSettings } = require('../../beheer/settings');
const { hashPassword } = require('../../crm/passwords');
const { temporaryPassword, connectionString } = require('../../crm/cli');
const { DATA_DIR } = require('../../paths');
const { runSeed } = require('./seed');

/** De opdrachten. */
const MODES = ['vullen', 'opnieuw', 'verwijderen'];

/** Uitleg bij verkeerd gebruik. */
const USAGE = 'Gebruik: node src/dev/seed/cli.js <vullen|opnieuw|verwijderen> --testomgeving';

/**
 * Of er al een hoofdsleutel is. De testdata maakt nooit zelf een nieuwe sleutel aan: met een andere sleutel dan de app
 * zouden de versleutelde gegevens van de testpersonen onleesbaar zijn.
 * @returns {boolean} Waar als AVANTA_MASTER_KEY(_FILE) is gezet of `DATA_DIR/master-key` bestaat.
 */
function masterKeyAvailable() {
  return Boolean(process.env.AVANTA_MASTER_KEY || process.env.AVANTA_MASTER_KEY_FILE || fs.existsSync(path.join(DATA_DIR, 'master-key')));
}

/**
 * Zet de aantallen om naar regels voor de terminal.
 * @param {string} title Kop.
 * @param {Record<string, number>} counts Aantal per soort.
 * @returns {string[]} Regels.
 */
function countLines(title, counts) {
  const entries = Object.entries(counts).filter(([, count]) => count > 0);
  if (!entries.length) return [];
  return [title, ...entries.map(([label, count]) => `  ${label}: ${count}`)];
}

/**
 * Voert de opdracht uit en schrijft de uitkomst naar de terminal.
 * @param {string[]} args Argumenten na `cli.js`.
 * @returns {Promise<number>} Uitgangscode.
 */
async function main(args) {
  // Strikt: precies één opdracht en verder alleen `--testomgeving`, zodat de volgorde nooit bepaalt wat er gebeurt.
  const modes = args.filter((argument) => MODES.includes(argument));
  const unknown = args.filter((argument) => !MODES.includes(argument) && argument !== '--testomgeving');
  const [mode] = /** @type {('vullen'|'opnieuw'|'verwijderen')[]} */ (modes);
  if (modes.length !== 1 || unknown.length) {
    console.error(USAGE);
    return 2;
  }
  if (!masterKeyAvailable()) {
    console.error('Er is geen hoofdsleutel (AVANTA_MASTER_KEY of DATA_DIR/master-key); start de app eerst één keer.');
    return 2;
  }
  const db = createDatabase(connectionString());
  try {
    await db.migrate();
    const vault = createVault(loadMasterKey());
    const settings = createSettings({ db, vault, env: process.env });
    await settings.load();
    const password = mode === 'verwijderen' ? '' : temporaryPassword();
    const result = await runSeed({
      db,
      vault,
      settings,
      mode,
      confirmed: args.includes('--testomgeving'),
      passwordHash: password ? await hashPassword(password) : '',
    });
    if (result.ok === false) {
      console.error(`Geweigerd: ${result.reason}`);
      return 2;
    }
    for (const line of [...countLines('Verwijderd:', result.removed), ...countLines('Toegevoegd:', result.added)]) console.log(line);
    if (mode === 'verwijderen') {
      console.log('De testdata is verwijderd.');
      return 0;
    }
    console.log('');
    console.log('Testgebruikers (inloggen op /app/inloggen/): beheerder, kantoor, reisleider, boekhouding en redacteur, elk');
    console.log('als <rol>@example.com. Ze delen dit wachtwoord, dat nergens anders staat (bij "opnieuw" komt er een nieuw):');
    console.log(`  ${password}`);
    return 0;
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => {
    console.error(`Fout: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main, masterKeyAvailable, countLines, MODES };
