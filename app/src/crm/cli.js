/**
 * Opdrachtregel voor het CRM (in de app-container, zelfde omgeving als de app), bevinding F07:
 *   node src/crm/cli.js beheerder-herstel <e-mailadres>
 *
 * Geeft een beheerder die er niet meer in komt (wachtwoord vergeten, telefoon met de authenticator kwijt) weer toegang,
 * ook als er geen tweede beheerder is die dat in het CRM kan doen. In één transactie:
 * - een nieuw, willekeurig tijdelijk wachtwoord (alleen hier getoond, in de database alleen de scrypt-hash);
 * - alle sessies van die beheerder beëindigd;
 * - de tweestapsverificatie uitgezet en een nieuwe activatiecode (7 dagen geldig) om haar opnieuw in te stellen;
 * - een regel in het auditlog (`gebruiker.hersteld-server`, zonder IP-adres: de opdracht komt van de server zelf).
 *
 * Alleen voor een actieve gebruiker met de rol beheerder; andere gebruikers herstelt een beheerder in het CRM.
 * Wie de opdracht kan draaien, heeft al rootrechten op de server: dat is de controle. Daniël draait hem via het vaste
 * commando met `servertaken.sh beheerder-herstel` (zie `docs/DRAAIBOEK-VPS-VERHUIZING.md`, *Weer toegang als beheerder*).
 * Uitgangscode 0 = gelukt, 1 = fout, 2 = verkeerd gebruik of geen actieve beheerder met dit adres.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const { createDatabase } = require('../database/db');
const { hashPassword } = require('./passwords');
const { createTwoFactor } = require('./two-factor');

/** Uitleg bij verkeerd gebruik. */
const USAGE = 'Gebruik: node src/crm/cli.js beheerder-herstel <e-mailadres>';

/**
 * Maakt een tijdelijk wachtwoord: 24 tekens uit een alfabet zonder verwarrende tekens, in groepjes van 4.
 * @returns {string} Bijvoorbeeld `k7Qm-3xTz-...` (ruim 140 bits).
 */
function temporaryPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const characters = Array.from({ length: 24 }, () => alphabet[crypto.randomInt(alphabet.length)]);
  return characters.join('').match(/.{4}/g).join('-');
}

/**
 * Verbergt het grootste deel van een e-mailadres (voor de lijst met beheerders bij een onbekend adres).
 * @param {string} email E-mailadres.
 * @returns {string} Bijvoorbeeld `d***@example.nl`.
 */
function maskEmail(email) {
  const [name, domain] = String(email).split('@');
  return `${name.slice(0, 1)}***@${domain || ''}`;
}

/**
 * Herstelt de toegang van een beheerder.
 * @param {{query: Function, transaction: Function}} db Database.
 * @param {string} emailInput Het e-mailadres van de beheerder (hoofdletters en spaties maken niet uit).
 * @returns {Promise<({ok: true, userId: number, password: string, activation: string}|{ok: false, admins: string[]})>}
 *   De nieuwe gegevens, of de gemaskeerde adressen van de actieve beheerders als er geen beheerder met dit adres is.
 */
async function recoverAdmin(db, emailInput) {
  const email = String(emailInput || '').trim().toLowerCase();
  const [user] = await db.query("SELECT id FROM users WHERE email = $1 AND role = 'beheerder' AND active", [email]);
  if (!user) {
    const admins = await db.query("SELECT email FROM users WHERE role = 'beheerder' AND active ORDER BY id");
    return { ok: false, admins: admins.map((row) => maskEmail(row.email)) };
  }
  const password = temporaryPassword();
  const passwordHash = await hashPassword(password);
  // Uitzetten en een activatiecode maken heeft de sleutelkluis niet nodig (die is alleen voor het geheim zelf).
  const twoFactor = createTwoFactor({ db, vault: null });
  const activation = await db.transaction(async (client) => {
    await client.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [user.id, passwordHash]);
    await client.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
    await twoFactor.disable(user.id, client);
    const code = await twoFactor.issueActivation(user.id, client);
    await client.query(
      "INSERT INTO audit_log (user_id, action, entity, entity_id, ip_prefix) VALUES (NULL, 'gebruiker.hersteld-server', 'users', $1, NULL)",
      [String(user.id)],
    );
    return code;
  });
  return { ok: true, userId: user.id, password, activation };
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
 * @param {string[]} args Argumenten na `cli.js`.
 * @returns {Promise<number>} Uitgangscode.
 */
async function main(args) {
  const [command, email] = args;
  if (command !== 'beheerder-herstel' || !email) {
    console.error(USAGE);
    return 2;
  }
  const db = createDatabase(connectionString());
  try {
    const result = await recoverAdmin(db, email);
    if (!result.ok) {
      console.error('Er is geen actieve beheerder met dit e-mailadres.');
      console.error(result.admins.length ? `Actieve beheerders: ${result.admins.join(', ')}` : 'Er is geen enkele actieve beheerder; maak er een aan via /app/installatie/ als de tabel leeg is.');
      return 2;
    }
    console.log('Toegang hersteld. Alle sessies van deze beheerder zijn beëindigd en de tweestapsverificatie staat uit.');
    console.log(`Tijdelijk wachtwoord: ${result.password}`);
    console.log(`Activatiecode tweestapsverificatie (7 dagen geldig): ${result.activation}`);
    console.log('Log in op /app/inloggen/, kies meteen een eigen wachtwoord onder Wachtwoord en stel de tweestapsverificatie');
    console.log('opnieuw in met de activatiecode. Deze gegevens staan nergens anders; sluit dit venster daarna.');
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

module.exports = { recoverAdmin, temporaryPassword, maskEmail, connectionString, main };
