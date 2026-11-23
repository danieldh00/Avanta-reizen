/**
 * Route van het overzicht `/app/`: wat er te doen is per recht (`crm/dashboard.js`) en de melding als de eigen
 * tweestapsverificatie nog uit staat.
 */
const express = require('express');
const { html } = require('../site/html');
const { roleLabel } = require('./rights');
const { renderCrmPage } = require('./layout');
const { loadDashboard, renderDashboard } = require('./dashboard');

/**
 * Bouwt de route van het overzicht.
 * @param {{db: object, auth: object, twoFactor: object, settings: object, monitor?: object, backups?: object, systemUpdate?: object, appLog?: object, now?: () => number}} options
 *   Database, sessies, tweestapsverificatie en de diensten waar het overzicht de stand van toont.
 * @returns {express.Router} Router, te koppelen binnen `/app`.
 */
function createDashboardRoutes(options) {
  const { db, auth, twoFactor } = options;
  const router = express.Router();

  router.get('/', auth.requireLogin, async (req, res, next) => {
    try {
      const [mfa, data] = await Promise.all([
        twoFactor.stateOf(req.user.id),
        loadDashboard(
          { db, settings: options.settings, monitor: options.monitor, backups: options.backups, systemUpdate: options.systemUpdate, appLog: options.appLog },
          { role: req.user.role, now: (options.now || Date.now)() },
        ),
      ]);
      return res.send(renderCrmPage({
        title: 'Overzicht',
        user: req.user,
        csrf: req.session.csrf,
        path: '/app/',
        body: html`<p class="crm-summary">Welkom, ${req.user.name}. Je bent ingelogd als <strong>${roleLabel(req.user.role)}</strong>.</p>
          ${mfa.enabled ? '' : html`<p class="notice">Tweestapsverificatie staat nog uit voor je account${auth.mfaRequiredFor(req.user.role) ? ' en is verplicht vanaf de volgende keer dat je inlogt' : ''}. <a href="/app/tweestaps/">Nu instellen</a></p>`}
          ${renderDashboard(data)}`,
      }));
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createDashboardRoutes };
