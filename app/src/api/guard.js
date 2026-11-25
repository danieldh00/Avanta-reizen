// @ts-check
/**
 * Bescherming van de JSON-API onder `/app/api/` tegen verzoeken van andere sites (CSRF), bovenop de sessiecookie met
 * `SameSite=Strict`:
 *
 * - elk verzoek draagt de vaste kop `X-Avanta-Api: 1`. Een andere site kan die kop alleen meesturen na een
 *   CORS-voorcontrole, en die beantwoordt de server nooit; een gewone link of formulier naar de API werkt dus niet;
 * - het verzoek komt van deze site (`Sec-Fetch-Site`/`Origin`, `security/form-guard.js`);
 * - een schrijvend verzoek met inhoud stuurt `application/json`, of `multipart/form-data` alleen op de paden die
 *   daarvoor zijn opgegeven (uploads).
 *
 * Elk antwoord krijgt `Cache-Control: no-store`: er blijven geen gegevens in de cache van de browser.
 */
const { isCrossSite } = require('../security/form-guard');
const { sendApiError } = require('./errors');

/** Naam en waarde van de vaste kop die de client van de frontend meestuurt. */
const API_HEADER = 'x-avanta-api';
const API_HEADER_VALUE = '1';

/** Methoden die iets veranderen. */
const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Of een verzoek inhoud heeft (een body), volgens de koppen.
 * @param {any} req Express-verzoek.
 * @returns {boolean} Waar bij een `Content-Length` groter dan nul of `Transfer-Encoding`.
 */
function hasBody(req) {
  return Boolean(req.get('transfer-encoding')) || Number(req.get('content-length') || 0) > 0;
}

/**
 * Middleware-fabriek voor de bescherming van de API.
 * @param {{multipartPaths?: RegExp[]}} [options] Paden (binnen `/app/api`) waar een upload met `multipart/form-data` mag.
 * @returns {Function} Express-middleware.
 */
function createApiGuard(options = {}) {
  const multipartPaths = options.multipartPaths || [];
  return (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.get(API_HEADER) !== API_HEADER_VALUE || isCrossSite(req)) return sendApiError(res, 'geweigerd');
    if (!WRITE_METHODS.includes(req.method) || !hasBody(req)) return next();
    if (req.is('application/json')) return next();
    if (req.is('multipart/form-data') && multipartPaths.some((pattern) => pattern.test(req.path))) return next();
    return sendApiError(res, 'verkeerd-formaat');
  };
}

module.exports = { createApiGuard, API_HEADER, API_HEADER_VALUE, WRITE_METHODS };
