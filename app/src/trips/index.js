/**
 * Ingang van de module Reisaanbod voor het CRM: koppelt de routes van reizen, reistypes en landen, en reisleiders.
 * Een nieuw scherm in deze module krijgt hier een regel; `crm/routes.js` hoeft daarvoor niet te veranderen.
 */
const express = require('express');
const { createCategoryRoutes } = require('./category-routes');
const { createTripRoutes } = require('./trip-routes');
const { createGuideRoutes } = require('./guide-routes');

/**
 * Bouwt de routes van de module Reisaanbod.
 * @param {object} context Wat de schil van het CRM meegeeft (`crm/routes.js`): `db`, `auth` (sessies en rechten) en
 *   de gedeelde diensten uit `server.js`.
 * @returns {express.Router} Router, te koppelen binnen `/app`.
 */
function createTripsModuleRoutes(context) {
  const { db, auth, redirects } = context;
  const library = context.mediaLibrary;
  const router = express.Router();
  router.use(createTripRoutes({ db, auth, redirects, library, settings: context.settings }));
  router.use(createCategoryRoutes({ db, auth, redirects, library }));
  router.use(createGuideRoutes({ db, auth, redirects, library, siteContent: context.siteContent }));
  return router;
}

module.exports = { createTripsModuleRoutes };
