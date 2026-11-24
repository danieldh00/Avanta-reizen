// @ts-check
/**
 * Mijn reizen en Mijn gegevens van het reizigersaccount (CMS-pakket J3). Een account hoort bij zijn bevestigde
 * e-mailadres: de aanmeldingen met dat adres zijn de reizen van de reiziger (index `bookings_email_idx` op
 * `lower(email)`). Het aanmeldformulier bevestigt het adres niet, dus toont het account alleen reisgegevens (reis, datum,
 * referentie, status), nooit naam, adres of telefoon uit een aanmelding en nooit bijzondere gegevens; die beheert kantoor.
 */
const { html } = require('../site/html');
const { formatDate, isoDate, tripPath } = require('../site/format');
const { today } = require('../site/content');
const { STATUSES } = require('../booking/crm-routes');
const { createXlsx } = require('../export/xlsx');

/** Leesbare betaalkeuze. */
const PAYMENT_LABELS = { aanbetaling: 'Aanbetaling', totaal: 'Totaalbedrag' };

/** Hoogstens zoveel aanmeldingen tonen en exporteren (ruim boven wat één reiziger ooit heeft). */
const MAX_BOOKINGS = 500;

/**
 * Betaalstand voor de reiziger, afgeleid van de status van de aanmelding.
 * @param {string} status Status (`booking/crm-routes.js`).
 * @returns {string} Tekst, bijv. *Nog te betalen*.
 */
function paymentState(status) {
  if (status === 'betaald') return 'Betaald';
  if (status === 'aanbetaald') return 'Aanbetaling ontvangen, restant nog te betalen';
  if (status === 'geannuleerd') return '';
  return 'Nog te betalen';
}

/**
 * Maakt de functies voor Mijn reizen.
 * @param {{db: any}} options De database.
 * @returns {{bookingsOf: Function, ownDetailsOf: Function, overview: Function, details: Function, exportXlsx: Function}} Functies.
 */
function createMyTrips(options) {
  const { db } = options;

  /**
   * De aanmeldingen bij een e-mailadres, nieuwste vertrek eerst, met de reis als die nog online staat.
   * @param {string} email Bevestigd e-mailadres van het account (kleine letters).
   * @returns {Promise<any[]>} Aanmeldingen.
   */
  const bookingsOf = (email) => db.query(
    `SELECT b.reference, b.trip_title, b.trip_code, b.departure_date, b.status, b.payment_choice, b.price_cents, b.created_at,
            CASE WHEN t.published THEN t.slug END AS trip_slug
       FROM bookings b LEFT JOIN trips t ON t.id = b.trip_id
      WHERE lower(b.email) = $1
      ORDER BY b.departure_date DESC NULLS LAST, b.created_at DESC
      LIMIT ${MAX_BOOKINGS}`,
    [email],
  );

  /**
   * De gewone gegevens van de laatste aanmelding die deze reiziger deed terwijl hij ingelogd was (kolom
   * `customer_account_id`). Nooit op e-mailadres: het aanmeldformulier bevestigt dat adres niet, dus een aanmelding met
   * dit adres kan van iemand anders zijn.
   * @param {number} accountId Id van het reizigersaccount.
   * @returns {Promise<(any|null)>} Naam, geslacht, adres, telefoon en beroep, of null zonder eigen aanmelding.
   */
  const ownDetailsOf = async (accountId) => {
    const [row] = await db.query(
      `SELECT gender, first_names, call_name, last_name, mobile, phone, street, postal_code, city, occupation
         FROM bookings WHERE customer_account_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [accountId],
    );
    return row || null;
  };

  /**
   * Eén aanmelding als kaart: reis, datum, referentie, status en betaalstand.
   * @param {any} booking Aanmelding.
   * @returns {any} HTML.
   */
  const bookingCard = (booking) => html`<li class="account-trip">
    <h3 class="account-trip__title">${booking.trip_slug ? html`<a href="${tripPath(booking.trip_slug)}">${booking.trip_title}</a>` : booking.trip_title}</h3>
    <dl>
      <dt>Vertrek</dt><dd>${booking.departure_date ? formatDate(booking.departure_date) : 'onbekend'}</dd>
      ${booking.trip_code ? html`<dt>Reiscode</dt><dd>${booking.trip_code}</dd>` : ''}
      <dt>Referentie</dt><dd>${booking.reference}</dd>
      <dt>Status</dt><dd>${STATUSES[booking.status] || booking.status}</dd>
      ${paymentState(booking.status) ? html`<dt>Betaling</dt><dd>${paymentState(booking.status)}</dd>` : ''}
    </dl>
  </li>`;

  /**
   * Het overzicht Mijn reizen: komende en eerdere reizen, en links naar Mijn gegevens.
   * @param {{email: string}} customer De ingelogde reiziger.
   * @returns {Promise<any>} HTML.
   */
  const overview = async (customer) => {
    const bookings = await bookingsOf(customer.email);
    const now = today();
    const upcoming = bookings.filter((booking) => booking.departure_date && isoDate(booking.departure_date) >= now).reverse();
    const earlier = bookings.filter((booking) => !booking.departure_date || isoDate(booking.departure_date) < now);
    return html`<section class="account-section" aria-labelledby="komende-reizen">
        <h2 id="komende-reizen" class="account-section__title">Komende reizen</h2>
        ${upcoming.length ? html`<ul class="account-trips">${upcoming.map(bookingCard)}</ul>` : html`<p>Je hebt nog geen komende reis. <a href="/reis/">Bekijk ons reisaanbod</a>.</p>`}
        <p class="account__hint">Meld je je aan terwijl je bent ingelogd, dan vullen we die gegevens een volgende keer alvast in. Bijzondere gegevens en je paspoort vragen we elke keer opnieuw.</p>
      </section>
      <section class="account-section" aria-labelledby="eerdere-reizen">
        <h2 id="eerdere-reizen" class="account-section__title">Eerdere reizen</h2>
        ${earlier.length ? html`<ul class="account-trips">${earlier.map(bookingCard)}</ul>` : html`<p>Nog geen eerdere reizen.</p>`}
      </section>
      <p class="account__hint">Je ziet hier de aanmeldingen met het e-mailadres van dit account. Mis je een reis, of klopt er iets niet? Neem contact op met kantoor.</p>
      <p class="account__links"><a href="/account/gegevens/">Mijn gegevens</a> · <a href="/account/wachtwoord/">Wachtwoord wijzigen</a></p>`;
  };

  /**
   * Mijn gegevens: wat bij het account zelf hoort. Naam, adres en telefoon uit aanmeldingen tonen we hier bewust niet:
   * het aanmeldformulier bevestigt het e-mailadres niet, dus een aanmelding met dit adres kan van iemand anders zijn.
   * @param {{email: string}} customer De ingelogde reiziger.
   * @param {{created_at: Date, verified_at: Date}} account Accountgegevens.
   * @returns {Promise<any>} HTML.
   */
  const details = async (customer, account) => {
    const bookings = await bookingsOf(customer.email);
    return html`<dl class="account-details">
        <dt>E-mailadres</dt><dd>${customer.email}</dd>
        <dt>Account sinds</dt><dd>${formatDate(account.created_at)}</dd>
        <dt>Aanmeldingen</dt><dd>${bookings.length}</dd>
      </dl>
      <p class="account__hint">Je naam, adres, telefoon en bijzondere gegevens (geboortedatum, paspoort, kerkgenootschap, gezondheid) beheert kantoor; die tonen we hier niet. Wil je ze inzien of wijzigen? Neem contact op met kantoor.</p>`;
  };

  /**
   * De export van Mijn gegevens als Excel: account en reizen.
   * @param {{email: string}} customer De ingelogde reiziger.
   * @param {{created_at: Date, verified_at: Date, last_login_at: (Date|null)}} account Accountgegevens.
   * @returns {Promise<Buffer>} Het .xlsx-bestand.
   */
  const exportXlsx = async (customer, account) => {
    const bookings = await bookingsOf(customer.email);
    const stamp = (value) => (value ? new Date(value).toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' }) : '');
    const sheets = [
      {
        name: 'Account',
        rows: [['Gegeven', 'Waarde'], ['E-mailadres', customer.email], ['Aangemaakt', stamp(account.created_at)], ['Bevestigd', stamp(account.verified_at)], ['Laatst ingelogd', stamp(account.last_login_at)],
          ['Let op', 'Naam, adres, telefoon en bijzondere gegevens beheert kantoor en zitten niet in deze export; vraag ze op bij kantoor.']],
      },
      {
        name: 'Reizen',
        rows: [['Referentie', 'Reis', 'Reiscode', 'Vertrek', 'Status', 'Betaalkeuze', 'Reissom (€)', 'Aangemeld op'],
          ...bookings.map((booking) => [booking.reference, booking.trip_title, booking.trip_code, booking.departure_date ? isoDate(booking.departure_date) : '',
            STATUSES[booking.status] || booking.status, PAYMENT_LABELS[booking.payment_choice] || booking.payment_choice,
            booking.price_cents === null ? '' : booking.price_cents / 100, stamp(booking.created_at)])],
      },
    ];
    return createXlsx(sheets);
  };

  return { bookingsOf, ownDetailsOf, overview, details, exportXlsx };
}

module.exports = { createMyTrips, paymentState };
