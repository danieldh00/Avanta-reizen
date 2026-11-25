// @ts-check
/**
 * Router van het CRM onder `/app/`: de gedeelde schil (limiet, formuliergrootte per onderdeel, sessie laden) en de
 * routes van alle modules. De routes zelf staan per onderwerp in een eigen bestand: toegang in `crm/login-routes.js`,
 * het overzicht in `crm/dashboard-routes.js`, en per module een ingang `index.js` (`persons/`, `booking/`,
 * `payments/`, `trips/`, `cms/`, `media/`, `contact/`, `infobrief/`) die
 * de routes van die module koppelt. Een nieuw scherm in een module komt in de ingang van die module, niet hier.
 * Alles onder `/app/` krijgt `Cache-Control: no-store` en `noindex`.
 */
const express = require('express');
const { html } = require('../site/html');
const { clientKey, createRateLimiter } = require('../security/rate-limit');
const { createAuth } = require('./auth');
const { createPasswordCheck } = require('../security/password-check');
const { renderCrmPage } = require('./layout');
const { createLoginRoutes, generateSetupCode, normalizeSetupCode, MAX_FAILED_LOGINS, LOCK_MINUTES, MAX_FAILED_LOGINS_PER_ACCOUNT } = require('./login-routes');
const { createDashboardRoutes } = require('./dashboard-routes');
const { createWhatsNewRoutes } = require('./whats-new-routes');
const { createSearchRoutes } = require('./search-routes');
const { normalizeEmail, textField } = require('./input');
const { createUserRoutes } = require('./users');
const { createAuditRoutes } = require('./audit-routes');
const { createPersonsModuleRoutes } = require('../persons');
const { createBookingModuleRoutes } = require('../booking');
const { createPaymentsModuleRoutes } = require('../payments');
const { createPersons } = require('../persons/persons');
const { createTwoFactor, createTwoFactorRoutes } = require('./two-factor');
const { createVault } = require('../security/vault');
const { createMediaModuleRoutes } = require('../media');
const { createTripsModuleRoutes } = require('../trips');
const { createCmsModuleRoutes } = require('../cms');
const { createContactModuleRoutes } = require('../contact');
const { createInfobriefModuleRoutes } = require('../infobrief');
const { createMenuCounters } = require('./menu-counters');
const { createBeheerRoutes } = require('../beheer/routes');
const { createApiRouter } = require('../api/router');
const { createFaqApi } = require('../cms/faq-api');
const { createPostTermApi } = require('../cms/post-term-api');
const { createMenuApi } = require('../cms/menu-api');
const { createCategoryApi } = require('../trips/category-api');
const { createListHeaderApi } = require('../cms/list-header-api');
const { createWebBundle } = require('./web-bundle');
const { sendApiError } = require('../api/errors');

/**
 * Of een pad (binnen `/app`) bij de JSON-API hoort; Express routeert hoofdletterongevoelig.
 * @param {string} requestPath Pad binnen de router.
 * @returns {boolean} Waar voor `/api/…`.
 */
function isApiPath(requestPath) {
  const lower = requestPath.toLowerCase();
  return lower === '/api' || lower.startsWith('/api/');
}

/**
 * Bouwt de CRM-router.
 * @param {{db: any, masterKey: Buffer, webDistDir?: string, vault?: any, settings: any, passwordCheck?: any, mailer?: any, wanIp?: any, notifications?: any, captcha?: any, backups?: any, drive?: any, restoreTests?: any, systemUpdate?: any, hostTasks?: any, appLog?: any, monitor?: any, auditExportMax?: number, setupCode?: string, secureCookies?: boolean, now?: () => number,
 *   redirects?: any, retention?: any, paymentReminders?: any, onlinePayments?: any, infobriefSender?: any,
 *   mediaLibrary?: any, menus?: any, listHeaders?: any, mediaLimits?: any, paymentOverviewMaxRows?: number}} options
 *   Database, hoofdsleutel, de instellingen (`beheer/settings.js`), de wachtwoordcontrole (`security/password-check.js`,
 *   anders een nieuwe), de mailer en WAN-IP-opzoeker (`mail/`), de captcha, de diensten van de modules (doorverwijzingen, opschoning, betalingen, infobrieven,
 *   fotobibliotheek, menu's, koppen van lijstpagina's) met hun grenzen, de installatiecode voor de eerste beheerder (zonder code geen installatie), of de cookie
 *   `Secure` krijgt en (voor tests) de klok van de limieten.
 * @returns {express.Router} Router, te koppelen op `/app`.
 */
function createCrmRouter(options) {
  const { db } = options;
  const auth = createAuth(options);
  // De kluis uit services.js (met de vorige sleutels na een rotatie); tests zonder kluis krijgen er een met de hoofdsleutel.
  const vault = options.vault || createVault(options.masterKey);
  const twoFactor = createTwoFactor({ db, vault, now: options.now });
  const persons = createPersons({ vault });
  const passwordCheck = options.passwordCheck || createPasswordCheck({ settings: options.settings, appLog: options.appLog, now: options.now });
  const router = express.Router();
  // Bundels van de nieuwe schermen in Vue (`web/`), per module opgezocht in het manifest van Vite.
  const webBundle = createWebBundle({ distDir: options.webDistDir });
  // Algemene limiet op alles onder /app/ (ook de sessiecontrole kost een databasevraag per verzoek).
  const generalLimiter = createRateLimiter({ limit: 300, windowMs: 60 * 1000, now: options.now });

  router.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    if (!generalLimiter.hit(clientKey(req))) {
      if (isApiPath(req.path)) {
        res.set('Retry-After', '60');
        return sendApiError(res, 'te-veel');
      }
      return res.status(429).set('Retry-After', '60').type('text').send('Te veel verzoeken. Probeer het over een minuut opnieuw.');
    }
    return next();
  });
  // Beheer heeft formulieren met meer en langere velden (bijv. robots.txt-regels); de rest blijft klein.
  const smallForms = express.urlencoded({ extended: false, limit: '16kb', parameterLimit: 20 });
  const beheerForms = express.urlencoded({ extended: false, limit: '64kb', parameterLimit: 100 });
  // De fotobibliotheek heeft een keuzelijst met alle landen (één veld per gekozen land).
  const mediaForms = express.urlencoded({ extended: false, limit: '64kb', parameterLimit: 400 });
  // Pagina's, blogberichten, FAQ-antwoorden, reisleiders en infobrieven: een tekstblok mag lang zijn (100.000 tekens opgemaakte tekst); velden per blok blijven beperkt.
  const pageForms = express.urlencoded({ extended: false, limit: '512kb', parameterLimit: 100 });
  // Reizen en reistypes/landen: een lange omschrijving uit de teksteditor, ruim 30 velden en een vinkje per land en
  // reistype (zoals de keuzelijst van de fotobibliotheek).
  const tripForms = express.urlencoded({ extended: false, limit: '512kb', parameterLimit: 400 });
  // Blog: als pagina's, plus een vinkje per categorie en tag (hoogstens 2 × 200).
  const blogForms = express.urlencoded({ extended: false, limit: '512kb', parameterLimit: 450 });
  // Aanmelding handmatig invoeren: alle velden van het aanmeldformulier (zoals `/aanmelden/`).
  const bookingForms = express.urlencoded({ extended: false, limit: '32kb', parameterLimit: 80 });
  router.use((req, res, next) => {
    if (req.path.startsWith('/beheer/')) return beheerForms(req, res, next);
    if (req.path.startsWith('/paginas/') || req.path.startsWith('/faq/') || req.path.startsWith('/reisleiders/') || req.path.startsWith('/infobrieven/')) return pageForms(req, res, next);
    if (req.path.startsWith('/blog/')) return blogForms(req, res, next);
    if (req.path.startsWith('/reizen/') || req.path.startsWith('/reistypes-en-landen/')) return tripForms(req, res, next);
    if (req.path === '/aanmeldingen/nieuw/') return bookingForms(req, res, next);
    if (req.path.startsWith('/fotobibliotheek/')) return mediaForms(req, res, next);
    return smallForms(req, res, next);
  });
  router.use(auth.loadSession);
  // JSON-API voor de nieuwe schermen (`api/router.js`), vóór de tellers van het menu (die horen alleen bij pagina's).
  // Een module koppelt haar API-routes met een fabriek in `modules`.
  router.use('/api', createApiRouter({
    auth, db, appLog: options.appLog, now: options.now,
    redirects: options.redirects, menus: options.menus, listHeaders: options.listHeaders, mediaLibrary: options.mediaLibrary,
    modules: [createFaqApi, createPostTermApi, createMenuApi, createCategoryApi, createListHeaderApi],
    // Paden met een lange opgemaakte tekst (antwoord van een vraag, tekst van een reistype of land).
    largeJsonPaths: [/^\/faq\/vragen\//i, /^\/reistypes-en-landen\//i],
  }));
  // Tellers naast menu-items (nieuwe berichten), alleen voor pagina's en met het recht (`crm/menu-counters.js`).
  router.use(createMenuCounters({ db }));

  // Toegang en overzicht.
  router.use(createLoginRoutes({ db, auth, twoFactor, passwordCheck, setupCode: options.setupCode, now: options.now }));
  router.use(createWhatsNewRoutes({ auth }));
  router.use(createDashboardRoutes({ db, auth, twoFactor, settings: options.settings, monitor: options.monitor, backups: options.backups, systemUpdate: options.systemUpdate, appLog: options.appLog, now: options.now }));
  router.use(createSearchRoutes({ db, auth }));
  router.use(createTwoFactorRoutes({ db, auth, twoFactor, now: options.now }));
  router.use(createUserRoutes({ db, auth, twoFactor, passwordCheck, normalizeEmail, textField }));
  router.use(createAuditRoutes({ db, auth, now: options.now, exportMax: options.auditExportMax }));
  // De modules met een eigen ingang: elk koppelt zijn eigen routes (`<module>/index.js`). Elke module heeft eigen
  // adressen (`/deelnemers/`, `/aanmeldingen/`, `/betalingen/`, …), dus de volgorde tussen modules maakt niet uit.
  const moduleContext = { ...options, db, auth, persons, webBundle };
  router.use(createPersonsModuleRoutes(moduleContext));
  router.use(createBookingModuleRoutes(moduleContext));
  router.use(createPaymentsModuleRoutes(moduleContext));
  router.use(createMediaModuleRoutes(moduleContext));
  router.use(createTripsModuleRoutes(moduleContext));
  router.use(createCmsModuleRoutes(moduleContext));
  router.use(createContactModuleRoutes(moduleContext));
  router.use(createInfobriefModuleRoutes(moduleContext));
  router.use(createBeheerRoutes({ db, auth, webBundle, settings: options.settings, redirects: options.redirects, mailer: options.mailer, wanIp: options.wanIp, captcha: options.captcha, passwordCheck, backups: options.backups, drive: options.drive, restoreTests: options.restoreTests, systemUpdate: options.systemUpdate, hostTasks: options.hostTasks, appLog: options.appLog, monitor: options.monitor, retention: options.retention, now: options.now }));

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
