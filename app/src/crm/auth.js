// @ts-check
/**
 * Sessies, CSRF-bescherming, rechtencontrole en auditlog van het CRM.
 * - Sessie: willekeurig token in een cookie (`HttpOnly`, `Secure`, `SameSite=Strict`, pad `/app`); in de database staat
 *   alleen de SHA-256 ervan. Verloopt na 1 uur zonder activiteit en uiterlijk na 1 dag (instelbaar in Beheer >
 *   Toegang en beveiliging > Sessies en bewaartermijnen; een kortere duur geldt meteen voor bestaande sessies, een
 *   langere maximale duur alleen voor nieuwe sessies).
 * - CSRF: elk formulier met POST bevat een token dat uit de sessie is afgeleid (HMAC), plus een herkomstcontrole.
 * - Rechten: `requireRight(recht)` per route; zonder sessie naar het inlogscherm, zonder recht 403.
 * - Tweestapsverificatie: na het wachtwoord krijgt wie 2FA heeft of moet hebben eerst een *halve* sessie (`mfa_ok`
 *   onwaar, 15 minuten geldig). Daarmee is alleen de codestap of het instellen van 2FA bereikbaar (`req.pending`);
 *   `req.user` blijft leeg, dus elke andere route behandelt zo'n bezoeker als niet ingelogd. Na de code komt er een
 *   nieuwe, volledige sessie (nieuw token).
 * - Auditlog: wie, wat, welk record, wanneer en een ingekort IP-adres; nooit de waarde zelf of persoonsgegevens.
 */
const crypto = require('node:crypto');
const { roleHasRight, roleHasGlobalRight, roleNeedsMfa } = require('./rights');
const { isCrossSite } = require('../security/form-guard');

/** Naam en pad van de sessiecookie. */
const COOKIE_NAME = 'avanta_sessie';
const COOKIE_PATH = '/app';

/**
 * Standaard verloop na inactiviteit en maximale levensduur van een sessie (zonder instellingen). Het CRM toont
 * bijzondere gegevens, dus kort (audit A07, ASVS 3.3): na een uur zonder activiteit en uiterlijk na een dag opnieuw
 * inloggen. Instelbaar in Beheer > Toegang en beveiliging > Sessies en bewaartermijnen.
 */
const IDLE_HOURS = 1;
const MAX_DAYS = 1;

/** Zo lang is een halve sessie (wachtwoord goed, code of 2FA-instelling nog niet) geldig. */
const PENDING_MINUTES = 15;

/** Standaard bewaartermijn van het auditlog (`docs/OPZET-CRM.md` §5: 2 jaar) en van de IP-voorvoegsels daarin. */
const AUDIT_RETENTION_MONTHS = 24;
const AUDIT_IP_RETENTION_DAYS = 90;

/**
 * Een instelling als die er is, anders de standaard (voor code en tests zonder instellingenlaag).
 * @param {(any|undefined)} settings De instellingen (`beheer/settings.js`).
 * @param {string} key Naam van de instelling.
 * @param {number} fallback Standaardwaarde.
 * @returns {number} De waarde.
 */
function settingOr(settings, key, fallback) {
  return settings ? settings.get(key) : fallback;
}

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
 * @param {any} req Express-verzoek.
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
 * @param {any} req Express-verzoek.
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
 * Ruimt verlopen sessies en auditregels ouder dan de bewaartermijn op en wist IP-voorvoegsels ouder dan hun termijn
 * (verlopen sessies via de index op `expires_at`, auditregels via `audit_log_created_idx`; de tweede opdracht op
 * `sessions.created_at` scant de kleine tabel). Draait bij het starten van de server en daarna dagelijks (zie
 * `startCrmMaintenance`).
 * @param {{query: Function}} db Database.
 * @param {any} [settings] De instellingen (`beheer/settings.js`); zonder instellingen gelden de standaardtermijnen.
 * @returns {Promise<void>}
 */
async function purgeExpired(db, settings) {
  if (settings) await settings.ready();
  const maxDays = settingOr(settings, 'sessionMaxDays', MAX_DAYS);
  // Twee aparte opdrachten, zodat de eerste de index op `expires_at` gebruikt.
  await db.query('DELETE FROM sessions WHERE expires_at < now()');
  await db.query('DELETE FROM sessions WHERE created_at < now() - make_interval(days => $1)', [maxDays]);
  await db.query('DELETE FROM audit_log WHERE created_at < now() - make_interval(months => $1)', [settingOr(settings, 'auditRetentionMonths', AUDIT_RETENTION_MONTHS)]);
  await db.query(
    'UPDATE audit_log SET ip_prefix = NULL WHERE created_at < now() - make_interval(days => $1) AND ip_prefix IS NOT NULL',
    [settingOr(settings, 'auditIpRetentionDays', AUDIT_IP_RETENTION_DAYS)],
  );
}

/**
 * Start het dagelijkse onderhoud: meteen een keer opruimen, daarna elke 24 uur. De timer houdt het proces niet open.
 * Een mislukte ronde wordt gelogd (zonder gegevens) en de volgende ronde probeert het opnieuw.
 * @param {{query: Function}} db Database.
 * @param {any} [settings] De instellingen (bewaartermijnen).
 * @returns {NodeJS.Timeout} De timer.
 */
function startCrmMaintenance(db, settings) {
  const run = () => purgeExpired(db, settings).catch((error) => console.error(`CRM-onderhoud mislukt: ${String(error.message).replace(/[\r\n]/g, ' ')}`));
  run();
  return setInterval(run, 24 * 60 * 60 * 1000).unref();
}

/**
 * Maakt de sessie- en rechtenlaag.
 * @param {{db: any, masterKey: Buffer, settings?: any, secureCookies?: boolean}} options Database, hoofdsleutel (voor
 *   de CSRF-sleutel), de instellingen (sessieduur) en of de cookie `Secure` krijgt (standaard ja).
 * @returns {any} Functies en middleware, zie onder.
 */
function createAuth(options) {
  const { db } = options;
  const csrfKey = crypto.createHmac('sha256', options.masterKey).update('crm-csrf').digest();
  const secure = options.secureCookies !== false;

  /**
   * De huidige sessieduur uit de instellingen.
   * @returns {{idleHours: number, maxDays: number}} Uren zonder activiteit en maximale dagen.
   */
  const limits = () => ({ idleHours: settingOr(options.settings, 'sessionIdleHours', IDLE_HOURS), maxDays: settingOr(options.settings, 'sessionMaxDays', MAX_DAYS) });

  /**
   * Schrijft een regel in het auditlog. Fouten bij het schrijven laten het verzoek mislukken: een actie die niet gelogd
   * kan worden, gaat niet door.
   * @param {any} req Express-verzoek (voor het IP-voorvoegsel).
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
   * @param {any} res Express-antwoord.
   * @param {string} token Token (of leeg om te wissen).
   * @param {number} maxAgeSeconds Levensduur.
   * @returns {void}
   */
  const setCookie = (res, token, maxAgeSeconds) => {
    res.append('Set-Cookie', `${COOKIE_NAME}=${token}; Path=${COOKIE_PATH}; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`);
  };

  /**
   * Of tweestapsverificatie verplicht is voor een rol, volgens Beheer > Toegang en beveiliging > Tweestapsverificatie:
   * *niemand* (standaard: optioneel, ieder zet het zelf aan), *gegevens* (rollen met een `gegevens.*`-recht) of
   * *iedereen*. Wie 2FA heeft aangezet, moet bij het inloggen altijd de code geven, ook als het niet verplicht is.
   * @param {string} role Rol.
   * @returns {boolean} Waar als de rol 2FA moet hebben.
   */
  const mfaRequiredFor = (role) => {
    const policy = options.settings ? options.settings.get('mfaRequiredFor') : 'niemand';
    return policy === 'iedereen' || (policy === 'gegevens' && roleNeedsMfa(role));
  };

  /**
   * Maakt een nieuwe sessie (na inloggen) en zet de cookie. Ruimt meteen verlopen sessies op (via de index op
   * `expires_at`; een sessie die door inactiviteit ongeldig is, verdwijnt uiterlijk op dat moment).
   * @param {any} res Express-antwoord.
   * @param {number} userId Gebruiker.
   * @param {{query: Function}} [client] Database of transactie-client.
   * @param {{mfaOk?: boolean}} [mode] `mfaOk: false` = halve sessie (alleen de tweede stap), 15 minuten geldig.
   * @returns {Promise<string>} Het token.
   */
  const startSession = async (res, userId, client = db, mode = {}) => {
    await client.query('DELETE FROM sessions WHERE expires_at < now()');
    const token = crypto.randomBytes(32).toString('base64url');
    const mfaOk = mode.mfaOk !== false;
    const lifetimeMinutes = mfaOk ? limits().maxDays * 24 * 60 : PENDING_MINUTES;
    await client.query(
      `INSERT INTO sessions (token_hash, user_id, expires_at, mfa_ok) VALUES ($1, $2, now() + make_interval(mins => $3), $4)`,
      [hashToken(token), userId, lifetimeMinutes, mfaOk],
    );
    setCookie(res, token, lifetimeMinutes * 60);
    return token;
  };

  /**
   * Rondt de tweede stap af: de halve sessie vervalt en er komt een nieuwe, volledige sessie met een nieuw token
   * (zo kan een vooraf bekend token nooit een volledige sessie worden).
   * @param {any} req Express-verzoek (met `req.pending`).
   * @param {any} res Express-antwoord.
   * @param {{query: Function}} client Transactie-client.
   * @returns {Promise<void>}
   */
  const completeMfa = async (req, res, client) => {
    await client.query('DELETE FROM sessions WHERE token_hash = $1', [req.pending.tokenHash]);
    await startSession(res, req.pending.id, client);
  };

  /**
   * Beëindigt de huidige sessie en wist de cookie.
   * @param {any} req Express-verzoek.
   * @param {any} res Express-antwoord.
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
   * verlopen sessie of een geblokkeerde gebruiker telt als niet ingelogd. De ingestelde duur geldt ook voor bestaande
   * sessies: een sessie ouder dan de maximale duur telt als verlopen, ook als `expires_at` later ligt.
   * Een halve sessie (2FA nodig, code nog niet gegeven) zet alleen `req.pending` met `step` `code` (2FA staat aan) of
   * `setup` (2FA verplicht maar nog niet ingesteld; `setupOk` = de activatiecode van de beheerder is gegeven);
   * `req.user` blijft dan leeg.
   * @param {any} req Express-verzoek.
   * @param {any} res Express-antwoord.
   * @param {Function} next Volgende stap.
   * @returns {Promise<void>}
   */
  const loadSession = async (req, res, next) => {
    try {
      req.user = null;
      req.session = null;
      req.pending = null;
      const token = readCookie(req, COOKIE_NAME);
      if (!token || token.length > 100) return next();
      const tokenHash = hashToken(token);
      const { idleHours, maxDays } = limits();
      const [row] = await db.query(
        `SELECT s.user_id, s.mfa_ok, s.mfa_setup_ok, (s.last_seen_at < now() - make_interval(secs => $3)) AS stale, u.email, u.name, u.role,
                (u.totp_enabled_at IS NOT NULL) AS mfa_enabled
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = $1 AND u.active AND s.expires_at > now() AND s.last_seen_at > now() - make_interval(hours => $2)
            AND s.created_at > now() - make_interval(days => $4)`,
        [tokenHash, idleHours, TOUCH_SECONDS, maxDays],
      );
      if (!row) return next();
      if (row.stale) await db.query('UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1', [tokenHash]);
      const account = { id: row.user_id, email: row.email, name: row.name, role: row.role };
      if (!row.mfa_ok && (row.mfa_enabled || mfaRequiredFor(row.role))) {
        req.pending = { ...account, step: row.mfa_enabled ? 'code' : 'setup', setupOk: row.mfa_setup_ok, tokenHash, csrf: csrfToken(tokenHash) };
        return next();
      }
      req.user = account;
      req.session = { tokenHash, mfaOk: row.mfa_ok, setupOk: row.mfa_setup_ok, csrf: csrfToken(tokenHash) };
      return next();
    } catch (error) {
      return next(error);
    }
  };

  /**
   * Waar een halve sessie heen moet: de codestap of het instellen van 2FA.
   * @param {any} req Express-verzoek.
   * @returns {string} Pad, of leeg zonder halve sessie.
   */
  const pendingPath = (req) => {
    if (!req.pending) return '';
    return req.pending.step === 'code' ? '/app/inloggen/code/' : '/app/tweestaps/';
  };

  /**
   * Middleware: alleen voor ingelogde gebruikers. Anders een GET naar het inlogscherm (of, met een halve sessie, naar
   * de codestap of het instellen van 2FA), een POST 401.
   * @param {any} req Express-verzoek.
   * @param {any} res Express-antwoord.
   * @param {Function} next Volgende stap.
   * @returns {void}
   */
  const requireLogin = (req, res, next) => {
    if (req.user) return next();
    if (req.method === 'GET' || req.method === 'HEAD') return res.redirect(303, pendingPath(req) || '/app/inloggen/');
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
   * Middleware-fabriek: vereist een recht voor álle records (niet beperkt tot eigen vertrekken, zie
   * `TRIP_SCOPED_ROLES`). Zonder sessie als `requireLogin`, anders 403.
   * @param {string} right Het recht (sleutel uit `RIGHTS`).
   * @returns {Function} Express-middleware.
   */
  const requireGlobalRight = (right) => (req, res, next) => requireLogin(req, res, () => {
    if (roleHasGlobalRight(req.user.role, right)) return next();
    return res.status(403).type('text').send('Je hebt geen toegang tot deze pagina.');
  });

  /**
   * Middleware: controleert bij een POST de herkomst en het CSRF-token uit het formulier (veld `_csrf`). Vereist een
   * (volledige of halve) sessie en een geparste body.
   * @param {any} req Express-verzoek.
   * @param {any} res Express-antwoord.
   * @param {Function} next Volgende stap.
   * @returns {void}
   */
  const checkCsrf = (req, res, next) => {
    if (!csrfValid(req, req.body?._csrf)) return res.status(403).type('text').send('Verzoek geweigerd. Laad de pagina opnieuw en probeer het nog eens.');
    return next();
  };

  /**
   * Of een verzoek van deze site komt en het gegeven CSRF-token bij de (volledige of halve) sessie hoort. Voor
   * formulieren die niet als geheel geparst worden (uploads): daar wordt het token gecontroleerd zodra het binnenkomt.
   * @param {any} req Express-verzoek.
   * @param {*} token Het meegestuurde token.
   * @returns {boolean} Waar als herkomst en token kloppen.
   */
  function csrfValid(req, token) {
    const given = Buffer.from(String(token || ''));
    const current = req.session || req.pending;
    const expected = Buffer.from(current ? current.csrf : '');
    return !isCrossSite(req) && expected.length > 0 && given.length === expected.length && crypto.timingSafeEqual(given, expected);
  }

  return { audit, startSession, completeMfa, endSession, endSessionsOf, loadSession, requireLogin, requireRight, requireGlobalRight, checkCsrf, csrfValid, mfaRequiredFor, pendingPath };
}

module.exports = { createAuth, purgeExpired, startCrmMaintenance, hashToken, readCookie, ipPrefix, COOKIE_NAME, IDLE_HOURS, MAX_DAYS, PENDING_MINUTES, AUDIT_RETENTION_MONTHS, AUDIT_IP_RETENTION_DAYS };
