/**
 * Ingang van de module Boeken voor het CRM: koppelt de routes van de aanmeldingen (`crm-routes.js`) en het handmatig
 * invoeren van een aanmelding (`manual-routes.js`). Het openbare
 * aanmeldformulier (`routes.js`) koppelt `server.js` buiten `/app/`. Een nieuw scherm in deze module krijgt hier een
 * regel; `crm/routes.js` hoeft daarvoor niet te veranderen.
 */
const express = require('express');
const { createBookingRoutes } = require('./crm-routes');
const { createManualBookingRoutes } = require('./manual-routes');

/**
 * Bouwt de CRM-routes van de module Boeken.
 * @param {object} context Wat de schil van het CRM meegeeft (`crm/routes.js`): `db`, `auth` (sessies en rechten),
 *   `persons` (versleutelde persoonsblokken), `notifications` (bevestiging aan de reiziger) en de gedeelde diensten
 *   uit `server.js`.
 * @returns {express.Router} Router, te koppelen binnen `/app`.
 */
function createBookingModuleRoutes(context) {
  const { db, auth, settings, persons, notifications, now } = context;
  const router = express.Router();
  // Eerst het invoerformulier: `/aanmeldingen/nieuw/` is geen id van een aanmelding.
  router.use(createManualBookingRoutes({ db, auth, persons, notifications, now }));
  router.use(createBookingRoutes({ db, auth, settings, now }));
  return router;
}

module.exports = { createBookingModuleRoutes };
