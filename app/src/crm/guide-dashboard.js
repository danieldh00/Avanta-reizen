/**
 * Het overzicht van het CRM (`/app/`) voor de reisleider (rol in `TRIP_SCOPED_ROLES`): zijn eigen vertrekken met het
 * aantal deelnemers, het venster waarin hij bijzondere gegevens mag exporteren en een link naar de deelnemerslijst.
 *
 * Alleen de reizen van het reisleidersprofiel dat aan het account hangt (`users.guide_id` naar `trip_guides`) komen
 * in de query; een reisleider zonder gekoppeld profiel ziet een uitleg in plaats van een lijst. Er staan hier geen
 * persoonsgegevens: alleen aantallen. De lijst zelf en de rechten daarop zitten in `persons/participant-list-routes.js`.
 *
 * Een vertrek blijft in de lijst tot het venster na de terugkomst dicht is; daarna verdwijnt het van het overzicht.
 */

const { html } = require('../site/html');
const { formatDate } = require('../site/format');
const { guideWindowSql, ownTripSql, returnDateSql, describeWindow, TODAY_SQL } = require('../trips/guide-window');
const ui = require('./ui');

/** Hoogstens zoveel vertrekken op het overzicht van de reisleider. */
const GUIDE_TRIP_LIMIT = 50;

/** Een vertrek binnen zoveel dagen telt als "binnenkort" (tegel op het overzicht). */
const SOON_DAYS = 30;

/**
 * Haalt het profiel en de eigen vertrekken van de reisleider op.
 * @param {{query: Function}} db Database.
 * @param {{userId: number, window: {daysBefore: number, daysAfter: number}}} input Gebruiker en het venster uit Beheer.
 * @returns {Promise<{guideName: (string|null), trips: object[], window: object}>} Naam van het gekoppelde profiel (null
 *   zonder koppeling) en de vertrekken (id, title, trip_code, departure_date, return_date, opens_on, closes_on,
 *   in_window, departs_soon, participant_count), eerstvolgende eerst.
 */
async function loadGuideDashboard(db, { userId, window }) {
  const [profile] = await db.query('SELECT g.name FROM users u JOIN guides g ON g.id = u.guide_id WHERE u.id = $1', [userId]);
  if (!profile) return { guideName: null, trips: [], window };
  const windowSql = guideWindowSql('t', { before: 1, after: 2 });
  const trips = await db.query(
    `SELECT t.id, t.title, t.trip_code,
            to_char(t.departure_date, 'YYYY-MM-DD') AS departure_date,
            to_char(${returnDateSql('t')}, 'YYYY-MM-DD') AS return_date,
            to_char(${windowSql.opensOn}, 'YYYY-MM-DD') AS opens_on,
            to_char(${windowSql.closesOn}, 'YYYY-MM-DD') AS closes_on,
            ${windowSql.inWindow} AS in_window,
            (t.departure_date BETWEEN ${TODAY_SQL} AND ${TODAY_SQL} + ${SOON_DAYS}) AS departs_soon,
            (SELECT count(*)::int FROM bookings b WHERE b.trip_id = t.id AND b.status <> 'geannuleerd') AS participant_count
       FROM trips t
      WHERE ${ownTripSql('t', 3)}
        AND $3::int IS NOT NULL
        AND (t.departure_date IS NULL OR ${windowSql.closesOn} >= ${TODAY_SQL})
      ORDER BY t.departure_date IS NULL, t.departure_date, t.id
      LIMIT $4`,
    [window.daysBefore, window.daysAfter, userId, GUIDE_TRIP_LIMIT],
  );
  return { guideName: profile.name, trips, window };
}

/**
 * De stand van het venster van één vertrek in gewone taal, met een label voor de kleur.
 * @param {{departure_date: (string|null), opens_on: (string|null), closes_on: (string|null), in_window: boolean}} trip Vertrek.
 * @returns {object} HTML: open tot en met, opent op, of geen vertrekdatum.
 */
function renderWindowState(trip) {
  if (!trip.departure_date) return html`${ui.renderStatus('geen', 'Nog geen datum')}`;
  if (trip.in_window) return html`${ui.renderStatus('betaald', 'Open')} t/m ${formatDate(trip.closes_on)}`;
  return html`${ui.renderStatus('geen', 'Nog dicht')} opent ${formatDate(trip.opens_on)}`;
}

/**
 * Tekent het overzicht van de reisleider.
 * @param {{guideName: (string|null), trips: object[], window: {daysBefore: number, daysAfter: number}}} data Uitvoer van
 *   `loadGuideDashboard`.
 * @returns {object} HTML: tegels met de aantallen en daaronder de vertrekken als tabel.
 */
function renderGuideDashboard(data) {
  if (!data.guideName) {
    return html`<section class="crm-panel" aria-labelledby="overzicht-mijn-vertrekken">
      <h2 id="overzicht-mijn-vertrekken">Mijn vertrekken</h2>
      <p class="crm-empty">Je account hangt nog niet aan een reisleidersprofiel, dus er zijn nog geen vertrekken te tonen. Vraag de beheerder om je profiel te koppelen (Gebruikers).</p>
    </section>`;
  }
  const open = data.trips.filter((trip) => trip.in_window).length;
  const soon = data.trips.filter((trip) => trip.departs_soon).length;
  const participants = data.trips.reduce((total, trip) => total + trip.participant_count, 0);
  const columns = [
    { label: 'Datum', cell: (trip) => (trip.departure_date ? `${formatDate(trip.departure_date)} t/m ${formatDate(trip.return_date)}` : '–') },
    { label: 'Reis', cell: (trip) => html`${trip.title}${trip.trip_code ? ` (${trip.trip_code})` : ''}` },
    { label: 'Deelnemers', numeric: true, cell: (trip) => String(trip.participant_count) },
    { label: 'Bijzondere gegevens', cell: renderWindowState },
    { label: 'Lijst', cell: (trip) => (trip.participant_count ? html`<a href="/app/deelnemerslijsten/#reis-${trip.id}">Deelnemerslijst</a>` : '–') },
  ];
  return html`<section class="crm-panel" aria-labelledby="overzicht-mijn-vertrekken">
    <h2 id="overzicht-mijn-vertrekken">Mijn vertrekken</h2>
    <ul class="crm-tiles">
      <li><a class="crm-tile${data.trips.length ? ' crm-tile--open' : ''}" href="/app/deelnemerslijsten/"><span class="crm-tile-count">${data.trips.length}</span><span class="crm-tile-label">Vertrekken</span></a></li>
      <li><a class="crm-tile" href="/app/deelnemerslijsten/"><span class="crm-tile-count">${participants}</span><span class="crm-tile-label">Deelnemers</span></a></li>
      <li><a class="crm-tile${open ? ' crm-tile--open' : ''}" href="/app/deelnemerslijsten/"><span class="crm-tile-count">${open}</span><span class="crm-tile-label">Venster open</span></a></li>
      <li><a class="crm-tile${soon ? ' crm-tile--open' : ''}" href="/app/deelnemerslijsten/"><span class="crm-tile-count">${soon}</span><span class="crm-tile-label">Vertrek binnen ${SOON_DAYS} dagen</span></a></li>
    </ul>
  </section>
  <section class="crm-panel" aria-labelledby="overzicht-reisleider-lijsten">
    <h2 id="overzicht-reisleider-lijsten">Vertrekken en deelnemerslijsten</h2>
    ${ui.renderTable({ caption: 'Mijn vertrekken', empty: 'Er staan geen vertrekken op je naam.', rows: data.trips, columns })}
    <p class="field__help">Naam, mobiel en e-mail van je deelnemers kun je altijd downloaden. Identiteits- en gezondheidsgegevens alleen in het venster, ${describeWindow(data.window.daysBefore, data.window.daysAfter)}. Elke download wordt gelogd.</p>
  </section>`;
}

module.exports = { loadGuideDashboard, renderGuideDashboard, renderWindowState, GUIDE_TRIP_LIMIT, SOON_DAYS };
