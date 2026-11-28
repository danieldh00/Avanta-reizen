// @ts-check
/**
 * Bezoekersstatistieken op de publieke site: Google Analytics (GA4) en Microsoft Clarity. Welk meet-ID en welk
 * Clarity-project actief zijn, op welke pagina's Clarity mag meekijken en de uitgebreide Content-Security-Policy. De
 * server zet alleen de ID's in de pagina; `public/js/analytics.js` laadt Google en Microsoft pas na toestemming van de
 * bezoeker (standaard geweigerd). Zonder actieve ID staat er niets van dit alles in de pagina en blijft de policy gelijk.
 */

/** Een GA4-meet-ID: "G-" met 4 tot 14 hoofdletters of cijfers. */
const MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{4,14}$/;

/** Een Clarity-project-ID: kleine letters en cijfers (te vinden in Clarity onder Settings > Overview). */
const CLARITY_ID_PATTERN = /^[a-z0-9]{6,20}$/;

/**
 * Pagina's waar Clarity nooit meekijkt, ook niet met toestemming: het CRM (en de reisleiderweergave daarin), Mijn
 * Avanta, het aanmeldformulier en online betalen. Daar staan persoonsgegevens of gevoelige gegevens op het scherm.
 */
const CLARITY_EXCLUDED_PREFIXES = ['/app/', '/account/', '/aanmelden/', '/betalen/'];

/** Adressen die Google Analytics nodig heeft, per richtlijn van de policy. */
const ANALYTICS_SOURCES = {
  'script-src': ['https://www.googletagmanager.com'],
  'connect-src': ['https://www.googletagmanager.com', 'https://*.google-analytics.com', 'https://*.analytics.google.com'],
  // GA4 valt voor sommige hits terug op een afbeeldings-beacon.
  'img-src': ['https://*.google-analytics.com', 'https://*.googletagmanager.com'],
};

/**
 * Adressen die Clarity nodig heeft: het laadscript op www.clarity.ms, de eigenlijke code op scripts.clarity.ms en de
 * opname naar een wisselende host onder clarity.ms. Bewust niet `c.bing.com`: dat is de koppeling met advertenties van
 * Microsoft, die hier altijd uit staat.
 */
const CLARITY_SOURCES = {
  'script-src': ['https://www.clarity.ms', 'https://scripts.clarity.ms'],
  'connect-src': ['https://*.clarity.ms'],
  'img-src': ['https://*.clarity.ms'],
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
 * Het Clarity-project dat de site mag gebruiken: een leeg veld betekent uit.
 * @param {string} projectId Ingevuld project-ID.
 * @returns {string} Het project-ID in kleine letters, of leeg als Clarity uit staat of het ID niet geldig is.
 */
function activeClarityId(projectId) {
  const id = String(projectId || '').trim().toLowerCase();
  return CLARITY_ID_PATTERN.test(id) ? id : '';
}

/**
 * Of Clarity op dit pad mag meekijken (zie `CLARITY_EXCLUDED_PREFIXES`). Hoofdletterongevoelig, net als de routes
 * van Express, en ook het pad zonder slash aan het eind telt mee.
 * @param {string} path Pad van het verzoek.
 * @returns {boolean} Waar als Clarity hier mag laden.
 */
function clarityAllowedOn(path) {
  const lowerPath = `${String(path || '/').toLowerCase()}/`;
  return !CLARITY_EXCLUDED_PREFIXES.some((prefix) => lowerPath.startsWith(prefix));
}

/**
 * Voegt bronnen toe aan de richtlijnen van een policy. Ontbreekt een richtlijn (zoals `connect-src`), dan komt die
 * erbij op basis van `'self'`.
 * @param {string[]} directives De richtlijnen (wordt aangepast).
 * @param {Record<string, string[]>} sourcesByDirective Toe te voegen adressen per richtlijn.
 * @returns {void}
 */
function addSources(directives, sourcesByDirective) {
  for (const [name, sources] of Object.entries(sourcesByDirective)) {
    const index = directives.findIndex((directive) => directive.split(' ')[0] === name);
    if (index === -1) directives.push(`${name} 'self' ${sources.join(' ')}`);
    else directives[index] = `${directives[index]} ${sources.join(' ')}`;
  }
}

/**
 * De Content-Security-Policy met de adressen van Google Analytics en/of Clarity erbij als die actief zijn. Er komen
 * nooit inline scripts bij.
 * @param {string} baseCsp De standaardpolicy.
 * @param {string} measurementId Het actieve meet-ID (leeg = geen Google Analytics).
 * @param {string} [clarityId] Het actieve Clarity-project (leeg = geen Clarity).
 * @returns {string} De policy voor dit verzoek.
 */
function cspWith(baseCsp, measurementId, clarityId = '') {
  if (!measurementId && !clarityId) return baseCsp;
  const directives = baseCsp.split('; ');
  if (measurementId) addSources(directives, ANALYTICS_SOURCES);
  if (clarityId) addSources(directives, CLARITY_SOURCES);
  return directives.join('; ');
}

module.exports = { MEASUREMENT_ID_PATTERN, CLARITY_ID_PATTERN, CLARITY_EXCLUDED_PREFIXES, activeMeasurementId, activeClarityId, clarityAllowedOn, cspWith };
