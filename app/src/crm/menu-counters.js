/**
 * Tellers in het menu van het CRM: het aantal openstaande dingen naast een menu-item (bijvoorbeeld nieuwe berichten).
 * Een middleware na het laden van de sessie zet de aantallen op `req.user.counters`; `crm/layout.js` toont ze bij het
 * item met dezelfde `counter`-sleutel in `CRM_MENU`. Alleen bij een GET (een pagina) en alleen tellers waarvoor de
 * gebruiker het recht heeft; een fout bij het tellen laat de pagina gewoon zien, zonder teller.
 * Een nieuwe teller: één regel in `MENU_COUNTERS` en `counter: '<sleutel>'` bij het item in `CRM_MENU`.
 */
const { roleHasGlobalRight } = require('./rights');
const { countNewMessages } = require('../contact/messages');

/** De tellers: sleutel, het recht dat nodig is (voor alle records) en de functie die telt. */
const MENU_COUNTERS = [
  { key: 'berichten', right: 'berichten', count: countNewMessages },
];

/**
 * Maakt de middleware die de tellers voor de ingelogde gebruiker ophaalt.
 * @param {{db: object, counters?: object[]}} options Database en (voor tests) andere tellers.
 * @returns {Function} Express-middleware.
 */
function createMenuCounters(options) {
  const counters = options.counters || MENU_COUNTERS;
  return async (req, res, next) => {
    if (req.method !== 'GET' || !req.user) return next();
    const allowed = counters.filter((counter) => roleHasGlobalRight(req.user.role, counter.right));
    if (!allowed.length) return next();
    try {
      const totals = await Promise.all(allowed.map((counter) => counter.count(options.db)));
      req.user.counters = Object.fromEntries(allowed.map((counter, index) => [counter.key, totals[index]]));
    } catch (error) {
      // Zonder teller is het menu nog bruikbaar; geen persoonsgegevens in de melding.
      console.error(`Tellers in het menu mislukt: ${String(error.message).replace(/[\r\n]/g, ' ')}`);
    }
    return next();
  };
}

module.exports = { createMenuCounters, MENU_COUNTERS };
