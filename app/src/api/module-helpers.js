// @ts-check
/**
 * Gedeelde stukken voor de API-routes van de modules (`<module>/<onderwerp>-api.js`): een limiet op schrijven per
 * gebruiker, het omzetten van de veldnamen van een formuliercontrole naar die van de API en het schema van een veld
 * Volgorde. Zo hoeft niet elke module dezelfde regels opnieuw te schrijven.
 */
const { createRateLimiter } = require('../security/rate-limit');
const { z } = require('./schema');

/**
 * Volgorde: een heel getal zoals in de formulieren (hoogstens zes cijfers, ook negatief).
 */
const sortOrderSchema = z.number({ error: 'Vul een heel getal in.' }).int('Vul een heel getal in.').min(-999999, 'Vul een heel getal in.').max(999999, 'Vul een heel getal in.');

/**
 * Maakt een middleware die schrijvende verzoeken per gebruiker telt; boven de limiet `te-veel` (429) met `Retry-After`.
 * @param {{name: string, limit: number, sendApiError: Function, now?: () => number}} options Naam van de teller (per
 *   module), aantal per minuut, de foutfunctie van de API en de klok (tests).
 * @returns {Function} Express-middleware.
 */
function createWriteLimit(options) {
  const limiter = createRateLimiter({ limit: options.limit, windowMs: 60 * 1000, now: options.now });
  return (req, res, next) => {
    if (limiter.hit(`${options.name}:${req.user.id}`)) return next();
    res.set('Retry-After', '60');
    return options.sendApiError(res, 'te-veel');
  };
}

/**
 * Zet de fouten van een formuliercontrole om naar de veldnamen van de API; een onbekende naam blijft gelijk.
 * @param {Record<string, string>} errors Fouten met de namen van het formulier.
 * @param {Record<string, string>} names Naam in het formulier naar naam in de API.
 * @returns {Record<string, string>} Fouten met de namen van de API.
 */
function apiFieldNames(errors, names) {
  /** @type {Record<string, string>} */
  const fields = {};
  for (const [name, message] of Object.entries(errors)) fields[Object.hasOwn(names, name) ? names[name] : name] = message;
  return fields;
}

module.exports = { createWriteLimit, apiFieldNames, sortOrderSchema };
