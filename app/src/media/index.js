// @ts-check
/**
 * Ingang van de module Foto's voor het CRM: koppelt de routes van de fotobibliotheek. Een nieuw scherm in deze
 * module krijgt hier een regel; `crm/routes.js` hoeft daarvoor niet te veranderen.
 */
const express = require('express');
const { createMediaRoutes } = require('./routes');

/**
 * Bouwt de routes van de module Foto's.
 * @param {any} context Wat de schil van het CRM meegeeft (`crm/routes.js`): `db`, `auth` (sessies en rechten) en
 *   de gedeelde diensten uit `server.js`.
 * @returns {express.Router} Router, te koppelen binnen `/app`.
 */
function createMediaModuleRoutes(context) {
  const { db, auth } = context;
  const router = express.Router();
  router.use(createMediaRoutes({ db, auth, library: context.mediaLibrary, limits: context.mediaLimits, now: context.now }));
  return router;
}

module.exports = { createMediaModuleRoutes };
