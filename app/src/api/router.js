// @ts-check
/**
 * Router van de JSON-API onder `/app/api/`, gekoppeld in de schil van het CRM (`crm/routes.js`) ná het laden van de
 * sessie. Gedeeld voor alle modules:
 *
 * - bescherming tegen andere sites en `no-store` (`guard.js`), JSON tot een vaste grootte;
 * - `requireLogin`, `requireRight` en `requireGlobalRight` met antwoorden in JSON (401/403) in plaats van een
 *   doorverwijzing; de rechten zelf komen uit `crm/rights.js`, net als bij de schermen;
 * - één foutformaat (`errors.js`), ook voor een onbekend pad (404) en een onverwachte fout (500, met foutcode in het
 *   logboek);
 * - `GET /app/api/sessie/`: wie is ingelogd en met welke rechten (om in de frontend knoppen te verbergen; de server
 *   controleert elk verzoek opnieuw).
 *
 * Een module koppelt haar eigen API-routes met een fabriek `(context) => Router` in `modules`; de context bevat de
 * middleware hierboven en `validate` (`schema.js`). Limieten: de algemene limiet van het CRM geldt ook hier.
 */
const express = require('express');
const { roleHasRight, roleHasGlobalRight, roleLabel, RIGHTS } = require('../crm/rights');
const { newErrorCode, describeError, normalizePath } = require('../system/app-log');
const { currentContext } = require('../system/request-context');
const { createApiGuard } = require('./guard');
const { sendApiError } = require('./errors');
const { validate } = require('./schema');

/** Grootste JSON-body; een module met lange teksten krijgt later een eigen grens per pad. */
const JSON_LIMIT = '64kb';

/**
 * Bouwt de API-router.
 * @param {{auth: any, appLog?: any, modules?: Array<(context: any) => any>, multipartPaths?: RegExp[]}} options
 *   De authenticatie van het CRM (`crm/auth.js`), het logboek, de API-fabrieken van de modules en de paden waar een
 *   upload mag.
 * @returns {express.Router} Router, te koppelen op `/app/api`.
 */
function createApiRouter(options) {
  const { auth, appLog } = options;
  const router = express.Router();
  router.use(createApiGuard({ multipartPaths: options.multipartPaths }));
  router.use(express.json({ limit: JSON_LIMIT, strict: true, type: 'application/json' }));

  /**
   * Middleware: alleen met een volledige sessie; anders 401 met het pad om in te loggen (of de tweede stap).
   * @param {any} req Express-verzoek.
   * @param {any} res Express-antwoord.
   * @param {Function} next Volgende stap.
   * @returns {any} Niets, of het foutantwoord.
   */
  const requireLogin = (req, res, next) => {
    if (req.user) return next();
    return sendApiError(res, 'niet-ingelogd', { loginPath: auth.pendingPath(req) || '/app/inloggen/' });
  };

  /**
   * Middleware-fabriek: vereist een recht (zie `crm/rights.js`); zonder recht 403.
   * @param {string} right Het recht.
   * @returns {Function} Express-middleware.
   */
  const requireRight = (right) => (req, res, next) => requireLogin(req, res, () => (
    roleHasRight(req.user.role, right) ? next() : sendApiError(res, 'geen-toegang')));

  /**
   * Middleware-fabriek: vereist een recht voor álle records (niet beperkt tot eigen vertrekken); anders 403.
   * @param {string} right Het recht.
   * @returns {Function} Express-middleware.
   */
  const requireGlobalRight = (right) => (req, res, next) => requireLogin(req, res, () => (
    roleHasGlobalRight(req.user.role, right) ? next() : sendApiError(res, 'geen-toegang')));

  router.get('/sessie/', requireLogin, (req, res) => {
    res.json({
      gebruiker: { naam: req.user.name, rol: req.user.role, rolNaam: roleLabel(req.user.role) },
      rechten: Object.keys(RIGHTS).filter((right) => roleHasRight(req.user.role, right)),
    });
  });

  const context = { ...options, requireLogin, requireRight, requireGlobalRight, validate, sendApiError };
  for (const createModuleApi of options.modules || []) router.use(createModuleApi(context));

  router.use((req, res) => sendApiError(res, 'niet-gevonden'));

  // Express herkent een foutafhandelaar aan de vier parameters.
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error && error.type === 'entity.too.large') return sendApiError(res, 'te-groot');
    if (error && error.type === 'entity.parse.failed') return sendApiError(res, 'ongeldig', { message: 'Het verzoek is geen geldige JSON.' });
    const errorCode = newErrorCode();
    const described = describeError(error);
    // Zelfde bron als de foutafhandelaar van de app (`server.js`), zodat de foutcode op dezelfde plek te vinden is.
    const { requestId } = currentContext();
    if (appLog) appLog.error('fout', `${described.name}: ${described.message}`, { errorCode, requestId, data: { method: req.method, path: normalizePath(req.originalUrl), code: described.code, frames: described.frames } });
    return sendApiError(res, 'fout', { errorCode });
  });
  return router;
}

module.exports = { createApiRouter, JSON_LIMIT };
