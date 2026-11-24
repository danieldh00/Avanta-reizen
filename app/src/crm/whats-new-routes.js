// @ts-check
/**
 * Route `/app/wat-is-er-nieuw/`: de wijzigingen in de app per versie (`crm/whats-new.js`), voor iedere ingelogde
 * gebruiker van het CRM. Te vinden in het gebruikersmenu rechtsboven. De technische details ziet alleen wie het recht
 * `systeem` heeft.
 */
const express = require('express');
const { renderCrmPage } = require('./layout');
const { roleHasRight } = require('./rights');
const { createChangelogReader, renderWhatsNew } = require('./whats-new');

/** Adres van de pagina. */
const WHATS_NEW_PATH = '/app/wat-is-er-nieuw/';

/**
 * Bouwt de route van *Wat is er nieuw*.
 * @param {{auth: {requireLogin: Function}, readChangelog?: () => import('./whats-new').Release[], version?: string}} options
 *   Sessies, en voor de tests een eigen lezer van de changelog en versie.
 * @returns {express.Router} Router, te koppelen binnen `/app`.
 */
function createWhatsNewRoutes(options) {
  const router = express.Router();
  const readChangelog = options.readChangelog || createChangelogReader();
  const version = options.version || require('../../package.json').version;

  router.get('/wat-is-er-nieuw/', /** @type {express.RequestHandler} */ (options.auth.requireLogin), (req, res) => {
    const request = /** @type {any} */ (req);
    res.send(renderCrmPage({
      title: 'Wat is er nieuw',
      user: request.user,
      csrf: request.session.csrf,
      path: WHATS_NEW_PATH,
      body: renderWhatsNew(readChangelog(), { currentVersion: version, showDetails: roleHasRight(request.user.role, 'systeem') }),
    }));
  });

  return router;
}

module.exports = { createWhatsNewRoutes, WHATS_NEW_PATH };
