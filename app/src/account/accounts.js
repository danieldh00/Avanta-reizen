// @ts-check
/**
 * Reizigersaccounts (CMS-pakket J2, migratie 23): accounts, sessies en eenmalige links per e-mail, los van de
 * medewerkers van het CRM (`users`, `sessions`).
 * - Account: e-mailadres (kleine letters, uniek) en een scrypt-hash (`crm/passwords.js`). Pas bruikbaar na bevestigen
 *   (`verified_at`). Opnieuw registreren van een onbevestigd adres verandert niets aan het account (geen nieuw
 *   wachtwoord, geen nieuwe termijn): er komt alleen een nieuwe bevestigingslink. Wie het wachtwoord van de eerste
 *   registratie niet kent, gebruikt *wachtwoord vergeten*. Na zeven dagen zonder bevestiging verdwijnt het account.
 * - Sessie: willekeurig token in een cookie; in de database alleen de SHA-256. Verloopt na 8 uur zonder activiteit en
 *   uiterlijk na 7 dagen.
 * - Eenmalige link (bevestigen, wachtwoord herstellen): willekeurig token, in de database alleen de SHA-256, met een
 *   vervaltijd; bij gebruik meteen verbruikt. Per account en soort hoogstens drie per uur (tegen mailbommen), geteld
 *   onder een slot op het account. Mails zonder link (*je hebt al een account*) tellen apart (soort `melding`), zodat
 *   een ander het quotum voor herstellinks van de eigenaar nooit kan opmaken.
 * - Code per e-mail (J3): zes cijfers, tien minuten geldig, hoogstens vijf pogingen per code. Een goede code geeft de
 *   sessie een kwartier lang toegang tot gevoelige acties (export, wachtwoord wijzigen): een gelekt wachtwoord alleen is
 *   daarvoor nooit genoeg.
 */
const crypto = require('node:crypto');

/** Verloop van een sessie: uren zonder activiteit en maximale levensduur in dagen. */
const IDLE_HOURS = 8;
const MAX_DAYS = 7;

/** Geldigheid van een link in minuten, per soort. */
const TOKEN_MINUTES = { bevestigen: 24 * 60, herstellen: 60, melding: 60, code: 10 };

/** Hoogstens zoveel pogingen per code. */
const MAX_CODE_ATTEMPTS = 5;

/** Zo lang geeft een goede code toegang tot gevoelige acties (minuten). */
const STEP_UP_MINUTES = 15;

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
 * @param {{db: any}} options De database.
 * @returns {any} Functies, zie onder.
 */
function createAccounts(options) {
  const { db } = options;

  /**
   * Zoekt een account op e-mailadres.
   * @param {string} email Genormaliseerd e-mailadres.
   * @param {{query: Function}} [client] Database of transactie-client.
   * @returns {Promise<(any|null)>} Account (id, email, password_hash, verified) of null.
   */
  const findByEmail = async (email, client = db) => {
    const [account] = await client.query(
      'SELECT id, email, password_hash, (verified_at IS NOT NULL) AS verified FROM customer_accounts WHERE email = $1',
      [email],
    );
    return account || null;
  };

  /**
   * Registreert een account. Bestaat het adres al (bevestigd of niet), dan blijft het account ongemoeid: geen nieuw
   * wachtwoord en geen nieuwe opruimtermijn.
   * @param {string} email Genormaliseerd e-mailadres.
   * @param {string} passwordHash Hash van het gekozen wachtwoord.
   * @returns {Promise<{id: number, state: ('nieuw'|'onbevestigd'|'bevestigd')}>} Het account en wat er al was.
   */
  const register = async (email, passwordHash) => {
    const [created] = await db.query(
      'INSERT INTO customer_accounts (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING RETURNING id',
      [email, passwordHash],
    );
    if (created) return { id: created.id, state: 'nieuw' };
    const existing = await findByEmail(email);
    // Net tussendoor verwijderd (opruimen): doe alsof het lukte, zonder mail.
    if (!existing) return { id: 0, state: 'bevestigd' };
    return { id: existing.id, state: existing.verified ? 'bevestigd' : 'onbevestigd' };
  };

  /**
   * Of er dit uur al te veel links of codes van een soort voor een account zijn gemaakt.
   * @param {number} accountId Account.
   * @param {string} purpose Soort.
   * @param {{query: Function}} client Database of transactie-client.
   * @returns {Promise<boolean>} Waar als de limiet bereikt is.
   */
  const overLimit = async (accountId, purpose, client) => {
    const [recent] = await client.query(
      "SELECT count(*)::int AS total FROM customer_tokens WHERE account_id = $1 AND purpose = $2 AND created_at > now() - interval '1 hour'",
      [accountId, purpose],
    );
    return recent.total >= MAX_TOKENS_PER_HOUR;
  };

  /**
   * Hash van een code, met een willekeurig voorvoegsel (de kolom is uniek en een code van zes cijfers is te raden).
   * @param {string} nonce Voorvoegsel.
   * @param {number} accountId Account.
   * @param {string} code Code.
   * @returns {string} `nonce.hash`.
   */
  const codeHash = (nonce, accountId, code) => `${nonce}.${crypto.createHash('sha256').update(`${nonce}:${accountId}:${code}`).digest('hex')}`;

  /**
   * Maakt een nieuwe code van zes cijfers; eerdere open codes vervallen. Hoogstens drie per uur.
   * @param {number} accountId Account.
   * @returns {Promise<string>} De code, of leeg als de limiet bereikt is.
   */
  const createCode = (accountId) => db.transaction(async (client) => {
    await client.query('SELECT id FROM customer_accounts WHERE id = $1 FOR UPDATE', [accountId]);
    if (await overLimit(accountId, 'code', client)) return '';
    await useTokens(client, accountId, 'code');
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const nonce = crypto.randomBytes(12).toString('hex');
    await client.query(
      "INSERT INTO customer_tokens (token_hash, account_id, purpose, expires_at) VALUES ($1, $2, 'code', now() + make_interval(mins => $3))",
      [codeHash(nonce, accountId, code), accountId, TOKEN_MINUTES.code],
    );
    return code;
  });

  /**
   * Controleert een code en geeft de sessie bij een goede code een kwartier toegang tot gevoelige acties. Elke
   * verkeerde poging telt; na vijf is de code op.
   * @param {number} accountId Account.
   * @param {string} tokenHash Hash van het sessietoken.
   * @param {*} code Ingevoerde code.
   * @returns {Promise<('ok'|'fout'|'op')>} Goed, fout, of geen geldige code (verlopen, op of nooit aangevraagd).
   */
  const checkCode = (accountId, tokenHash, code) => db.transaction(async (client) => {
    const given = String(code ?? '').replace(/\s/g, '');
    const [row] = await client.query(
      `SELECT token_hash, attempts FROM customer_tokens
        WHERE account_id = $1 AND purpose = 'code' AND used_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [accountId],
    );
    if (!row || row.attempts >= MAX_CODE_ATTEMPTS) return 'op';
    const nonce = row.token_hash.split('.')[0];
    const expected = Buffer.from(row.token_hash);
    const actual = Buffer.from(codeHash(nonce, accountId, /^\d{6}$/.test(given) ? given : 'x'));
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      await client.query('UPDATE customer_tokens SET attempts = attempts + 1 WHERE token_hash = $1', [row.token_hash]);
      return row.attempts + 1 >= MAX_CODE_ATTEMPTS ? 'op' : 'fout';
    }
    await client.query('UPDATE customer_tokens SET used_at = now() WHERE token_hash = $1', [row.token_hash]);
    await client.query(
      'UPDATE customer_sessions SET step_up_until = now() + make_interval(mins => $3) WHERE token_hash = $1 AND account_id = $2',
      [tokenHash, accountId, STEP_UP_MINUTES],
    );
    return 'ok';
  });

  /**
   * Stelt een nieuw wachtwoord in (na de code per e-mail) en beëindigt alle andere sessies van het account.
   * @param {number} accountId Account.
   * @param {string} passwordHash Nieuwe hash.
   * @param {string} keepTokenHash Hash van de sessie die blijft.
   * @param {{query: Function}} client Transactie-client.
   * @returns {Promise<void>}
   */
  const changePassword = async (accountId, passwordHash, keepTokenHash, client) => {
    await client.query('UPDATE customer_accounts SET password_hash = $2, password_changed_at = now() WHERE id = $1', [accountId, passwordHash]);
    await client.query('DELETE FROM customer_sessions WHERE account_id = $1 AND token_hash <> $2', [accountId, keepTokenHash]);
    await useTokens(client, accountId, 'herstellen');
  };

  /**
   * Maakt een eenmalige link (of telt een mail zonder link, soort `melding`), behalve als er dit uur al te veel van die
   * soort voor het account zijn. Het tellen en invoegen gebeurt onder een slot op het account, zodat gelijktijdige
   * verzoeken de limiet niet omzeilen.
   * @param {number} accountId Account.
   * @param {string} purpose 'bevestigen', 'herstellen' of 'melding'.
   * @returns {Promise<string>} Het token, of leeg als de limiet bereikt is of het account weg is.
   */
  const createToken = (accountId, purpose) => {
    if (!Object.hasOwn(TOKEN_MINUTES, purpose) || purpose === 'code') return Promise.reject(new Error('onbekende soort link'));
    return db.transaction(async (client) => {
      const [account] = await client.query('SELECT id FROM customer_accounts WHERE id = $1 FOR UPDATE', [accountId]);
      if (!account) return '';
      if (await overLimit(accountId, purpose, client)) return '';
      const token = newToken();
      // Een melding heeft geen bruikbare link: meteen als gebruikt vastgelegd.
      await client.query(
        `INSERT INTO customer_tokens (token_hash, account_id, purpose, expires_at, used_at)
         VALUES ($1, $2, $3, now() + make_interval(mins => $4), CASE WHEN $3 = 'melding' THEN now() END)`,
        [hashToken(token), accountId, purpose, TOKEN_MINUTES[purpose]],
      );
      return token;
    });
  };

  /**
   * Zoekt een geldige (niet verlopen, niet gebruikte) link met het account erbij.
   * @param {string} token Token uit de link.
   * @param {string} purpose Soort.
   * @param {{query: Function}} [client] Database of transactie-client; met `lock` vergrendeld tot het einde van de transactie.
   * @param {{lock?: boolean}} [mode] Vergrendelen (binnen een transactie, vóór het verbruiken).
   * @returns {Promise<(any|null)>} `{token_hash, account_id, email, password_hash, verified}` of null.
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
   * @returns {Promise<(any|null)>} `{accountId, email, tokenHash, stepUp}` of null.
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

  return { findByEmail, register, createToken, createCode, checkCode, changePassword, findToken, useTokens, startSession, loadSession, endSession, endSessionsOf, purgeExpired };
}

module.exports = { createAccounts, hashToken, tokenShapeOk, IDLE_HOURS, MAX_DAYS, TOKEN_MINUTES, MAX_TOKENS_PER_HOUR, UNVERIFIED_DAYS, MAX_CODE_ATTEMPTS, STEP_UP_MINUTES };
