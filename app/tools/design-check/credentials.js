// @ts-check
/**
 * Inloggegevens voor de design-controle: fictieve accounts voor een lokale test- of ontwerpdatabase. Er staat geen
 * wachtwoord in de repository: het komt uit `DESIGN_WACHTWOORD`, of anders uit het bestand `wachtwoord` in een eigen map
 * van de gebruiker (`~/.cache/avanta-design-check/`, alleen toegankelijk voor de eigen gebruiker). Alleen `seed.js` maakt
 * dat bestand aan (met een willekeurig wachtwoord); `check.js` en `overview.js` lezen het en stoppen met een duidelijke
 * melding als het ontbreekt. Er wordt niets aangemaakt bij het laden van dit bestand.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** Eigen map voor het lokale wachtwoord (niet de gedeelde tijdelijke map). */
const PASSWORD_DIR = path.join(os.homedir(), '.cache', 'avanta-design-check');
/** Bestand met het lokale wachtwoord. */
const PASSWORD_FILE = path.join(PASSWORD_DIR, 'wachtwoord');
/** Minimale lengte, gelijk aan de eis van het CRM. */
const MIN_LENGTH = 12;

/**
 * Controleert dat een pad een echt bestand of echte map van de eigen gebruiker is, zonder rechten voor groep of overig.
 * Een symlink of een pad van een andere gebruiker wordt geweigerd.
 * @param {string} target Pad.
 * @param {('bestand'|'map')} kind Verwachte soort.
 * @returns {boolean} `false` als het pad niet bestaat; gooit een fout als het niet veilig is.
 */
function assertOwnPath(target, kind) {
  let stats;
  try {
    stats = fs.lstatSync(target);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  const rightKind = kind === 'map' ? stats.isDirectory() : stats.isFile();
  const ownUser = typeof process.getuid !== 'function' || stats.uid === process.getuid();
  if (!rightKind || !ownUser || (stats.mode & 0o077) !== 0) {
    throw new Error(`${target} is geen ${kind} van de eigen gebruiker met alleen eigen rechten; verwijder het en draai seed.js opnieuw.`);
  }
  return true;
}

/**
 * Het wachtwoord van de testaccounts: uit `DESIGN_WACHTWOORD` of uit het lokale bestand. Met `create` (alleen
 * `seed.js`) wordt een ontbrekend bestand exclusief aangemaakt (`wx`: weigert een bestaand pad of een symlink).
 * @param {{create?: boolean}} [options] Opties.
 * @returns {string} Wachtwoord van minimaal 12 tekens.
 */
function designPassword({ create = false } = {}) {
  const fromEnv = process.env.DESIGN_WACHTWOORD;
  if (fromEnv) {
    if (fromEnv.length < MIN_LENGTH) throw new Error(`DESIGN_WACHTWOORD moet minimaal ${MIN_LENGTH} tekens hebben (eis van het CRM).`);
    return fromEnv;
  }
  if (assertOwnPath(PASSWORD_FILE, 'bestand')) {
    const stored = fs.readFileSync(PASSWORD_FILE, 'utf8').trim();
    if (stored.length < MIN_LENGTH) throw new Error(`${PASSWORD_FILE} bevat geen geldig wachtwoord; verwijder het en draai seed.js opnieuw.`);
    return stored;
  }
  if (!create) throw new Error(`Geen wachtwoord voor de testaccounts (${PASSWORD_FILE} ontbreekt): draai eerst seed.js, of zet DESIGN_WACHTWOORD.`);
  fs.mkdirSync(PASSWORD_DIR, { recursive: true, mode: 0o700 });
  assertOwnPath(PASSWORD_DIR, 'map');
  const fresh = crypto.randomBytes(18).toString('base64url');
  const handle = fs.openSync(PASSWORD_FILE, 'wx', 0o600);
  try {
    fs.writeSync(handle, fresh);
  } finally {
    fs.closeSync(handle);
  }
  return fresh;
}

/**
 * De testaccounts met hun wachtwoord.
 * @param {{create?: boolean}} [options] Opties voor `designPassword`.
 * @returns {{ADMIN: any, CUSTOMER: any}} Eerste beheerder (installatiescherm) en reizigersaccount.
 */
function accounts(options) {
  const password = designPassword(options);
  return {
    ADMIN: { name: 'Design Beheerder', email: 'beheer@example.nl', password },
    CUSTOMER: { email: TRAVELLER_EMAIL, password },
  };
}

/** E-mailadres van het reizigersaccount, gelijk aan dat van de eerste aanmelding. */
const TRAVELLER_EMAIL = 'anna@example.nl';

module.exports = {
  accounts,
  designPassword,
  TRAVELLER_EMAIL,
  /** Extra CRM-gebruikers per rol, om de lijst Gebruikers en het menu per rol te vullen. */
  ROLE_USERS: [
    { email: 'kantoor@example.nl', name: 'Karin Kantoor', role: 'kantoor' },
    { email: 'redacteur@example.nl', name: 'Ruben Redacteur', role: 'redacteur' },
    { email: 'boekhouding@example.nl', name: 'Bert Boekhouding', role: 'boekhouding' },
  ],
  PASSWORD_FILE,
};
