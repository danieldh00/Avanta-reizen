// @ts-check
/**
 * Betalingen bij een aanmelding (OPZET-CRM §2 F, migratie 26): de verwachte bedragen (`booking_charges`), de ontvangen
 * betalingen (`payments`) en de berekening van saldo, aanbetaling, vervaldatums en betaalstatus. Niets daarvan wordt
 * opgeslagen: het volgt altijd uit de regels en de instellingen `paymentDepositDays` en `paymentBalanceDaysBefore`.
 *
 * - Bij aanmelden: reissom (prijs van de reis), SGR-garantie € 5 en boekingskosten € 15 (niet bij het totaalbedrag).
 * - Aanbetaling = aanbetaling van de reis (op het moment van aanmelden) + boekingskosten + SGR, hoogstens het totaal;
 *   wie het totaalbedrag kiest, betaalt alles op de vervaldatum van de aanbetaling.
 * - Een betaling wordt nooit gewijzigd of verwijderd; een vergissing herstel je met een correctie (ook negatief).
 */
const { SGR_CENTS, BOOKING_FEE_CENTS } = require('../booking/fields');
const { formatPrice, isoDate } = require('../site/format');

/** Soorten bedragen met hun naam op het scherm. */
const CHARGE_KINDS = {
  reissom: 'Reissom',
  boekingskosten: 'Boekingskosten',
  sgr: 'SGR-garantie',
  korting: 'Korting',
  annulering: 'Annuleringskosten',
  overig: 'Overig',
};

/** Soorten die kantoor zelf toevoegt (de andere komen bij het aanmelden). Korting wordt als negatief bedrag opgeslagen. */
const MANUAL_CHARGE_KINDS = ['korting', 'annulering', 'overig'];

/** Soorten die bij de aanbetaling horen (naast de aanbetaling van de reis). */
const DEPOSIT_FEE_KINDS = ['boekingskosten', 'sgr'];

/** Manieren van betalen met hun naam op het scherm. */
const PAYMENT_METHODS = {
  bank: 'Bankoverschrijving',
  ideal: 'iDEAL',
  contant: 'Contant',
  correctie: 'Correctie',
};

/** Betaalstatus (berekend) met de naam op het scherm. */
const PAYMENT_STATES = {
  geen: 'Geen bedrag',
  open: 'Open',
  aanbetaald: 'Aanbetaald',
  betaald: 'Betaald',
  teveel: 'Te veel betaald',
};

/** Hoogste bedrag dat kantoor in één regel invult: € 1.000.000. */
const MAX_AMOUNT_CENTS = 100_000_000;

/** Maximale lengte van een omschrijving bij een bedrag en van een toelichting bij een betaling. */
const DESCRIPTION_MAX = 200;
const NOTE_MAX = 500;

/**
 * Leest een bedrag zoals kantoor het intypt: "1.234,56", "1234,5", "1234.56", "€ 15" of "-20". Punten zijn
 * duizendtallen als er ook een komma staat.
 * @param {*} value Invoer.
 * @returns {(number|null)} Bedrag in centen, of null als het geen geldig bedrag is (of groter dan € 1.000.000).
 */
function parseAmount(value) {
  if (typeof value !== 'string') return null;
  let text = value.replace(/[\s€]/g, '');
  if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
  const match = /^(-?)(\d{1,7})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const cents = Number(match[2]) * 100 + Number((match[3] || '0').padEnd(2, '0'));
  if (cents > MAX_AMOUNT_CENTS) return null;
  return match[1] === '-' ? -cents : cents;
}

/**
 * Een bedrag in centen voor het scherm, ook negatief: "€1.849,-" of "-€15,50".
 * @param {(number|null)} cents Bedrag.
 * @returns {string} Opgemaakt bedrag (leeg bij null).
 */
function formatAmount(cents) {
  if (cents === null || cents === undefined) return '';
  return cents < 0 ? `-${formatPrice(-cents)}` : formatPrice(cents);
}

/**
 * De bedragen die bij een nieuwe aanmelding horen, zoals het formulier ze toont.
 * @param {{priceCents: (number|null), paymentChoice: string}} booking Reissom en betaalkeuze.
 * @returns {Array<{kind: string, amountCents: number}>} Regels.
 */
function initialCharges(booking) {
  const charges = [];
  if (Number.isInteger(booking.priceCents) && booking.priceCents > 0) charges.push({ kind: 'reissom', amountCents: booking.priceCents });
  charges.push({ kind: 'sgr', amountCents: SGR_CENTS });
  if (booking.paymentChoice === 'aanbetaling') charges.push({ kind: 'boekingskosten', amountCents: BOOKING_FEE_CENTS });
  return charges;
}

/**
 * Zet de bedragen van een nieuwe aanmelding in de database (in de transactie van het aanmelden).
 * @param {{query: Function}} client Transactie-client.
 * @param {number} bookingId Id van de aanmelding.
 * @param {{priceCents: (number|null), paymentChoice: string}} booking Reissom en betaalkeuze.
 * @returns {Promise<void>}
 */
async function addInitialCharges(client, bookingId, booking) {
  const charges = initialCharges(booking);
  await client.query(
    `INSERT INTO booking_charges (booking_id, kind, amount_cents)
     SELECT $1, kind, amount FROM unnest($2::text[], $3::int[]) AS line(kind, amount)`,
    [bookingId, charges.map((charge) => charge.kind), charges.map((charge) => charge.amountCents)],
  );
}

/**
 * Telt dagen op bij een datum (jjjj-mm-dd), zonder tijdzones.
 * @param {string} day Datum.
 * @param {number} days Aantal dagen (ook negatief).
 * @returns {string} Nieuwe datum.
 */
function addDays(day, days) {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

/**
 * De datum van een tijdstip in Nederland.
 * @param {(Date|string|number)} value Tijdstip.
 * @returns {string} Datum (jjjj-mm-dd).
 */
function localDay(value) {
  return new Date(value).toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });
}

/**
 * Vervaldatums van een aanmelding: de aanbetaling zoveel dagen na aanmelden, het restant zoveel dagen vóór vertrek
 * (nooit eerder dan de aanbetaling). Bij het totaalbedrag vervalt alles op de datum van de aanbetaling.
 * @param {{created_at: (Date|string), departure_date: (Date|string|null), payment_choice: string}} booking Aanmelding.
 * @param {{depositDays: number, balanceDaysBefore: number}} terms Termijnen uit de instellingen.
 * @returns {{depositDueOn: string, balanceDueOn: (string|null)}} Datums (jjjj-mm-dd); zonder vertrekdatum geen restantdatum.
 */
function dueDates(booking, terms) {
  const depositDueOn = addDays(localDay(booking.created_at), terms.depositDays);
  if (booking.payment_choice === 'totaal') return { depositDueOn, balanceDueOn: depositDueOn };
  const departure = isoDate(booking.departure_date);
  if (!departure) return { depositDueOn, balanceDueOn: null };
  const balance = addDays(departure, -terms.balanceDaysBefore);
  return { depositDueOn, balanceDueOn: balance < depositDueOn ? depositDueOn : balance };
}

/**
 * Rekent saldo, aanbetaling, betaalstatus en achterstand uit.
 * @param {object} input Gegevens.
 * @param {{status: string, payment_choice: string, deposit_cents: (number|null), created_at: (Date|string), departure_date: (Date|string|null)}} input.booking Aanmelding.
 * @param {Array<{kind: string, amount_cents: number}>} input.charges Verwachte bedragen.
 * @param {Array<{amount_cents: number}>} input.payments Ontvangen betalingen.
 * @param {{depositDays: number, balanceDaysBefore: number}} input.terms Termijnen.
 * @param {string} input.today Vandaag (jjjj-mm-dd, Nederland).
 * @returns {{totalCents: number, paidCents: number, balanceCents: number, depositRequiredCents: number, depositOpenCents: number, depositDueOn: string, balanceDueOn: (string|null), state: string, overdue: (''|'aanbetaling'|'restant')}}
 *   Uitkomst; `overdue` is de oudste vervallen termijn die nog niet is voldaan (nooit bij een geannuleerde aanmelding).
 */
function summarize({ booking, charges, payments, terms, today }) {
  const totalCents = charges.reduce((sum, charge) => sum + charge.amount_cents, 0);
  const paidCents = payments.reduce((sum, payment) => sum + payment.amount_cents, 0);
  const fees = charges.filter((charge) => DEPOSIT_FEE_KINDS.includes(charge.kind)).reduce((sum, charge) => sum + charge.amount_cents, 0);
  const depositRequiredCents = booking.payment_choice === 'totaal'
    ? Math.max(totalCents, 0)
    : Math.max(Math.min(totalCents, (booking.deposit_cents || 0) + fees), 0);
  const { depositDueOn, balanceDueOn } = dueDates(booking, terms);
  let state = 'open';
  if (totalCents <= 0 && paidCents === 0) state = 'geen';
  else if (paidCents > totalCents) state = 'teveel';
  else if (paidCents >= totalCents) state = 'betaald';
  else if (paidCents > 0 && paidCents >= depositRequiredCents) state = 'aanbetaald';
  /** @type {(''|'aanbetaling'|'restant')} */
  let overdue = '';
  if (booking.status !== 'geannuleerd') {
    if (paidCents < depositRequiredCents && today > depositDueOn) overdue = 'aanbetaling';
    else if (paidCents < totalCents && balanceDueOn && today > balanceDueOn) overdue = 'restant';
  }
  return {
    totalCents,
    paidCents,
    balanceCents: totalCents - paidCents,
    depositRequiredCents,
    depositOpenCents: Math.max(depositRequiredCents - paidCents, 0),
    depositDueOn,
    balanceDueOn,
    state,
    overdue,
  };
}

/**
 * De status van de aanmelding die bij de betaalstand past, als de aanmelding automatisch mag doorschuiven: alleen
 * vooruit, alleen vanaf bevestigd of aanbetaald (een nieuwe aanmelding bevestigt kantoor zelf).
 * @param {string} status Huidige status van de aanmelding.
 * @param {string} state Betaalstatus (`PAYMENT_STATES`).
 * @returns {(string|null)} Nieuwe status, of null als hij blijft.
 */
function nextBookingStatus(status, state) {
  const paidInFull = state === 'betaald' || state === 'teveel';
  if ((status === 'bevestigd' || status === 'aanbetaald') && paidInFull) return 'betaald';
  if (status === 'bevestigd' && state === 'aanbetaald') return 'aanbetaald';
  return null;
}

/**
 * Of de status van de aanmelding achterloopt op of voorloopt op de betaalstand, bijvoorbeeld na een correctie of een
 * extra bedrag (de status schuift automatisch alleen vooruit; terugzetten beslist kantoor zelf).
 * @param {string} status Status van de aanmelding.
 * @param {string} state Betaalstatus.
 * @returns {string} Waarschuwing voor het scherm, of leeg.
 */
function statusMismatch(status, state) {
  const paidInFull = state === 'betaald' || state === 'teveel';
  if (status === 'betaald' && state !== 'geen' && !paidInFull) return 'De aanmelding staat op betaald, maar er staat nog een bedrag open.';
  if (status === 'aanbetaald' && state === 'open') return 'De aanmelding staat op aanbetaald, maar de aanbetaling is niet (meer) voldaan.';
  return '';
}

/**
 * Leest de bedragen en betalingen van een aanmelding.
 * @param {{query: Function}} client Database of transactie-client.
 * @param {number} bookingId Id van de aanmelding.
 * @returns {Promise<{charges: any[], removedCharges: any[], payments: any[]}>} Regels, oudste eerst; weggehaalde
 *   bedragen apart (die tellen niet mee).
 */
async function loadLines(client, bookingId) {
  const [charges, payments] = await Promise.all([
    client.query(
      `SELECT c.id, c.kind, c.description, c.amount_cents, c.created_at, u.name AS user_name, c.removed_at, r.name AS removed_by_name
         FROM booking_charges c LEFT JOIN users u ON u.id = c.created_by LEFT JOIN users r ON r.id = c.removed_by
        WHERE c.booking_id = $1 ORDER BY c.created_at, c.id`,
      [bookingId],
    ),
    client.query(
      `SELECT p.id, p.amount_cents, p.method, p.received_on, p.note, p.provider_ref, p.created_at, u.name AS user_name
         FROM payments p LEFT JOIN users u ON u.id = p.created_by
        WHERE p.booking_id = $1 ORDER BY p.received_on, p.id`,
      [bookingId],
    ),
  ]);
  return { charges: charges.filter((charge) => !charge.removed_at), removedCharges: charges.filter((charge) => charge.removed_at), payments };
}

/**
 * De termijnen uit de instellingen.
 * @param {{get: Function}} settings Instellingen.
 * @returns {{depositDays: number, balanceDaysBefore: number}} Termijnen.
 */
function termsFrom(settings) {
  return { depositDays: settings.get('paymentDepositDays'), balanceDaysBefore: settings.get('paymentBalanceDaysBefore') };
}

module.exports = {
  CHARGE_KINDS,
  MANUAL_CHARGE_KINDS,
  PAYMENT_METHODS,
  PAYMENT_STATES,
  MAX_AMOUNT_CENTS,
  DESCRIPTION_MAX,
  NOTE_MAX,
  parseAmount,
  formatAmount,
  initialCharges,
  addInitialCharges,
  addDays,
  localDay,
  dueDates,
  summarize,
  nextBookingStatus,
  statusMismatch,
  loadLines,
  termsFrom,
};
