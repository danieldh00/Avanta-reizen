/**
 * Tweestapsverificatie (TOTP) voor het CRM: opslag in `users` (migratie 9) en de schermen. Zelfde aanpak als AquaTech
 * (`hub/backend/src/beveiliging/two-factor.js`): het geheim staat versleuteld in `users.totp_secret` (vault, AAD
 * `users:totp:<id>`); zolang `totp_enabled_at` leeg is, is het een nog niet bevestigde instelling.
 * `users.totp_last_step` voorkomt dat dezelfde code twee keer werkt; `users.totp_recovery` bewaart alleen de SHA-256 van
 * de herstelcodes.
 *
 * Schermen:
 * - `/app/inloggen/code/`: de tweede stap na het wachtwoord (halve sessie, zie `crm/auth.js`). Verkeerde codes tellen
 *   per account: na 5 binnen 15 minuten is de codestap voor dat account dicht. Wie het wachtwoord niet heeft, komt hier
 *   nooit; raden met veel IP-adressen tegelijk levert dus hoogstens een halve sessie op.
 * - `/app/tweestaps/`: stand, aanzetten (QR-code + bevestigen met een code), nieuwe herstelcodes en uitzetten (alleen
 *   als het voor de rol niet verplicht is, met wachtwoord én code). Ook bereikbaar met een halve sessie als 2FA
 *   verplicht is maar nog niet is ingesteld. 2FA is standaard optioneel (instelling `mfaRequiredFor`). Wie het aanzet,
 *   geeft eerst de **activatiecode** die de beheerder heeft gemaakt (eenmalig, 7 dagen geldig, alleen als SHA-256
 *   bewaard). Bij gebruik wordt de code meteen gewist en mag alleen die sessie instellen; verloopt de sessie vóór het
 *   bevestigen, dan is een nieuwe code nodig. Zo is een gelekt of tijdelijk wachtwoord nooit genoeg om een eigen
 *   authenticator te koppelen. De eerste beheerder gebruikt de installatiecode als activatiecode.
 * Een beheerder zet de 2FA van een collega uit en maakt activatiecodes via `crm/users.js`.
 */
const crypto = require('node:crypto');
const express = require('express');
const { html } = require('../site/html');
const { createRateLimiter } = require('../security/rate-limit');
const { isCrossSite } = require('../security/form-guard');
const totp = require('./totp');
const qrCode = require('./qr-code');
const { verifyPassword, MAX_LENGTH } = require('./passwords');
const { renderCrmPage, renderInput, renderAlert, formatDateTime } = require('./layout');

/** Naam van de uitgever in de authenticator-app. */
const ISSUER = 'Avanta CRM';

/** Zoveel verkeerde codes per account binnen het venster; daarna is de stap dicht tot het venster om is. */
const MAX_FAILED_CODES = 5;
const CODE_LOCK_MINUTES = 15;

/** Zoveel dagen is een activatiecode van de beheerder geldig; de installatiecode als activatiecode 30 dagen. */
const ACTIVATION_DAYS = 7;
const SETUP_ACTIVATION_DAYS = 30;

/** Tekens voor de activatiecode (zonder 0/O en 1/I, die lijken op elkaar). */
const ACTIVATION_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Normaliseert een activatiecode (of installatiecode): hoofdletters, zonder spaties en streepjes.
 * @param {*} value Invoer.
 * @returns {string} Genormaliseerde code (leeg als het geen tekst is).
 */
const normalizeActivation = (value) => (typeof value === 'string' ? value.toUpperCase().replace(/[\s-]/g, '').slice(0, 64) : '');

/**
 * SHA-256 van een activatiecode, zoals hij in de database staat.
 * @param {*} value Code.
 * @returns {string} Hash in hex.
 */
const activationHash = (value) => crypto.createHash('sha256').update(normalizeActivation(value)).digest('hex');

/**
 * Maakt een willekeurige activatiecode van 20 tekens in groepjes van 5 (ongeveer 100 bits).
 * @returns {string} Code, bijv. `ABCDE-FGHJK-LMNPQ-RSTUV`.
 */
function generateActivationCode() {
  const characters = Array.from(crypto.randomBytes(20), (byte) => ACTIVATION_ALPHABET[byte % ACTIVATION_ALPHABET.length]).join('');
  return characters.match(/.{5}/g).join('-');
}

/** Melding bij een verkeerde code. */
const CODE_WRONG = 'De code klopt niet. Gebruik de nieuwste code uit de app, of een herstelcode.';
/** Melding als de codestap dicht is. */
const CODE_LOCKED = `Te veel verkeerde codes. Probeer het over ${CODE_LOCK_MINUTES} minuten opnieuw.`;

/**
 * De context (AAD) waarmee het geheim van een gebruiker versleuteld wordt.
 * @param {number} userId Gebruiker.
 * @returns {string} AAD.
 */
const contextOf = (userId) => `users:totp:${userId}`;

/**
 * Zet een geheim in groepjes van vier tekens, om over te typen.
 * @param {string} secret Geheim in base32.
 * @returns {string} Bijv. `ABCD EFGH …`.
 */
const groupSecret = (secret) => secret.match(/.{1,4}/g).join(' ');

/**
 * Maakt de opslag voor tweestapsverificatie.
 * @param {{db: object, vault: {seal: Function, open: Function}, now?: () => number}} options Database, kluis en (voor
 *   tests) de klok.
 * @returns {object} Functies, zie onder.
 */
function createTwoFactor(options) {
  const { db, vault } = options;
  const clock = options.now || Date.now;

  /**
   * De 2FA-gegevens van een gebruiker.
   * @param {number} userId Gebruiker.
   * @param {{query: Function}} [client] Database of transactie-client.
   * @returns {Promise<(object|undefined)>} Rij met `totp_secret`, `totp_enabled_at`, `totp_last_step`, `totp_recovery`.
   */
  const rowOf = async (userId, client = db) => (await client.query(
    'SELECT totp_secret, totp_enabled_at, totp_last_step, totp_recovery FROM users WHERE id = $1',
    [userId],
  ))[0];

  /**
   * Ontsleutelt het geheim van een gebruiker.
   * @param {number} userId Gebruiker.
   * @param {string} sealed Versleuteld geheim.
   * @returns {string} Geheim in base32.
   */
  const secretOf = (userId, sealed) => vault.open(sealed, contextOf(userId));

  /**
   * Of 2FA aan staat en hoeveel herstelcodes er nog zijn.
   * @param {number} userId Gebruiker.
   * @returns {Promise<{enabled: boolean, enabledAt: (Date|null), recoveryLeft: number}>} Stand.
   */
  const stateOf = async (userId) => {
    const row = await rowOf(userId);
    const enabled = Boolean(row && row.totp_enabled_at && row.totp_secret);
    return { enabled, enabledAt: enabled ? row.totp_enabled_at : null, recoveryLeft: enabled ? row.totp_recovery.length : 0 };
  };

  /**
   * Begint met aanzetten: een nieuw (nog niet actief) geheim. Staat 2FA al aan, dan gebeurt er niets.
   * @param {number} userId Gebruiker.
   * @returns {Promise<boolean>} Waar als er een nieuw geheim is.
   */
  const startSetup = async (userId) => {
    const secret = totp.newSecret();
    const rows = await db.query(
      "UPDATE users SET totp_secret = $2, totp_enabled_at = NULL, totp_last_step = NULL, totp_recovery = '{}' WHERE id = $1 AND totp_enabled_at IS NULL RETURNING id",
      [userId, vault.seal(secret, contextOf(userId))],
    );
    return rows.length > 0;
  };

  /**
   * Het nog niet bevestigde geheim met het adres voor de app.
   * @param {{id: number, email: string}} user Gebruiker.
   * @returns {Promise<({secret: string, uri: string}|null)>} Geheim en otpauth-adres, of null als er geen instelling loopt.
   */
  const pendingSetup = async (user) => {
    const row = await rowOf(user.id);
    if (!row || !row.totp_secret || row.totp_enabled_at) return null;
    const secret = secretOf(user.id, row.totp_secret);
    return { secret, uri: totp.otpauthUri({ secret, account: user.email, issuer: ISSUER }) };
  };

  /**
   * Bevestigt het aanzetten met een code uit de app; daarna staat 2FA aan, zijn er nieuwe herstelcodes en vervalt een
   * activatiecode.
   * @param {number} userId Gebruiker.
   * @param {*} code Code uit de app.
   * @param {{query: Function}} client Transactie-client.
   * @returns {Promise<{recoveryCodes?: string[], error?: string}>} De herstelcodes (één keer tonen), of een fout.
   */
  const confirm = async (userId, code, client) => {
    const [row] = await client.query('SELECT totp_secret, totp_enabled_at FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!row || !row.totp_secret || row.totp_enabled_at) return { error: 'state' };
    const checked = totp.verify(secretOf(userId, row.totp_secret), code, { now: clock() });
    if (!checked.ok) return { error: 'code' };
    const recovery = totp.newRecoveryCodes();
    await client.query(
      'UPDATE users SET totp_enabled_at = now(), totp_last_step = $2, totp_recovery = $3, totp_activation_hash = NULL, totp_activation_expires_at = NULL, updated_at = now() WHERE id = $1',
      [userId, checked.step, recovery.hashes],
    );
    return { recoveryCodes: recovery.codes };
  };

  /**
   * Controleert een code uit de app (geen herstelcode) en legt de gebruikte stap vast, zodat dezelfde code niet nog eens
   * werkt. Bij twee gelijktijdige verzoeken met dezelfde code wint er één.
   * @param {number} userId Gebruiker.
   * @param {*} code Ingevoerde code.
   * @returns {Promise<boolean>} Waar als de code klopt.
   */
  const verifyAppCode = async (userId, code) => {
    const row = await rowOf(userId);
    if (!row || !row.totp_enabled_at || !row.totp_secret) return false;
    const lastStep = row.totp_last_step === null ? null : Number(row.totp_last_step);
    const checked = totp.verify(secretOf(userId, row.totp_secret), code, { lastStep, now: clock() });
    if (!checked.ok) return false;
    const saved = await db.query(
      'UPDATE users SET totp_last_step = $2 WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2) RETURNING id',
      [userId, checked.step],
    );
    return saved.length > 0;
  };

  /**
   * De tweede stap: een code uit de app of een herstelcode. Een herstelcode vervalt na gebruik (atomair: bij twee
   * gelijktijdige verzoeken met dezelfde herstelcode wint er één).
   * @param {number} userId Gebruiker.
   * @param {*} input Ingevoerde code (alleen tekst telt).
   * @returns {Promise<{ok: boolean, recoveryUsed?: boolean}>} Uitslag.
   */
  const check = async (userId, input) => {
    const typed = (typeof input === 'string' ? input : '').trim().slice(0, 40);
    if (!typed) return { ok: false };
    if (await verifyAppCode(userId, typed)) return { ok: true };
    const row = await rowOf(userId);
    if (!row || !row.totp_enabled_at) return { ok: false };
    const index = totp.matchRecovery(row.totp_recovery, typed);
    if (index < 0) return { ok: false };
    const used = await db.query(
      'UPDATE users SET totp_recovery = array_remove(totp_recovery, $2) WHERE id = $1 AND $2 = ANY(totp_recovery) RETURNING id',
      [userId, row.totp_recovery[index]],
    );
    return used.length > 0 ? { ok: true, recoveryUsed: true } : { ok: false };
  };

  /**
   * Maakt nieuwe herstelcodes (de oude vervallen).
   * @param {number} userId Gebruiker.
   * @param {{query: Function}} client Transactie-client.
   * @returns {Promise<string[]>} De nieuwe codes (één keer tonen).
   */
  const renewRecovery = async (userId, client) => {
    const recovery = totp.newRecoveryCodes();
    await client.query('UPDATE users SET totp_recovery = $2 WHERE id = $1 AND totp_enabled_at IS NOT NULL', [userId, recovery.hashes]);
    return recovery.codes;
  };

  /**
   * Zet 2FA uit (ook een lopende, niet bevestigde instelling).
   * @param {number} userId Gebruiker.
   * @param {{query: Function}} client Database of transactie-client.
   * @returns {Promise<boolean>} Waar als er iets uitgezet is.
   */
  const disable = async (userId, client = db) => {
    const rows = await client.query(
      "UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL, totp_recovery = '{}', updated_at = now() WHERE id = $1 AND totp_secret IS NOT NULL RETURNING id",
      [userId],
    );
    return rows.length > 0;
  };

  /**
   * Maakt een nieuwe activatiecode voor een gebruiker (de vorige vervalt).
   * @param {number} userId Gebruiker.
   * @param {{query: Function}} [client] Database of transactie-client.
   * @param {{code?: string, days?: number}} [mode] Een bestaande code (de installatiecode) en de geldigheid in dagen.
   * @returns {Promise<string>} De code (één keer tonen).
   */
  const issueActivation = async (userId, client = db, mode = {}) => {
    const code = mode.code || generateActivationCode();
    await client.query(
      'UPDATE users SET totp_activation_hash = $2, totp_activation_expires_at = now() + make_interval(days => $3) WHERE id = $1',
      [userId, activationHash(code), mode.days || ACTIVATION_DAYS],
    );
    return code;
  };

  /**
   * Verbruikt een activatiecode: bestaat, niet verlopen en gelijk (tijdconstante vergelijking). Bij een goede code wordt
   * hij in dezelfde transactie gewist en krijgt alleen de sessie die hem gaf het recht om in te stellen
   * (`sessions.mfa_setup_ok`). Dezelfde code werkt dus nooit in een tweede sessie.
   * @param {number} userId Gebruiker.
   * @param {*} input Ingevoerde code.
   * @param {string} tokenHash Hash van het token van de sessie die de code geeft.
   * @returns {Promise<boolean>} Waar als de code klopte en is verbruikt.
   */
  const consumeActivation = async (userId, input, tokenHash) => {
    if (!normalizeActivation(input)) return false;
    return db.transaction(async (client) => {
      const [row] = await client.query(
        'SELECT totp_activation_hash AS hash FROM users WHERE id = $1 AND totp_activation_expires_at > now() FOR UPDATE',
        [userId],
      );
      if (!row || !row.hash) return false;
      const stored = Buffer.from(row.hash, 'hex');
      const given = Buffer.from(activationHash(input), 'hex');
      if (stored.length !== given.length || !crypto.timingSafeEqual(stored, given)) return false;
      await client.query('UPDATE users SET totp_activation_hash = NULL, totp_activation_expires_at = NULL WHERE id = $1', [userId]);
      const updated = await client.query('UPDATE sessions SET mfa_setup_ok = true WHERE token_hash = $1 AND user_id = $2 RETURNING user_id', [tokenHash, userId]);
      if (updated.length !== 1) throw new Error('Sessie voor de activatiecode niet gevonden');
      return true;
    });
  };

  /**
   * Of er een geldige activatiecode klaarstaat (voor het scherm van de beheerder).
   * @param {number} userId Gebruiker.
   * @returns {Promise<(Date|null)>} Tot wanneer de code geldt, of null.
   */
  const activationUntil = async (userId) => {
    const [row] = await db.query(
      'SELECT totp_activation_expires_at AS until FROM users WHERE id = $1 AND totp_activation_hash IS NOT NULL AND totp_activation_expires_at > now()',
      [userId],
    );
    return row ? row.until : null;
  };

  /**
   * Telt een poging op de codestap, vooraf en atomair in de database. Het venster begint bij de eerste poging en duurt
   * een kwartier; daarna begint de telling opnieuw.
   * @param {number} userId Gebruiker.
   * @returns {Promise<boolean>} Waar als de poging mag (hoogstens 5 binnen het venster).
   */
  const countCodeAttempt = async (userId) => {
    const [row] = await db.query(
      `UPDATE users SET
         totp_failures = CASE WHEN totp_failures_reset_at IS NULL OR totp_failures_reset_at <= now() THEN 1 ELSE totp_failures + 1 END,
         totp_failures_reset_at = CASE WHEN totp_failures_reset_at IS NULL OR totp_failures_reset_at <= now()
           THEN now() + make_interval(mins => $2) ELSE totp_failures_reset_at END
       WHERE id = $1 RETURNING totp_failures`,
      [userId, CODE_LOCK_MINUTES],
    );
    return Boolean(row) && row.totp_failures <= MAX_FAILED_CODES;
  };

  return { countCodeAttempt, stateOf, startSetup, pendingSetup, confirm, verifyAppCode, check, renewRecovery, disable, issueActivation, consumeActivation, activationUntil };
}

/**
 * Maakt de routes voor de codestap en het 2FA-scherm.
 * @param {{db: object, auth: object, twoFactor: object, now?: () => number}} options Database, sessie- en rechtenlaag,
 *   de opslag (`createTwoFactor`) en (voor tests) de klok van de limieten.
 * @returns {express.Router} Router.
 */
function createTwoFactorRoutes(options) {
  const { db, auth, twoFactor } = options;
  const router = express.Router();
  // Verkeerde codes bij instellen, nieuwe herstelcodes en uitzetten, per gebruiker.
  const manageFailures = createRateLimiter({ limit: MAX_FAILED_CODES, windowMs: CODE_LOCK_MINUTES * 60 * 1000, now: options.now });

  /**
   * Het account van het verzoek: de ingelogde gebruiker, of de halve sessie die 2FA nog moet instellen.
   * @param {object} req Express-verzoek.
   * @returns {({id: number, email: string, name: string, role: string, csrf: string, pending: boolean}|null)} Account, of null.
   */
  const accountOf = (req) => {
    if (req.user) return { ...req.user, csrf: req.session.csrf, tokenHash: req.session.tokenHash, setupOk: req.session.setupOk, pending: false };
    if (req.pending && req.pending.step === 'setup') return { ...req.pending, pending: true };
    return null;
  };

  /**
   * Of dit account 2FA mag instellen: pas nadat deze sessie de activatiecode van de beheerder heeft gegeven. Dat geldt
   * ook voor een ingelogde gebruiker zonder 2FA: die sessie bewijst alleen het wachtwoord, en een gelekt wachtwoord mag
   * nooit genoeg zijn om een eigen app te koppelen.
   * @param {object} account Account (`accountOf`).
   * @returns {boolean} Waar als instellen mag.
   */
  const mayConfigure = (account) => account.setupOk === true;

  /**
   * Middleware: een ingelogde gebruiker of een halve sessie die 2FA moet instellen; anders als `requireLogin`.
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @param {Function} next Volgende stap.
   * @returns {void}
   */
  const requireAccount = (req, res, next) => (accountOf(req) ? next() : auth.requireLogin(req, res, next));

  /**
   * Weigert een POST van een andere site.
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @param {Function} next Volgende stap.
   * @returns {void}
   */
  const sameSiteOnly = (req, res, next) => (isCrossSite(req) ? res.status(403).type('text').send('Verzoek geweigerd.') : next());

  /**
   * Een CRM-pagina voor een account; een halve sessie krijgt geen menu, wel een knop om uit te loggen.
   * @param {object} account Account (`accountOf`).
   * @param {string} title Titel.
   * @param {object} body Inhoud.
   * @returns {string} HTML-pagina.
   */
  const page = (account, title, body) => renderCrmPage({
    title,
    user: account.pending ? null : account,
    csrf: account.csrf,
    path: '/app/tweestaps/',
    body: html`${body}${account.pending ? renderLogoutForm(account.csrf) : ''}`,
  });

  /**
   * Knop om uit te loggen (voor schermen zonder menu).
   * @param {string} csrf CSRF-token.
   * @returns {object} HTML.
   */
  const renderLogoutForm = (csrf) => html`<form class="crm-logout-inline" method="post" action="/app/uitloggen/">
    <input type="hidden" name="_csrf" value="${csrf}"><button class="btn btn--outline btn--small" type="submit">Annuleren en uitloggen</button>
  </form>`;

  /**
   * Invoerveld voor een code (cijfers uit de app, of een herstelcode).
   * @param {{name?: string, label: string, error?: string, allowRecovery?: boolean}} field Veld.
   * @returns {object} HTML.
   */
  const renderCodeInput = (field) => {
    const name = field.name || 'code';
    const id = `veld-${name}`;
    return html`<div class="field">
      <span class="field__label"><label for="${id}">${field.label}</label></span>
      <input id="${id}" name="${name}" type="text" autocomplete="one-time-code" ${field.allowRecovery ? '' : html`inputmode="numeric" pattern="[0-9 ]{6,7}" `}maxlength="${field.allowRecovery ? 11 : 7}" required${field.error ? html` aria-invalid="true" aria-describedby="${id}-fout"` : ''}>
      ${field.error ? html`<span class="field__error" id="${id}-fout">${field.error}</span>` : ''}
    </div>`;
  };

  /**
   * Lijst met herstelcodes (één keer getoond).
   * @param {string[]} codes Codes.
   * @returns {object} HTML.
   */
  const renderRecoveryCodes = (codes) => html`<p>Bewaar deze herstelcodes op een veilige plek (bijv. in een wachtwoordkluis of
      geprint). Met een herstelcode log je in als je telefoon kwijt is; elke code werkt één keer. Ze worden <strong>niet</strong>
      nog eens getoond.</p>
    <ul class="crm-recovery-codes">${codes.map((code) => html`<li><code>${code}</code></li>`)}</ul>`;

  // ---- De tweede stap bij inloggen ----

  /**
   * Het scherm van de codestap.
   * @param {object} req Express-verzoek (met `req.pending`).
   * @param {string} [error] Melding.
   * @returns {string} HTML-pagina.
   */
  const renderCodeStep = (req, error) => renderCrmPage({
    title: 'Code uit je app',
    body: html`<div class="crm-narrow">
      <p>Vul de code van zes cijfers in uit je authenticator-app. Telefoon kwijt? Gebruik een van je herstelcodes.</p>
      ${renderAlert(error)}
      <form class="form" method="post" action="/app/inloggen/code/">
        <input type="hidden" name="_csrf" value="${req.pending.csrf}">
        ${renderCodeInput({ label: 'Code of herstelcode', allowRecovery: true })}
        <div><button class="btn" type="submit">Inloggen</button></div>
      </form>
      ${renderLogoutForm(req.pending.csrf)}
    </div>`,
  });

  /**
   * Middleware: alleen met een halve sessie die een code moet geven; anders naar de juiste plek.
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @param {Function} next Volgende stap.
   * @returns {void}
   */
  const requireCodeStep = (req, res, next) => {
    if (req.pending && req.pending.step === 'code') return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(401).type('text').send('Log opnieuw in.');
    if (req.user) return res.redirect(303, '/app/');
    return res.redirect(303, auth.pendingPath(req) || '/app/inloggen/');
  };

  router.get('/inloggen/code/', requireCodeStep, (req, res) => res.send(renderCodeStep(req)));

  router.post('/inloggen/code/', sameSiteOnly, requireCodeStep, auth.checkCsrf, async (req, res, next) => {
    try {
      const userId = req.pending.id;
      // Tel de poging vooraf in de database (gelijktijdige verzoeken en een herstart omzeilen de limiet zo niet); een
      // goede code wist de teller. Per account, dus ook vanaf veel IP-adressen tegelijk hoogstens 5 per kwartier.
      if (!(await twoFactor.countCodeAttempt(userId))) {
        await auth.audit(req, { userId, action: 'inloggen.code-geblokkeerd', entity: 'users', entityId: userId });
        return res.status(429).set('Retry-After', String(CODE_LOCK_MINUTES * 60)).send(renderCodeStep(req, CODE_LOCKED));
      }
      const result = await twoFactor.check(userId, req.body.code);
      if (!result.ok) {
        await auth.audit(req, { userId, action: 'inloggen.code-mislukt', entity: 'users', entityId: userId });
        return res.status(401).send(renderCodeStep(req, CODE_WRONG));
      }
      await db.transaction(async (client) => {
        await client.query('UPDATE users SET last_login_at = now(), totp_failures = 0, totp_failures_reset_at = NULL WHERE id = $1', [userId]);
        await auth.completeMfa(req, res, client);
        if (result.recoveryUsed) await auth.audit(req, { userId, action: 'tweestaps.herstelcode', entity: 'users', entityId: userId }, client);
        await auth.audit(req, { userId, action: 'inloggen', entity: 'users', entityId: userId }, client);
      });
      return res.redirect(303, result.recoveryUsed ? '/app/tweestaps/?herstelcode=1' : '/app/');
    } catch (error) {
      return next(error);
    }
  });

  // ---- Het 2FA-scherm ----

  /**
   * Het overzicht van de eigen 2FA.
   * @param {object} req Express-verzoek.
   * @param {{errors?: object, notice?: string}} [state] Fouten per formulier en een melding.
   * @returns {Promise<string>} HTML-pagina.
   */
  const renderOverview = async (req, state = {}) => {
    const account = accountOf(req);
    const errors = state.errors || {};
    const current = await twoFactor.stateOf(account.id);
    const required = auth.mfaRequiredFor(account.role);
    if (!current.enabled) {
      return page(account, 'Tweestapsverificatie', html`<div class="crm-narrow">
        ${state.notice ? html`<p class="notice" role="status">${state.notice}</p>` : ''}
        ${required
    ? html`<p class="notice">Tweestapsverificatie is verplicht voor jouw account. Stel het nu in; daarna kun je verder.</p>`
    : html`<p>Tweestapsverificatie staat uit. Zet het aan: een geraden of gelekt wachtwoord is dan niet genoeg om in te loggen.</p>`}
        <p>Je hebt een authenticator-app op je telefoon nodig, bijvoorbeeld Microsoft Authenticator, Google Authenticator of de
          app van je wachtwoordkluis. Bij het inloggen vraagt het CRM na je wachtwoord een code uit die app.</p>
        ${mayConfigure(account)
    ? html`<form method="post" action="/app/tweestaps/instellen/">
          <input type="hidden" name="_csrf" value="${account.csrf}">
          <button class="btn" type="submit">Tweestapsverificatie instellen</button>
        </form>`
    : html`<p>Vul eerst de <strong>activatiecode</strong> in die je van de beheerder hebt gekregen (de eerste beheerder
          gebruikt de installatiecode). Zo kan niemand met alleen je wachtwoord een eigen app koppelen.</p>
        ${renderAlert(errors.activation)}
        <form class="form" method="post" action="/app/tweestaps/activeren/">
          <input type="hidden" name="_csrf" value="${account.csrf}">
          ${renderInput({ name: 'activation', label: 'Activatiecode', autocomplete: 'off', max: 64 })}
          <div><button class="btn" type="submit">Verder</button></div>
        </form>`}
      </div>`);
    }
    return page(account, 'Tweestapsverificatie', html`<div class="crm-narrow">
      ${state.notice ? html`<p class="notice" role="status">${state.notice}</p>` : ''}
      <p>Tweestapsverificatie staat aan sinds ${formatDateTime(current.enabledAt)}. Je hebt nog <strong>${current.recoveryLeft}</strong>
        herstelcode${current.recoveryLeft === 1 ? '' : 's'}.</p>
      ${current.recoveryLeft <= 3 ? html`<p class="notice">Je hebt bijna geen herstelcodes meer. Maak nieuwe aan.</p>` : ''}
      <h2>Nieuwe herstelcodes</h2>
      <p>De oude herstelcodes vervallen.</p>
      ${renderAlert(errors.recovery)}
      <form class="form" method="post" action="/app/tweestaps/herstelcodes/">
        <input type="hidden" name="_csrf" value="${account.csrf}">
        ${renderCodeInput({ label: 'Code uit je app' })}
        <div><button class="btn btn--outline" type="submit">Nieuwe herstelcodes maken</button></div>
      </form>
      <h2>Uitzetten</h2>
      ${required
    ? html`<p>Voor jouw account is tweestapsverificatie verplicht; uitzetten kan niet. Nieuwe telefoon? Vraag een beheerder
          om je tweestapsverificatie te resetten en stel het daarna opnieuw in.</p>`
    : html`${renderAlert(errors.disable)}
        <form class="form" method="post" action="/app/tweestaps/uitzetten/">
          <input type="hidden" name="_csrf" value="${account.csrf}">
          <input type="hidden" name="username" value="${account.email}" autocomplete="username">
          ${renderInput({ name: 'password', label: 'Je wachtwoord', type: 'password', autocomplete: 'current-password', max: MAX_LENGTH })}
          ${renderCodeInput({ name: 'code', label: 'Code uit je app of een herstelcode', allowRecovery: true })}
          <div><button class="btn btn--outline" type="submit">Tweestapsverificatie uitzetten</button></div>
        </form>`}
    </div>`);
  };

  router.get('/tweestaps/', requireAccount, async (req, res, next) => {
    try {
      let notice = '';
      if (req.query.herstelcode === '1') notice = 'Je bent ingelogd met een herstelcode; die werkt nu niet meer.';
      else if (req.query.uit === '1') notice = 'Tweestapsverificatie staat uit.';
      return res.send(await renderOverview(req, { notice }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/tweestaps/activeren/', sameSiteOnly, requireAccount, auth.checkCsrf, async (req, res, next) => {
    try {
      const account = accountOf(req);
      if (mayConfigure(account)) return res.redirect(303, '/app/tweestaps/');
      const failureKey = `activeren:${account.id}`;
      // Tel vooraf, zodat gelijktijdige pogingen de limiet niet omzeilen; een goede code wist de teller.
      if (!manageFailures.hit(failureKey)) {
        return res.status(429).set('Retry-After', String(CODE_LOCK_MINUTES * 60)).send(await renderOverview(req, { errors: { activation: CODE_LOCKED } }));
      }
      if (!(await twoFactor.consumeActivation(account.id, req.body.activation, account.tokenHash))) {
        await auth.audit(req, { userId: account.id, action: 'tweestaps.activatie-mislukt', entity: 'users', entityId: account.id });
        return res.status(422).send(await renderOverview(req, { errors: { activation: 'Deze activatiecode klopt niet of is verlopen. Vraag de beheerder om een nieuwe.' } }));
      }
      manageFailures.clear(failureKey);
      await twoFactor.startSetup(account.id);
      return res.redirect(303, '/app/tweestaps/instellen/');
    } catch (error) {
      return next(error);
    }
  });

  router.post('/tweestaps/instellen/', sameSiteOnly, requireAccount, auth.checkCsrf, async (req, res, next) => {
    try {
      if (!mayConfigure(accountOf(req))) return res.redirect(303, '/app/tweestaps/');
      await twoFactor.startSetup(accountOf(req).id);
      return res.redirect(303, '/app/tweestaps/instellen/');
    } catch (error) {
      return next(error);
    }
  });

  /**
   * Het scherm met de QR-code en het bevestigen.
   * @param {object} req Express-verzoek.
   * @param {{secret: string, uri: string}} setup Geheim en otpauth-adres.
   * @param {string} [error] Melding.
   * @returns {string} HTML-pagina.
   */
  const renderSetup = (req, setup, error) => {
    const account = accountOf(req);
    // De QR-code als data-adres (de CSP staat `img-src data:` toe); het geheim gaat nergens anders heen.
    const image = `data:image/svg+xml;base64,${Buffer.from(qrCode.svg(setup.uri, { label: 'QR-code voor je authenticator-app' })).toString('base64')}`;
    return page(account, 'Tweestapsverificatie instellen', html`<div class="crm-narrow">
      <ol class="crm-steps">
        <li>Open je authenticator-app en kies <em>account toevoegen</em>.</li>
        <li>Scan deze QR-code. Lukt scannen niet, typ dan de sleutel over (type: op tijd gebaseerd).</li>
        <li>Vul hieronder de code van zes cijfers in die de app nu toont.</li>
      </ol>
      <p><img class="crm-qr" src="${image}" width="220" height="220" alt="QR-code voor je authenticator-app"></p>
      <p>Sleutel: <code class="crm-secret">${groupSecret(setup.secret)}</code></p>
      ${renderAlert(error)}
      <form class="form" method="post" action="/app/tweestaps/bevestigen/">
        <input type="hidden" name="_csrf" value="${account.csrf}">
        ${renderCodeInput({ label: 'Code uit je app' })}
        <div><button class="btn" type="submit">Bevestigen</button> <a href="/app/tweestaps/">Terug</a></div>
      </form>
    </div>`);
  };

  router.get('/tweestaps/instellen/', requireAccount, async (req, res, next) => {
    try {
      const account = accountOf(req);
      const setup = mayConfigure(account) ? await twoFactor.pendingSetup(account) : null;
      if (!setup) return res.redirect(303, '/app/tweestaps/');
      return res.send(renderSetup(req, setup));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/tweestaps/bevestigen/', sameSiteOnly, requireAccount, auth.checkCsrf, async (req, res, next) => {
    try {
      const account = accountOf(req);
      if (!mayConfigure(account)) return res.redirect(303, '/app/tweestaps/');
      const failureKey = `instellen:${account.id}`;
      // Tel vooraf, zodat gelijktijdige pogingen de limiet niet omzeilen; een goede code wist de teller.
      if (!manageFailures.hit(failureKey)) {
        const setup = await twoFactor.pendingSetup(account);
        if (!setup) return res.redirect(303, '/app/tweestaps/');
        return res.status(429).set('Retry-After', String(CODE_LOCK_MINUTES * 60)).send(renderSetup(req, setup, CODE_LOCKED));
      }
      const outcome = await db.transaction(async (client) => {
        const result = await twoFactor.confirm(account.id, req.body.code, client);
        if (result.error) return result;
        // Andere sessies van deze gebruiker zijn zonder deze tweede stap gemaakt: die vervallen.
        await auth.endSessionsOf(account.id, account.pending ? '' : req.session.tokenHash, client);
        if (account.pending) await auth.completeMfa(req, res, client);
        await auth.audit(req, { userId: account.id, action: 'tweestaps.aan', entity: 'users', entityId: account.id }, client);
        return result;
      });
      if (outcome.error === 'state') return res.redirect(303, '/app/tweestaps/');
      if (outcome.error) {
        const setup = await twoFactor.pendingSetup(account);
        if (!setup) return res.redirect(303, '/app/tweestaps/');
        return res.status(422).send(renderSetup(req, setup, 'De code klopt niet. Controleer of de tijd op je telefoon goed staat en gebruik de nieuwste code.'));
      }
      manageFailures.clear(failureKey);
      // Na een halve sessie is er nu een nieuwe sessie (en dus een nieuw CSRF-token): deze pagina heeft daarom geen menu
      // en geen formulieren; het menu verschijnt vanaf de volgende pagina.
      return res.send(renderCrmPage({
        title: 'Tweestapsverificatie staat aan',
        body: html`<div class="crm-narrow">
          ${renderRecoveryCodes(outcome.recoveryCodes)}
          <p><a class="btn" href="/app/">Ik heb de codes bewaard, verder</a></p>
        </div>`,
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/tweestaps/herstelcodes/', auth.requireLogin, auth.checkCsrf, async (req, res, next) => {
    try {
      const failureKey = `beheren:${req.user.id}`;
      if (!manageFailures.hit(failureKey)) return res.status(429).send(await renderOverview(req, { errors: { recovery: CODE_LOCKED } }));
      if (!(await twoFactor.verifyAppCode(req.user.id, req.body.code))) {
        return res.status(422).send(await renderOverview(req, { errors: { recovery: 'De code klopt niet. Gebruik de nieuwste code uit de app.' } }));
      }
      manageFailures.clear(failureKey);
      const codes = await db.transaction(async (client) => {
        const created = await twoFactor.renewRecovery(req.user.id, client);
        await auth.audit(req, { userId: req.user.id, action: 'tweestaps.herstelcodes', entity: 'users', entityId: req.user.id }, client);
        return created;
      });
      return res.send(page(accountOf(req), 'Nieuwe herstelcodes', html`<div class="crm-narrow">
        ${renderRecoveryCodes(codes)}
        <p><a class="btn" href="/app/tweestaps/">Ik heb de codes bewaard</a></p>
      </div>`));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/tweestaps/uitzetten/', auth.requireLogin, auth.checkCsrf, async (req, res, next) => {
    try {
      if (auth.mfaRequiredFor(req.user.role)) {
        return res.status(403).send(await renderOverview(req, { errors: { disable: 'Voor jouw account is tweestapsverificatie verplicht.' } }));
      }
      const failureKey = `beheren:${req.user.id}`;
      if (!manageFailures.hit(failureKey)) return res.status(429).send(await renderOverview(req, { errors: { disable: CODE_LOCKED } }));
      const [user] = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
      const passwordOk = Boolean(user) && await verifyPassword(req.body.password, user.password_hash);
      const codeOk = passwordOk && (await twoFactor.check(req.user.id, req.body.code)).ok;
      if (!codeOk) {
        return res.status(422).send(await renderOverview(req, { errors: { disable: 'Wachtwoord of code klopt niet.' } }));
      }
      manageFailures.clear(failureKey);
      await db.transaction(async (client) => {
        await twoFactor.disable(req.user.id, client);
        // Net als bij aanzetten en bij de beheerder: andere sessies vervallen, de huidige blijft.
        await auth.endSessionsOf(req.user.id, req.session.tokenHash, client);
        await auth.audit(req, { userId: req.user.id, action: 'tweestaps.uit', entity: 'users', entityId: req.user.id }, client);
      });
      return res.redirect(303, '/app/tweestaps/?uit=1');
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createTwoFactor, createTwoFactorRoutes, generateActivationCode, normalizeActivation, ISSUER, MAX_FAILED_CODES, CODE_LOCK_MINUTES, ACTIVATION_DAYS, SETUP_ACTIVATION_DAYS };
