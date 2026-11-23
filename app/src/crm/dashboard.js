/**
 * Het overzicht van het CRM (`/app/`): wat vandaag aandacht vraagt (*Te doen*), de komende vertrekken met bezetting en
 * openstaand bedrag, recente wijzigingen aan aanmeldingen en, voor de beheerder, de stand van het systeem.
 *
 * Elk onderdeel hoort bij een recht. `loadDashboard` haalt alleen op wat de rol mag zien en `renderDashboard` tekent
 * alleen wat is opgehaald; een onderdeel zonder recht bestaat dus niet in de uitvoer.
 *
 * Elke tegel telt hetzelfde als de lijst waar hij naartoe linkt. *Te laat* komt uit `loadOverview` en het openstaande
 * bedrag per vertrek uit `outstandingByTrip`, beide uit het betaaloverzicht, zodat de cijfers hier en daar gelijk zijn.
 *
 * Mislukt het ophalen van één onderdeel, dan toont alleen dat onderdeel een melding (`FAILED`); de rest van de pagina
 * blijft werken en de fout komt in het logboek.
 */

const { html } = require('../site/html');
const { formatDate } = require('../site/format');
const { bookedSeatsSql, seatSummary } = require('../trips/seats');
const { roleHasRight, roleHasGlobalRight } = require('./rights');
const { formatDateTime } = require('./layout');
const { STATUSES } = require('./booking-routes');
const { loadOverview, outstandingByTrip } = require('./payment-overview-routes');
const payments = require('./payments');
const ui = require('./ui');

/** Hoeveel komende vertrekken het overzicht toont. */
const DEPARTURE_LIMIT = 8;

/** Hoeveel recente wijzigingen het overzicht toont. */
const ACTIVITY_LIMIT = 8;

/** Hoogstens zoveel openstaande aanmeldingen doorrekenen voor de tegel *te late betalingen*. */
const LATE_SCAN_ROWS = 500;

/** Markering voor een onderdeel waarvan het ophalen mislukte (het onderdeel toont dan een melding). */
const FAILED = Symbol('niet geladen');

/**
 * Wat een rol op het overzicht mag zien.
 * @param {string} role Rol van de gebruiker.
 * @returns {{bookings: boolean, persons: boolean, payments: boolean, trips: boolean, system: boolean, users: boolean}} Per onderdeel
 *   of de rol het recht heeft (voor aanmeldingen, deelnemers en betalingen: voor alle records, niet per vertrek).
 */
function dashboardAccess(role) {
  return {
    bookings: roleHasGlobalRight(role, 'aanmeldingen'),
    persons: roleHasGlobalRight(role, 'deelnemers'),
    payments: roleHasGlobalRight(role, 'betalingen'),
    trips: roleHasRight(role, 'reizen'),
    system: roleHasRight(role, 'systeem'),
    users: roleHasRight(role, 'gebruikers'),
  };
}

/**
 * Telt de nieuwe aanmeldingen (status *nieuw*).
 * @param {{query: Function}} db Database.
 * @returns {Promise<number>} Aantal.
 */
async function countNewBookings(db) {
  const [row] = await db.query("SELECT count(*)::int AS total FROM bookings WHERE status = 'nieuw'");
  return row.total;
}

/**
 * Telt de deelnemers die als mogelijk dubbel zijn gemarkeerd.
 * @param {{query: Function}} db Database.
 * @returns {Promise<number>} Aantal.
 */
async function countPossibleDuplicates(db) {
  const [row] = await db.query('SELECT count(*)::int AS total FROM persons WHERE duplicate_of IS NOT NULL');
  return row.total;
}

/**
 * Telt de reizen die als concept staan: dezelfde voorwaarde als het filter *Concept* in de lijst met reizen.
 * @param {{query: Function}} db Database.
 * @returns {Promise<number>} Aantal.
 */
async function countDraftTrips(db) {
  const [row] = await db.query('SELECT count(*)::int AS total FROM trips WHERE NOT published');
  return row.total;
}

/**
 * Telt de aanmeldingen met een te late betaling, met dezelfde berekening als het betaaloverzicht.
 * @param {{query: Function}} db Database.
 * @param {{terms: object, today: string}} input Betaaltermijnen uit Beheer en vandaag.
 * @returns {Promise<{count: number, atLeast: boolean}>} Aantal, en of het er meer kunnen zijn (de lijst was afgekapt).
 */
async function countLatePayments(db, { terms, today }) {
  const { rows, truncated } = await loadOverview(db, { view: 'te-laat', tripId: null, terms, today, maxRows: LATE_SCAN_ROWS });
  return { count: rows.length, atLeast: truncated };
}

/**
 * De eerstvolgende vertrekken met het aantal bezette plaatsen en, als het mag, het openstaande bedrag per vertrek.
 * @param {{query: Function}} db Database.
 * @param {{today: string, withOutstanding: boolean}} input Vandaag en of het openstaande bedrag erbij komt.
 * @returns {Promise<object[]>} Vertrekken (id, title, trip_code, departure_date, capacity, fully_booked, published,
 *   booked_seats en, met `withOutstanding`, outstanding_cents).
 */
async function loadDepartures(db, { today, withOutstanding }) {
  const trips = await db.query(
    `SELECT t.id, t.title, t.trip_code, t.departure_date, t.capacity, t.fully_booked, t.published,
            ${bookedSeatsSql('t')} AS booked_seats
       FROM trips t
      WHERE t.departure_date >= $1::date
      ORDER BY t.departure_date, t.id
      LIMIT $2`,
    [today, DEPARTURE_LIMIT],
  );
  if (!withOutstanding) return trips;
  const outstanding = await outstandingByTrip(db, trips.map((trip) => trip.id));
  return trips.map((trip) => ({ ...trip, outstanding_cents: outstanding.get(trip.id) || 0 }));
}

/**
 * De laatste wijzigingen aan aanmeldingen (statuswijzigingen en notities), nieuwste eerst.
 * @param {{query: Function}} db Database.
 * @returns {Promise<object[]>} Regels (booking_id, reference, from_status, to_status, created_at, user_name).
 */
function loadActivity(db) {
  return db.query(
    `SELECT e.booking_id, b.reference, e.from_status, e.to_status, e.created_at, u.name AS user_name
       FROM booking_events e
       JOIN bookings b ON b.id = e.booking_id
       LEFT JOIN users u ON u.id = e.user_id
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT $1`,
    [ACTIVITY_LIMIT],
  );
}

/**
 * De stand van het systeem voor de beheerder: bewaking, laatste back-up en versie.
 * @param {{monitor?: object, backups?: object, systemUpdate?: object}} sources Bewaking, back-ups en updates (elk mag
 *   ontbreken, bijvoorbeeld in tests).
 * @returns {{monitorEnabled: boolean, openIncidents: number, lastBackupAt: (string|null), version: string, updateAvailable: boolean}}
 *   De stand.
 */
function systemState({ monitor, backups, systemUpdate }) {
  const monitorView = monitor ? monitor.view() : { enabled: false, open: [] };
  const [latestBackup] = backups ? backups.list() : [];
  const updateView = systemUpdate ? systemUpdate.view() : { running: '', newer: false };
  return {
    monitorEnabled: Boolean(monitorView.enabled),
    openIncidents: monitorView.open.length,
    lastBackupAt: latestBackup ? latestBackup.createdAt : null,
    version: updateView.running || '',
    updateAvailable: Boolean(updateView.newer),
  };
}

/**
 * Haalt alles op wat de gebruiker op het overzicht mag zien.
 * @param {{db: object, settings: object, monitor?: object, backups?: object, systemUpdate?: object, appLog?: object}} sources
 *   Database, instellingen (betaaltermijnen), de bronnen voor de stand van het systeem en het logboek.
 * @param {{role: string, now: number}} input Rol van de gebruiker en het huidige tijdstip in ms.
 * @returns {Promise<object>} `access` plus per toegestaan onderdeel de gegevens: `newBookings`, `latePayments`,
 *   `duplicates`, `draftTrips`, `departures`, `activity` en `system`. Een onderdeel zonder recht is `undefined`; een
 *   onderdeel dat niet geladen kon worden is `FAILED`.
 */
async function loadDashboard(sources, { role, now }) {
  const { db, settings } = sources;
  const access = dashboardAccess(role);
  const today = payments.localDay(now);
  /**
   * Haalt één onderdeel op als de rol het mag zien; een fout raakt alleen dit onderdeel.
   * @param {boolean} allowed Of de rol het onderdeel mag zien.
   * @param {string} name Naam van het onderdeel voor het logboek.
   * @param {() => (Promise<*>|*)} load Haalt de gegevens op.
   * @returns {Promise<*>} De gegevens, `undefined` zonder recht, of `FAILED` na een fout.
   */
  const part = async (allowed, name, load) => {
    if (!allowed) return undefined;
    try {
      return await load();
    } catch (error) {
      // Alleen het onderdeel en de soort fout: de melding van de database kan waarden bevatten.
      if (sources.appLog) sources.appLog.error('overzicht', `onderdeel ${name} niet geladen (${error.code || error.name})`);
      return FAILED;
    }
  };
  const [newBookings, latePayments, duplicates, draftTrips, departures, activity, system] = await Promise.all([
    part(access.bookings, 'nieuwe aanmeldingen', () => countNewBookings(db)),
    part(access.payments, 'te late betalingen', () => countLatePayments(db, { terms: payments.termsFrom(settings), today })),
    part(access.persons, 'mogelijke dubbelen', () => countPossibleDuplicates(db)),
    part(access.trips, 'reizen in concept', () => countDraftTrips(db)),
    part(access.trips || access.bookings, 'komende vertrekken', () => loadDepartures(db, { today, withOutstanding: access.payments })),
    part(access.bookings, 'recente activiteit', () => loadActivity(db)),
    part(access.system, 'systeem', () => systemState(sources)),
  ]);
  return { access, newBookings, latePayments, duplicates, draftTrips, departures, activity, system };
}

/**
 * De melding in een onderdeel dat niet geladen kon worden.
 * @returns {object} HTML.
 */
function renderFailed() {
  return html`<p class="crm-empty" role="status">Dit onderdeel kon niet worden geladen. Probeer het later opnieuw.</p>`;
}

/**
 * Eén tegel van *Te doen*: een getal met een omschrijving, als link naar de lijst met dat filter.
 * @param {{count: (number|symbol), label: string, href: string, atLeast?: boolean}} tile Aantal (of `FAILED`),
 *   omschrijving, adres en of het aantal een ondergrens is.
 * @returns {object} HTML.
 */
function renderTile(tile) {
  const failed = tile.count === FAILED;
  return html`<li><a class="crm-tile${!failed && tile.count ? ' crm-tile--open' : ''}" href="${tile.href}"${failed ? html` title="Dit aantal kon niet worden geladen"` : ''}>
    <span class="crm-tile-count">${failed ? '?' : (tile.atLeast ? `${tile.count}+` : tile.count)}</span>
    <span class="crm-tile-label">${tile.label}</span>
  </a></li>`;
}

/**
 * De tegels van *Te doen* voor wat de gebruiker mag zien.
 * @param {object} data Uitvoer van `loadDashboard`.
 * @returns {(object|string)} HTML, of een lege tekst als geen enkele tegel van toepassing is.
 */
function renderTodo(data) {
  const tiles = [
    data.newBookings === undefined ? null : { count: data.newBookings, label: 'Nieuwe aanmeldingen', href: '/app/aanmeldingen/?status=nieuw' },
    data.latePayments === undefined ? null : { count: data.latePayments === FAILED ? FAILED : data.latePayments.count, atLeast: data.latePayments !== FAILED && data.latePayments.atLeast, label: 'Te late betalingen', href: '/app/betalingen/?weergave=te-laat' },
    data.duplicates === undefined ? null : { count: data.duplicates, label: 'Mogelijk dubbele deelnemers', href: '/app/deelnemers/?dubbel=1' },
    data.draftTrips === undefined ? null : { count: data.draftTrips, label: 'Reizen in concept', href: '/app/reizen/?status=concept' },
  ].filter(Boolean);
  if (!tiles.length) return '';
  return html`<section class="crm-panel" aria-labelledby="overzicht-te-doen">
    <h2 id="overzicht-te-doen">Te doen</h2>
    <ul class="crm-tiles">${tiles.map(renderTile)}</ul>
  </section>`;
}

/**
 * De komende vertrekken als tabel.
 * @param {object} data Uitvoer van `loadDashboard`.
 * @returns {(object|string)} HTML, of een lege tekst als de gebruiker geen vertrekken mag zien.
 */
function renderDepartures(data) {
  if (data.departures === undefined) return '';
  const { access } = data;
  /**
   * Het adres waar een vertrek naartoe linkt: het bewerkscherm, of anders de aanmeldingen van die reis.
   * @param {object} trip Vertrek.
   * @returns {string} Adres.
   */
  const hrefOf = (trip) => (access.trips ? `/app/reizen/${trip.id}/` : `/app/aanmeldingen/?reis=${trip.id}`);
  const columns = [
    { label: 'Vertrek', cell: (trip) => formatDate(trip.departure_date) },
    { label: 'Reis', cell: (trip) => html`<a href="${hrefOf(trip)}">${trip.title}</a>${trip.trip_code ? ` (${trip.trip_code})` : ''}${trip.published ? '' : html` ${ui.renderStatus('concept', 'Concept')}`}` },
    {
      label: 'Plaatsen',
      cell: (trip) => {
        const seats = seatSummary(trip);
        return html`${seats.capacity === null ? `${seats.booked} bezet` : `${seats.booked} van ${seats.capacity}`}${seats.full ? html` ${ui.renderStatus('vol', 'Volgeboekt')}` : ''}`;
      },
    },
    access.payments ? { label: 'Openstaand', numeric: true, cell: (trip) => payments.formatAmount(Number(trip.outstanding_cents)) } : null,
  ].filter(Boolean);
  return html`<section class="crm-panel" aria-labelledby="overzicht-vertrekken">
    <h2 id="overzicht-vertrekken">Komende vertrekken</h2>
    ${data.departures === FAILED ? renderFailed() : ui.renderTable({ caption: 'Komende vertrekken', empty: 'Er staan geen vertrekken gepland.', rows: data.departures, columns })}
    ${access.trips ? html`<p class="crm-panel-more"><a href="/app/reizen/">Alle reizen</a></p>` : ''}
  </section>`;
}

/**
 * Omschrijft een wijziging aan een aanmelding in gewone taal.
 * @param {{from_status: (string|null), to_status: (string|null)}} event Wijziging.
 * @returns {string} Omschrijving.
 */
function describeEvent(event) {
  const label = (status) => STATUSES[status] || status;
  if (event.to_status && event.from_status && event.to_status !== event.from_status) return `van ${label(event.from_status)} naar ${label(event.to_status)}`;
  if (event.to_status && !event.from_status) return `aangemaakt als ${label(event.to_status)}`;
  return 'notitie toegevoegd';
}

/**
 * De recente wijzigingen aan aanmeldingen.
 * @param {object} data Uitvoer van `loadDashboard`.
 * @returns {(object|string)} HTML, of een lege tekst als de gebruiker geen aanmeldingen mag zien.
 */
function renderActivity(data) {
  if (data.activity === undefined) return '';
  return html`<section class="crm-panel" aria-labelledby="overzicht-activiteit">
    <h2 id="overzicht-activiteit">Recente activiteit</h2>
    ${data.activity === FAILED ? renderFailed() : data.activity.length ? html`<ol class="crm-activity">${data.activity.map((event) => html`<li>
      <a href="/app/aanmeldingen/${event.booking_id}/">${event.reference}</a>: ${describeEvent(event)}
      <span class="crm-activity-meta">${formatDateTime(event.created_at)}${event.user_name ? ` · ${event.user_name}` : ''}</span>
    </li>`)}</ol>` : html`<p class="crm-empty">Nog geen wijzigingen aan aanmeldingen.</p>`}
  </section>`;
}

/**
 * De stand van het systeem voor de beheerder.
 * @param {object} data Uitvoer van `loadDashboard`.
 * @returns {(object|string)} HTML, of een lege tekst zonder het recht `systeem`.
 */
function renderSystem(data) {
  if (data.system === undefined) return '';
  if (data.system === FAILED) return html`<section class="crm-panel" aria-labelledby="overzicht-systeem"><h2 id="overzicht-systeem">Systeem</h2>${renderFailed()}</section>`;
  const { system } = data;
  const monitorStatus = !system.monitorEnabled
    ? ui.renderStatus('geen', 'Uit')
    : (system.openIncidents ? ui.renderStatus('teveel', `${system.openIncidents} open`) : ui.renderStatus('betaald', 'In orde'));
  return html`<section class="crm-panel" aria-labelledby="overzicht-systeem">
    <h2 id="overzicht-systeem">Systeem</h2>
    <dl class="crm-facts">
      <dt>Bewaking</dt><dd>${monitorStatus} <a href="/app/beheer/bewaking/">Bekijken</a></dd>
      <dt>Laatste back-up</dt><dd>${system.lastBackupAt ? formatDateTime(system.lastBackupAt) : 'Nog geen'} <a href="/app/beheer/back-ups/">Back-ups</a></dd>
      <dt>Versie</dt><dd>${system.version || 'onbekend'}${system.updateAvailable ? html` ${ui.renderStatus('nieuw', 'Update beschikbaar')}` : ''} <a href="/app/beheer/updates/">Updates</a></dd>
      ${data.access.users ? html`<dt>Gebruikers</dt><dd><a href="/app/gebruikers/">Gebruikers beheren</a></dd>` : ''}
    </dl>
  </section>`;
}

/**
 * Tekent het overzicht.
 * @param {object} data Uitvoer van `loadDashboard`.
 * @returns {object} HTML: *Te doen*, daaronder links de vertrekken en rechts activiteit en systeem.
 */
function renderDashboard(data) {
  const side = [renderActivity(data), renderSystem(data)].filter(Boolean);
  const departures = renderDepartures(data);
  return html`${renderTodo(data)}
    ${departures || side.length ? html`<div class="crm-dash${departures && side.length ? ' crm-dash--split' : ''}">
      ${departures ? html`<div class="crm-dash-main">${departures}</div>` : ''}
      ${side.length ? html`<div class="crm-dash-side">${side}</div>` : ''}
    </div>` : ''}`;
}

module.exports = { loadDashboard, renderDashboard, dashboardAccess, describeEvent, systemState, FAILED, DEPARTURE_LIMIT, ACTIVITY_LIMIT };
