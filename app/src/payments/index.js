/**
 * Ingang van de module Betalingen voor het CRM: koppelt de routes van de betalingen per aanmelding en het
 * betalingsoverzicht. De openbare betaallink en de webhook (`online-payment-routes.js`) koppelt `server.js` buiten
 * `/app/`. Een nieuw scherm in deze module krijgt hier een regel; `crm/routes.js` hoeft daarvoor niet te veranderen.
 */
const express = require('express');
const { createPaymentRoutes } = require('./payment-routes');
const { createPaymentOverviewRoutes } = require('./payment-overview-routes');

/**
 * Bouwt de routes van de module Betalingen.
 * @param {object} context Wat de schil van het CRM meegeeft (`crm/routes.js`): `db`, `auth` (sessies en rechten),
 *   `persons` (versleutelde persoonsblokken) en de gedeelde diensten uit `server.js`.
 * @returns {express.Router} Router, te koppelen binnen `/app`.
 */
function createPaymentsModuleRoutes(context) {
  const { db, auth, settings, now } = context;
  const router = express.Router();
  router.use(createPaymentRoutes({ db, auth, settings, reminders: context.paymentReminders, onlinePayments: context.onlinePayments, now }));
  router.use(createPaymentOverviewRoutes({ db, auth, settings, now, maxRows: context.paymentOverviewMaxRows }));
  return router;
}

module.exports = { createPaymentsModuleRoutes };
