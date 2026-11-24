// @ts-check
/**
 * Google Analytics (GA4) op de publieke site: welk meet-ID actief is en de uitgebreide Content-Security-Policy. De
 * server zet alleen het meet-ID in de pagina; `public/js/analytics.js` laadt Google pas na toestemming van de bezoeker
 * (Consent Mode v2, standaard geweigerd). Zonder actief meet-ID staat er niets van dit alles in de pagina en blijft de
 * policy gelijk.
 */

/** Een GA4-meet-ID: "G-" met 4 tot 14 hoofdletters of cijfers. */
const MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{4,14}$/;

/** Adressen die Google Analytics nodig heeft, per richtlijn van de policy. */
const ANALYTICS_SOURCES = {
  'script-src': ['https://www.googletagmanager.com'],
  'connect-src': ['https://www.googletagmanager.com', 'https://*.google-analytics.com', 'https://*.analytics.google.com'],
  // GA4 valt voor sommige hits terug op een afbeeldings-beacon.
  'img-src': ['https://*.google-analytics.com', 'https://*.googletagmanager.com'],
};

/**
 * Het meet-ID dat de site mag gebruiken: alleen als Analytics aan staat én het ID geldig is.
 * @param {boolean} enabled Of Analytics aan staat.
 * @param {string} measurementId Ingevuld meet-ID.
 * @returns {string} Het meet-ID in hoofdletters, of leeg als er niet gemeten mag worden.
 */
function activeMeasurementId(enabled, measurementId) {
  const id = String(measurementId || '').trim().toUpperCase();
  return enabled === true && MEASUREMENT_ID_PATTERN.test(id) ? id : '';
}

/**
 * De Content-Security-Policy met de adressen van Google Analytics erbij als er gemeten wordt. Ontbreekt een richtlijn
 * (zoals `connect-src`), dan komt die erbij op basis van `'self'`. Er komen nooit inline scripts bij.
 * @param {string} baseCsp De standaardpolicy.
 * @param {string} measurementId Het actieve meet-ID (leeg = niet meten).
 * @returns {string} De policy voor dit verzoek.
 */
function cspWith(baseCsp, measurementId) {
  if (!measurementId) return baseCsp;
  const directives = baseCsp.split('; ');
  for (const [name, sources] of Object.entries(ANALYTICS_SOURCES)) {
    const index = directives.findIndex((directive) => directive.split(' ')[0] === name);
    if (index === -1) directives.push(`${name} 'self' ${sources.join(' ')}`);
    else directives[index] = `${directives[index]} ${sources.join(' ')}`;
  }
  return directives.join('; ');
}

module.exports = { MEASUREMENT_ID_PATTERN, activeMeasurementId, cspWith };
