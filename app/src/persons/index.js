/**
 * Ingang van de module Personen voor het CRM: koppelt de routes van deelnemers (met inzage en wissen), het
 * samenvoegen van dubbelen en de deelnemerslijsten. Een nieuw scherm in deze module krijgt hier een regel;
 * `crm/routes.js` hoeft daarvoor niet te veranderen.
 */
const express = require('express');
const { createPersonRoutes } = require('./person-routes');
const { createPersonMergeRoutes } = require('./person-merge-routes');
const { createParticipantListRoutes } = require('./participant-list-routes');

/**
 * Bouwt de routes van de module Personen.
 * @param {object} context Wat de schil van het CRM meegeeft (`crm/routes.js`): `db`, `auth` (sessies en rechten),
 *   `persons` (versleutelde persoonsblokken) en de gedeelde diensten uit `server.js`.
 * @returns {express.Router} Router, te koppelen binnen `/app`.
 */
function createPersonsModuleRoutes(context) {
  const { db, auth, persons, now } = context;
  const router = express.Router();
  router.use(createPersonRoutes({ db, auth, persons, now }));
  router.use(createPersonMergeRoutes({ db, auth, persons }));
  router.use(createParticipantListRoutes({ db, auth, persons, now }));
  return router;
}

module.exports = { createPersonsModuleRoutes };
