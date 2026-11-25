// @ts-check
/**
 * Foutformaat van de JSON-API onder `/app/api/`. Elke fout heeft dezelfde vorm, zodat de getypte client in de
 * frontend (`app/web/src/api/client.ts`) hem op één plek afhandelt:
 *
 *   { "fout": { "code": "geen-toegang", "melding": "Je hebt geen toegang tot dit onderdeel." } }
 *
 * met bij ongeldige invoer `velden` (melding per veld) en bij een onverwachte fout `foutcode` (terug te vinden in het
 * logboek). Een melding is altijd een vaste tekst uit de code: nooit invoer, geheimen of persoonsgegevens.
 */

/** Vaste codes met hun HTTP-status en standaardmelding. */
const API_ERRORS = {
  'niet-ingelogd': { status: 401, message: 'Log opnieuw in.' },
  geweigerd: { status: 403, message: 'Verzoek geweigerd. Laad de pagina opnieuw en probeer het nog eens.' },
  'geen-toegang': { status: 403, message: 'Je hebt geen toegang tot dit onderdeel.' },
  'niet-gevonden': { status: 404, message: 'Niet gevonden.' },
  ongeldig: { status: 400, message: 'Controleer de gemarkeerde velden.' },
  'te-groot': { status: 413, message: 'Het verzoek is te groot.' },
  'verkeerd-formaat': { status: 415, message: 'Dit formaat wordt niet geaccepteerd.' },
  'te-veel': { status: 429, message: 'Te veel verzoeken. Probeer het over een minuut opnieuw.' },
  onderhoud: { status: 503, message: 'Even geduld: er wordt onderhoud gedaan.' },
  fout: { status: 500, message: 'Er ging iets mis. Probeer het later opnieuw.' },
};

/**
 * Stuurt een fout van de API.
 * @param {any} res Express-antwoord.
 * @param {keyof typeof API_ERRORS} code Vaste foutcode.
 * @param {{message?: string, fields?: Record<string, string>, errorCode?: string, loginPath?: string}} [extra]
 *   Eigen vaste melding, meldingen per veld, foutcode uit het logboek of het pad om (opnieuw) in te loggen.
 * @returns {any} Het antwoord.
 */
function sendApiError(res, code, extra = {}) {
  const known = API_ERRORS[code];
  /** @type {Record<string, any>} */
  const body = { code, melding: extra.message || known.message };
  if (extra.fields) body.velden = extra.fields;
  if (extra.errorCode) body.foutcode = extra.errorCode;
  if (extra.loginPath) body.naar = extra.loginPath;
  return res.status(known.status).set('Cache-Control', 'no-store').json({ fout: body });
}

module.exports = { sendApiError, API_ERRORS };
