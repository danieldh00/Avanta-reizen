/**
 * Reizigersaccounts (CMS-pakket J2, migratie 23): accounts, sessies en eenmalige links per e-mail, los van de
 * medewerkers van het CRM (`users`, `sessions`).
 * - Account: e-mailadres (kleine letters, uniek) en een scrypt-hash (`crm/passwords.js`). Pas bruikbaar na bevestigen
 *   (`verified_at`). Een onbevestigd account met hetzelfde adres wordt bij opnieuw registreren overschreven; na zeven
 *   dagen zonder bevestiging verdwijnt het.
 * - Sessie: willekeurig token in een cookie; in de database alleen de SHA-256. Verloopt na 8 uur zonder activiteit en
 *   uiterlijk na 7 dagen.
 * - Eenmalige link (bevestigen, wachtwoord herstellen): willekeurig token, in de database alleen de SHA-256, met een
 *   vervaltijd; bij gebruik meteen verbruikt. Per account en soort hoogstens drie per uur (tegen mailbommen).
 */
const crypto = require('node:crypto');

/** Verloop van een sessie: uren zonder activiteit en maximale levensduur in dagen. */
const IDLE_HOURS = 8;
const MAX_DAYS = 7;

/** Geldigheid van een link in minuten, per soort. */
const TOKEN_MINUTES = { bevestigen: 24 * 60, herstellen: 60 };

/** Hoogstens zoveel links per account en soort per uur. */
const MAX_TOKENS_PER_HOUR = 3;

/** Onbevestigde accounts verdwijnen na zoveel dagen. */
const UNVERIFIED_DAYS = 7;

/** Hoe vaak `last_seen_at` hooguit wordt bijgewerkt (seconden). */
const TOUCH_SECONDS = 60;

/**
 * SHA-256 van een token (hex), zoals het in de database staat.
 * @param {string} token Token uit de cookie of de link.
 * @returns {string} Hash.
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Een nieuw willekeurig token (256 bits, base64url).
 * @returns {string} Token.
 */
function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Of een token de juiste vorm heeft (voorkomt databasevragen met onzin of enorme invoer).
 * @param {*} token Invoer.
 * @returns {boolean} Waar als het een token kan zijn.
 */
function tokenShapeOk(token) {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{20,100}$/.test(token);
}

/**
 * Maakt de opslag van reizigersaccounts.
 * @param {{db: object}} options De database.
 * @returns {object} Functies, zie onder.
 */
function createAccounts(options) {
  const { db } = options;

  /**
   * Zoekt een account op e-mailadres.
   * @param {string} email Genormaliseerd e-mailadres.
   * @param {{query: Function}} [client] Database of transactie-client.
   * @returns {Promise<(object|null)>} Account (id, email, password_hash, verified) of null.
   */
  const findByEmail = async (email, client = db) => {
    const [account] = await client.query(
      'SELECT id, email, password_hash, (verified_at IS NOT NULL) AS verified FROM customer_accounts WHERE email = $1',
      [email],
    );
    return account || null;
  };

  /**
   * Registreert een account, of overschrijft het wachtwoord van een nog onbevestigd account met hetzelfde adres (de
   * oude bevestigingslinks vervallen dan). Een bevestigd account blijft ongemoeid.
   * @param {string} email Genormaliseerd e-mailadres.
   * @param {string} passwordHash Hash van het gekozen wachtwoord.
   * @returns {Promise<{id: number, existing: boolean}>} Het account en of het al bevestigd bestond.
   */
  const register = (email, passwordHash) => db.transaction(async (client) => {
    const [existing] = await client.query('SELECT id, (verified_at IS NOT NULL) AS verified FROM customer_accounts WHERE email = $1 FOR UPDATE', [email]);
    if (existing && existing.verified) return { id: existing.id, existing: true };
    if (existing) {
      await client.query('UPDATE customer_accounts SET password_hash = $2, password_changed_at = now(), created_at = now() WHERE id = $1', [existing.id, passwordHash]);
      await client.query("DELETE FROM customer_tokens WHERE account_id = $1 AND purpose = 'bevestigen'", [existing.id]);
      return { id: existing.id, existing: false };
    }
    const [created] = await client.query(
      'INSERT INTO customer_accounts (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING RETURNING id',
      [email, passwordHash],
    );
    // Gelijktijdig geregistreerd: het andere verzoek won; dit verzoek doet alsof het lukte (zelfde antwoord, geen mail).
    return created ? { id: created.id, existing: false } : { id: 0, existing: true };
  });

  /**
   * Maakt een eenmalige link, behalve als er dit uur al te veel van die soort voor het account zijn.
   * @param {number} accountId Account.
   * @param {string} purpose 'bevestigen' of 'herstellen'.
   * @param {{query: Function}} [client] Database of transactie-client.
   * @returns {Promise<string>} Het token, of leeg als de limiet bereikt is.
   */
  const createToken = async (accountId, purpose, client = db) => {
    if (!Object.hasOwn(TOKEN_MINUTES, purpose)) throw new Error('onbekende soort link');
    const [recent] = await client.query(
      "SELECT count(*)::int AS total FROM customer_tokens WHERE account_id = $1 AND purpose = $2 AND created_at > now() - interval '1 hour'",
      [accountId, purpose],
    );
    if (recent.total >= MAX_TOKENS_PER_HOUR) return '';
    const token = newToken();
    await client.query(
      'INSERT INTO customer_tokens (token_hash, account_id, purpose, expires_at) VALUES ($1, $2, $3, now() + make_interval(mins => $4))',
      [hashToken(token), accountId, purpose, TOKEN_MINUTES[purpose]],
    );
    return token;
  };

  /**
   * Zoekt een geldige (niet verlopen, niet gebruikte) link met het account erbij.
   * @param {string} token Token uit de link.
   * @param {string} purpose Soort.
   * @param {{query: Function}} [client] Database of transactie-client; met `lock` vergrendeld tot het einde van de transactie.
   * @param {{lock?: boolean}} [mode] Vergrendelen (binnen een transactie, vóór het verbruiken).
   * @returns {Promise<(object|null)>} `{token_hash, account_id, email, password_hash, verified}` of null.
   */
  const findToken = async (token, purpose, client = db, mode = {}) => {
    if (!tokenShapeOk(token)) return null;
    const [row] = await client.query(
      `SELECT t.token_hash, t.account_id, a.email, a.password_hash, (a.verified_at IS NOT NULL) AS verified
         FROM customer_tokens t JOIN customer_accounts a ON a.id = t.account_id
        WHERE t.token_hash = $1 AND t.purpose = $2 AND t.used_at IS NULL AND t.expires_at > now()
        ${mode.lock ? 'FOR UPDATE OF t, a' : ''}`,
      [hashToken(token), purpose],
    );
    return row || null;
  };

  /**
   * Verbruikt alle open links van een soort voor een account (na gebruik van één ervan).
   * @param {{query: Function}} client Transactie-client.
   * @param {number} accountId Account.
   * @param {string} purpose Soort.
   * @returns {Promise<void>}
   */
  const useTokens = async (client, accountId, purpose) => {
    await client.query('UPDATE customer_tokens SET used_at = now() WHERE account_id = $1 AND purpose = $2 AND used_at IS NULL', [accountId, purpose]);
  };

  /**
   * Maakt een nieuwe sessie.
   * @param {number} accountId Account.
   * @param {{query: Function}} [client] Database of transactie-client.
   * @returns {Promise<{token: string, maxAgeSeconds: number}>} Het token voor de cookie en de levensduur.
   */
  const startSession = async (accountId, client = db) => {
    await client.query('DELETE FROM customer_sessions WHERE expires_at < now()');
    const token = newToken();
    await client.query(
      'INSERT INTO customer_sessions (token_hash, account_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))',
      [hashToken(token), accountId, MAX_DAYS],
    );
    await client.query('UPDATE customer_accounts SET last_login_at = now() WHERE id = $1', [accountId]);
    return { token, maxAgeSeconds: MAX_DAYS * 24 * 60 * 60 };
  };

  /**
   * Zoekt de sessie bij een token; een verlopen of inactieve sessie telt niet.
   * @param {string} token Token uit de cookie.
   * @returns {Promise<(object|null)>} `{accountId, email, tokenHash, stepUp}` of null.
   */
  const loadSession = async (token) => {
    if (!tokenShapeOk(token)) return null;
    const tokenHash = hashToken(token);
    const [row] = await db.query(
      `SELECT s.account_id, a.email, (s.last_seen_at < now() - make_interval(secs => $3)) AS stale,
              (s.step_up_until IS NOT NULL AND s.step_up_until > now()) AS step_up
         FROM customer_sessions s JOIN customer_accounts a ON a.id = s.account_id
        WHERE s.token_hash = $1 AND a.verified_at IS NOT NULL AND s.expires_at > now()
          AND s.last_seen_at > now() - make_interval(hours => $2)`,
      [tokenHash, IDLE_HOURS, TOUCH_SECONDS],
    );
    if (!row) return null;
    if (row.stale) await db.query('UPDATE customer_sessions SET last_seen_at = now() WHERE token_hash = $1', [tokenHash]);
    return { accountId: row.account_id, email: row.email, tokenHash, stepUp: row.step_up };
  };

  /**
   * Beëindigt één sessie.
   * @param {string} tokenHash Hash van het token.
   * @returns {Promise<void>}
   */
  const endSession = async (tokenHash) => {
    await db.query('DELETE FROM customer_sessions WHERE token_hash = $1', [tokenHash]);
  };

  /**
   * Beëindigt alle sessies van een account (na een nieuw wachtwoord).
   * @param {{query: Function}} client Database of transactie-client.
   * @param {number} accountId Account.
   * @returns {Promise<void>}
   */
  const endSessionsOf = async (client, accountId) => {
    await client.query('DELETE FROM customer_sessions WHERE account_id = $1', [accountId]);
  };

  /**
   * Ruimt verlopen sessies en links op en verwijdert accounts die na zeven dagen nog niet bevestigd zijn.
   * @returns {Promise<void>}
   */
  const purgeExpired = async () => {
    await db.query('DELETE FROM customer_sessions WHERE expires_at < now()');
    await db.query("DELETE FROM customer_tokens WHERE expires_at < now() - interval '1 day'");
    await db.query('DELETE FROM customer_accounts WHERE verified_at IS NULL AND created_at < now() - make_interval(days => $1)', [UNVERIFIED_DAYS]);
  };

  return { findByEmail, register, createToken, findToken, useTokens, startSession, loadSession, endSession, endSessionsOf, purgeExpired };
}

module.exports = { createAccounts, hashToken, tokenShapeOk, IDLE_HOURS, MAX_DAYS, TOKEN_MINUTES, MAX_TOKENS_PER_HOUR, UNVERIFIED_DAYS };
