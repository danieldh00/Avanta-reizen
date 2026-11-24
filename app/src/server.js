/**
 * Webserver van Avanta Reizen: de publieke website op `/` en het CRM op `/app/`.
 * Start met `node src/server.js`; vereist DATABASE_URL. Dit bestand bouwt de Express-app: beveiligingskoppen, de
 * volgorde van de middleware en de routes. De diensten die de routes delen staan in `services.js`.
 */
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { createDatabase } = require('./database/db');
const { createSiteRouter } = require('./site/routes');
const { createBookingRouter } = require('./booking/routes');
const { createAccountRouter } = require('./account/routes');
const { createContactForm } = require('./contact/routes');
const { createCrmRouter, generateSetupCode } = require('./crm/routes');
const seo = require('./site/seo');
const { loadMasterKey, loadPreviousKeys } = require('./security/vault');
const { siteSettingsOf } = require('./site/site-settings');
const { cspWith } = require('./site/analytics');
const { cspWith: captchaCspWith, isFormPath } = require('./security/captcha');
const crypto = require('node:crypto');
const { PUBLIC_DIR, MEDIA_DIR, DATA_DIR } = require('./paths');
const { SITE_CONTENT_FILE } = require('./site/site-content');
const { transferFixedContent } = require('./site/content-transfer');
const { createServices, startBackgroundTasks } = require('./services');
const { roleHasRight } = require('./crm/rights');
const { createPersons } = require('./persons/persons');
const { createOnlinePaymentRoutes } = require('./payments/online-payment-routes');
const { renderPage, renderPageHeader } = require('./site/layout');
const { maintenanceState, maintenanceGuard } = require('./system/maintenance');
const { runWithContext, currentContext } = require('./system/request-context');
const { normalizePath, describeError, newErrorCode, newRequestId } = require('./system/app-log');
const { html } = require('./site/html');
const { useImageIndex } = require('./media/formats');
const { createHealthRoute } = require('./system/health');

/**
 * De standaard Content-Security-Policy: alleen eigen bestanden, geen inline scripts en geen inline `<style>`-blokken.
 * Alleen het `style`-attribuut mag nog (`style-src-attr`): de publieke site zet daarmee de achtergrondfoto van een kop,
 * banner of kaart. Het CRM en Beheer gebruiken geen inline stijlen.
 */
const BASE_CSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; style-src-attr 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

/**
 * HSTS (audit A06): de browser gebruikt een jaar lang alleen nog https voor deze host. Standaard zonder
 * `includeSubDomains`: andere subdomeinen van het domein van Avanta (mail, oude diensten) mogen er niet door breken.
 */
const HSTS_VALUE = 'max-age=31536000';

/**
 * HSTS-preload (wachtlijst W10, akkoord Daniël 24-11-2026): twee jaar, alle subdomeinen en `preload`, de eisen van de
 * preloadlijst van de browsers. Alleen als de beheerder het aanzet (Beheer > Toegang en beveiliging > HSTS-preload),
 * de site live is (indexeren aan) en het verzoek op de host van het basisadres binnenkomt; zo zet de testomgeving
 * (altijd noindex, eigen host) nooit een domein vast. Opnemen in de lijst vraagt Daniël daarna zelf aan
 * (`docs/GO-LIVE.md` §4.5); terugdraaien duurt maanden.
 */
const HSTS_PRELOAD_VALUE = 'max-age=63072000; includeSubDomains; preload';

/**
 * De HSTS-kop voor dit verzoek: met preload alleen onder de voorwaarden bij `HSTS_PRELOAD_VALUE`.
 * @param {object} req Express-verzoek (`hostname` volgt de vertrouwde proxy).
 * @param {{get: (key: string) => *}} [settings] Instellingen (synchroon); zonder instellingen nooit preload.
 * @returns {string} Waarde voor `Strict-Transport-Security`.
 */
function hstsValue(req, settings) {
  if (!settings || settings.get('hstsPreload') !== true || settings.get('seoIndexing') !== true) return HSTS_VALUE;
  let siteHost;
  try {
    siteHost = new URL(String(settings.get('siteUrl') || '')).hostname.toLowerCase();
  } catch {
    return HSTS_VALUE;
  }
  return siteHost && String(req.hostname || '').toLowerCase() === siteHost ? HSTS_PRELOAD_VALUE : HSTS_VALUE;
}

/**
 * Zet de beveiligingskoppen op elk antwoord, met standaard `noindex`: de middleware met de site-instellingen haalt die
 * kop pas weg als indexeren in Beheer aan staat. Zo is een antwoord van vóór die middleware (of bij een fout) nooit
 * indexeerbaar. HSTS alleen bij https (`req.secure`, achter de vertrouwde proxy via `X-Forwarded-Proto`): over http
 * negeert de browser de kop, en lokaal of in de tests draait de app zonder https. Hier altijd de gewone HSTS-waarde;
 * de middleware met de site-instellingen zet de preloadwaarde pas na `settings.ready()`, zodat nooit een startwaarde
 * in plaats van de waarde uit Beheer telt.
 * @returns {Function} Express-middleware.
 */
function securityHeaders() {
  return (req, res, next) => {
    res.set({
      'Content-Security-Policy': BASE_CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    if (req.secure) res.set('Strict-Transport-Security', HSTS_VALUE);
    res.set('X-Robots-Tag', 'noindex, nofollow');
    next();
  };
}

/**
 * Welke proxy Express vertrouwt voor `req.ip` (en daarmee de limiet per bezoeker). Alleen `loopback` (standaard) of het
 * exacte IP-adres van één reverse proxy, bijv. `172.18.0.5`. Subnetten, lijsten en hop-aantallen worden geweigerd:
 * daarmee kan een bezoeker via het Docker-bridgeadres met een zelfgekozen `X-Forwarded-For` de limiet omzeilen.
 * @param {(string|undefined)} value Waarde uit `TRUST_PROXY`.
 * @returns {string} Instelling voor Express.
 * @throws {Error} Bij een waarde die geen loopback of enkel IP-adres is.
 */
function parseTrustProxy(value) {
  const text = String(value ?? '').trim();
  if (!text || text === 'loopback') return 'loopback';
  if (net.isIP(text) === 0) throw new Error(`TRUST_PROXY moet leeg, 'loopback' of één exact IP-adres zijn, niet '${text}'`);
  return text;
}

/**
 * Bouwt de Express-app.
 * @param {{db: object, masterKey: Buffer, previousKeys?: Buffer[], settings?: object, appLog?: object, systemUpdate?: object, updateStatusDir?: string, updateRequestDir?: string, mailer?: object, wanIp?: object, captcha?: object, captchaFetch?: Function, backups?: object, databaseUrl?: string, backupDir?: string, pgDumpPath?: string, googleFetch?: Function, statfs?: Function, monitorRequest?: Function, monitorDataDir?: string, retentionToday?: () => string, indexable?: boolean, siteUrl?: string, trustProxy?: string, setupCode?: string, secureCookies?: boolean, passwordCheckFetch?: Function, now?: () => number, homepage?: {load: Function}, siteContent?: {load: Function}}} options Database,
 *   hoofdsleutel, de instellingen (standaard uit de database, `beheer/settings.js`), het logboek (standaard
 *   `system/app-log.js`; wegschrijven start pas met `appLog.start()` in `start()`), de koppeling met het updatescript
 *   (standaard `system/system-update.js` met de mappen uit `updateStatusDir`/`updateRequestDir` of UPDATE_STATUS_DIR/UPDATE_REQUEST_DIR), de mailer en WAN-IP-opzoeker (standaard `mail/`), de captcha (standaard `security/captcha.js`, met `captchaFetch` als eigen fetch), de back-updienst (standaard `backup/backups.js` met `databaseUrl`, `backupDir` en `pgDumpPath`; zonder `databaseUrl` geen back-ups), een eigen fetch voor Google Drive (`googleFetch`, tests) en voor de controle op gelekte wachtwoorden (`passwordCheckFetch`, tests), of de site geïndexeerd mag worden, het basisadres (standaard `SITE_URL`), welke proxy vertrouwd wordt
 *   (standaard `TRUST_PROXY`, anders loopback), de installatiecode voor de eerste CRM-beheerder en of de CRM-cookie
 *   `Secure` krijgt (standaard ja).
 * @returns {express.Express} De app.
 */
function createApp(options) {
  const app = express();
  // Alle diensten (instellingen, logboek, mail, back-ups, bewaking, …) staan in `services.js`. `app.locals` geeft ze
  // door aan `start()` en aan de tests.
  const services = createServices(options);
  const { vault, settings, appLog, captcha, passwordCheck, menus, systemUpdate, hostTasks, redirects, mediaDir, mediaLibrary, imageFormats, mailer, wanIp, notifications, drive, backups, restoreTests, monitor, retention, onlinePayments, paymentReminders, infobriefSender, siteContent, homepage, listHeaders, accounts } = services;
  Object.assign(app.locals, { services, settings, appLog, captcha, passwordCheck, menus, systemUpdate, redirects, mediaLibrary, mailer, drive, backups, restoreTests, monitor, retention, onlinePayments, paymentReminders, infobriefSender, accounts });
  app.disable('x-powered-by');
  const trustedProxy = parseTrustProxy(options.trustProxy ?? process.env.TRUST_PROXY);
  app.set('trust proxy', trustedProxy);
  app.use(securityHeaders());
  // Express 5 laat `req.body` leeg (undefined) als er geen formulier is ingelezen, bijv. een POST zonder inhoud of met
  // een ander inhoudstype. De routes lezen velden als `req.body.naam`; met een leeg object als begin krijgen die net als
  // vroeger `undefined` in plaats van een TypeError (500). Een parser vervangt het object daarna door de echte velden.
  app.use((req, res, next) => {
    req.body = {};
    next();
  });
  // Elk verzoek een eigen request-id (nooit een id van buiten) in de context en in de kop X-Request-Id; trage verzoeken
  // komen in het logboek (genormaliseerd pad, geen querystring).
  app.use((req, res, next) => {
    const requestId = newRequestId();
    res.set('X-Request-Id', requestId);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      const threshold = Number(settings.get('logSlowMs')) || 1500;
      if (durationMs >= threshold) {
        appLog.warn('traag', `${req.method} ${normalizePath(req.originalUrl)} ${res.statusCode} in ${Math.round(durationMs)} ms`, { requestId, durationMs });
      }
    });
    runWithContext({ requestId }, next);
  });

  // Gezondheid voor Docker en het updatescript; de versie alleen voor verzoeken van binnen de server (`system/health.js`).
  app.get('/api/health', createHealthRoute({ db: options.db, version: require('../package.json').version, trustedProxy }));

  // Site-instellingen per verzoek (`res.locals.site`), HSTS-preload, de noindex-kop en de CSP voor Analytics en de captcha.
  app.use(async (req, res, next) => {
    try {
      await settings.ready();
      await listHeaders.load();
      res.locals.site = siteSettingsOf(settings);
      // HSTS-preload pas hier, met de geladen waarden uit Beheer (zie `hstsValue`).
      if (req.secure) res.set('Strict-Transport-Security', hstsValue(req, settings));
      // Express routeert hoofdletterongevoelig, dus ook `/APP/…` is het CRM: dat blijft altijd noindex.
      const lowerPath = req.path.toLowerCase();
      const inCrm = lowerPath.startsWith('/app/') || lowerPath === '/app';
      if (res.locals.site.indexable && !inCrm) res.removeHeader('X-Robots-Tag');
      // Google Analytics alleen op de publieke site en alleen met een actief meet-ID; het CRM blijft op de standaardpolicy.
      if (res.locals.site.analytics.measurementId && !inCrm) res.set('Content-Security-Policy', cspWith(BASE_CSP, res.locals.site.analytics.measurementId));
      // Captcha: de sitesleutel voor de pagina, en alleen op de formulierpagina's de adressen van Google in de CSP.
      // Alleen op de formulierpagina's: daar laadt de layout het script en krijgt de CSP de Google-adressen.
      res.locals.site.captchaSiteKey = !inCrm && isFormPath(req.path) ? captcha.siteKey() : '';
      if (res.locals.site.captchaSiteKey) res.set('Content-Security-Policy', captchaCspWith(res.get('Content-Security-Policy')));
      return next();
    } catch (error) {
      return next(error);
    }
  });

  // Menu's van de site uit het CRM (`cms/menus.js`), één keer geladen; lukt dat niet, dan toont de site het vaste menu.
  app.use(async (req, res, next) => {
    try {
      await menus.ready();
    } catch (error) {
      appLog.error('menu', `Menu's laden mislukt (${describeError(error).message}); de site toont het vaste menu.`);
    }
    res.locals.site.menus = menus.current();
    next();
  });

  // Onderhoudsmodus (update of met de hand): de stand per verzoek in de context (voor de balk in de layouts), daarna
  // weigert de bewaker schrijfverzoeken met 503.
  app.use((req, res, next) => {
    currentContext().maintenance = maintenanceState({ settings, systemUpdate });
    next();
  });
  app.use(maintenanceGuard(() => currentContext().maintenance));

  // Doorverwijzingen uit Beheer (oude adressen naar nieuwe), vóór de statische bestanden en de site.
  app.use(redirects.middleware);

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(seo.robotsTxt(res.locals.site));
  });
  // Waar een beveiligingsprobleem gemeld kan worden (RFC 9116); ook als de site nog niet geïndexeerd mag worden.
  app.get('/.well-known/security.txt', (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600').type('text/plain').send(seo.securityTxt(res.locals.site));
  });

  app.use(express.static(PUBLIC_DIR, { maxAge: '7d', index: false, redirect: false }));
  // Afbeeldingen: import en fotobibliotheek (tests geven een eigen map mee).
  // Importfoto's: de lichtere JPEG onder hetzelfde adres, als die er al is; `srcset` op de site via dezelfde index.
  useImageIndex(imageFormats.index);
  app.use('/media', imageFormats.middleware);
  app.use('/media', express.static(mediaDir, { maxAge: '30d', index: false, redirect: false, fallthrough: true }));


  app.use('/app', createCrmRouter({ db: options.db, masterKey: options.masterKey, vault, settings, passwordCheck, redirects, mailer, wanIp, notifications, captcha, backups, drive, restoreTests, systemUpdate, hostTasks, appLog, monitor, retention, paymentReminders, onlinePayments, infobriefSender, mediaLibrary, menus, homepage, siteContent, listHeaders, mediaLimits: options.mediaLimits, paymentOverviewMaxRows: options.paymentOverviewMaxRows, auditExportMax: options.auditExportMax, setupCode: options.setupCode, secureCookies: options.secureCookies, now: options.now }));

  const formKey = crypto.createHmac('sha256', options.masterKey).update('formulier-token').digest();
  // Eén lezer van `site-content.json` voor de site en het aanmeldformulier (kop van /aanmelden/).
  // Reizigersaccount onder /account/ (CMS-pakket J2): eigen sessies en cookie, los van het CRM. Het aanmeldformulier
  // vult bij een ingelogde reiziger de gewone gegevens van de vorige aanmelding alvast in (J4).
  const accountRouter = createAccountRouter({ db: options.db, masterKey: options.masterKey, formKey, mailer, settings, captcha, accounts, passwordCheck, secureCookies: options.secureCookies, now: options.now });
  app.use(createOnlinePaymentRoutes({ db: options.db, onlinePayments, settings, now: options.now }));
  app.use(createBookingRouter({ db: options.db, vault, formKey, notifications, captcha, now: options.now, listHeaders, prefill: accountRouter.prefillFor, customerFor: accountRouter.customerFor }));
  app.use(accountRouter);
  const contactForm = createContactForm({ db: options.db, formKey, notifications, captcha, now: options.now });
  app.use(createSiteRouter({ db: options.db, contactForm, homepage, siteContent, listHeaders }));

  // 404: telt mee in de 404-lijst van Beheer; altijd noindex (kop en renderPage zonder indexable), met een canonical
  // naar het gevraagde pad.
  app.use((req, res) => {
    redirects.recordNotFound(req);
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.status(404).send(renderPage({
      title: 'Pagina niet gevonden',
      path: req.path,
      site: res.locals.site,
      seo: { canonicalUrl: seo.absoluteUrl(res.locals.site.siteUrl, req.path), imageUrl: res.locals.site.imageUrl },
      header: renderPageHeader({ title: 'Pagina niet gevonden' }),
      body: html`<div class="container section"><p>Deze pagina bestaat niet (meer). Bekijk <a href="/reis/">ons reisaanbod</a> of ga naar de <a href="/">homepage</a>.</p></div>`,
    }));
  });

  // Express herkent een foutafhandelaar aan de vier parameters.
  app.use((error, req, res, next) => {
    // Elke onverwachte fout krijgt een foutcode: in het logboek (zonder geheimen of persoonsgegevens) en op de pagina,
    // zodat een beheerder hem terugvindt. Details alleen in de debugmodus en alleen voor een beheerder (recht systeem).
    if (res.headersSent) return next(error);
    const errorCode = newErrorCode();
    const { requestId } = currentContext();
    const described = describeError(error);
    appLog.error('fout', `${described.name}: ${described.message}`, {
      errorCode, requestId, data: { method: req.method, path: normalizePath(req.originalUrl), code: described.code, frames: described.frames },
    });
    // Rechtstreeks naar stderr: de console gaat al naar het logboek, dan zou de fout er twee keer in staan.
    process.stderr.write(`[fout ${errorCode}] ${req.method} ${normalizePath(req.originalUrl)}${requestId ? ` verzoek ${requestId}` : ''}: ${described.name}: ${described.message}\n`);
    const debug = settings.get('debugMode') === true && req.user && roleHasRight(req.user.role, 'systeem');
    res.set({ 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' });
    res.status(500).send(renderPage({
      title: 'Er ging iets mis',
      path: req.path,
      site: res.locals.site,
      header: renderPageHeader({ title: 'Er ging iets mis' }),
      body: html`<div class="container section"><p>Probeer het later opnieuw. Blijft het gebeuren, geef dan foutcode <strong>${errorCode}</strong> door.</p>
        ${debug ? html`<details class="debug-details" open><summary>Details (debugmodus)</summary>
          <p>${described.name}: ${described.message}${described.code ? ` (code ${described.code})` : ''}</p>
          <p>Verzoek ${requestId}, ${req.method} ${normalizePath(req.originalUrl)}</p>
          ${described.frames.length ? html`<ol>${described.frames.map((frame) => html`<li><code>${frame}</code></li>`)}</ol>` : ''}
        </details>` : ''}</div>`,
    }));
  });
  return app;
}

/**
 * Start de server: database verbinden, migraties draaien en luisteren op PORT.
 * @returns {Promise<import('node:http').Server>} De server.
 */
async function start() {
  const databaseUrl = process.env.DATABASE_URL || readSecretFile(process.env.DATABASE_URL_FILE);
  const db = createDatabase(databaseUrl);
  await db.migrate();
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const port = Number(process.env.PORT) || 3400;
  const setupCode = generateSetupCode();
  const masterKey = loadMasterKey();
  // Na een sleutelrotatie (security/key-rotation.js) de vorige sleutels om oudere gegevens en back-ups te lezen.
  const previousKeys = loadPreviousKeys();
  const app = createApp({ db, masterKey, previousKeys, databaseUrl, indexable: process.env.SITE_INDEXABLE === 'true', setupCode });
  // Logboek: wegschrijven en opschonen, fouten van achtergrondtaken (console) en onverwerkte fouten van het proces.
  app.locals.appLog.start();
  app.locals.appLog.captureConsole();
  // Aanmeldingen van vóór de personen-tabel (migratie 10) omzetten naar personen, zonder art. 9-gegevens, en eerder
  // overgenomen art. 9-gegevens wissen (A10); alleen aantallen in het log.
  createPersons({ vault: app.locals.services.vault }).backfillPersons(db)
    .then(({ converted, failed, purged, purgeFailed }) => {
      if (converted) console.log(`personen: ${converted} oude aanmelding(en) omgezet`);
      if (purged) console.log(`personen: bij ${purged} persoon/personen art. 9-gegevens van het oude formulier gewist`);
      if (purgeFailed) console.error(`personen: bij ${purgeFailed} persoon/personen art. 9-gegevens van het oude formulier niet gewist (volgende start opnieuw)`);
      if (failed) console.error(`personen: ${failed} oude aanmelding(en) niet te ontsleutelen (andere hoofdsleutel?)`);
    })
    .catch((error) => console.error(`personen: omzetten mislukt (${error.code || error.name})`));
  // Een onverwerkte promise-fout stopt het proces, net als zonder deze listener (Node 22: `--unhandled-rejections=throw`),
  // maar pas nadat de fout in het logboek staat. Docker start de container daarna opnieuw.
  let stopping = false;
  process.on('unhandledRejection', (reason) => {
    const described = describeError(reason);
    process.stderr.write(`Onverwerkte fout${stopping ? ' tijdens het afsluiten' : ''}: ${described.name}: ${described.message}\n`);
    if (stopping) return;
    stopping = true;
    app.locals.appLog.error('proces', `Onverwerkte fout: ${described.message}`, { data: { frames: described.frames } });
    // Harde grens: hangt de database, dan stopt het proces toch na drie seconden.
    setTimeout(() => process.exit(1), 3000);
    app.locals.appLog.flush().catch(() => {}).finally(() => process.exit(1));
  });
  // Vaste inhoud uit site-content.json eenmalig naar de database (W28); wat al is overgezet, blijft zoals het is.
  const siteContentFile = path.join(DATA_DIR, SITE_CONTENT_FILE);
  const transferred = await transferFixedContent({ db, siteContent: fs.existsSync(siteContentFile) ? app.locals.services.siteContent.load() : null });
  for (const part of transferred) console.log(`vaste inhoud: ${part.part} overgezet naar de database (${part.summary})`);
  startBackgroundTasks(app.locals.services, db);
  const [{ present }] = await db.query('SELECT EXISTS (SELECT 1 FROM users) AS present');
  // Eenmalige installatiecode voor de eerste beheerder; alleen bruikbaar zolang er geen enkele CRM-gebruiker is.
  if (!present) console.log(`CRM: nog geen gebruikers. Maak de eerste beheerder aan op /app/installatie/ met installatiecode ${setupCode}`);
  return app.listen(port, () => console.log(`Avanta Reizen luistert op poort ${port}`));
}

/**
 * Leest een geheim uit een bestand (Docker-secret), of geeft undefined.
 * @param {string} [filePath] Pad van het bestand.
 * @returns {string|undefined} De inhoud zonder witruimte.
 */
function readSecretFile(filePath) {
  return filePath ? fs.readFileSync(path.resolve(filePath), 'utf8').trim() : undefined;
}

if (require.main === module) {
  start().catch((error) => {
    console.error(`Starten mislukt: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { createApp, start, parseTrustProxy, hstsValue, BASE_CSP, HSTS_VALUE, HSTS_PRELOAD_VALUE };
