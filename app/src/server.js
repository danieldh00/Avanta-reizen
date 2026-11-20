/**
 * Webserver van Avanta Reizen: de publieke website op `/` (later het CRM op `/app/`).
 * Start met `node src/server.js`; vereist DATABASE_URL.
 */
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { createDatabase } = require('./database/db');
const { createSiteRouter } = require('./site/routes');
const { createBookingRouter } = require('./booking/routes');
const { loadMasterKey, createVault } = require('./security/vault');
const crypto = require('node:crypto');
const { PUBLIC_DIR, MEDIA_DIR } = require('./paths');
const { renderPage, renderPageHeader } = require('./site/layout');
const { html } = require('./site/html');

/**
 * Zet de beveiligingskoppen op elk antwoord. Zolang de site niet live is, mag niets geïndexeerd worden.
 * @param {{indexable: boolean}} options Of zoekmachines de site mogen indexeren.
 * @returns {Function} Express-middleware.
 */
function securityHeaders(options) {
  return (req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    if (!options.indexable) res.set('X-Robots-Tag', 'noindex, nofollow');
    next();
  };
}

/**
 * Welke proxy's Express vertrouwt voor `req.ip` (en daarmee de limiet per bezoeker). Standaard alleen loopback; achter
 * een reverse proxy in een andere container het exacte adres daarvan (bijv. `172.18.0.5`); geen subnet met het Docker-bridgenetwerk.
 * @param {(string|undefined)} value Waarde uit `TRUST_PROXY` (kommagescheiden adressen/subnetten of een getal).
 * @returns {(string|number)} Instelling voor Express.
 */
function parseTrustProxy(value) {
  const text = String(value ?? '').trim();
  if (!text) return 'loopback';
  return /^\d+$/.test(text) ? Number(text) : text;
}

/**
 * Bouwt de Express-app.
 * @param {{db: object, masterKey: Buffer, indexable?: boolean, trustProxy?: string, now?: () => number}} options Database, hoofdsleutel,
 *   of de site geïndexeerd mag worden en welke proxy vertrouwd wordt (standaard `TRUST_PROXY`, anders loopback).
 * @returns {express.Express} De app.
 */
function createApp(options) {
  const indexable = Boolean(options.indexable);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', parseTrustProxy(options.trustProxy ?? process.env.TRUST_PROXY));
  app.use(securityHeaders({ indexable }));

  app.get('/api/health', async (req, res) => {
    try {
      await options.db.query('SELECT 1 AS ok');
      res.json({ ok: true, version: require('../package.json').version });
    } catch (_) {
      res.status(503).json({ ok: false });
    }
  });

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(indexable ? 'User-agent: *\nAllow: /\nSitemap: /sitemap.xml\n' : 'User-agent: *\nDisallow: /\n');
  });

  app.use(express.static(PUBLIC_DIR, { maxAge: '7d', index: false, redirect: false }));
  app.use('/media', express.static(MEDIA_DIR, { maxAge: '30d', index: false, redirect: false, fallthrough: true }));

  const vault = createVault(options.masterKey);
  const formKey = crypto.createHmac('sha256', options.masterKey).update('formulier-token').digest();
  app.use(createBookingRouter({ db: options.db, vault, formKey, now: options.now }));
  app.use(createSiteRouter({ db: options.db, indexable }));

  app.use((req, res) => {
    res.status(404).send(renderPage({
      title: 'Pagina niet gevonden',
      path: req.path,
      header: renderPageHeader({ title: 'Pagina niet gevonden' }),
      body: html`<div class="container section"><p>Deze pagina bestaat niet (meer). Bekijk <a href="/reis/">ons reisaanbod</a> of ga naar de <a href="/">homepage</a>.</p></div>`,
    }));
  });

  // Express herkent een foutafhandelaar aan de vier parameters.
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    console.error(`Fout bij ${req.method} ${req.path.replace(/[\r\n]/g, ' ')}: ${String(error.message).replace(/[\r\n]/g, ' ')}`);
    res.status(500).send(renderPage({
      title: 'Er ging iets mis',
      path: req.path,
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
  const app = createApp({ db, masterKey: loadMasterKey(), indexable: process.env.SITE_INDEXABLE === 'true' });
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
