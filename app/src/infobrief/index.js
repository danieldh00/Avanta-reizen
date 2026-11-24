// @ts-check
/**
 * Ingang van de module Infobrief voor het CRM: koppelt de routes van de infobrieven (`infobrief-routes.js`). De
 * verzender in de achtergrond (`sender.js`) maakt `services.js` aan; die komt hier binnen als `infobriefSender`. Een
 * nieuw scherm in deze module krijgt hier een regel; `crm/routes.js` hoeft daarvoor niet te veranderen.
 */
const express = require('express');
const { createInfobriefRoutes } = require('./infobrief-routes');

/**
 * Bouwt de CRM-routes van de module Infobrief.
 * @param {any} context Wat de schil van het CRM meegeeft (`crm/routes.js`): `db`, `auth`, `persons`, `settings`,
 *   `mailer`, `infobriefSender` en (voor tests) `now`.
 * @returns {express.Router} Router, te koppelen binnen `/app`.
 */
function createInfobriefModuleRoutes(context) {
  const { db, auth, persons, settings, mailer, infobriefSender, now } = context;
  const router = express.Router();
  router.use(createInfobriefRoutes({ db, auth, persons, settings, mailer, sender: infobriefSender, now }));
  return router;
}

module.exports = { createInfobriefModuleRoutes };
