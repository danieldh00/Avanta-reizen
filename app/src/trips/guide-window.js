// @ts-check
/**
 * Het venster van de reisleider en de beperking tot de eigen vertrekken.
 *
 * Een reisleider (rol in `TRIP_SCOPED_ROLES`, `crm/rights.js`) ziet alleen de reizen van het reisleidersprofiel dat
 * aan zijn account hangt (`users.guide_id` naar `trip_guides`). Identiteits- en gezondheidsgegevens van zijn
 * deelnemers mag hij alleen binnen een venster rond het vertrek exporteren: vanaf zoveel dagen vóór vertrek tot en met
 * zoveel dagen na de terugkomst. De terugkomst is vertrek + duur - 1 (zonder duur alleen de vertrekdag). Beide
 * aantallen staan in Beheer > CRM > Reisleider (`guideWindowDaysBefore`, `guideWindowDaysAfter`).
 *
 * De SQL hieronder gebruikt gebonden parameters voor de aantallen en het gebruikers-id, nooit ingeplakte waarden.
 * "Vandaag" is de datum in Europe/Amsterdam volgens de database, zodat alle schermen dezelfde dag gebruiken.
 */

/** Standaard: dagen vóór vertrek waarop het venster opengaat (`docs/OPZET-CRM.md` §4). */
const DEFAULT_DAYS_BEFORE = 14;

/** Standaard: dagen na de terugkomst waarop het venster nog open is (0 = tot en met de terugkomstdag). */
const DEFAULT_DAYS_AFTER = 0;

/** Hoogste toegestane waarde voor beide aantallen (ook de grens in Beheer). */
const MAX_WINDOW_DAYS = 60;

/** Vandaag in Nederland, als datum volgens de database. */
const TODAY_SQL = "(now() AT TIME ZONE 'Europe/Amsterdam')::date";

/**
 * Een aantal dagen uit de instellingen, begrensd op 0 tot en met `MAX_WINDOW_DAYS`; ongeldig geeft de standaard.
 * @param {*} value Waarde uit de instellingen.
 * @param {number} fallback Standaardwaarde.
 * @returns {number} Geheel aantal dagen.
 */
function clampDays(value, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) return fallback;
  return Math.min(number, MAX_WINDOW_DAYS);
}

/**
 * Het venster zoals in Beheer ingesteld.
 * @param {{get: (key: string) => *}} [settings] Instellingen (`beheer/settings.js`); zonder instellingen de standaard.
 * @returns {{daysBefore: number, daysAfter: number}} Dagen vóór vertrek en dagen na de terugkomst.
 */
function guideWindowFrom(settings) {
  if (!settings) return { daysBefore: DEFAULT_DAYS_BEFORE, daysAfter: DEFAULT_DAYS_AFTER };
  return {
    daysBefore: clampDays(settings.get('guideWindowDaysBefore'), DEFAULT_DAYS_BEFORE),
    daysAfter: clampDays(settings.get('guideWindowDaysAfter'), DEFAULT_DAYS_AFTER),
  };
}

/**
 * SQL-uitdrukking: de terugkomstdag van reis `alias` (vertrek + duur - 1, minstens de vertrekdag).
 * @param {string} alias Alias van de tabel `trips` in de query (vaste tekst uit de code, nooit invoer).
 * @returns {string} Uitdrukking van het type date.
 */
function returnDateSql(alias) {
  return `(${alias}.departure_date + GREATEST(coalesce(${alias}.duration_days, 1), 1) - 1)`;
}

/**
 * SQL-uitdrukkingen voor het venster van reis `alias`: begin, einde en of vandaag erin valt.
 * @param {string} alias Alias van de tabel `trips` in de query (vaste tekst uit de code, nooit invoer).
 * @param {{before: number, after: number}} params Nummers van de parameters met de dagen vóór vertrek en na terugkomst.
 * @returns {{opensOn: string, closesOn: string, inWindow: string}} Uitdrukkingen; zonder vertrekdatum is `inWindow`
 *   onwaar en zijn begin en einde leeg.
 */
function guideWindowSql(alias, params) {
  const opensOn = `(${alias}.departure_date - $${params.before}::int)`;
  const closesOn = `(${returnDateSql(alias)} + $${params.after}::int)`;
  return {
    opensOn,
    closesOn,
    inWindow: `(${alias}.departure_date IS NOT NULL AND ${TODAY_SQL} BETWEEN ${opensOn} AND ${closesOn})`,
  };
}

/**
 * SQL-voorwaarde: reis `alias` hoort bij het reisleidersprofiel van gebruiker `$param`, of `$param` is null (geen
 * beperking, voor kantoor en beheerder).
 * @param {string} alias Alias van de tabel `trips` in de query (vaste tekst uit de code, nooit invoer).
 * @param {number} param Nummer van de parameter met het gebruikers-id.
 * @returns {string} Voorwaarde.
 */
function ownTripSql(alias, param) {
  return `($${param}::int IS NULL OR EXISTS (SELECT 1 FROM trip_guides tg JOIN users u ON u.guide_id = tg.guide_id WHERE tg.trip_id = ${alias}.id AND u.id = $${param}))`;
}

/**
 * Het venster van de reisleider in gewone taal, voor de uitleg op het scherm.
 * @param {number} daysBefore Dagen vóór vertrek.
 * @param {number} daysAfter Dagen na de terugkomst.
 * @returns {string} Bijvoorbeeld "van 14 dagen vóór vertrek tot en met de terugkomst".
 */
function describeWindow(daysBefore, daysAfter) {
  const start = daysBefore ? `van ${daysBefore} ${daysBefore === 1 ? 'dag' : 'dagen'} vóór vertrek` : 'vanaf de vertrekdag';
  const end = daysAfter ? `tot en met ${daysAfter} ${daysAfter === 1 ? 'dag' : 'dagen'} na de terugkomst` : 'tot en met de terugkomst';
  return `${start} ${end}`;
}

module.exports = { describeWindow, DEFAULT_DAYS_BEFORE, DEFAULT_DAYS_AFTER, MAX_WINDOW_DAYS, TODAY_SQL, guideWindowFrom, guideWindowSql, returnDateSql, ownTripSql, clampDays };
