/**
 * Mijn reizen en Mijn gegevens van het reizigersaccount (CMS-pakket J3). Een account hoort bij zijn bevestigde
 * e-mailadres: de aanmeldingen met dat adres zijn de reizen van de reiziger (index `bookings_email_idx` op
 * `lower(email)`). Alleen gewone gegevens: geboortedatum, paspoort, kerkgenootschap, noodnummer en bijzonderheden staan
 * versleuteld bij de persoon en komen nooit in het account of de export; die vraagt de reiziger op bij kantoor.
 */
const { html } = require('../site/html');
const { formatDate, isoDate, tripPath } = require('../site/format');
const { today } = require('../site/content');
const { STATUSES } = require('../crm/booking-routes');
const { createXlsx } = require('../export/xlsx');

/** Leesbare betaalkeuze. */
const PAYMENT_LABELS = { aanbetaling: 'Aanbetaling', totaal: 'Totaalbedrag' };

/** Hoogstens zoveel aanmeldingen tonen en exporteren (ruim boven wat één reiziger ooit heeft). */
const MAX_BOOKINGS = 500;

/**
 * Betaalstand voor de reiziger, afgeleid van de status van de aanmelding.
 * @param {string} status Status (`crm/booking-routes.js`).
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
 * @param {{db: object}} options De database.
 * @returns {{bookingsOf: Function, detailsOf: Function, overview: Function, details: Function, exportXlsx: Function}} Functies.
 */
function createMyTrips(options) {
  const { db } = options;

  /**
   * De aanmeldingen bij een e-mailadres, nieuwste vertrek eerst, met de reis als die nog online staat.
   * @param {string} email Bevestigd e-mailadres van het account (kleine letters).
   * @returns {Promise<object[]>} Aanmeldingen.
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
   * De gewone gegevens van de laatste aanmelding bij een e-mailadres (zoals de reiziger ze toen invulde).
   * @param {string} email Bevestigd e-mailadres.
   * @returns {Promise<(object|null)>} Naam, adres en telefoon, of null zonder aanmelding.
   */
  const detailsOf = async (email) => {
    const [row] = await db.query(
      `SELECT first_names, call_name, last_name, email, mobile, phone, street, postal_code, city, created_at
         FROM bookings WHERE lower(email) = $1 ORDER BY created_at DESC LIMIT 1`,
      [email],
    );
    return row || null;
  };

  /**
   * Eén aanmelding als kaart: reis, datum, referentie, status en betaalstand.
   * @param {object} booking Aanmelding.
   * @returns {object} HTML.
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
   * @returns {Promise<object>} HTML.
   */
  const overview = async (customer) => {
    const bookings = await bookingsOf(customer.email);
    const now = today();
    const upcoming = bookings.filter((booking) => booking.departure_date && isoDate(booking.departure_date) >= now).reverse();
    const earlier = bookings.filter((booking) => !booking.departure_date || isoDate(booking.departure_date) < now);
    return html`<section class="account-section" aria-labelledby="komende-reizen">
        <h2 id="komende-reizen" class="account-section__title">Komende reizen</h2>
        ${upcoming.length ? html`<ul class="account-trips">${upcoming.map(bookingCard)}</ul>` : html`<p>Je hebt nog geen komende reis. <a href="/reis/">Bekijk ons reisaanbod</a>.</p>`}
      </section>
      <section class="account-section" aria-labelledby="eerdere-reizen">
        <h2 id="eerdere-reizen" class="account-section__title">Eerdere reizen</h2>
        ${earlier.length ? html`<ul class="account-trips">${earlier.map(bookingCard)}</ul>` : html`<p>Nog geen eerdere reizen.</p>`}
      </section>
      <p class="account__hint">Je ziet hier de aanmeldingen met het e-mailadres van dit account. Mis je een reis, of klopt er iets niet? Neem contact op met kantoor.</p>
      <p class="account__links"><a href="/account/gegevens/">Mijn gegevens</a> · <a href="/account/wachtwoord/">Wachtwoord wijzigen</a></p>`;
  };

  /**
   * Mijn gegevens: de gewone gegevens van de laatste aanmelding.
   * @param {{email: string}} customer De ingelogde reiziger.
   * @returns {Promise<object>} HTML.
   */
  const details = async (customer) => {
    const row = await detailsOf(customer.email);
    if (!row) return html`<p>Er is nog geen aanmelding met dit e-mailadres, dus er staan nog geen gegevens van je bij ons.</p>`;
    const phone = [row.mobile, row.phone].filter(Boolean).join(' / ');
    return html`<dl class="account-details">
        <dt>Naam</dt><dd>${row.first_names} ${row.last_name}${row.call_name ? ` (${row.call_name})` : ''}</dd>
        <dt>E-mailadres</dt><dd>${row.email}</dd>
        ${phone ? html`<dt>Telefoon</dt><dd>${phone}</dd>` : ''}
        <dt>Adres</dt><dd>${row.street}, ${row.postal_code} ${row.city}</dd>
      </dl>
      <p class="account__hint">Zoals je ze invulde bij je laatste aanmelding (${formatDate(row.created_at)}). Wijzigen? Geef het door aan kantoor. Bijzondere gegevens (geboortedatum, paspoort, kerkgenootschap, gezondheid) tonen we hier niet; die vraag je op bij kantoor.</p>`;
  };

  /**
   * De export van Mijn gegevens als Excel: account, gegevens en reizen.
   * @param {{email: string}} customer De ingelogde reiziger.
   * @param {{created_at: Date, verified_at: Date, last_login_at: (Date|null)}} account Accountgegevens.
   * @returns {Promise<Buffer>} Het .xlsx-bestand.
   */
  const exportXlsx = async (customer, account) => {
    const [bookings, row] = await Promise.all([bookingsOf(customer.email), detailsOf(customer.email)]);
    const stamp = (value) => (value ? new Date(value).toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' }) : '');
    const sheets = [
      { name: 'Account', rows: [['Gegeven', 'Waarde'], ['E-mailadres', customer.email], ['Aangemaakt', stamp(account.created_at)], ['Bevestigd', stamp(account.verified_at)], ['Laatst ingelogd', stamp(account.last_login_at)]] },
      {
        name: 'Gegevens',
        rows: [['Gegeven', 'Waarde'], ...(row ? [
          ['Voornamen', row.first_names], ['Roepnaam', row.call_name], ['Achternaam', row.last_name], ['E-mailadres', row.email],
          ['Mobiel', row.mobile], ['Telefoon', row.phone], ['Straat + huisnummer', row.street], ['Postcode', row.postal_code], ['Woonplaats', row.city],
        ] : []), ['Let op', 'Bijzondere gegevens (geboortedatum, paspoort, kerkgenootschap, noodnummer, gezondheid) staan versleuteld bij kantoor en zitten niet in deze export.']],
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

  return { bookingsOf, detailsOf, overview, details, exportXlsx };
}

module.exports = { createMyTrips, paymentState };
