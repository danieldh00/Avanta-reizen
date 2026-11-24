// @ts-check
/**
 * Versleuteling van gevoelige gegevens (AVG art. 9 en paspoortgegevens) met AES-256-GCM.
 * De hoofdsleutel komt uit AVANTA_MASTER_KEY (64 hex-tekens), een bestand (AVANTA_MASTER_KEY_FILE) of wordt bij de
 * eerste start aangemaakt in DATA_DIR/master-key. Zonder die sleutel zijn de gegevens niet meer te lezen: neem hem op
 * in de back-up, apart van de database.
 *
 * Sleutelrotatie (P7.5, A13): naast de huidige sleutel kan de kluis vorige sleutels hebben (AVANTA_MASTER_KEY_PREVIOUS,
 * kommagescheiden, of DATA_DIR/master-key.previous met één sleutel per regel). Nieuwe versleuteling gebeurt altijd met
 * de huidige sleutel in formaat `v2.<sleutel-id>.…`; ontsleutelen kiest de sleutel op zijn id (`v2`) of probeert ze op
 * volgorde (oud formaat `v1`, zonder id). `security/key-rotation.js` versleutelt alles opnieuw met de huidige sleutel.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR } = require('../paths');

/** Oud formaat zonder sleutel-id: `v1.<iv>.<tag>.<data>`. Wordt nog gelezen, niet meer geschreven. */
const LEGACY_VERSION = 'v1';
/** Huidig formaat met sleutel-id: `v2.<sleutel-id>.<iv>.<tag>.<data>`. */
const VERSION = 'v2';
/** Lengte van het sleutel-id in hex-tekens (geen geheim: een HMAC van een vaste tekst met de sleutel). */
const KEY_ID_LENGTH = 16;

/**
 * Controleert een sleutel in hex en zet hem om.
 * @param {string} hex Sleutel als 64 hex-tekens.
 * @returns {Buffer} Sleutel van 32 bytes.
 * @throws {Error} Als het geen 64 hex-tekens zijn.
 */
function parseKey(hex) {
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('hoofdsleutel moet 64 hex-tekens zijn');
  return Buffer.from(hex, 'hex');
}

/**
 * Leest de vorige hoofdsleutels (na een rotatie): uit AVANTA_MASTER_KEY_PREVIOUS (kommagescheiden) of uit
 * DATA_DIR/master-key.previous (één per regel, `#` = commentaar). Nieuwste eerst; dubbele weg.
 * @param {{keys?: string, dataDir?: string}} [options] Bronnen (voor tests).
 * @returns {Buffer[]} Sleutels van 32 bytes (leeg als er geen rotatie is geweest).
 * @throws {Error} Als een sleutel geen 64 hex-tekens is.
 */
function loadPreviousKeys(options = {}) {
  const fromEnvironment = options.keys ?? process.env.AVANTA_MASTER_KEY_PREVIOUS ?? '';
  let entries = String(fromEnvironment).split(',');
  if (!String(fromEnvironment).trim()) {
    const file = path.join(options.dataDir || DATA_DIR, 'master-key.previous');
    entries = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n') : [];
  }
  const keys = entries.map((entry) => entry.trim()).filter((entry) => entry && !entry.startsWith('#')).map(parseKey);
  return keys.filter((key, index) => keys.findIndex((other) => other.equals(key)) === index);
}

/**
 * Het id van een sleutel: herkenbaar in versleutelde tekst en in de uitvoer van de rotatie, zonder iets over de sleutel
 * prijs te geven.
 * @param {Buffer} key Sleutel van 32 bytes.
 * @returns {string} 16 hex-tekens.
 */
function keyIdOf(key) {
  return crypto.createHmac('sha256', key).update('avanta-kluis-sleutel-id').digest('hex').slice(0, KEY_ID_LENGTH);
}

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
  return parseKey(hex);
}

/**
 * Ontsleutelt met één sleutel.
 * @param {Buffer} key Sleutel.
 * @param {string} iv IV in base64url.
 * @param {string} tag Tag in base64url.
 * @param {string} data Versleutelde gegevens in base64url.
 * @param {string} context AAD (leeg = geen).
 * @returns {*} De oorspronkelijke JSON-waarde.
 * @throws {Error} Bij een verkeerde sleutel, context of gewijzigde gegevens.
 */
function openWith(key, iv, tag, data, context) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  if (context) decipher.setAAD(Buffer.from(String(context), 'utf8'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8'));
}

/**
 * @typedef {object} Vault
 * @property {(value: *, context?: string) => string} seal Versleutelt met de huidige sleutel.
 * @property {(sealed: string, context?: string) => *} open Ontsleutelt met de huidige of een vorige sleutel.
 * @property {(sealed: string) => boolean} isCurrent Of een versleutelde tekst al met de huidige sleutel is gemaakt.
 * @property {(purpose: string) => Buffer} deriveKey Afgeleide sleutel van de huidige hoofdsleutel.
 * @property {string} keyId Id van de huidige sleutel.
 * @property {Buffer[]} previousKeys De vorige sleutels (voor afgeleide sleutels die oude waarden moeten herkennen).
 */

/**
 * Maakt een kluis met de huidige sleutel en eventueel vorige sleutels (na een rotatie).
 * @param {Buffer} key Huidige sleutel van 32 bytes.
 * @param {{previousKeys?: Buffer[]}} [options] Vorige sleutels, nieuwste eerst; alleen om te ontsleutelen.
 * @returns {Vault} Versleutelen en ontsleutelen (JSON-waarden). Met `context` (AAD, bijv. `users:totp:<id>`) hoort de
 *   versleutelde tekst bij dat ene record: naar een ander record gekopieerd, lukt het ontsleutelen niet.
 */
function createVault(key, options = {}) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('sleutel moet 32 bytes zijn');
  const previousKeys = (options.previousKeys || []).filter((previous) => !previous.equals(key));
  for (const previous of previousKeys) {
    if (!Buffer.isBuffer(previous) || previous.length !== 32) throw new Error('vorige sleutel moet 32 bytes zijn');
  }
  const keyId = keyIdOf(key);
  /** Sleutels op id, huidige eerst. */
  const keysById = new Map([[keyId, key], ...previousKeys.map((previous) => /** @type {[string, Buffer]} */ ([keyIdOf(previous), previous]))]);
  return {
    keyId,
    previousKeys,
    /**
     * Leidt een aparte sleutel af voor één doel (HKDF-SHA256), bijv. de HMAC-sleutel van `persons.match_key`. Zo wordt
     * de hoofdsleutel zelf nooit voor twee dingen gebruikt.
     * @param {string} purpose Doel, bijv. `persons:match`.
     * @returns {Buffer} Sleutel van 32 bytes.
     */
    deriveKey(purpose) {
      if (!purpose) throw new Error('doel ontbreekt');
      return Buffer.from(crypto.hkdfSync('sha256', key, Buffer.alloc(0), `avanta:${purpose}`, 32));
    },
    /**
     * Versleutelt een JSON-waarde.
     * @param {*} value De waarde.
     * @param {string} [context] Extra gegevens die meetellen in de controle (AAD); leeg = geen.
     * @returns {string} "v2.<sleutel-id>.<iv>.<tag>.<data>" (iv, tag en data in base64url).
     */
    seal(value, context = '') {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      if (context) cipher.setAAD(Buffer.from(String(context), 'utf8'));
      const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      return [VERSION, keyId, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
    },
    /**
     * Of een versleutelde tekst al met de huidige sleutel en in het huidige formaat is gemaakt (dan hoeft de rotatie
     * hem niet opnieuw te versleutelen).
     * @param {string} sealed Versleutelde tekst.
     * @returns {boolean} Waar bij `v2` met het id van de huidige sleutel.
     */
    isCurrent(sealed) {
      const [version, id] = String(sealed).split('.');
      return version === VERSION && id === keyId;
    },
    /**
     * Ontsleutelt een waarde van seal().
     * @param {string} sealed Versleutelde tekst.
     * @param {string} [context] Dezelfde AAD als bij seal().
     * @returns {*} De oorspronkelijke waarde.
     * @throws {Error} Bij een verkeerde sleutel, een andere context of gewijzigde gegevens.
     */
    open(sealed, context = '') {
      const parts = String(sealed).split('.');
      if (parts[0] === VERSION) {
        const [, id, iv, tag, data] = parts;
        if (parts.length !== 5 || !iv || !tag) throw new Error('onbekend formaat');
        const match = keysById.get(id);
        if (!match) throw new Error('onbekende sleutel');
        return openWith(match, iv, tag, data, context);
      }
      const [version, iv, tag, data] = parts;
      if (version !== LEGACY_VERSION || parts.length !== 4 || !iv || !tag) throw new Error('onbekend formaat');
      // Oud formaat zonder id: de huidige sleutel eerst, dan de vorige. GCM weigert een verkeerde sleutel betrouwbaar.
      let lastError;
      for (const candidate of keysById.values()) {
        try {
          return openWith(candidate, iv, tag, data, context);
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError;
    },
  };
}

module.exports = { loadMasterKey, loadPreviousKeys, createVault, keyIdOf, parseKey };
