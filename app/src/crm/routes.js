/**
 * Router van het CRM onder `/app/`: inloggen, uitloggen, eerste beheerder (installatiecode), overzicht en het eigen
 * wachtwoord wijzigen. Gebruikersbeheer en auditlog staan in `crm/users.js`.
 * Alles onder `/app/` krijgt `Cache-Control: no-store` en `noindex`.
 */
const crypto = require('node:crypto');
const express = require('express');
const { html } = require('../site/html');
const { clientKey, createRateLimiter } = require('../security/rate-limit');
const { isCrossSite } = require('../security/form-guard');
const { createAuth } = require('./auth');
const { RIGHTS, ROLES, roleHasRight, roleLabel } = require('./rights');
const { hashPassword, verifyPassword, needsRehash, passwordProblem, getDummyHash, MAX_LENGTH } = require('./passwords');
const { renderCrmPage, renderInput, renderAlert } = require('./layout');
const { createUserRoutes } = require('./users');

/** Na zoveel mislukte pogingen wordt een account tijdelijk geblokkeerd, zoveel minuten lang. */
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

/** Melding bij een mislukte login; verraadt niet of het account bestaat of geblokkeerd is. */
const LOGIN_FAILED = `E-mailadres of wachtwoord klopt niet. Na ${MAX_FAILED_LOGINS} mislukte pogingen is een account ${LOCK_MINUTES} minuten geblokkeerd.`;

/** Tekens voor de installatiecode (zonder 0/O en 1/I, die lijken op elkaar). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Maakt een willekeurige installatiecode van 20 tekens in groepjes van 5 (ongeveer 100 bits).
 * @returns {string} Code, bijv. `ABCDE-FGHJK-LMNPQ-RSTUV`.
 */
function generateSetupCode() {
  const bytes = crypto.randomBytes(20);
  const characters = Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
  return characters.match(/.{5}/g).join('-');
}

/**
 * Normaliseert een ingevoerde installatiecode: hoofdletters, zonder spaties en streepjes.
 * @param {*} value Invoer.
 * @returns {string} Genormaliseerde code.
 */
function normalizeSetupCode(value) {
  return String(value || '').toUpperCase().replace(/[\s-]/g, '').slice(0, 64);
}

/**
 * Normaliseert een e-mailadres (spaties weg, kleine letters) en controleert het.
 * @param {*} value Invoer.
 * @returns {string} E-mailadres, of leeg als het ongeldig is.
 */
function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return email.length <= 200 && /^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(email) ? email : '';
}

/**
 * Leest een tekstveld uit het formulier: ingekort en zonder witruimte aan de randen.
 * @param {*} value Invoer.
 * @param {number} max Maximale lengte.
 * @returns {string} Tekst.
 */
function textField(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * Bouwt de CRM-router.
 * @param {{db: object, masterKey: Buffer, setupCode?: string, secureCookies?: boolean, now?: () => number}} options
 *   Database, hoofdsleutel, de installatiecode voor de eerste beheerder (zonder code geen installatie), of de cookie
 *   `Secure` krijgt en (voor tests) de klok van de limieten.
 * @returns {express.Router} Router, te koppelen op `/app`.
 */
function createCrmRouter(options) {
  const { db } = options;
  const auth = createAuth(options);
  const router = express.Router();
  const setupCodeHash = options.setupCode ? crypto.createHash('sha256').update(normalizeSetupCode(options.setupCode)).digest() : null;
  const loginLimiter = createRateLimiter({ limit: 10, windowMs: 15 * 60 * 1000, now: options.now });
  const setupLimiter = createRateLimiter({ limit: 5, windowMs: 15 * 60 * 1000, now: options.now });
  const passwordLimiter = createRateLimiter({ limit: 5, windowMs: 15 * 60 * 1000, now: options.now });

  router.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    next();
  });
  router.use(express.urlencoded({ extended: false, limit: '16kb', parameterLimit: 20 }));
  router.use(auth.loadSession);

  /**
   * Weigert een POST zonder sessie van een andere site (inloggen, installatie).
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @param {Function} next Volgende stap.
   * @returns {void}
   */
  const sameSiteOnly = (req, res, next) => (isCrossSite(req) ? res.status(403).type('text').send('Verzoek geweigerd.') : next());

  /**
   * Middleware-fabriek: limiet per bezoeker (of per gebruiker als er een sessie is).
   * @param {{hit: Function}} limiter De limiet.
   * @returns {Function} Express-middleware.
   */
  const limit = (limiter) => (req, res, next) => (limiter.hit(req.user ? `gebruiker:${req.user.id}` : clientKey(req))
    ? next()
    : res.status(429).set('Retry-After', '900').type('text').send('Te veel pogingen. Probeer het over een kwartier opnieuw.'));

  /**
   * Of er al gebruikers zijn (dan is de installatie afgerond).
   * @returns {Promise<boolean>} Waar als er minstens één gebruiker is.
   */
  const hasUsers = async () => (await db.query('SELECT EXISTS (SELECT 1 FROM users) AS present'))[0].present;

  /**
   * Het inlogscherm.
   * @param {{email?: string, error?: string, setupOpen?: boolean}} state Ingevuld e-mailadres, melding en of de installatie nog open staat.
   * @returns {string} HTML-pagina.
   */
  const renderLogin = (state = {}) => renderCrmPage({
    title: 'Inloggen',
    body: html`<div class="crm-narrow">
      ${state.setupOpen ? html`<p class="notice">Er is nog geen gebruiker. Maak eerst de <a href="/app/installatie/">eerste beheerder</a> aan met de installatiecode uit het serverlog.</p>` : ''}
      ${renderAlert(state.error)}
      <form class="form" method="post" action="/app/inloggen/">
        ${renderInput({ name: 'email', label: 'E-mailadres', type: 'email', value: state.email, autocomplete: 'username', max: 200 })}
        ${renderInput({ name: 'password', label: 'Wachtwoord', type: 'password', autocomplete: 'current-password', max: MAX_LENGTH })}
        <div><button class="btn" type="submit">Inloggen</button></div>
      </form>
    </div>`,
  });

  router.get('/inloggen/', async (req, res, next) => {
    try {
      if (req.user) return res.redirect(303, '/app/');
      return res.send(renderLogin({ setupOpen: Boolean(setupCodeHash) && !(await hasUsers()) }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/inloggen/', sameSiteOnly, limit(loginLimiter), async (req, res, next) => {
    try {
      const email = normalizeEmail(req.body.email);
      const password = typeof req.body.password === 'string' ? req.body.password : '';
      const [user] = email
        ? await db.query('SELECT id, password_hash, active, (locked_until IS NOT NULL AND locked_until > now()) AS locked FROM users WHERE lower(email) = $1', [email])
        : [];
      // Ook bij een onbekend adres een volledige controle, zodat de responstijd niets verraadt.
      const passwordOk = await verifyPassword(password, user ? user.password_hash : await getDummyHash());
      if (!user || !user.active || user.locked || !passwordOk) {
        let action = 'inloggen.mislukt';
        if (user && !user.active) action = 'inloggen.inactief';
        else if (user && user.locked) action = 'inloggen.geblokkeerd';
        if (user && user.active && !user.locked) {
          await db.query(
            `UPDATE users SET
               locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END,
               failed_logins = CASE WHEN failed_logins + 1 >= $2 THEN 0 ELSE failed_logins + 1 END
             WHERE id = $1`,
            [user.id, MAX_FAILED_LOGINS, LOCK_MINUTES],
          );
        }
        await auth.audit(req, { userId: user ? user.id : null, action, entity: 'users', entityId: user ? user.id : undefined });
        return res.status(401).send(renderLogin({ email: textField(req.body.email, 200), error: LOGIN_FAILED }));
      }
      const newHash = needsRehash(user.password_hash) ? await hashPassword(password) : null;
      await db.transaction(async (client) => {
        await client.query(
          'UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now(), password_hash = COALESCE($2, password_hash) WHERE id = $1',
          [user.id, newHash],
        );
        await auth.startSession(res, user.id, client);
        await auth.audit(req, { userId: user.id, action: 'inloggen', entity: 'users', entityId: user.id }, client);
      });
      return res.redirect(303, '/app/');
    } catch (error) {
      return next(error);
    }
  });

  router.post('/uitloggen/', auth.requireLogin, auth.checkCsrf, async (req, res, next) => {
    try {
      await auth.audit(req, { userId: req.user.id, action: 'uitloggen', entity: 'users', entityId: req.user.id });
      await auth.endSession(req, res);
      return res.redirect(303, '/app/inloggen/');
    } catch (error) {
      return next(error);
    }
  });

  /**
   * Het installatiescherm voor de eerste beheerder.
   * @param {{values?: object, errors?: object}} state Ingevulde waarden en fouten per veld.
   * @returns {string} HTML-pagina.
   */
  const renderSetup = (state = {}) => {
    const values = state.values || {};
    const errors = state.errors || {};
    return renderCrmPage({
      title: 'Eerste beheerder',
      body: html`<div class="crm-narrow">
        <p>Vul de installatiecode in die bij het starten in het serverlog staat, en maak het account van de eerste beheerder aan.</p>
        ${renderAlert(errors._form)}
        <form class="form" method="post" action="/app/installatie/">
          ${renderInput({ name: 'code', label: 'Installatiecode', value: values.code, error: errors.code, autocomplete: 'off', max: 64 })}
          ${renderInput({ name: 'name', label: 'Naam', value: values.name, error: errors.name, autocomplete: 'name', max: 100 })}
          ${renderInput({ name: 'email', label: 'E-mailadres', type: 'email', value: values.email, error: errors.email, autocomplete: 'username', max: 200 })}
          ${renderInput({ name: 'password', label: 'Wachtwoord (minimaal 12 tekens)', type: 'password', error: errors.password, autocomplete: 'new-password', max: MAX_LENGTH })}
          ${renderInput({ name: 'password2', label: 'Wachtwoord herhalen', type: 'password', error: errors.password2, autocomplete: 'new-password', max: MAX_LENGTH })}
          <div><button class="btn" type="submit">Beheerder aanmaken</button></div>
        </form>
      </div>`,
    });
  };

  /**
   * Antwoord als de installatie niet (meer) beschikbaar is.
   * @param {object} res Express-antwoord.
   * @returns {void}
   */
  const setupClosed = (res) => res.status(404).send(renderCrmPage({ title: 'Niet gevonden', body: html`<p>Deze pagina bestaat niet. <a href="/app/inloggen/">Inloggen</a></p>` }));

  router.get('/installatie/', async (req, res, next) => {
    try {
      if (!setupCodeHash || await hasUsers()) return setupClosed(res);
      return res.send(renderSetup());
    } catch (error) {
      return next(error);
    }
  });

  router.post('/installatie/', sameSiteOnly, limit(setupLimiter), async (req, res, next) => {
    try {
      if (!setupCodeHash || await hasUsers()) return setupClosed(res);
      const values = { code: textField(req.body.code, 64), name: textField(req.body.name, 100), email: textField(req.body.email, 200) };
      const errors = {};
      const givenHash = crypto.createHash('sha256').update(normalizeSetupCode(req.body.code)).digest();
      if (!crypto.timingSafeEqual(givenHash, setupCodeHash)) errors.code = 'Deze installatiecode klopt niet.';
      if (!values.name) errors.name = 'Vul een naam in.';
      const email = normalizeEmail(req.body.email);
      if (!email) errors.email = 'Vul een geldig e-mailadres in.';
      const problem = passwordProblem(req.body.password, { email });
      if (problem) errors.password = problem;
      else if (req.body.password !== req.body.password2) errors.password2 = 'De wachtwoorden zijn niet gelijk.';
      if (Object.keys(errors).length) {
        await auth.audit(req, { action: errors.code ? 'installatie.mislukt' : 'installatie.ongeldig' });
        return res.status(422).send(renderSetup({ values, errors }));
      }
      const passwordHash = await hashPassword(req.body.password);
      const created = await db.transaction(async (client) => {
        // Slot tegen twee gelijktijdige installaties: binnen de transactie opnieuw controleren dat er niemand is.
        await client.query('SELECT pg_advisory_xact_lock(727002)');
        const [existing] = await client.query('SELECT EXISTS (SELECT 1 FROM users) AS present');
        if (existing.present) return null;
        const [user] = await client.query(
          "INSERT INTO users (email, name, role, password_hash, last_login_at) VALUES ($1, $2, 'beheerder', $3, now()) RETURNING id",
          [email, values.name, passwordHash],
        );
        await auth.audit(req, { userId: user.id, action: 'installatie', entity: 'users', entityId: user.id }, client);
        await auth.startSession(res, user.id, client);
        return user;
      });
      if (!created) return setupClosed(res);
      return res.redirect(303, '/app/');
    } catch (error) {
      return next(error);
    }
  });

  router.get('/', auth.requireLogin, (req, res) => {
    const rights = ROLES[req.user.role] ? ROLES[req.user.role].rights : [];
    res.send(renderCrmPage({
      title: 'Overzicht',
      user: req.user,
      csrf: req.session.csrf,
      path: '/app/',
      body: html`<p>Welkom, ${req.user.name}. Je bent ingelogd als <strong>${roleLabel(req.user.role)}</strong>.</p>
        <p>Het CRM wordt in stappen gebouwd. De modules voor aanmeldingen, deelnemers en reizen volgen.</p>
        ${roleHasRight(req.user.role, 'gebruikers') ? html`<p><a class="btn" href="/app/gebruikers/">Gebruikers beheren</a></p>` : ''}
        <h2>Jouw rechten</h2>
        <ul class="crm-rights">${rights.map((right) => html`<li>${RIGHTS[right]}</li>`)}</ul>`,
    }));
  });

  /**
   * Het scherm om het eigen wachtwoord te wijzigen.
   * @param {object} req Express-verzoek.
   * @param {{errors?: object, done?: boolean}} state Fouten per veld en of het gelukt is.
   * @returns {string} HTML-pagina.
   */
  const renderPasswordPage = (req, state = {}) => {
    const errors = state.errors || {};
    return renderCrmPage({
      title: 'Wachtwoord wijzigen',
      user: req.user,
      csrf: req.session.csrf,
      body: html`<div class="crm-narrow">
        ${state.done ? html`<p class="notice" role="status">Je wachtwoord is gewijzigd. Andere sessies zijn uitgelogd.</p>` : ''}
        ${renderAlert(errors._form)}
        <form class="form" method="post" action="/app/wachtwoord/">
          <input type="hidden" name="_csrf" value="${req.session.csrf}">
          <input type="hidden" name="username" value="${req.user.email}" autocomplete="username">
          ${renderInput({ name: 'current', label: 'Huidig wachtwoord', type: 'password', error: errors.current, autocomplete: 'current-password', max: MAX_LENGTH })}
          ${renderInput({ name: 'password', label: 'Nieuw wachtwoord (minimaal 12 tekens)', type: 'password', error: errors.password, autocomplete: 'new-password', max: MAX_LENGTH })}
          ${renderInput({ name: 'password2', label: 'Nieuw wachtwoord herhalen', type: 'password', error: errors.password2, autocomplete: 'new-password', max: MAX_LENGTH })}
          <div><button class="btn" type="submit">Wachtwoord opslaan</button></div>
        </form>
      </div>`,
    });
  };

  router.get('/wachtwoord/', auth.requireLogin, (req, res) => {
    res.send(renderPasswordPage(req, { done: req.query.gewijzigd === '1' }));
  });

  router.post('/wachtwoord/', auth.requireLogin, auth.checkCsrf, limit(passwordLimiter), async (req, res, next) => {
    try {
      const errors = {};
      const [user] = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
      if (!user || !(await verifyPassword(req.body.current, user.password_hash))) errors.current = 'Je huidige wachtwoord klopt niet.';
      const problem = passwordProblem(req.body.password, { email: req.user.email });
      if (problem) errors.password = problem;
      else if (req.body.password !== req.body.password2) errors.password2 = 'De wachtwoorden zijn niet gelijk.';
      if (Object.keys(errors).length) return res.status(422).send(renderPasswordPage(req, { errors }));
      const passwordHash = await hashPassword(req.body.password);
      await db.transaction(async (client) => {
        await client.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [req.user.id, passwordHash]);
        await auth.endSessionsOf(req.user.id, req.session.tokenHash, client);
        await auth.audit(req, { userId: req.user.id, action: 'wachtwoord.gewijzigd', entity: 'users', entityId: req.user.id }, client);
      });
      return res.redirect(303, '/app/wachtwoord/?gewijzigd=1');
    } catch (error) {
      return next(error);
    }
  });

  router.use(createUserRoutes({ db, auth, normalizeEmail, textField }));

  router.use((req, res) => {
    res.status(404).send(renderCrmPage({
      title: 'Niet gevonden',
      user: req.user,
      csrf: req.session ? req.session.csrf : '',
      body: html`<p>Deze pagina bestaat niet. Ga naar het <a href="/app/">overzicht</a>.</p>`,
    }));
  });

  return router;
}

module.exports = { createCrmRouter, generateSetupCode, normalizeSetupCode, normalizeEmail, MAX_FAILED_LOGINS, LOCK_MINUTES };
