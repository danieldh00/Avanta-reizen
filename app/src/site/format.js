/**
 * Opmaak van bedragen, datums, adressen en samenvattingen voor de website (Nederlands, Europe/Amsterdam).
 */
const { parse } = require('node-html-parser');

/** Lengte van de samenvatting van een blogbericht in bytes (UTF-8), zoals het thema van de huidige site. */
const SUMMARY_BYTES = 197;

/**
 * Bedrag in centen als "€1.849,-" (hele euro's) of "€1.849,50".
 * @param {(number|null)} cents Bedrag in centen.
 * @returns {string} Opgemaakt bedrag, of leeg.
 */
function formatPrice(cents) {
  if (cents === null || cents === undefined) return '';
  const euros = Math.floor(cents / 100);
  const rest = cents % 100;
  return `€${euros.toLocaleString('nl-NL')},${rest ? String(rest).padStart(2, '0') : '-'}`;
}

/**
 * Zet een datum (Date of jjjj-mm-dd) om naar een Date op 12:00 lokale tijd, tegen verschuiving door tijdzones.
 * @param {(Date|string)} value De datum.
 * @returns {(Date|null)} De datum of null.
 */
function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12) : null;
}

/**
 * Datum als "03-12-2026", zoals op de huidige site.
 * @param {(Date|string)} value De datum.
 * @returns {string} Opgemaakte datum.
 */
function formatDate(value) {
  const date = toDate(value);
  if (!date) return '';
  return `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${date.getFullYear()}`;
}

/**
 * Datum als "3 december 2026".
 * @param {(Date|string)} value De datum.
 * @returns {string} Opgemaakte datum.
 */
function formatLongDate(value) {
  const date = value instanceof Date && !/^\d{4}-/.test(String(value)) ? value : toDate(value);
  if (!date) return '';
  return date.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Amsterdam' });
}

/**
 * Datum als jjjj-mm-dd (voor formulieren en URL's).
 * @param {(Date|string)} value De datum.
 * @returns {string} ISO-datum of leeg.
 */
function isoDate(value) {
  const date = toDate(value);
  if (!date) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Pad van een reis.
 * @param {string} slug Slug.
 * @returns {string} Pad.
 */
const tripPath = (slug) => `/reis/${encodeURIComponent(slug)}/`;

/**
 * Pad van een categorie.
 * @param {string} slug Slug.
 * @returns {string} Pad.
 */
const categoryPath = (slug) => `/reis-categorie/${encodeURIComponent(slug)}/`;

/**
 * Pad van een reisleider.
 * @param {string} slug Slug.
 * @returns {string} Pad.
 */
const guidePath = (slug) => `/reisleider/${encodeURIComponent(slug)}/`;

/**
 * Pad van een blogbericht.
 * @param {string} slug Slug.
 * @returns {string} Pad.
 */
const postPath = (slug) => `/${encodeURIComponent(slug)}/`;

/**
 * Samenvatting van een blogbericht zoals de huidige site: de tekst van het bericht (zonder opmaak), afgekapt op 197
 * bytes met " ..." erachter. Een bericht met alleen foto's heeft geen samenvatting.
 * @param {string} bodyText Tekst of HTML van het bericht (entiteiten zoals `&amp;` worden tekens).
 * @returns {string} Samenvatting, of leeg.
 */
function postSummary(bodyText) {
  const text = parse(String(bodyText || ''), { comment: false }).text.replace(/\[[^\]]{0,40}\]/g, '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= SUMMARY_BYTES) return `${text} ...`;
  return `${bytes.subarray(0, SUMMARY_BYTES).toString('utf8').replace(/\uFFFD+$/, '')} ...`;
}

module.exports = { postSummary, formatPrice, formatDate, formatLongDate, isoDate, toDate, tripPath, categoryPath, guidePath, postPath };
