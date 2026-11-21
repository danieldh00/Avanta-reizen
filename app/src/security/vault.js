/**
 * Versleuteling van gevoelige gegevens (AVG art. 9 en paspoortgegevens) met AES-256-GCM.
 * De hoofdsleutel komt uit AVANTA_MASTER_KEY (64 hex-tekens), een bestand (AVANTA_MASTER_KEY_FILE) of wordt bij de
 * eerste start aangemaakt in DATA_DIR/master-key. Zonder die sleutel zijn de gegevens niet meer te lezen: neem hem op
 * in de back-up, apart van de database.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR } = require('../paths');

const VERSION = 'v1';

/**
 * Leest of maakt de hoofdsleutel.
 * @param {{key?: string, keyFile?: string, dataDir?: string}} [options] Bronnen voor de sleutel (voor tests).
 * @returns {Buffer} Sleutel van 32 bytes.
 */
function loadMasterKey(options = {}) {
  const fromEnvironment = options.key ?? process.env.AVANTA_MASTER_KEY;
  const keyFile = options.keyFile ?? process.env.AVANTA_MASTER_KEY_FILE;
  let hex = fromEnvironment || (keyFile ? fs.readFileSync(keyFile, 'utf8').trim() : '');
  if (!hex) {
    const file = path.join(options.dataDir || DATA_DIR, 'master-key');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      // 'wx' maakt het bestand alleen aan als het nog niet bestaat; zo overschrijft een gelijktijdige start nooit een sleutel.
      hex = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(file, `${hex}\n`, { mode: 0o600, flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      hex = fs.readFileSync(file, 'utf8').trim();
    }
  }
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('hoofdsleutel moet 64 hex-tekens zijn');
  return Buffer.from(hex, 'hex');
}

/**
 * Maakt een kluis met een vaste sleutel.
 * @param {Buffer} key Sleutel van 32 bytes.
 * @returns {{seal: (value: *, context?: string) => string, open: (sealed: string, context?: string) => *}} Versleutelen en
 *   ontsleutelen (JSON-waarden). Met `context` (AAD, bijv. `users:totp:<id>`) hoort de versleutelde tekst bij dat ene
 *   record: naar een ander record gekopieerd, lukt het ontsleutelen niet.
 */
function createVault(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('sleutel moet 32 bytes zijn');
  return {
    /**
     * Versleutelt een JSON-waarde.
     * @param {*} value De waarde.
     * @param {string} [context] Extra gegevens die meetellen in de controle (AAD); leeg = geen.
     * @returns {string} "v1.<iv>.<tag>.<data>" in base64url.
     */
    seal(value, context = '') {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      if (context) cipher.setAAD(Buffer.from(String(context), 'utf8'));
      const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
    },
    /**
     * Ontsleutelt een waarde van seal().
     * @param {string} sealed Versleutelde tekst.
     * @param {string} [context] Dezelfde AAD als bij seal().
     * @returns {*} De oorspronkelijke waarde.
     * @throws {Error} Bij een verkeerde sleutel, een andere context of gewijzigde gegevens.
     */
    open(sealed, context = '') {
      const [version, iv, tag, data] = String(sealed).split('.');
      if (version !== VERSION || !iv || !tag || data === undefined) throw new Error('onbekend formaat');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      if (context) decipher.setAAD(Buffer.from(String(context), 'utf8'));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8'));
    },
  };
}

module.exports = { loadMasterKey, createVault };
