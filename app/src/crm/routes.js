/**
 * Router van het CRM onder `/app/`: inloggen, uitloggen, eerste beheerder (installatiecode), overzicht en het eigen
 * wachtwoord wijzigen. Gebruikersbeheer en auditlog staan in `crm/users.js`, de deelnemers in `crm/person-routes.js`, de tweestapsverificatie (codestap na het
 * wachtwoord en het eigen 2FA-scherm) in `crm/two-factor.js`.
 * Alles onder `/app/` krijgt `Cache-Control: no-store` en `noindex`.
 */
const crypto = require('node:crypto');
const express = require('express');
const { html } = require('../site/html');
const { clientKey, createRateLimiter } = require('../security/rate-limit');
const { isCrossSite } = require('../security/form-guard');
const { createAuth, ipPrefix } = require('./auth');
const { RIGHTS, ROLES, roleHasRight, roleHasGlobalRight, roleLabel } = require('./rights');
const { hashPassword, verifyPassword, needsRehash, passwordProblem, getDummyHash, MAX_LENGTH } = require('./passwords');
const { renderCrmPage, renderInput, renderAlert } = require('./layout');
const { createUserRoutes } = require('./users');
const { createPersonRoutes } = require('./person-routes');
const { createPersonMergeRoutes } = require('./person-merge-routes');
const { createBookingRoutes } = require('./booking-routes');
const { createMediaRoutes } = require('../media/routes');
const { createCategoryRoutes } = require('../trips/category-routes');
const { createTripRoutes } = require('../trips/trip-routes');
const { createPageRoutes } = require('../cms/page-routes');
const { createMenuRoutes } = require('../cms/menu-routes');
const { createPostRoutes } = require('../cms/post-routes');
const { createPostTermRoutes } = require('../cms/post-term-routes');
const { createFaqRoutes } = require('../cms/faq-routes');
const { createGuideRoutes } = require('../trips/guide-routes');
const { createPersons } = require('./persons');
const { createTwoFactor, createTwoFactorRoutes, SETUP_ACTIVATION_DAYS } = require('./two-factor');
const { createVault } = require('../security/vault');
const { createBeheerRoutes } = require('../beheer/routes');

/**
 * Hoogstens zoveel mislukte pogingen op één account vanuit één IP-reeks (/24 of /48) per venster van zoveel minuten
 * (het venster begint bij de eerste mislukte poging); daarna is die combinatie dicht tot het venster om is. Bewust niet het hele account: dan zou een aanvaller die het e-mailadres kent de beheerder kunnen
 * buitensluiten. Vanaf een ander netwerk (of na het kwartier) kan de echte gebruiker gewoon inloggen.
 */
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

/**
 * Teller per account tegen gedistribueerd raden: elke IP-reeks telt per uur hoogstens één keer mee (bij haar eerste
 * poging). Zijn er binnen een uur pogingen vanuit zoveel verschillende reeksen, dan is het account tot het einde van
 * dat uur dicht. Buitensluiten vraagt dus echt 30 verschillende netwerken per uur; één netwerk kan het nooit.
 */
const MAX_FAILED_LOGINS_PER_ACCOUNT = 30;
const ACCOUNT_WINDOW_MINUTES = 60;

/** Melding bij een mislukte login; verraadt niet of het account bestaat of geblokkeerd is. */
const LOGIN_FAILED = `E-mailadres of wachtwoord klopt niet. Na ${MAX_FAILED_LOGINS} mislukte pogingen binnen ${LOCK_MINUTES} minuten moet je even wachten.`;

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
 * @param {{db: object, masterKey: Buffer, settings: object, mailer?: object, wanIp?: object, captcha?: object, backups?: object, drive?: object, restoreTests?: object, systemUpdate?: object, hostTasks?: object, appLog?: object, monitor?: object, setupCode?: string, secureCookies?: boolean, now?: () => number}} options
 *   Database, hoofdsleutel, de instellingen (`beheer/settings.js`), de mailer en WAN-IP-opzoeker (`mail/`), de captcha, de installatiecode voor de eerste beheerder (zonder code geen installatie), of de cookie
 *   `Secure` krijgt en (voor tests) de klok van de limieten.
 * @returns {express.Router} Router, te koppelen op `/app`.
 */
function createCrmRouter(options) {
  const { db } = options;
  const auth = createAuth(options);
  const vault = createVault(options.masterKey);
  const twoFactor = createTwoFactor({ db, vault, now: options.now });
  const persons = createPersons({ vault });
  const router = express.Router();
  const setupCodeHash = options.setupCode ? crypto.createHash('sha256').update(normalizeSetupCode(options.setupCode)).digest() : null;
  const loginLimiter = createRateLimiter({ limit: 10, windowMs: 15 * 60 * 1000, now: options.now });
  const setupLimiter = createRateLimiter({ limit: 5, windowMs: 15 * 60 * 1000, now: options.now });
  const passwordLimiter = createRateLimiter({ limit: 5, windowMs: 15 * 60 * 1000, now: options.now });
  const failedLoginLimiter = createRateLimiter({ limit: MAX_FAILED_LOGINS, windowMs: LOCK_MINUTES * 60 * 1000, now: options.now });
  const accountRangeLimiter = createRateLimiter({ limit: 1, windowMs: ACCOUNT_WINDOW_MINUTES * 60 * 1000, now: options.now });
  const accountFailureLimiter = createRateLimiter({ limit: MAX_FAILED_LOGINS_PER_ACCOUNT, windowMs: ACCOUNT_WINDOW_MINUTES * 60 * 1000, now: options.now });
  // Algemene limiet op alles onder /app/ (ook de sessiecontrole kost een databasevraag per verzoek).
  const generalLimiter = createRateLimiter({ limit: 300, windowMs: 60 * 1000, now: options.now });

  router.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    if (!generalLimiter.hit(clientKey(req))) {
      return res.status(429).set('Retry-After', '60').type('text').send('Te veel verzoeken. Probeer het over een minuut opnieuw.');
    }
    return next();
  });
  // Beheer heeft formulieren met meer en langere velden (bijv. robots.txt-regels); de rest blijft klein.
  const smallForms = express.urlencoded({ extended: false, limit: '16kb', parameterLimit: 20 });
  const beheerForms = express.urlencoded({ extended: false, limit: '64kb', parameterLimit: 100 });
  // De fotobibliotheek heeft een keuzelijst met alle landen (één veld per gekozen land).
  const mediaForms = express.urlencoded({ extended: false, limit: '64kb', parameterLimit: 400 });
  // Pagina's, blogberichten, FAQ-antwoorden en reisleiders: een tekstblok mag lang zijn (100.000 tekens opgemaakte tekst); velden per blok blijven beperkt.
  const pageForms = express.urlencoded({ extended: false, limit: '512kb', parameterLimit: 100 });
  // Blog: als pagina's, plus een vinkje per categorie en tag (hoogstens 2 × 200).
  const blogForms = express.urlencoded({ extended: false, limit: '512kb', parameterLimit: 450 });
  router.use((req, res, next) => {
    if (req.path.startsWith('/beheer/')) return beheerForms(req, res, next);
    if (req.path.startsWith('/paginas/') || req.path.startsWith('/faq/') || req.path.startsWith('/reisleiders/')) return pageForms(req, res, next);
    if (req.path.startsWith('/blog/')) return blogForms(req, res, next);
    if (req.path.startsWith('/fotobibliotheek/')) return mediaForms(req, res, next);
    return smallForms(req, res, next);
  });
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
      if (req.pending) return res.redirect(303, auth.pendingPath(req));
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
        ? await db.query('SELECT id, role, password_hash, active, (totp_enabled_at IS NOT NULL) AS mfa_enabled FROM users WHERE lower(email) = $1', [email])
        : [];
      const failureKey = `${user ? user.id : 'onbekend'}:${ipPrefix(req)}`;
      const accountKey = user ? `account:${user.id}` : '';
      // Tel de poging vóór de (trage) wachtwoordcontrole, zodat gelijktijdige verzoeken de limiet niet kunnen omzeilen.
      // Bij een geslaagde login worden de tellers weer gewist.
      let blocked = false;
      if (user) {
        const pairAllowed = failedLoginLimiter.hit(failureKey);
        const newRange = accountRangeLimiter.hit(failureKey);
        const accountAllowed = newRange ? accountFailureLimiter.hit(accountKey) : !accountFailureLimiter.isBlocked(accountKey);
        blocked = !pairAllowed || !accountAllowed;
      }
      // Ook bij een onbekend adres een volledige controle, zodat de responstijd niets verraadt.
      const passwordOk = await verifyPassword(password, user ? user.password_hash : await getDummyHash());
      if (!user || !user.active || blocked || !passwordOk) {
        let action = 'inloggen.mislukt';
        if (user && !user.active) action = 'inloggen.inactief';
        else if (blocked) action = 'inloggen.geblokkeerd';
        await auth.audit(req, { userId: user ? user.id : null, action, entity: 'users', entityId: user ? user.id : undefined });
        return res.status(401).send(renderLogin({ email: textField(req.body.email, 200), error: LOGIN_FAILED }));
      }
      failedLoginLimiter.clear(failureKey);
      accountFailureLimiter.clear(accountKey);
      const newHash = needsRehash(user.password_hash) ? await hashPassword(password) : null;
      // Tweede stap nodig (2FA staat aan, of is verplicht maar nog niet ingesteld): eerst een halve sessie, waarmee
      // alleen de codestap of het instellen bereikbaar is. Een geraden wachtwoord alleen geeft zo geen toegang.
      if (user.mfa_enabled || auth.mfaRequiredFor(user.role)) {
        await db.transaction(async (client) => {
          if (newHash) await client.query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, newHash]);
          await auth.startSession(res, user.id, client, { mfaOk: false });
          await auth.audit(req, { userId: user.id, action: 'inloggen.wachtwoord', entity: 'users', entityId: user.id }, client);
        });
        return res.redirect(303, user.mfa_enabled ? '/app/inloggen/code/' : '/app/tweestaps/');
      }
      await db.transaction(async (client) => {
        await client.query(
          'UPDATE users SET last_login_at = now(), password_hash = COALESCE($2, password_hash) WHERE id = $1',
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

  // Uitloggen kan ook met een halve sessie (annuleren bij de codestap of het instellen van 2FA).
  router.post('/uitloggen/', (req, res, next) => (req.pending ? next() : auth.requireLogin(req, res, next)), auth.checkCsrf, async (req, res, next) => {
    try {
      const userId = (req.user || req.pending).id;
      await auth.audit(req, { userId, action: 'uitloggen', entity: 'users', entityId: userId });
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
        // De installatiecode is ook de activatiecode voor de 2FA van de eerste beheerder (er is nog geen andere beheerder).
        await twoFactor.issueActivation(user.id, client, { code: options.setupCode, days: SETUP_ACTIVATION_DAYS });
        await auth.startSession(res, user.id, client);
        return user;
      });
      if (!created) return setupClosed(res);
      return res.redirect(303, '/app/');
    } catch (error) {
      return next(error);
    }
  });

  router.get('/', auth.requireLogin, async (req, res, next) => {
    try {
      const rights = ROLES[req.user.role] ? ROLES[req.user.role].rights : [];
      const mfa = await twoFactor.stateOf(req.user.id);
      return res.send(renderCrmPage({
        title: 'Overzicht',
        user: req.user,
        csrf: req.session.csrf,
        path: '/app/',
        body: html`<p>Welkom, ${req.user.name}. Je bent ingelogd als <strong>${roleLabel(req.user.role)}</strong>.</p>
          <p>Het CRM wordt in stappen gebouwd. Reizen, betalingen en deelnemerslijsten volgen.</p>
          ${roleHasGlobalRight(req.user.role, 'aanmeldingen') ? html`<p><a class="btn" href="/app/aanmeldingen/">Aanmeldingen</a></p>` : ''}
          ${roleHasGlobalRight(req.user.role, 'deelnemers') ? html`<p><a class="btn" href="/app/deelnemers/">Deelnemers</a></p>` : ''}
          ${mfa.enabled ? '' : html`<p class="notice">Tweestapsverificatie staat nog uit voor je account${auth.mfaRequiredFor(req.user.role) ? ' en is verplicht vanaf de volgende keer dat je inlogt' : ''}. <a href="/app/tweestaps/">Nu instellen</a></p>`}
          ${roleHasRight(req.user.role, 'gebruikers') ? html`<p><a class="btn" href="/app/gebruikers/">Gebruikers beheren</a></p>` : ''}
          ${roleHasRight(req.user.role, 'systeem') ? html`<p><a class="btn btn--outline" href="/app/beheer/">Naar Beheer</a></p>` : ''}
          <h2>Jouw account</h2>
          <ul><li><a href="/app/wachtwoord/">Wachtwoord wijzigen</a></li><li><a href="/app/tweestaps/">Tweestapsverificatie</a> (${mfa.enabled ? 'aan' : 'uit'})</li></ul>
          <h2>Jouw rechten</h2>
          <ul class="crm-rights">${rights.map((right) => html`<li>${RIGHTS[right]}</li>`)}</ul>`,
      }));
    } catch (error) {
      return next(error);
    }
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
      path: '/app/wachtwoord/',
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

  router.use(createTwoFactorRoutes({ db, auth, twoFactor, now: options.now }));
  router.use(createUserRoutes({ db, auth, twoFactor, normalizeEmail, textField }));
  router.use(createPersonRoutes({ db, auth, persons }));
  router.use(createPersonMergeRoutes({ db, auth, persons }));
  router.use(createBookingRoutes({ db, auth }));
  router.use(createMediaRoutes({ db, auth, library: options.mediaLibrary, limits: options.mediaLimits, now: options.now }));
  router.use(createTripRoutes({ db, auth, redirects: options.redirects, library: options.mediaLibrary }));
  router.use(createCategoryRoutes({ db, auth, redirects: options.redirects, library: options.mediaLibrary }));
  router.use(createGuideRoutes({ db, auth, redirects: options.redirects, library: options.mediaLibrary, siteContent: options.siteContent }));
  router.use(createPageRoutes({ db, auth, library: options.mediaLibrary, redirects: options.redirects, menus: options.menus, homepage: options.homepage, siteContent: options.siteContent }));
  router.use(createMenuRoutes({ db, auth, menus: options.menus }));
  router.use(createFaqRoutes({ db, auth }));
  router.use(createPostTermRoutes({ db, auth, redirects: options.redirects, siteContent: options.siteContent }));
  router.use(createPostRoutes({ db, auth, library: options.mediaLibrary, redirects: options.redirects, menus: options.menus, siteContent: options.siteContent }));
  router.use(createBeheerRoutes({ db, auth, settings: options.settings, redirects: options.redirects, mailer: options.mailer, wanIp: options.wanIp, captcha: options.captcha, backups: options.backups, drive: options.drive, restoreTests: options.restoreTests, systemUpdate: options.systemUpdate, hostTasks: options.hostTasks, appLog: options.appLog, monitor: options.monitor, now: options.now }));

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

module.exports = { createCrmRouter, generateSetupCode, normalizeSetupCode, normalizeEmail, MAX_FAILED_LOGINS, LOCK_MINUTES, MAX_FAILED_LOGINS_PER_ACCOUNT };
