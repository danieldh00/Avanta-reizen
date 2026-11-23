/**
 * Inloggegevens voor de design-controle: fictieve accounts voor een lokale test- of ontwerpdatabase. Er staat geen
 * wachtwoord in de repository: het komt uit `DESIGN_WACHTWOORD`, of anders uit een bestand in de tijdelijke map
 * (`avanta-design-check-wachtwoord`, alleen leesbaar voor de eigen gebruiker) dat bij het eerste gebruik met een
 * willekeurig wachtwoord wordt aangemaakt. Zo gebruiken `seed.js` en `check.js` op dezelfde machine hetzelfde wachtwoord.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** Bestand met het lokale wachtwoord. */
const PASSWORD_FILE = path.join(os.tmpdir(), 'avanta-design-check-wachtwoord');

/**
 * Het wachtwoord van de testaccounts: uit de omgeving, uit het lokale bestand, of nieuw aangemaakt.
 * @returns {string} Wachtwoord (minimaal 12 tekens, zoals het CRM eist).
 */
function designPassword() {
  if (process.env.DESIGN_WACHTWOORD) return process.env.DESIGN_WACHTWOORD;
  try {
    const stored = fs.readFileSync(PASSWORD_FILE, 'utf8').trim();
    if (stored.length >= 12) return stored;
  } catch {
    // Nog geen bestand: hieronder aanmaken.
  }
  const fresh = crypto.randomBytes(18).toString('base64url');
  fs.writeFileSync(PASSWORD_FILE, fresh, { mode: 0o600 });
  return fresh;
}

const PASSWORD = designPassword();

module.exports = {
  /** Eerste beheerder (installatiescherm). */
  ADMIN: { name: 'Design Beheerder', email: 'beheer@example.nl', password: PASSWORD },
  /** Reizigersaccount, met hetzelfde e-mailadres als de eerste aanmelding. */
  CUSTOMER: { email: 'anna@example.nl', password: PASSWORD },
  /** Extra CRM-gebruikers per rol, om de lijst Gebruikers en het menu per rol te vullen. */
  ROLE_USERS: [
    { email: 'kantoor@example.nl', name: 'Karin Kantoor', role: 'kantoor' },
    { email: 'redacteur@example.nl', name: 'Ruben Redacteur', role: 'redacteur' },
    { email: 'boekhouding@example.nl', name: 'Bert Boekhouding', role: 'boekhouding' },
  ],
  PASSWORD_FILE,
};
