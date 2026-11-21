/**
 * Reizigersaccount onder `/account/` (CMS-pakket J2): registreren, bevestigen, inloggen, uitloggen, wachtwoord vergeten
 * en herstellen, en het overzicht. Los van het CRM: eigen tabellen (`account/accounts.js`), eigen cookie met pad
 * `/account` en eigen CSRF-sleutel.
 *
 * Beveiliging (zoals het CRM, `crm/routes.js`):
 * - Wachtwoorden met scrypt, minimaal 12 tekens (`crm/passwords.js`); bij een onbekend adres toch een volledige
 *   controle, zodat de responstijd niets verraadt. Meldingen verraden nooit of een adres een account heeft.
 * - Inloggen: limiet per bezoeker, per account + IP-reeks (5 per kwartier) en per account over 30 IP-reeksen per uur.
 * - Bevestigen vraagt de link uit de mail én het wachtwoord: wie andermans adres registreert, kan het account nooit
 *   overnemen, en wie de mail onderschept zonder wachtwoord ook niet.
 * - Registreren en wachtwoord vergeten zijn openbare formulieren: herkomst, limiet, honeypot, ondertekend tijdstempel
 *   en de captcha (`security/form-guard.js`, `security/captcha.js`). Per account hoogstens drie mails per soort per uur.
 * - Links bevatten een eenmalig token (alleen de hash in de database); de pagina's sturen geen `Referer` mee.
 * - Alles in het auditlog (`customer_accounts`, zonder e-mailadres of andere gegevens).
 */
const crypto = require('node:crypto');
const express = require('express');
const { renderPage, renderPageHeader } = require('../site/layout');
const { clientKey, createRateLimiter } = require('../security/rate-limit');
const { createFormGuard, isCrossSite } = require('../security/form-guard');
const { captchaField } = require('../security/captcha');
const { hashPassword, verifyPassword, needsRehash, passwordProblem, getDummyHash } = require('../crm/passwords');
const { readCookie, ipPrefix } = require('../crm/auth');
const { createAccounts, MAX_DAYS } = require('./accounts');
const { createAccountMails } = require('./mails');
const views = require('./views');

/** Naam en pad van de sessiecookie (los van de cookie van het CRM). */
const COOKIE_NAME = 'avanta_reiziger';
const COOKIE_PATH = '/account';

/** Limieten op mislukte pogingen, gelijk aan het CRM. */
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const MAX_FAILED_LOGINS_PER_ACCOUNT = 30;
const ACCOUNT_WINDOW_MINUTES = 60;

/** Melding bij een mislukte login; verraadt niet of het account bestaat. */
const LOGIN_FAILED = `E-mailadres of wachtwoord klopt niet. Na ${MAX_FAILED_LOGINS} mislukte pogingen binnen ${LOCK_MINUTES} minuten moet je even wachten.`;

/** Omschrijving van de acties in het auditlog van het CRM. */
const ACCOUNT_ACTION_LABELS = {
  'reiziger.geregistreerd': 'Reizigersaccount aangemaakt (nog niet bevestigd)',
  'reiziger.bevestigd': 'Reizigersaccount bevestigd',
  'reiziger.inloggen': 'Reiziger ingelogd',
  'reiziger.inloggen.mislukt': 'Reiziger: inloggen mislukt',
  'reiziger.inloggen.geblokkeerd': 'Reiziger: inloggen geweigerd (te veel pogingen)',
  'reiziger.inloggen.onbevestigd': 'Reiziger: inloggen geweigerd (account nog niet bevestigd)',
  'reiziger.bevestigen.mislukt': 'Reiziger: bevestigen mislukt (verkeerd wachtwoord)',
  'reiziger.uitloggen': 'Reiziger uitgelogd',
  'reiziger.herstel-aangevraagd': 'Reiziger: link voor nieuw wachtwoord aangevraagd',
  'reiziger.wachtwoord-hersteld': 'Reiziger: nieuw wachtwoord ingesteld via de link',
};

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
 * Leest een tekstveld voor het opnieuw tonen van een formulier: ingekort en zonder witruimte aan de randen.
 * @param {*} value Invoer.
 * @param {number} max Maximale lengte.
 * @returns {string} Tekst.
 */
function textField(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * Leest een wachtwoordveld (ongewijzigd, alleen als het tekst is).
 * @param {*} value Invoer.
 * @returns {string} Wachtwoord, of leeg.
 */
function passwordField(value) {
  return typeof value === 'string' ? value : '';
}

/**
 * Bouwt de router van het reizigersaccount.
 * @param {{db: object, masterKey: Buffer, formKey: Buffer, mailer: object, settings: object, captcha?: object, accounts?: object, secureCookies?: boolean, now?: () => number, overviewContent?: Function}} options
 *   Database, hoofdsleutel (CSRF-sleutel), sleutel voor het formuliertoken, mailer en instellingen (mails), captcha,
 *   de accountopslag (anders een nieuwe), of de cookie `Secure` krijgt, (voor tests) de klok van de limieten, en
 *   eventueel een functie die de inhoud van het overzicht levert (`({accountId, email}) => Promise<html>`).
 * @returns {express.Router} De router.
 */
function createAccountRouter(options) {
  const { db } = options;
  const router = express.Router({ strict: true });
  const accounts = options.accounts || createAccounts({ db });
  const mails = createAccountMails({ mailer: options.mailer, settings: options.settings });
  const csrfKey = crypto.createHmac('sha256', options.masterKey).update('account-csrf').digest();
  const secure = options.secureCookies !== false;
  const now = options.now;

  const loginLimiter = createRateLimiter({ limit: 10, windowMs: 15 * 60 * 1000, now });
  const linkLimiter = createRateLimiter({ limit: 10, windowMs: 15 * 60 * 1000, now });
  const failedLoginLimiter = createRateLimiter({ limit: MAX_FAILED_LOGINS, windowMs: LOCK_MINUTES * 60 * 1000, now });
  const accountRangeLimiter = createRateLimiter({ limit: 1, windowMs: ACCOUNT_WINDOW_MINUTES * 60 * 1000, now });
  const accountFailureLimiter = createRateLimiter({ limit: MAX_FAILED_LOGINS_PER_ACCOUNT, windowMs: ACCOUNT_WINDOW_MINUTES * 60 * 1000, now });
  const generalLimiter = createRateLimiter({ limit: 120, windowMs: 60 * 1000, now });
  const registerGuard = createFormGuard({
    purpose: 'account-registreren', formKey: options.formKey, limit: 5, windowMs: 60 * 60 * 1000,
    limitMessage: 'Te veel pogingen om een account aan te maken. Probeer het over een uur opnieuw.', now,
  });
  const forgotGuard = createFormGuard({
    purpose: 'account-wachtwoord', formKey: options.formKey, limit: 5, windowMs: 15 * 60 * 1000,
    limitMessage: 'Te veel aanvragen. Probeer het over een kwartier opnieuw.', now,
  });

  router.use('/account', (req, res, next) => {
    // Links met een token in de URL: nooit als Referer naar een andere site, nooit in een cache of zoekmachine.
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' });
    if (!generalLimiter.hit(clientKey(req))) return res.status(429).set('Retry-After', '60').type('text').send('Te veel verzoeken. Probeer het over een minuut opnieuw.');
    return next();
  });
  router.use('/account', express.urlencoded({ extended: false, limit: '8kb', parameterLimit: 12 }));

  /**
   * Middleware: zoekt de sessie bij de cookie en zet `req.customer` (`{accountId, email, tokenHash, stepUp, csrf}`) of null.
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @param {Function} next Volgende stap.
   * @returns {Promise<void>}
   */
  const loadCustomer = async (req, res, next) => {
    try {
      req.customer = null;
      const session = await accounts.loadSession(readCookie(req, COOKIE_NAME));
      if (session) req.customer = { ...session, csrf: crypto.createHmac('sha256', csrfKey).update(session.tokenHash).digest('base64url') };
      return next();
    } catch (error) {
      return next(error);
    }
  };
  router.use('/account', loadCustomer);

  /**
   * Zet of wist de sessiecookie.
   * @param {object} res Express-antwoord.
   * @param {string} token Token, of leeg om te wissen.
   * @param {number} maxAgeSeconds Levensduur.
   * @returns {void}
   */
  const setCookie = (res, token, maxAgeSeconds) => {
    res.append('Set-Cookie', `${COOKIE_NAME}=${token}; Path=${COOKIE_PATH}; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`);
  };

  /**
   * Start een sessie in een transactie en zet de cookie.
   * @param {object} res Express-antwoord.
   * @param {number} accountId Account.
   * @param {{query: Function}} client Transactie-client.
   * @returns {Promise<void>}
   */
  const startSession = async (res, accountId, client) => {
    const session = await accounts.startSession(accountId, client);
    setCookie(res, session.token, session.maxAgeSeconds);
  };

  /**
   * Schrijft een regel in het auditlog van het CRM (zonder medewerker, zonder e-mailadres).
   * @param {object} req Express-verzoek.
   * @param {string} action Actie (sleutel uit `ACCOUNT_ACTION_LABELS`).
   * @param {(number|null)} accountId Account, of null als het onbekend is.
   * @param {{query: Function}} [client] Database of transactie-client.
   * @returns {Promise<void>}
   */
  const audit = async (req, action, accountId, client = db) => {
    await client.query(
      'INSERT INTO audit_log (user_id, action, entity, entity_id, ip_prefix) VALUES (NULL, $1, $2, $3, $4)',
      [action, 'customer_accounts', accountId ? String(accountId) : null, ipPrefix(req)],
    );
  };

  /**
   * Stuurt een accountpagina (altijd noindex en zonder cache).
   * @param {object} res Express-antwoord.
   * @param {{title: string, body: object}} page Titel en inhoud.
   * @param {number} [status] HTTP-status.
   * @returns {void}
   */
  const send = (res, page, status = 200) => {
    res.status(status).type('html').send(renderPage({
      title: page.title, path: '/account/', site: res.locals.site, indexable: false,
      header: renderPageHeader({ title: page.title, pretitle: 'Mijn Avanta' }), body: page.body,
    }));
  };

  /**
   * Middleware-fabriek: limiet per bezoeker.
   * @param {{hit: Function}} limiter De limiet.
   * @returns {Function} Express-middleware.
   */
  const limit = (limiter) => (req, res, next) => (limiter.hit(clientKey(req))
    ? next()
    : res.status(429).set('Retry-After', '900').type('text').send('Te veel pogingen. Probeer het over een kwartier opnieuw.'));

  /**
   * Weigert een POST van een andere site.
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @param {Function} next Volgende stap.
   * @returns {void}
   */
  const sameSiteOnly = (req, res, next) => (isCrossSite(req) ? res.status(403).type('text').send('Verzoek geweigerd.') : next());

  /**
   * Controleert bij een POST van een ingelogde reiziger de herkomst en het CSRF-token (veld `_csrf`).
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @param {Function} next Volgende stap.
   * @returns {void}
   */
  const requireCustomer = (req, res, next) => {
    if (!req.customer) return res.status(401).type('text').send('Log opnieuw in.');
    const given = Buffer.from(String(req.body?._csrf || ''));
    const expected = Buffer.from(req.customer.csrf);
    if (isCrossSite(req) || given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
      return res.status(403).type('text').send('Verzoek geweigerd. Laad de pagina opnieuw en probeer het nog eens.');
    }
    return next();
  };

  /**
   * Telt een mislukte poging op een account (per IP-reeks en over alle reeksen), vóór de trage wachtwoordcontrole.
   * @param {object} req Express-verzoek.
   * @param {(number|null)} accountId Account, of null bij een onbekend adres.
   * @returns {{blocked: boolean, clear: Function}} Of het account (vanaf deze reeks) dicht is, en een functie die de
   *   tellers wist na een geslaagde poging.
   */
  const countAttempt = (req, accountId) => {
    if (!accountId) return { blocked: false, clear: () => {} };
    const pairKey = `reiziger:${accountId}:${ipPrefix(req)}`;
    const accountKey = `reiziger:${accountId}`;
    const pairAllowed = failedLoginLimiter.hit(pairKey);
    const newRange = accountRangeLimiter.hit(pairKey);
    const accountAllowed = newRange ? accountFailureLimiter.hit(accountKey) : !accountFailureLimiter.isBlocked(accountKey);
    return {
      blocked: !pairAllowed || !accountAllowed,
      clear: () => {
        failedLoginLimiter.clear(pairKey);
        accountFailureLimiter.clear(accountKey);
      },
    };
  };

  router.get('/account/', async (req, res, next) => {
    try {
      if (!req.customer) return res.redirect(303, '/account/inloggen/');
      let notice = '';
      if (req.query.welkom === '1') notice = 'Je account is bevestigd. Welkom!';
      else if (req.query.hersteld === '1') notice = 'Je nieuwe wachtwoord is opgeslagen.';
      const content = options.overviewContent ? await options.overviewContent(req.customer) : '';
      return send(res, { title: 'Mijn account', body: views.overviewView({ email: req.customer.email, csrf: req.customer.csrf, notice, content }) });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/account/inloggen/', (req, res) => {
    if (req.customer) return res.redirect(303, '/account/');
    return send(res, { title: 'Inloggen', body: views.loginView({ notice: req.query.uitgelogd === '1' ? 'Je bent uitgelogd.' : '' }) });
  });

  router.post('/account/inloggen/', sameSiteOnly, limit(loginLimiter), async (req, res, next) => {
    try {
      const email = normalizeEmail(req.body.email);
      const password = passwordField(req.body.password);
      const account = email ? await accounts.findByEmail(email) : null;
      const attempt = countAttempt(req, account ? account.id : null);
      // Ook bij een onbekend adres een volledige controle, zodat de responstijd niets verraadt.
      const passwordOk = await verifyPassword(password, account ? account.password_hash : await getDummyHash());
      if (!account || attempt.blocked || !passwordOk) {
        await audit(req, account && attempt.blocked ? 'reiziger.inloggen.geblokkeerd' : 'reiziger.inloggen.mislukt', account ? account.id : null);
        return send(res, { title: 'Inloggen', body: views.loginView({ email: textField(req.body.email, 200), error: LOGIN_FAILED }) }, 401);
      }
      attempt.clear();
      // Alleen met het juiste wachtwoord te zien, dus verraadt niets aan wie het wachtwoord niet kent.
      if (!account.verified) {
        await audit(req, 'reiziger.inloggen.onbevestigd', account.id);
        return send(res, { title: 'Inloggen', body: views.loginView({ email, error: 'Bevestig eerst je e-mailadres via de link in de mail. Geen mail (meer)? Maak het account opnieuw aan met hetzelfde adres; je krijgt dan een nieuwe link.' }) }, 403);
      }
      const newHash = needsRehash(account.password_hash) ? await hashPassword(password) : null;
      await db.transaction(async (client) => {
        if (newHash) await client.query('UPDATE customer_accounts SET password_hash = $2 WHERE id = $1', [account.id, newHash]);
        await startSession(res, account.id, client);
        await audit(req, 'reiziger.inloggen', account.id, client);
      });
      return res.redirect(303, '/account/');
    } catch (error) {
      return next(error);
    }
  });

  router.post('/account/uitloggen/', requireCustomer, async (req, res, next) => {
    try {
      await audit(req, 'reiziger.uitloggen', req.customer.accountId);
      await accounts.endSession(req.customer.tokenHash);
      setCookie(res, '', 0);
      return res.redirect(303, '/account/inloggen/?uitgelogd=1');
    } catch (error) {
      return next(error);
    }
  });

  /**
   * Het registratieformulier met nieuwe verborgen velden.
   * @param {object} res Express-antwoord.
   * @param {{values?: object, errors?: object}} state Waarden en fouten.
   * @param {number} [status] HTTP-status.
   * @returns {void}
   */
  const sendRegister = (res, state, status = 200) => send(res, {
    title: 'Account aanmaken',
    body: views.registerView({ ...state, hiddenFields: registerGuard.hiddenFields(), captchaField: captchaField(options.captcha, 'registreren') }),
  }, status);

  /** Melding na registreren, gelijk voor nieuwe en bestaande adressen. */
  const REGISTER_DONE = 'Bedankt! We hebben een mail gestuurd met de volgende stap. Open de link in die mail om je account te bevestigen.';

  router.get('/account/registreren/', (req, res) => {
    if (req.customer) return res.redirect(303, '/account/');
    return sendRegister(res, { values: { email: textField(req.query.email, 200) } });
  });

  router.post('/account/registreren/', registerGuard.protect, async (req, res, next) => {
    try {
      const body = req.body || {};
      if (registerGuard.isBot(body)) return send(res, { title: 'Account aanmaken', body: views.mailSentView(REGISTER_DONE) });
      const email = normalizeEmail(body.email);
      const password = passwordField(body.password);
      const values = { email: textField(body.email, 200) };
      const errors = {};
      if (!email) errors.email = 'Vul een geldig e-mailadres in.';
      const problem = passwordProblem(password, { email });
      if (problem) errors.password = problem;
      else if (password !== body.password2) errors.password2 = 'De wachtwoorden zijn niet gelijk.';
      const tokenProblem = registerGuard.tokenProblem(body);
      if (tokenProblem) errors._form = tokenProblem;
      if (Object.keys(errors).length) return sendRegister(res, { values, errors }, 422);
      if (options.captcha) {
        const verdict = await options.captcha.check({ token: body.captchaToken, action: 'registreren', remoteIp: req.ip });
        if (!verdict.ok) return sendRegister(res, { values, errors: { _form: verdict.message } }, verdict.unavailable ? 503 : 422);
      }
      // Altijd hashen (ook bij een bestaand account), zodat de responstijd niets verraadt.
      const passwordHash = await hashPassword(password);
      const result = await accounts.register(email, passwordHash);
      const siteUrl = res.locals.site.siteUrl;
      if (result.id && result.existing) {
        const token = await accounts.createToken(result.id, 'herstellen');
        if (token) void mails.alreadyRegistered({ to: email, token, siteUrl });
      } else if (result.id) {
        const token = await accounts.createToken(result.id, 'bevestigen');
        await audit(req, 'reiziger.geregistreerd', result.id);
        if (token) void mails.verify({ to: email, token, siteUrl });
      }
      return send(res, { title: 'Account aanmaken', body: views.mailSentView(REGISTER_DONE) });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/account/bevestigen/', async (req, res, next) => {
    try {
      const row = await accounts.findToken(req.query.token, 'bevestigen');
      if (!row) return send(res, { title: 'Account bevestigen', body: views.invalidLinkView('/account/registreren/') }, 404);
      return send(res, { title: 'Account bevestigen', body: views.verifyView({ token: req.query.token }) });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/account/bevestigen/', sameSiteOnly, limit(linkLimiter), async (req, res, next) => {
    try {
      const token = textField(req.body.token, 100);
      const row = await accounts.findToken(token, 'bevestigen');
      if (!row) return send(res, { title: 'Account bevestigen', body: views.invalidLinkView('/account/registreren/') }, 404);
      const attempt = countAttempt(req, row.account_id);
      const passwordOk = await verifyPassword(passwordField(req.body.password), row.password_hash);
      if (attempt.blocked || !passwordOk) {
        await audit(req, 'reiziger.bevestigen.mislukt', row.account_id);
        return send(res, { title: 'Account bevestigen', body: views.verifyView({ token, error: `Dit wachtwoord klopt niet. Na ${MAX_FAILED_LOGINS} mislukte pogingen binnen ${LOCK_MINUTES} minuten moet je even wachten.` }) }, 401);
      }
      attempt.clear();
      const done = await db.transaction(async (client) => {
        // Opnieuw zoeken met een slot: de link kan intussen gebruikt zijn of het wachtwoord overschreven (opnieuw geregistreerd).
        const locked = await accounts.findToken(token, 'bevestigen', client, { lock: true });
        if (!locked || locked.password_hash !== row.password_hash) return false;
        await client.query('UPDATE customer_accounts SET verified_at = now() WHERE id = $1 AND verified_at IS NULL', [locked.account_id]);
        await accounts.useTokens(client, locked.account_id, 'bevestigen');
        await startSession(res, locked.account_id, client);
        await audit(req, 'reiziger.bevestigd', locked.account_id, client);
        return true;
      });
      if (!done) return send(res, { title: 'Account bevestigen', body: views.invalidLinkView('/account/registreren/') }, 404);
      return res.redirect(303, '/account/?welkom=1');
    } catch (error) {
      return next(error);
    }
  });

  /**
   * Het formulier *wachtwoord vergeten* met nieuwe verborgen velden.
   * @param {object} res Express-antwoord.
   * @param {{values?: object, errors?: object}} state Waarden en fouten.
   * @param {number} [status] HTTP-status.
   * @returns {void}
   */
  const sendForgot = (res, state, status = 200) => send(res, {
    title: 'Wachtwoord vergeten',
    body: views.forgotView({ ...state, hiddenFields: forgotGuard.hiddenFields(), captchaField: captchaField(options.captcha, 'wachtwoord') }),
  }, status);

  /** Melding na *wachtwoord vergeten*, gelijk voor bekende en onbekende adressen. */
  const FORGOT_DONE = 'Als er een account is met dit e-mailadres, staat er nu een mail klaar met een link om een nieuw wachtwoord in te stellen.';

  router.get('/account/wachtwoord-vergeten/', (req, res) => sendForgot(res, {}));

  router.post('/account/wachtwoord-vergeten/', forgotGuard.protect, async (req, res, next) => {
    try {
      const body = req.body || {};
      if (forgotGuard.isBot(body)) return send(res, { title: 'Wachtwoord vergeten', body: views.mailSentView(FORGOT_DONE) });
      const email = normalizeEmail(body.email);
      const values = { email: textField(body.email, 200) };
      if (!email) return sendForgot(res, { values, errors: { email: 'Vul een geldig e-mailadres in.' } }, 422);
      const tokenProblem = forgotGuard.tokenProblem(body);
      if (tokenProblem) return sendForgot(res, { values, errors: { _form: tokenProblem } }, 422);
      if (options.captcha) {
        const verdict = await options.captcha.check({ token: body.captchaToken, action: 'wachtwoord', remoteIp: req.ip });
        if (!verdict.ok) return sendForgot(res, { values, errors: { _form: verdict.message } }, verdict.unavailable ? 503 : 422);
      }
      const siteUrl = res.locals.site.siteUrl;
      // Op de achtergrond, zodat de responstijd niet verraadt of het adres een account heeft.
      const request = async () => {
        const account = await accounts.findByEmail(email);
        if (!account) return;
        const token = await accounts.createToken(account.id, 'herstellen');
        await audit(req, 'reiziger.herstel-aangevraagd', account.id);
        if (token) await mails.reset({ to: email, token, siteUrl });
      };
      void request().catch((error) => console.error(`reizigersaccount: herstellink maken mislukt (${error.code || error.name})`));
      return send(res, { title: 'Wachtwoord vergeten', body: views.mailSentView(FORGOT_DONE) });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/account/wachtwoord-herstellen/', async (req, res, next) => {
    try {
      const row = await accounts.findToken(req.query.token, 'herstellen');
      if (!row) return send(res, { title: 'Nieuw wachtwoord', body: views.invalidLinkView('/account/wachtwoord-vergeten/') }, 404);
      return send(res, { title: 'Nieuw wachtwoord', body: views.resetView({ token: req.query.token }) });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/account/wachtwoord-herstellen/', sameSiteOnly, limit(linkLimiter), async (req, res, next) => {
    try {
      const token = textField(req.body.token, 100);
      const row = await accounts.findToken(token, 'herstellen');
      if (!row) return send(res, { title: 'Nieuw wachtwoord', body: views.invalidLinkView('/account/wachtwoord-vergeten/') }, 404);
      const password = passwordField(req.body.password);
      const errors = {};
      const problem = passwordProblem(password, { email: row.email });
      if (problem) errors.password = problem;
      else if (password !== req.body.password2) errors.password2 = 'De wachtwoorden zijn niet gelijk.';
      if (Object.keys(errors).length) return send(res, { title: 'Nieuw wachtwoord', body: views.resetView({ token, errors }) }, 422);
      const passwordHash = await hashPassword(password);
      const done = await db.transaction(async (client) => {
        const locked = await accounts.findToken(token, 'herstellen', client, { lock: true });
        if (!locked) return false;
        // De link bewijst dat de reiziger de mailbox heeft: daarmee is het adres ook bevestigd.
        await client.query(
          'UPDATE customer_accounts SET password_hash = $2, password_changed_at = now(), verified_at = COALESCE(verified_at, now()) WHERE id = $1',
          [locked.account_id, passwordHash],
        );
        await accounts.useTokens(client, locked.account_id, 'herstellen');
        await accounts.useTokens(client, locked.account_id, 'bevestigen');
        await accounts.endSessionsOf(client, locked.account_id);
        await startSession(res, locked.account_id, client);
        await audit(req, 'reiziger.wachtwoord-hersteld', locked.account_id, client);
        return true;
      });
      if (!done) return send(res, { title: 'Nieuw wachtwoord', body: views.invalidLinkView('/account/wachtwoord-vergeten/') }, 404);
      return res.redirect(303, '/account/?hersteld=1');
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

/**
 * Start het dagelijkse opruimen van verlopen sessies, links en onbevestigde accounts. De timer houdt het proces niet open.
 * @param {{purgeExpired: Function}} accounts De accountopslag.
 * @returns {NodeJS.Timeout} De timer.
 */
function startAccountMaintenance(accounts) {
  const run = () => accounts.purgeExpired().catch((error) => console.error(`reizigersaccount: opruimen mislukt (${error.code || error.name})`));
  run();
  return setInterval(run, 24 * 60 * 60 * 1000).unref();
}

module.exports = { createAccountRouter, startAccountMaintenance, ACCOUNT_ACTION_LABELS, COOKIE_NAME, MAX_DAYS };
