/**
 * Webserver van Avanta Reizen: de publieke website op `/` en het CRM op `/app/`.
 * Start met `node src/server.js`; vereist DATABASE_URL.
 */
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { createDatabase } = require('./database/db');
const { createSiteRouter } = require('./site/routes');
const { createBookingRouter } = require('./booking/routes');
const { createContactForm } = require('./contact/routes');
const { createCrmRouter, generateSetupCode } = require('./crm/routes');
const { startCrmMaintenance } = require('./crm/auth');
const seo = require('./site/seo');
const { loadMasterKey, createVault } = require('./security/vault');
const { createSettings } = require('./beheer/settings');
const { siteSettingsOf } = require('./site/site-settings');
const { createRedirects } = require('./site/redirects');
const { cspWith } = require('./site/analytics');
const { createMailer } = require('./mail/mailer');
const { createWanIp } = require('./mail/wan-ip');
const { createNotifications } = require('./mail/notifications');
const { createCaptcha, cspWith: captchaCspWith, isFormPath } = require('./security/captcha');
const crypto = require('node:crypto');
const { PUBLIC_DIR, MEDIA_DIR, DATA_DIR } = require('./paths');
const { createBackupService } = require('./backup/backups');
const { createDrive } = require('./backup/drive');
const { roleHasRight } = require('./crm/rights');
const { createPersons } = require('./crm/persons');
const { createRestoreTests } = require('./backup/restore-test');
const { renderPage, renderPageHeader } = require('./site/layout');
const { createSystemUpdate } = require('./system/system-update');
const { createHostTasks } = require('./system/host-tasks');
const { maintenanceState, maintenanceGuard } = require('./system/maintenance');
const { runWithContext, currentContext } = require('./system/request-context');
const { startUpdateSync } = require('./beheer/update-routes');
const { createMonitor } = require('./system/monitor');
const { createAppLog, normalizePath, describeError, newErrorCode, newRequestId } = require('./system/app-log');
const { html } = require('./site/html');

/** De standaard Content-Security-Policy: alleen eigen bestanden, geen inline scripts. */
const BASE_CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

/**
 * Zet de beveiligingskoppen op elk antwoord, met standaard `noindex`: de middleware met de site-instellingen haalt die
 * kop pas weg als indexeren in Beheer aan staat. Zo is een antwoord van vóór die middleware (of bij een fout) nooit
 * indexeerbaar.
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
 * @param {{db: object, masterKey: Buffer, settings?: object, appLog?: object, systemUpdate?: object, updateStatusDir?: string, updateRequestDir?: string, mailer?: object, wanIp?: object, captcha?: object, captchaFetch?: Function, backups?: object, databaseUrl?: string, backupDir?: string, pgDumpPath?: string, googleFetch?: Function, statfs?: Function, monitorRequest?: Function, monitorDataDir?: string, indexable?: boolean, siteUrl?: string, trustProxy?: string, setupCode?: string, secureCookies?: boolean, now?: () => number, homepage?: {load: Function}, siteContent?: {load: Function}}} options Database,
 *   hoofdsleutel, de instellingen (standaard uit de database, `beheer/settings.js`), het logboek (standaard
 *   `system/app-log.js`; wegschrijven start pas met `appLog.start()` in `start()`), de koppeling met het updatescript
 *   (standaard `system/system-update.js` met de mappen uit `updateStatusDir`/`updateRequestDir` of UPDATE_STATUS_DIR/UPDATE_REQUEST_DIR), de mailer en WAN-IP-opzoeker (standaard `mail/`), de captcha (standaard `security/captcha.js`, met `captchaFetch` als eigen fetch), de back-updienst (standaard `backup/backups.js` met `databaseUrl`, `backupDir` en `pgDumpPath`; zonder `databaseUrl` geen back-ups), een eigen fetch voor Google Drive (`googleFetch`, tests), of de site geïndexeerd mag worden, het basisadres (standaard `SITE_URL`), welke proxy vertrouwd wordt
 *   (standaard `TRUST_PROXY`, anders loopback), de installatiecode voor de eerste CRM-beheerder en of de CRM-cookie
 *   `Secure` krijgt (standaard ja).
 * @returns {express.Express} De app.
 */
function createApp(options) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', parseTrustProxy(options.trustProxy ?? process.env.TRUST_PROXY));
  app.use(securityHeaders());
  // Elk verzoek een eigen request-id (nooit een id van buiten) in de context en in de kop X-Request-Id; trage verzoeken
  // komen in het logboek (genormaliseerd pad, geen querystring). Het logboek zelf wordt verderop gemaakt.
  let appLog = null;
  let settingsRef = null;
  app.use((req, res, next) => {
    const requestId = newRequestId();
    res.set('X-Request-Id', requestId);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      const threshold = appLog && settingsRef ? Number(settingsRef.get('logSlowMs')) || 1500 : Infinity;
      if (durationMs >= threshold) {
        appLog.warn('traag', `${req.method} ${normalizePath(req.originalUrl)} ${res.statusCode} in ${Math.round(durationMs)} ms`, { requestId, durationMs });
      }
    });
    runWithContext({ requestId }, next);
  });

  app.get('/api/health', async (req, res) => {
    try {
      await options.db.query('SELECT 1 AS ok');
      res.json({ ok: true, version: require('../package.json').version });
    } catch (_) {
      res.status(503).json({ ok: false });
    }
  });

  // Instellingen uit Beheer: één keer geladen, daarna uit het geheugen (Beheer schrijft het geheugen bij). De opties
  // `indexable` en `siteUrl` (of SITE_INDEXABLE/SITE_URL) zijn alleen de startwaarde; Beheer gaat voor.
  const vault = createVault(options.masterKey);
  const startValues = {
    ...process.env,
    SITE_INDEXABLE: options.indexable ? 'true' : 'false',
    SITE_URL: options.siteUrl ?? process.env.SITE_URL ?? '',
  };
  const settings = options.settings || createSettings({ db: options.db, vault, env: startValues });
  settingsRef = settings;
  appLog = options.appLog || createAppLog({ db: options.db, settings });
  app.locals.appLog = appLog;
  // Onzichtbare captcha op de formulieren (tests geven een eigen fetch mee voor de controle bij Google).
  const captcha = options.captcha || createCaptcha({ settings, fetchImpl: options.captchaFetch });
  app.locals.captcha = captcha;
  app.use(async (req, res, next) => {
    try {
      await settings.ready();
      res.locals.site = siteSettingsOf(settings);
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

  // Updates vanuit de app en servertaken: de gedeelde mappen met het hostscript (leeg = niet ingericht, bijv. lokaal).
  const updateStatusDir = options.updateStatusDir ?? process.env.UPDATE_STATUS_DIR ?? '';
  const systemUpdate = options.systemUpdate || createSystemUpdate({
    statusDir: updateStatusDir, requestDir: options.updateRequestDir ?? process.env.UPDATE_REQUEST_DIR ?? '',
    currentVersion: require('../package.json').version, now: options.now,
  });
  const hostTasks = createHostTasks({ statusDir: updateStatusDir, settings });
  app.locals.systemUpdate = systemUpdate;
  // Onderhoudsmodus (update of met de hand): de stand per verzoek in de context (voor de balk in de layouts), daarna
  // weigert de bewaker schrijfverzoeken met 503.
  app.use((req, res, next) => {
    currentContext().maintenance = maintenanceState({ settings, systemUpdate });
    next();
  });
  app.use(maintenanceGuard(() => currentContext().maintenance));

  // Doorverwijzingen uit Beheer (oude adressen naar nieuwe), vóór de statische bestanden en de site.
  const redirects = createRedirects({ db: options.db, settings });
  app.locals.redirects = redirects;
  app.use(redirects.middleware);

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(seo.robotsTxt(res.locals.site));
  });

  app.use(express.static(PUBLIC_DIR, { maxAge: '7d', index: false, redirect: false }));
  app.use('/media', express.static(MEDIA_DIR, { maxAge: '30d', index: false, redirect: false, fallthrough: true }));

  // E-mail via de mailserver uit Beheer (tests geven een eigen mailer en WAN-IP-opzoeker mee).
  const mailer = options.mailer || createMailer({ settings });
  const wanIp = options.wanIp || createWanIp();
  app.locals.mailer = mailer;
  app.locals.settings = settings;
  const notifications = createNotifications({ mailer, settings });
  // Versleutelde back-ups (Beheer > Back-ups en herstel); alleen met een verbindings-URL voor pg_dump. Na elke back-up
  // gaat er een kopie naar Google Drive als die gekoppeld is (tests geven een eigen fetch mee als nep-Google).
  const backupDir = options.backupDir || path.join(DATA_DIR, 'backups');
  const drive = createDrive({
    settings, dir: backupDir, fetchImpl: options.googleFetch, now: options.now,
    audit: (entry, client) => client.query('INSERT INTO audit_log (user_id, action, entity) VALUES ($1, $2, $3)', [entry.userId ?? null, entry.action, 'google-drive']),
    isAllowed: async (userId) => {
      const [user] = await options.db.query('SELECT role, active FROM users WHERE id = $1', [userId]);
      return Boolean(user && user.active && roleHasRight(user.role, 'systeem'));
    },
  });
  const backups = options.backups || createBackupService({
    db: options.db, settings, dir: backupDir, masterKey: options.masterKey,
    connectionString: options.databaseUrl, pgDumpPath: options.pgDumpPath, now: options.now,
    onCreated: () => drive.sync().catch((error) => console.error(`Google Drive: ${String(error.message).replace(/[\r\n]/g, ' ')}`)),
  });
  app.locals.backups = backups;
  app.locals.drive = drive;
  const restoreTests = createRestoreTests({ dir: backupDir, masterKey: options.masterKey, drive, now: options.now });
  app.locals.restoreTests = restoreTests;
  // Bewaking (Beheer > Systeem > Bewaking): de planner start pas in `start()`; tests geven een eigen statfs/verzender mee.
  const monitor = createMonitor({
    db: options.db, settings, mailer, appLog, backups, drive, restoreTests, systemUpdate,
    dataDir: options.monitorDataDir || DATA_DIR, now: options.now, statfs: options.statfs, request: options.monitorRequest,
  });
  app.locals.monitor = monitor;

  app.use('/app', createCrmRouter({ db: options.db, masterKey: options.masterKey, settings, redirects, mailer, wanIp, captcha, backups, drive, restoreTests, systemUpdate, hostTasks, appLog, monitor, setupCode: options.setupCode, secureCookies: options.secureCookies, now: options.now }));

  const formKey = crypto.createHmac('sha256', options.masterKey).update('formulier-token').digest();
  app.use(createBookingRouter({ db: options.db, vault, formKey, notifications, captcha, now: options.now }));
  const contactForm = createContactForm({ db: options.db, formKey, notifications, captcha, now: options.now });
  app.use(createSiteRouter({ db: options.db, contactForm, homepage: options.homepage, siteContent: options.siteContent }));

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
  // eslint-disable-next-line no-unused-vars
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
  const app = createApp({ db, masterKey, databaseUrl, indexable: process.env.SITE_INDEXABLE === 'true', setupCode });
  // Logboek: wegschrijven en opschonen, fouten van achtergrondtaken (console) en onverwerkte fouten van het proces.
  app.locals.appLog.start();
  app.locals.appLog.captureConsole();
  // Aanmeldingen van vóór de personen-tabel (migratie 10) omzetten naar personen; alleen aantallen in het log.
  createPersons({ vault: createVault(masterKey) }).backfillPersons(db)
    .then(({ converted, failed }) => {
      if (converted) console.log(`personen: ${converted} oude aanmelding(en) omgezet`);
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
  startCrmMaintenance(db, app.locals.settings);
  app.locals.redirects.startTimers();
  app.locals.backups.startTimer();
  app.locals.drive.startTimer();
  app.locals.restoreTests.startTimer(() => app.locals.settings.get('driveEnabled'));
  app.locals.monitor.start();
  // Updates: de stand van "automatisch bijwerken" naar het hostscript en een afgeronde uitrol in het auditlog (elke minuut).
  startUpdateSync({ db, settings: app.locals.settings, systemUpdate: app.locals.systemUpdate });
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

module.exports = { createApp, start, parseTrustProxy, BASE_CSP };
