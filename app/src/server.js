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
const crypto = require('node:crypto');
const { PUBLIC_DIR, MEDIA_DIR } = require('./paths');
const { renderPage, renderPageHeader } = require('./site/layout');
const { html } = require('./site/html');

/**
 * Zet de beveiligingskoppen op elk antwoord, met standaard `noindex`: de middleware met de site-instellingen haalt die
 * kop pas weg als indexeren in Beheer aan staat. Zo is een antwoord van vóór die middleware (of bij een fout) nooit
 * indexeerbaar.
 * @returns {Function} Express-middleware.
 */
function securityHeaders() {
  return (req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
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
 * @param {{db: object, masterKey: Buffer, settings?: object, indexable?: boolean, siteUrl?: string, trustProxy?: string, setupCode?: string, secureCookies?: boolean, now?: () => number}} options Database,
 *   hoofdsleutel, de instellingen (standaard uit de database, `beheer/settings.js`), of de site geïndexeerd mag worden, het basisadres (standaard `SITE_URL`), welke proxy vertrouwd wordt
 *   (standaard `TRUST_PROXY`, anders loopback), de installatiecode voor de eerste CRM-beheerder en of de CRM-cookie
 *   `Secure` krijgt (standaard ja).
 * @returns {express.Express} De app.
 */
function createApp(options) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', parseTrustProxy(options.trustProxy ?? process.env.TRUST_PROXY));
  app.use(securityHeaders());

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
  app.use(async (req, res, next) => {
    try {
      await settings.ready();
      res.locals.site = siteSettingsOf(settings);
      // Express routeert hoofdletterongevoelig, dus ook `/APP/…` is het CRM: dat blijft altijd noindex.
      const lowerPath = req.path.toLowerCase();
      if (res.locals.site.indexable && !lowerPath.startsWith('/app/') && lowerPath !== '/app') res.removeHeader('X-Robots-Tag');
      return next();
    } catch (error) {
      return next(error);
    }
  });

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(seo.robotsTxt(res.locals.site));
  });

  app.use(express.static(PUBLIC_DIR, { maxAge: '7d', index: false, redirect: false }));
  app.use('/media', express.static(MEDIA_DIR, { maxAge: '30d', index: false, redirect: false, fallthrough: true }));

  app.use('/app', createCrmRouter({ db: options.db, masterKey: options.masterKey, settings, setupCode: options.setupCode, secureCookies: options.secureCookies, now: options.now }));

  const formKey = crypto.createHmac('sha256', options.masterKey).update('formulier-token').digest();
  app.use(createBookingRouter({ db: options.db, vault, formKey, now: options.now }));
  const contactForm = createContactForm({ db: options.db, formKey, now: options.now });
  app.use(createSiteRouter({ db: options.db, contactForm }));

  // 404: altijd noindex (kop en renderPage zonder indexable), met een canonical naar het gevraagde pad.
  app.use((req, res) => {
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
    console.error(`Fout bij ${req.method} ${req.path.replace(/[\r\n]/g, ' ')}: ${String(error.message).replace(/[\r\n]/g, ' ')}`);
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.status(500).send(renderPage({
      title: 'Er ging iets mis',
      path: req.path,
      site: res.locals.site,
      header: renderPageHeader({ title: 'Er ging iets mis' }),
      body: html`<div class="container section"><p>Probeer het later opnieuw.</p></div>`,
    }));
  });
  return app;
}

/**
 * Start de server: database verbinden, migraties draaien en luisteren op PORT.
 * @returns {Promise<import('node:http').Server>} De server.
 */
async function start() {
  const db = createDatabase(process.env.DATABASE_URL || readSecretFile(process.env.DATABASE_URL_FILE));
  await db.migrate();
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const port = Number(process.env.PORT) || 3400;
  const setupCode = generateSetupCode();
  const app = createApp({ db, masterKey: loadMasterKey(), indexable: process.env.SITE_INDEXABLE === 'true', setupCode });
  startCrmMaintenance(db);
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

module.exports = { createApp, start, parseTrustProxy };
