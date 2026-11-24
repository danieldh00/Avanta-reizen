// @ts-check
/**
 * Kleine hulpfuncties voor formulierinvoer in het CRM: een e-mailadres en een tekstveld normaliseren.
 */

/**
 * Normaliseert een e-mailadres (spaties weg, kleine letters) en controleert het.
 * @param {*} value Invoer.
 * @returns {string} E-mailadres, of leeg als het ongeldig is.
 */
function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return email.length <= 200 && /^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(email) ? email : '';
}

/**
 * Leest een tekstveld uit het formulier: ingekort en zonder witruimte aan de randen.
 * @param {*} value Invoer.
 * @param {number} max Maximale lengte.
 * @returns {string} Tekst.
 */
function textField(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

module.exports = { normalizeEmail, textField };
