/**
 * Een aanmelding opslaan, gedeeld door het openbare formulier (`routes.js`) en het handmatig invoeren door kantoor
 * (`manual-routes.js`). In één transactie: de reis vergrendelen en controleren of er nog plaats is, de persoon zoeken of
 * aanmaken (`persons/persons.js`, bijzondere gegevens versleuteld per blok), de aanmelding zelf (NAW als momentopname,
 * zonder bijzondere gegevens), de verwachte bedragen en de toestemmingen. De referentie (AV-jjjj-XXXXXXXX) is uniek; bij
 * de kleine kans op een botsing wordt een nieuwe gekozen.
 */
const crypto = require('node:crypto');
const { isoDate } = require('../site/format');
const { addInitialCharges } = require('../payments/payments');
const { fullyBookedSql } = require('../trips/seats');

/** Hoe vaak een nieuwe referentie wordt geprobeerd bij een botsing. */
const REFERENCE_ATTEMPTS = 3;

/**
 * Een nieuwe referentie met het jaar volgens de Nederlandse datum (rond de jaarwisseling verschilt de tijdzone van de
 * server).
 * @param {number} timestamp Tijdstip in milliseconden.
 * @returns {string} Referentie, bijvoorbeeld `AV-2027-1A2B3C4D`.
 */
function newReference(timestamp) {
  const year = new Date(timestamp).toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' }).slice(0, 4);
  return `AV-${year}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

/**
 * Maakt de functie die een aanmelding opslaat.
 * @param {{db: {transaction: Function}, persons: {savePerson: Function, recordConsents: Function}, now?: () => number}} options
 *   Database, de personenlaag (`createPersons`) en de klok (tests).
 * @returns {{saveBooking: Function}} De opslagfunctie.
 */
function createBookingSaver(options) {
  const { db, persons } = options;
  const now = options.now || Date.now;

  /**
   * Slaat één poging op met een vaste referentie.
   * @param {string} reference Referentie.
   * @param {object} booking Zie `saveBooking`.
   * @returns {Promise<(object|null)>} Zie `saveBooking`; null als de reis vol of weg is.
   */
  const saveOnce = (reference, booking) => db.transaction(async (client) => {
    const { trip, values } = booking;
    const yes = (name) => values[name] === 'ja';
    // Eerst de reis vergrendelen, dan in een nieuw statement (met een nieuwe snapshot) tellen: twee gelijktijdige
    // aanmeldingen voor de laatste plaats gaan zo na elkaar en de tweede ziet de eerste.
    const [locked] = await client.query('SELECT id, deposit_cents FROM trips WHERE id = $1 FOR UPDATE', [trip.id]);
    if (!locked) return null;
    const [current] = await client.query(`SELECT ${fullyBookedSql('t')} AS full FROM trips t WHERE t.id = $1`, [trip.id]);
    if (current.full) return null;
    const { personId } = await persons.savePerson(client, values);
    const [saved] = await client.query(
      `INSERT INTO bookings (reference, trip_id, trip_code, trip_title, departure_date, gender, first_names, call_name, last_name,
         email, mobile, phone, street, postal_code, city, occupation, travel_with, earlier_trip, credit_card, driver_interest,
         driver_before, driver_when, payment_method, payment_choice, price_cents, person_id, customer_account_id, deposit_cents, consent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28, now())
       RETURNING id`,
      [reference, trip.id, trip.trip_code, trip.title, isoDate(trip.departure_date), values.gender, values.first_names, values.call_name,
        values.last_name, values.email.toLowerCase(), values.mobile, values.phone, values.street, values.postal_code.toUpperCase(),
        values.city, values.occupation, values.travel_with, yes('earlier_trip'), yes('credit_card'), yes('driver_interest'),
        yes('driver_before'), values.driver_when, 'handmatig', values.payment_choice, trip.price_cents, personId, booking.accountId || null,
        locked.deposit_cents >= 0 ? locked.deposit_cents : null],
    );
    // De verwachte bedragen (reissom, SGR, boekingskosten) voor de betalingen in het CRM.
    await addInitialCharges(client, saved.id, { priceCents: trip.price_cents, paymentChoice: values.payment_choice });
    await persons.recordConsents(client, { personId, bookingId: saved.id, values });
    // Extra stappen van de aanroeper in dezelfde transactie (kantoor: historie en auditlog).
    if (booking.afterSave) await booking.afterSave(client, { bookingId: saved.id, personId, reference });
    return { reference, bookingId: saved.id, personId, depositCents: locked.deposit_cents };
  });

  /**
   * Slaat een aanmelding op.
   * @param {{trip: object, values: Record<string, string>, accountId?: (number|null),
   *   afterSave?: (client: object, saved: {bookingId: number, personId: number, reference: string}) => Promise<void>}} booking
   *   De reis (id, trip_code, title, departure_date, price_cents), de gecontroleerde formulierwaarden, het
   *   reizigersaccount (of null) en eventueel extra stappen in dezelfde transactie.
   * @returns {Promise<({reference: string, bookingId: number, personId: number, depositCents: (number|null)}|null)>}
   *   De opgeslagen aanmelding, of null als de reis intussen volgeboekt of weg is.
   */
  const saveBooking = async (booking) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await saveOnce(newReference(now()), booking);
      } catch (error) {
        if (error.code !== '23505' || error.constraint !== 'bookings_reference_key' || attempt >= REFERENCE_ATTEMPTS) throw error;
      }
    }
  };

  return { saveBooking };
}

module.exports = { createBookingSaver, newReference };
