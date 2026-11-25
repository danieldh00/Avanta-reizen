// @ts-check
/**
 * Invoer van de JSON-API controleren met één schemabibliotheek (zod; besluit 4 in `docs/VUE-OMBOUW.md`). Alleen voor
 * de nieuwe API-routes; de bestaande opschoning in de logica van elke module blijft daarnaast gewoon staan.
 *
 * Een route beschrijft zijn invoer als schema en krijgt alleen de gecontroleerde waarden (onbekende velden worden
 * geweigerd met `.strict()`). Een fout wordt één antwoord `ongeldig` met een melding per veld.
 */
const { z } = require('zod');
const { sendApiError } = require('./errors');

// Standaardmeldingen in het Nederlands; een schema zet bij voorkeur een eigen, duidelijke melding per veld.
z.config(z.locales.nl());

/**
 * Zet de problemen uit zod om naar één melding per veld (het eerste probleem per veld telt). Het pad is de naam van het
 * veld met punten (`vertrek.datum`); een probleem op het geheel heet `_`.
 * @param {ReadonlyArray<{path: ReadonlyArray<PropertyKey>, message: string}>} issues Problemen uit zod.
 * @returns {Record<string, string>} Melding per veld.
 */
function fieldMessages(issues) {
  /** @type {Record<string, string>} */
  const fields = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join('.') || '_';
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
}

/**
 * Controleert een waarde tegen een schema.
 * @template T
 * @param {z.ZodType<T>} schema Het schema.
 * @param {unknown} value De invoer.
 * @returns {{ok: true, data: T} | {ok: false, fields: Record<string, string>}} De gecontroleerde waarde of de meldingen.
 */
function parseInput(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, fields: fieldMessages(result.error.issues) };
}

/**
 * Middleware-fabriek: controleert de body (of de query) van een verzoek en zet het resultaat op `req.input`. Bij een
 * fout volgt `ongeldig` (400) met een melding per veld.
 * @param {z.ZodType<any>} schema Het schema.
 * @param {'body'|'query'} [source] Waar de invoer staat; standaard de body.
 * @returns {Function} Express-middleware.
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = parseInput(schema, req[source]);
    if ('fields' in result) return sendApiError(res, 'ongeldig', { fields: result.fields });
    req.input = result.data;
    return next();
  };
}

/** Id uit de URL: een positief geheel getal (als tekst in het pad), anders `niet-gevonden` bij de route zelf. */
const idParam = z.coerce.number().int().positive().max(2147483647);

module.exports = { z, parseInput, validate, fieldMessages, idParam };
