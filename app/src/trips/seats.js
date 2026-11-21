/**
 * Plaatsen van een reis (CMS-pakket G4): het aantal bezette plaatsen is het aantal aanmeldingen voor die reis dat niet
 * geannuleerd is. Een reis is volgeboekt als het vinkje *Volgeboekt* aanstaat, of als er een aantal plaatsen is en de
 * bezette plaatsen dat aantal halen. Dezelfde SQL-stukken gebruiken het CRM, de publieke site en het aanmeldformulier,
 * zodat ze nooit van elkaar verschillen. De stukken bevatten alleen een vaste tabelalias uit de code, nooit invoer.
 */

/** Toegestane tabelaliassen (alleen vaste namen uit de code). */
const ALIAS_PATTERN = /^[a-z]{1,10}$/;

/**
 * Controleert een tabelalias.
 * @param {string} alias Alias van de tabel `trips` in de query.
 * @returns {string} De alias.
 */
function checkedAlias(alias) {
  if (!ALIAS_PATTERN.test(alias)) throw new Error('Ongeldige tabelalias');
  return alias;
}

/**
 * SQL voor het aantal bezette plaatsen (aanmeldingen die niet geannuleerd zijn). Gebruikt de index `bookings_trip_idx`.
 * @param {string} [alias] Alias van `trips`.
 * @returns {string} SQL-expressie (integer).
 */
function bookedSeatsSql(alias = 't') {
  const name = checkedAlias(alias);
  return `(SELECT count(*)::int FROM bookings b WHERE b.trip_id = ${name}.id AND b.status <> 'geannuleerd')`;
}

/**
 * SQL voor *volgeboekt*: het vinkje, of geen vrije plaatsen meer.
 * @param {string} [alias] Alias van `trips`.
 * @returns {string} SQL-expressie (boolean).
 */
function fullyBookedSql(alias = 't') {
  const name = checkedAlias(alias);
  return `(${name}.fully_booked OR (${name}.capacity IS NOT NULL AND ${bookedSeatsSql(name)} >= ${name}.capacity))`;
}

/**
 * Vat de plaatsen van een reis samen voor het CRM.
 * @param {{capacity: (number|null), booked_seats: number, fully_booked: boolean}} trip Reis met `booked_seats` en
 *   het vinkje `fully_booked`.
 * @returns {{booked: number, capacity: (number|null), free: (number|null), full: boolean, automatic: boolean}}
 *   Bezet, totaal, vrij, volgeboekt en of dat automatisch komt (door de aanmeldingen, niet door het vinkje).
 */
function seatSummary(trip) {
  const booked = Number(trip.booked_seats) || 0;
  const capacity = trip.capacity === null || trip.capacity === undefined ? null : Number(trip.capacity);
  const free = capacity === null ? null : Math.max(capacity - booked, 0);
  const automatic = capacity !== null && booked >= capacity;
  return { booked, capacity, free, full: Boolean(trip.fully_booked) || automatic, automatic: automatic && !trip.fully_booked };
}

module.exports = { bookedSeatsSql, fullyBookedSql, seatSummary };
