/**
 * Wachtwoorden voor het CRM: hashen met scrypt (Node `crypto`, geen extra pakket), controleren in constante tijd en
 * herkennen of een hash met verouderde instellingen opnieuw moet. Formaat: `scrypt$<N>$<r>$<p>$<zout>$<hash>` (base64url).
 */
const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);

/** Huidige instellingen voor scrypt (N = 2^15, ongeveer 32 MB geheugen per hash). */
const PARAMETERS = { N: 32768, r: 8, p: 1 };

/** Lengte van de afgeleide sleutel in bytes. */
const KEY_LENGTH = 64;

/** Minimale en maximale lengte van een wachtwoord (de bovengrens voorkomt dure hashes van enorme invoer). */
const MIN_LENGTH = 12;
const MAX_LENGTH = 200;

/**
 * Berekent scrypt met de gegeven instellingen.
 * @param {string} password Wachtwoord.
 * @param {Buffer} salt Zout.
 * @param {{N: number, r: number, p: number}} parameters Instellingen.
 * @returns {Promise<Buffer>} Afgeleide sleutel.
 */
function derive(password, salt, parameters) {
  return scrypt(String(password).normalize('NFKC'), salt, KEY_LENGTH, { ...parameters, maxmem: 256 * parameters.N * parameters.r });
}

/**
 * Hasht een wachtwoord met een willekeurig zout.
 * @param {string} password Wachtwoord.
 * @returns {Promise<string>} Hash in het formaat `scrypt$N$r$p$zout$hash`.
 */
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await derive(password, salt, PARAMETERS);
  return ['scrypt', PARAMETERS.N, PARAMETERS.r, PARAMETERS.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

/**
 * Leest een opgeslagen hash.
 * @param {string} stored Opgeslagen hash.
 * @returns {({parameters: {N: number, r: number, p: number}, salt: Buffer, key: Buffer}|null)} Onderdelen, of null als het formaat niet klopt.
 */
function parseHash(stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  // Volgorde in de hash: kosten (N), blokgrootte (r), parallellisatie (p); de sleutels heten zoals scrypt ze verwacht.
  const [cost, blockSize, parallelization] = parts.slice(1, 4).map(Number);
  if (![cost, blockSize, parallelization].every(Number.isSafeInteger)) return null;
  if (cost < 2 || cost > 2 ** 20 || blockSize < 1 || blockSize > 32 || parallelization < 1 || parallelization > 16) return null;
  return { parameters: { N: cost, r: blockSize, p: parallelization }, salt: Buffer.from(parts[4], 'base64url'), key: Buffer.from(parts[5], 'base64url') };
}

/**
 * Controleert een wachtwoord tegen een opgeslagen hash (in constante tijd).
 * @param {string} password Ingevoerd wachtwoord.
 * @param {string} stored Opgeslagen hash.
 * @returns {Promise<boolean>} Waar als het wachtwoord klopt.
 */
async function verifyPassword(password, stored) {
  const parsed = parseHash(stored);
  if (!parsed || parsed.key.length !== KEY_LENGTH || String(password).length > MAX_LENGTH) return false;
  const key = await derive(password, parsed.salt, parsed.parameters);
  return crypto.timingSafeEqual(key, parsed.key);
}

/**
 * Of een hash met andere dan de huidige instellingen is gemaakt (dan wordt hij bij het inloggen vernieuwd).
 * @param {string} stored Opgeslagen hash.
 * @returns {boolean} Waar als de hash vernieuwd moet worden.
 */
function needsRehash(stored) {
  const parsed = parseHash(stored);
  return !parsed || parsed.parameters.N !== PARAMETERS.N || parsed.parameters.r !== PARAMETERS.r || parsed.parameters.p !== PARAMETERS.p;
}

/**
 * Controleert een nieuw wachtwoord op de regels.
 * @param {string} password Nieuw wachtwoord.
 * @param {{email?: string}} [context] Gegevens van de gebruiker; het wachtwoord mag niet het e-mailadres zijn.
 * @returns {string} Lege tekst als het goed is, anders de melding.
 */
function passwordProblem(password, context = {}) {
  const text = typeof password === 'string' ? password : '';
  if (text.length < MIN_LENGTH) return `Kies een wachtwoord van minimaal ${MIN_LENGTH} tekens.`;
  if (text.length > MAX_LENGTH) return `Een wachtwoord mag maximaal ${MAX_LENGTH} tekens zijn.`;
  if (context.email && text.trim().toLowerCase() === String(context.email).trim().toLowerCase()) return 'Het wachtwoord mag niet je e-mailadres zijn.';
  if (new Set(text).size < 4) return 'Kies een wachtwoord met meer verschillende tekens.';
  return '';
}

/** Hash van een willekeurig wachtwoord (lui berekend), zie `getDummyHash`. */
let dummyHash = null;

/**
 * Een vaste hash om tegen te controleren als een e-mailadres onbekend is, zodat de responstijd niet verraadt of een
 * account bestaat. Wordt één keer per proces berekend.
 * @returns {Promise<string>} Hash van een willekeurig wachtwoord.
 */
function getDummyHash() {
  if (!dummyHash) dummyHash = hashPassword(crypto.randomBytes(18).toString('base64url'));
  return dummyHash;
}

module.exports = { hashPassword, verifyPassword, needsRehash, passwordProblem, getDummyHash, MIN_LENGTH, MAX_LENGTH, PARAMETERS };
