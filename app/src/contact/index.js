// @ts-check
/**
 * Ingang van de module Contact voor het CRM: koppelt de routes van de berichten (`message-routes.js`). Het openbare
 * contactformulier (`routes.js`) hoort bij de pagina `/contact/` van de site en wordt daar gekoppeld. Een nieuw scherm
 * in deze module krijgt hier een regel; `crm/routes.js` hoeft daarvoor niet te veranderen.
 */
const express = require('express');
const { createMessageRoutes } = require('./message-routes');

/**
 * Bouwt de CRM-routes van de module Contact.
 * @param {any} context Wat de schil van het CRM meegeeft (`crm/routes.js`): `db`, `auth` en de gedeelde diensten.
 * @returns {express.Router} Router, te koppelen binnen `/app`.
 */
function createContactModuleRoutes(context) {
  const { db, auth } = context;
  const router = express.Router();
  router.use(createMessageRoutes({ db, auth }));
  return router;
}

module.exports = { createContactModuleRoutes };
