/**
 * Ingang van de module Website-inhoud voor het CRM: koppelt de routes van pagina's, menu's, veelgestelde vragen,
 * de koppen van de lijstpagina's en het blog. Een nieuw scherm in deze module krijgt hier een regel; `crm/routes.js` hoeft daarvoor niet te veranderen.
 */
const express = require('express');
const { createPageRoutes } = require('./page-routes');
const { createMenuRoutes } = require('./menu-routes');
const { createPostRoutes } = require('./post-routes');
const { createPostTermRoutes } = require('./post-term-routes');
const { createFaqRoutes } = require('./faq-routes');
const { createListHeaderRoutes } = require('./list-header-routes');

/**
 * Bouwt de routes van de module Website-inhoud. De volgorde telt: categorieën en tags (`/blog/categorieen-en-tags/`)
 * staan vóór de blogberichten (`/blog/…`).
 * @param {object} context Wat de schil van het CRM meegeeft (`crm/routes.js`): `db`, `auth` (sessies en rechten) en
 *   de gedeelde diensten uit `server.js`.
 * @returns {express.Router} Router, te koppelen binnen `/app`.
 */
function createCmsModuleRoutes(context) {
  const { db, auth, redirects, menus, siteContent } = context;
  const library = context.mediaLibrary;
  const router = express.Router();
  router.use(createPageRoutes({ db, auth, library, redirects, menus, homepage: context.homepage, siteContent }));
  router.use(createMenuRoutes({ db, auth, menus }));
  router.use(createFaqRoutes({ db, auth }));
  router.use(createListHeaderRoutes({ db, auth, library, listHeaders: context.listHeaders }));
  router.use(createPostTermRoutes({ db, auth, redirects, siteContent }));
  router.use(createPostRoutes({ db, auth, library, redirects, menus, siteContent }));
  return router;
}

module.exports = { createCmsModuleRoutes };
