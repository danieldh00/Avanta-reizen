// @ts-check
/**
 * Gedeelde stukken voor de API-routes van de modules (`<module>/<onderwerp>-api.js`): een limiet op schrijven per
 * gebruiker, het omzetten van de veldnamen van een formuliercontrole naar die van de API, het schema van een veld
 * Volgorde en de foto's voor de fotokiezer. Zo hoeft niet elke module dezelfde regels opnieuw te schrijven.
 */
const { createRateLimiter } = require('../security/rate-limit');
const { searchPatterns } = require('../persons/person-routes');
const { mediaUrl } = require('../media/library');
const { pickerPhotos } = require('../media/picker');
const { z } = require('./schema');

/** Zoekvraag van de fotokiezer (`photo-picker.vue`): zoektekst, pagina en of alle landen meedoen. */
const photoQuerySchema = z.object({
  zoek: z.string().max(100, 'Hoogstens 100 tekens.').optional(),
  pagina: z.coerce.number().int().min(1).max(1000).optional(),
  alle: z.enum(['0', '1']).optional(),
}).strict();

/**
 * Haalt een pagina foto's voor de fotokiezer op, in de vorm van `PickerPage` (`photo-picker.vue`): id, klein adres,
 * titel, alternatieve tekst, landen en maat. Gedeeld door elke module met een fotokiezer; het recht controleert de route.
 * @param {any} library Fotobibliotheek (`createMediaLibrary`).
 * @param {{text?: string, page?: number, countryId?: (number|null)}} query Zoektekst, pagina en eventueel een land.
 * @returns {Promise<{photos: any[], hasMore: boolean}>} Foto's en of er een volgende pagina is.
 */
async function photoPickerPage(library, query) {
  const { patterns } = searchPatterns(query.text || '');
  const { photos, hasMore } = await pickerPhotos(library, { patterns, countryId: query.countryId || null, page: query.page || 1 });
  return {
    photos: photos.map((photo) => ({
      id: photo.id, url: mediaUrl(photo, 400), title: photo.title || photo.local_name, alt: photo.alt_text || '',
      meta: photo.countries.length ? photo.countries.join(', ') : 'Geen land', width: photo.width || 400, height: photo.height || 300,
    })),
    hasMore,
  };
}

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

module.exports = { createWriteLimit, apiFieldNames, sortOrderSchema, photoQuerySchema, photoPickerPage };
