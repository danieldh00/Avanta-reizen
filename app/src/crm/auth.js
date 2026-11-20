/**
 * Sessies, CSRF-bescherming, rechtencontrole en auditlog van het CRM.
 * - Sessie: willekeurig token in een cookie (`HttpOnly`, `Secure`, `SameSite=Strict`, pad `/app`); in de database staat
 *   alleen de SHA-256 ervan. Verloopt na 8 uur zonder activiteit en uiterlijk na 7 dagen.
 * - CSRF: elk formulier met POST bevat een token dat uit de sessie is afgeleid (HMAC), plus een herkomstcontrole.
 * - Rechten: `requireRight(recht)` per route; zonder sessie naar het inlogscherm, zonder recht 403.
 * - Auditlog: wie, wat, welk record, wanneer en een ingekort IP-adres; nooit de waarde zelf of persoonsgegevens.
 */
const crypto = require('node:crypto');
const { roleHasRight } = require('./rights');
const { isCrossSite } = require('../security/form-guard');

/** Naam en pad van de sessiecookie. */
const COOKIE_NAME = 'avanta_sessie';
const COOKIE_PATH = '/app';

/** Verloop na inactiviteit en maximale levensduur van een sessie. */
const IDLE_HOURS = 8;
const MAX_DAYS = 7;

/** Bewaartermijn van het auditlog (`docs/OPZET-CRM.md` §5: 2 jaar). */
const AUDIT_RETENTION_MONTHS = 24;

/** Hoe vaak `last_seen_at` hooguit wordt bijgewerkt (scheelt een schrijfactie per verzoek). */
const TOUCH_SECONDS = 60;

/**
 * SHA-256 van een sessietoken (hex), zoals het in de database staat.
 * @param {string} token Token uit de cookie.
 * @returns {string} Hash.
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Leest één cookie uit de `Cookie`-kop.
 * @param {object} req Express-verzoek.
 * @param {string} name Naam van de cookie.
 * @returns {string} Waarde, of leeg.
 */
function readCookie(req, name) {
  for (const part of String(req.get('cookie') || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return '';
}

/**
 * Ingekort IP-adres voor het auditlog: IPv4 per /24, IPv6 per /48. Genoeg om misbruik te herkennen, niet om een
 * aansluiting precies aan te wijzen.
 * @param {object} req Express-verzoek.
 * @returns {string} Voorvoegsel, bijv. `203.0.113.0/24`.
 */
function ipPrefix(req) {
  const address = String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  if (!address) return '';
  if (address.includes(':')) {
    const groups = address.split('::')[0].split(':').filter(Boolean).slice(0, 3);
    while (groups.length < 3) groups.push('0');
    return `${groups.join(':')}::/48`;
  }
  const octets = address.split('.');
  return octets.length === 4 ? `${octets.slice(0, 3).join('.')}.0/24` : '';
}

/**
 * Ruimt verlopen sessies en auditregels ouder dan de bewaartermijn op (beide via een index). Draait bij het starten
 * van de server en daarna dagelijks (zie `startCrmMaintenance`).
 * @param {{query: Function}} db Database.
 * @returns {Promise<void>}
 */
async function purgeExpired(db) {
  await db.query('DELETE FROM sessions WHERE expires_at < now()');
  await db.query('DELETE FROM audit_log WHERE created_at < now() - make_interval(months => $1)', [AUDIT_RETENTION_MONTHS]);
}

/**
 * Start het dagelijkse onderhoud: meteen een keer opruimen, daarna elke 24 uur. De timer houdt het proces niet open.
 * Een mislukte ronde wordt gelogd (zonder gegevens) en de volgende ronde probeert het opnieuw.
 * @param {{query: Function}} db Database.
 * @returns {NodeJS.Timeout} De timer.
 */
function startCrmMaintenance(db) {
  const run = () => purgeExpired(db).catch((error) => console.error(`CRM-onderhoud mislukt: ${String(error.message).replace(/[\r\n]/g, ' ')}`));
  run();
  return setInterval(run, 24 * 60 * 60 * 1000).unref();
}

/**
 * Maakt de sessie- en rechtenlaag.
 * @param {{db: object, masterKey: Buffer, secureCookies?: boolean}} options Database, hoofdsleutel (voor de CSRF-sleutel) en
 *   of de cookie `Secure` krijgt (standaard ja).
 * @returns {object} Functies en middleware, zie onder.
 */
function createAuth(options) {
  const { db } = options;
  const csrfKey = crypto.createHmac('sha256', options.masterKey).update('crm-csrf').digest();
  const secure = options.secureCookies !== false;

  /**
   * Schrijft een regel in het auditlog. Fouten bij het schrijven laten het verzoek mislukken: een actie die niet gelogd
   * kan worden, gaat niet door.
   * @param {object} req Express-verzoek (voor het IP-voorvoegsel).
   * @param {{userId?: (number|null), action: string, entity?: string, entityId?: (string|number)}} entry Wat er gebeurde.
   * @param {{query: Function}} [client] Database of transactie-client.
   * @returns {Promise<void>}
   */
  const audit = async (req, entry, client = db) => {
    await client.query(
      'INSERT INTO audit_log (user_id, action, entity, entity_id, ip_prefix) VALUES ($1, $2, $3, $4, $5)',
      [entry.userId ?? null, entry.action, entry.entity ?? null, entry.entityId === undefined ? null : String(entry.entityId), ipPrefix(req)],
    );
  };

  /**
   * Zet de sessiecookie.
   * @param {object} res Express-antwoord.
   * @param {string} token Token (of leeg om te wissen).
   * @param {number} maxAgeSeconds Levensduur.
   * @returns {void}
   */
  const setCookie = (res, token, maxAgeSeconds) => {
    res.append('Set-Cookie', `${COOKIE_NAME}=${token}; Path=${COOKIE_PATH}; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`);
  };

  /**
   * Maakt een nieuwe sessie (na inloggen) en zet de cookie. Ruimt meteen verlopen sessies op (via de index op
   * `expires_at`; een sessie die door inactiviteit ongeldig is, verdwijnt uiterlijk op dat moment).
   * @param {object} res Express-antwoord.
   * @param {number} userId Gebruiker.
   * @param {{query: Function}} [client] Database of transactie-client.
   * @returns {Promise<string>} Het token.
   */
  const startSession = async (res, userId, client = db) => {
    await client.query('DELETE FROM sessions WHERE expires_at < now()');
    const token = crypto.randomBytes(32).toString('base64url');
    await client.query(
      `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))`,
      [hashToken(token), userId, MAX_DAYS],
    );
    setCookie(res, token, MAX_DAYS * 24 * 60 * 60);
    return token;
  };

  /**
   * Beëindigt de huidige sessie en wist de cookie.
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @returns {Promise<void>}
   */
  const endSession = async (req, res) => {
    const token = readCookie(req, COOKIE_NAME);
    if (token) await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
    setCookie(res, '', 0);
  };

  /**
   * Beëindigt alle sessies van een gebruiker (na blokkeren, rolwijziging of nieuw wachtwoord), eventueel behalve de huidige.
   * @param {number} userId Gebruiker.
   * @param {string} [keepTokenHash] Hash van de sessie die blijft.
   * @param {{query: Function}} [client] Database of transactie-client.
   * @returns {Promise<void>}
   */
  const endSessionsOf = async (userId, keepTokenHash = '', client = db) => {
    await client.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [userId, keepTokenHash]);
  };

  /**
   * CSRF-token voor de huidige sessie.
   * @param {string} tokenHash Hash van het sessietoken.
   * @returns {string} Token voor in het formulier.
   */
  const csrfToken = (tokenHash) => crypto.createHmac('sha256', csrfKey).update(tokenHash).digest('base64url');

  /**
   * Middleware: zoekt de sessie bij de cookie en zet `req.user` (id, e-mail, naam, rol) en `req.session`. Een
   * verlopen sessie of een geblokkeerde gebruiker telt als niet ingelogd.
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @param {Function} next Volgende stap.
   * @returns {Promise<void>}
   */
  const loadSession = async (req, res, next) => {
    try {
      req.user = null;
      req.session = null;
      const token = readCookie(req, COOKIE_NAME);
      if (!token || token.length > 100) return next();
      const tokenHash = hashToken(token);
      const [row] = await db.query(
        `SELECT s.user_id, s.mfa_ok, (s.last_seen_at < now() - make_interval(secs => $3)) AS stale, u.email, u.name, u.role
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = $1 AND u.active AND s.expires_at > now() AND s.last_seen_at > now() - make_interval(hours => $2)`,
        [tokenHash, IDLE_HOURS, TOUCH_SECONDS],
      );
      if (!row) return next();
      if (row.stale) await db.query('UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1', [tokenHash]);
      req.user = { id: row.user_id, email: row.email, name: row.name, role: row.role };
      req.session = { tokenHash, mfaOk: row.mfa_ok, csrf: csrfToken(tokenHash) };
      return next();
    } catch (error) {
      return next(error);
    }
  };

  /**
   * Middleware: alleen voor ingelogde gebruikers. Anders een GET naar het inlogscherm, een POST 401.
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @param {Function} next Volgende stap.
   * @returns {void}
   */
  const requireLogin = (req, res, next) => {
    if (req.user) return next();
    if (req.method === 'GET' || req.method === 'HEAD') return res.redirect(303, '/app/inloggen/');
    return res.status(401).type('text').send('Log opnieuw in.');
  };

  /**
   * Middleware-fabriek: vereist een recht. Zonder sessie als `requireLogin`, zonder recht 403.
   * @param {string} right Het recht (sleutel uit `RIGHTS`).
   * @returns {Function} Express-middleware.
   */
  const requireRight = (right) => (req, res, next) => requireLogin(req, res, () => {
    if (roleHasRight(req.user.role, right)) return next();
    return res.status(403).type('text').send('Je hebt geen toegang tot deze pagina.');
  });

  /**
   * Middleware: controleert bij een POST de herkomst en het CSRF-token uit het formulier (veld `_csrf`). Vereist een
   * sessie (plaats na `requireLogin`) en een geparste body.
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @param {Function} next Volgende stap.
   * @returns {void}
   */
  const checkCsrf = (req, res, next) => {
    const given = Buffer.from(String(req.body?._csrf || ''));
    const expected = Buffer.from(req.session ? req.session.csrf : '');
    if (isCrossSite(req) || !expected.length || given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
      return res.status(403).type('text').send('Verzoek geweigerd. Laad de pagina opnieuw en probeer het nog eens.');
    }
    return next();
  };

  return { audit, startSession, endSession, endSessionsOf, loadSession, requireLogin, requireRight, checkCsrf };
}

module.exports = { createAuth, purgeExpired, startCrmMaintenance, hashToken, readCookie, ipPrefix, COOKIE_NAME, IDLE_HOURS, MAX_DAYS, AUDIT_RETENTION_MONTHS };
