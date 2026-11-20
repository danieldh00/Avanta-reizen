/**
 * Context per verzoek (AsyncLocalStorage): wat diep in de code nodig is zonder het door elke functie heen te geven,
 * zoals de onderhoudsmodus voor de balk in de layouts. De middleware in `server.js` start de context; buiten een
 * verzoek (planners, opdrachtregel) is er geen context en geeft `current()` een leeg object.
 */
const { AsyncLocalStorage } = require('node:async_hooks');

const storage = new AsyncLocalStorage();

/**
 * Voert een functie uit binnen een nieuwe context.
 * @param {object} store De gegevens van dit verzoek (bijv. `{ maintenance }`).
 * @param {Function} callback Wat er binnen de context draait (bij Express: `next`).
 * @returns {*} Wat de functie teruggeeft.
 */
function runWithContext(store, callback) {
  return storage.run(store, callback);
}

/**
 * De context van het lopende verzoek.
 * @returns {object} De gegevens, of een leeg object buiten een verzoek.
 */
function currentContext() {
  return storage.getStore() || {};
}

module.exports = { runWithContext, currentContext };
