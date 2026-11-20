/**
 * Opdrachtregel voor de back-ups (in de app-container, zelfde omgeving als de app):
 *   node src/backup/cli.js create [--update]        back-up maken (update.sh doet dit vóór elke update, met --update)
 *   node src/backup/cli.js list                     back-ups tonen
 *   node src/backup/cli.js decrypt <back-up> <doel>  ontsleutelen naar een pg_dump-bestand (voor pg_restore)
 * De hoofdsleutel komt net als in de app uit AVANTA_MASTER_KEY, AVANTA_MASTER_KEY_FILE of DATA_DIR/master-key; deze
 * opdrachten maken nooit een nieuwe sleutel aan (dan zou een back-up met de echte sleutel onleesbaar zijn).
 */
const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR } = require('../paths');
const { loadMasterKey, createVault } = require('../security/vault');
const backups = require('./backups');

/** Map met de back-ups. */
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

/**
 * Leest de hoofdsleutel, zonder er een aan te maken.
 * @returns {Buffer} De sleutel.
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
 * Maakt een back-up met de instellingen uit de database (bewaartermijn) en legt de uitkomst vast.
 * @param {boolean} beforeUpdate Of dit de back-up vóór een update is.
 * @returns {Promise<void>}
 */
async function create(beforeUpdate) {
  const { createDatabase } = require('../database/db');
  const { createSettings } = require('../beheer/settings');
  const masterKey = existingMasterKey();
  const url = connectionString();
  const db = createDatabase(url);
  try {
    const settings = createSettings({ db, vault: createVault(masterKey) });
    await settings.ready();
    const service = backups.createBackupService({ db, settings, dir: BACKUP_DIR, masterKey, connectionString: url });
    const backup = await service.run({ trigger: beforeUpdate ? 'update' : 'handmatig' });
    await db.query("INSERT INTO audit_log (user_id, action, entity, entity_id) VALUES (NULL, 'backup.gemaakt', 'backup', $1)", [backup.name]);
    console.log(`Back-up gemaakt: ${backup.name} (${backup.size} bytes)`);
  } finally {
    await db.close();
  }
}

/**
 * Ontsleutelt een back-up naar een dumpbestand; eerst naar `<doel>.part`, pas na de controle van de tag hernoemd.
 * @param {string} source Pad of naam (in de back-upmap) van de back-up.
 * @param {string} target Pad van het nieuwe dumpbestand.
 * @returns {Promise<void>}
 */
async function decrypt(source, target) {
  const file = fs.existsSync(source) ? source : path.join(BACKUP_DIR, path.basename(source));
  if (fs.existsSync(target)) throw new Error(`${target} bestaat al; kies een ander doel.`);
  const partFile = `${target}.part`;
  try {
    await backups.decryptTo(file, existingMasterKey(), fs.createWriteStream(partFile, { mode: 0o600 }));
    fs.renameSync(partFile, target);
  } finally {
    fs.rmSync(partFile, { force: true });
  }
  console.log(`Ontsleuteld naar ${target} (terugzetten met pg_restore, zie docs/DRAAIBOEK-VPS-VERHUIZING.md).`);
}

/**
 * Voert de opdracht uit.
 * @param {string[]} args Argumenten na `cli.js`.
 * @returns {Promise<void>}
 */
async function main(args) {
  const [command, first, second] = args;
  if (command === 'create') return create(first === '--update');
  if (command === 'list') {
    for (const backup of backups.listBackups(BACKUP_DIR)) console.log(`${backup.name}\t${backup.size}\t${backup.createdAt}`);
    return undefined;
  }
  if (command === 'decrypt' && first && second) return decrypt(first, second);
  console.error('Gebruik: node src/backup/cli.js create [--update] | list | decrypt <back-up> <doel.dump>');
  process.exitCode = 2;
  return undefined;
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Mislukt: ${String(error.message).replace(/[\r\n]/g, ' ')}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
