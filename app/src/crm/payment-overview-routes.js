/**
 * Overzicht van de betalingen in het CRM (`/app/betalingen/`, recht `betalingen`): welke aanmeldingen nog iets moeten
 * betalen, welke te laat zijn en waar te veel is betaald, met filter op reis en de totalen. Dezelfde lijst als Excel
 * (.xlsx, nooit CSV) via `/app/betalingen/overzicht.xlsx`; elke export staat in het auditlog en heeft een limiet.
 * Saldo, aanbetaling en vervaldatums komen uit `payments.summarize`, net als op de pagina van één aanmelding.
 */
const express = require('express');
const { html, raw } = require('../site/html');
const { formatDate, isoDate } = require('../site/format');
const { createXlsx, XLSX_TYPE } = require('../export/xlsx');
const { createRateLimiter } = require('../security/rate-limit');
const { renderCrmPage, renderAlert } = require('./layout');
const { STATUSES } = require('./booking-routes');
const payments = require('./payments');

/** De weergaven van het overzicht. */
const VIEWS = {
  open: 'Nog te betalen',
  'te-laat': 'Te laat',
  teveel: 'Te veel betaald',
  alles: 'Alle aanmeldingen',
};

/** Hoogstens zoveel aanmeldingen in het overzicht en de export. */
const MAX_ROWS = 5000;

/** Hoogstens zoveel exports per gebruiker per venster. */
const EXPORT_LIMIT = 30;

/** Venster van de exportlimiet (minuten). */
const EXPORT_WINDOW_MINUTES = 10;

/** Acties voor het auditlog (zie `ACTION_LABELS` in `crm/users.js`). */
const PAYMENT_OVERVIEW_ACTION_LABELS = {
  'export.betalingen': 'Betaaloverzicht geëxporteerd (.xlsx)',
};

/** Totalen per aanmelding: verwacht, waarvan boekingskosten en SGR, en betaald (zonder N+1). */
const OVERVIEW_SQL = `SELECT b.id, b.reference, b.trip_id, b.trip_title, b.trip_code, b.departure_date, b.status, b.created_at,
    b.first_names, b.call_name, b.last_name, b.payment_choice, b.deposit_cents,
    coalesce(c.total, 0)::int AS total_cents, coalesce(c.fees, 0)::int AS fee_cents, coalesce(p.paid, 0)::int AS paid_cents
  FROM bookings b
  LEFT JOIN (SELECT booking_id, sum(amount_cents) AS total,
                    sum(amount_cents) FILTER (WHERE kind IN ('boekingskosten', 'sgr')) AS fees
               FROM booking_charges WHERE removed_at IS NULL GROUP BY booking_id) c ON c.booking_id = b.id
  LEFT JOIN (SELECT booking_id, sum(amount_cents) AS paid FROM payments GROUP BY booking_id) p ON p.booking_id = b.id
  WHERE ($1::int IS NULL OR b.trip_id = $1)
    AND ($2 OR b.status <> 'geannuleerd')
    AND ($3 OR coalesce(c.total, 0) <> coalesce(p.paid, 0))
  ORDER BY b.departure_date NULLS LAST, b.trip_title, b.last_name, b.id
  LIMIT $4`;

/**
 * Leest de aanmeldingen voor het overzicht en rekent per aanmelding de stand uit.
 * @param {{query: Function}} db Database.
 * @param {{view: string, tripId: (number|null), terms: object, today: string}} filter Weergave, reis, termijnen en vandaag.
 * @returns {Promise<{rows: object[], truncated: boolean}>} Regels met `summary`, en of de lijst is afgekapt.
 */
async function loadOverview(db, filter) {
  const withCancelled = filter.view === 'teveel' || filter.view === 'alles';
  const rows = await db.query(OVERVIEW_SQL, [filter.tripId, withCancelled, filter.view === 'alles', MAX_ROWS + 1]);
  const truncated = rows.length > MAX_ROWS;
  const list = rows.slice(0, MAX_ROWS).map((row) => ({
    ...row,
    // Zelfde berekening als op de pagina van de aanmelding: de totalen als twee regels en één betaling.
    summary: payments.summarize({
      booking: row,
      charges: [{ kind: 'overig', amount_cents: row.total_cents - row.fee_cents }, { kind: 'sgr', amount_cents: row.fee_cents }],
      payments: [{ amount_cents: row.paid_cents }],
      terms: filter.terms,
      today: filter.today,
    }),
  }));
  const keep = {
    open: (row) => row.summary.balanceCents > 0,
    'te-laat': (row) => Boolean(row.summary.overdue),
    teveel: (row) => row.summary.balanceCents < 0,
    alles: () => true,
  }[filter.view];
  return { rows: list.filter(keep), truncated };
}

/**
 * Maakt het Excel-bestand van het overzicht.
 * @param {{rows: object[], view: string, tripLabel: string, userName: string, now: Date}} input Regels, filter, wie en wanneer.
 * @returns {Buffer} Het .xlsx-bestand.
 */
function buildOverviewWorkbook(input) {
  const euro = (cents) => cents / 100;
  const header = ['Referentie', 'Achternaam', 'Roepnaam', 'Reis', 'Reiscode', 'Vertrek', 'Status aanmelding', 'Betaalstatus',
    'Totaal (€)', 'Betaald (€)', 'Openstaand (€)', 'Aanbetaling (€)', 'Aanbetaling uiterlijk', 'Restant uiterlijk', 'Te laat'];
  const rows = input.rows.map((row) => [
    row.reference, row.last_name, row.call_name || row.first_names, row.trip_title, row.trip_code || '', isoDate(row.departure_date),
    STATUSES[row.status] || row.status, payments.PAYMENT_STATES[row.summary.state], euro(row.summary.totalCents), euro(row.summary.paidCents),
    euro(row.summary.balanceCents), euro(row.summary.depositRequiredCents), row.summary.depositDueOn, row.summary.balanceDueOn || '', row.summary.overdue,
  ]);
  const open = input.rows.reduce((sum, row) => sum + Math.max(row.summary.balanceCents, 0), 0);
  const about = [
    ['Over deze export', ''],
    ['Weergave', VIEWS[input.view]],
    ['Reis', input.tripLabel],
    ['Aantal aanmeldingen', input.rows.length],
    ['Totaal openstaand (€)', euro(open)],
    ['Gemaakt door', input.userName],
    ['Gemaakt op', input.now.toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' })],
  ];
  return createXlsx([{ name: 'Betalingen', rows: [header, ...rows] }, { name: 'Over deze export', rows: about }]);
}

/**
 * Maakt de routes voor het betaaloverzicht.
 * @param {{db: object, auth: object, settings: object, now?: () => number}} options Database, sessie- en rechtenlaag,
 *   instellingen (termijnen) en de klok (tests).
 * @returns {express.Router} Router.
 */
function createPaymentOverviewRoutes(options) {
  const { db, auth, settings } = options;
  const now = options.now || Date.now;
  const router = express.Router();
  const guard = auth.requireGlobalRight('betalingen');
  const limiter = createRateLimiter({ limit: EXPORT_LIMIT, windowMs: EXPORT_WINDOW_MINUTES * 60 * 1000, now: options.now });

  /**
   * Leest het filter uit de querystring.
   * @param {object} query `req.query`.
   * @returns {{view: string, tripId: (number|null)}} Filter.
   */
  const readFilter = (query) => ({
    view: Object.hasOwn(VIEWS, query.weergave) ? query.weergave : 'open',
    tripId: /^\d{1,9}$/.test(String(query.reis || '')) ? Number(query.reis) : null,
  });

  /**
   * Reizen met aanmeldingen, voor het filter.
   * @returns {Promise<object[]>} Reizen.
   */
  const tripsWithBookings = () => db.query(
    `SELECT t.id, t.title, t.trip_code, t.departure_date FROM trips t
      WHERE EXISTS (SELECT 1 FROM bookings b WHERE b.trip_id = t.id)
      ORDER BY t.departure_date DESC NULLS LAST, t.id`,
  );

  router.get('/betalingen/', guard, async (req, res, next) => {
    try {
      const filter = readFilter(req.query);
      const [{ rows, truncated }, trips] = await Promise.all([
        loadOverview(db, { ...filter, terms: payments.termsFrom(settings), today: payments.localDay(now()) }),
        tripsWithBookings(),
      ]);
      const open = rows.reduce((sum, row) => sum + Math.max(row.summary.balanceCents, 0), 0);
      const late = rows.filter((row) => row.summary.overdue).length;
      const query = new URLSearchParams({ weergave: filter.view, ...(filter.tripId ? { reis: String(filter.tripId) } : {}) }).toString();
      return res.send(renderCrmPage({
        title: 'Betalingen',
        user: req.user,
        csrf: req.session.csrf,
        path: '/app/betalingen/',
        body: html`<form class="crm-search" method="get" action="/app/betalingen/">
            <label for="veld-weergave" class="visually-hidden">Weergave</label>
            <select id="veld-weergave" name="weergave">${Object.entries(VIEWS).map(([key, label]) => html`<option value="${key}"${key === filter.view ? raw(' selected') : ''}>${label}</option>`)}</select>
            <label for="veld-reis" class="visually-hidden">Reis</label>
            <select id="veld-reis" name="reis"><option value="">Alle reizen</option>${trips.map((trip) => html`<option value="${trip.id}"${trip.id === filter.tripId ? raw(' selected') : ''}>${trip.title}${trip.trip_code ? ` (${trip.trip_code})` : ''}</option>`)}</select>
            <button class="btn btn--small" type="submit">Tonen</button>
            <a class="btn btn--small btn--outline" href="/app/betalingen/overzicht.xlsx?${query}">Excel (.xlsx)</a>
          </form>
          <p>${rows.length} aanmelding${rows.length === 1 ? '' : 'en'} · openstaand ${payments.formatAmount(open)}${late ? ` · ${late} te laat` : ''}</p>
          ${truncated ? renderAlert(`Alleen de eerste ${MAX_ROWS} aanmeldingen zijn meegenomen; kies een reis.`) : ''}
          ${rows.length ? html`<div class="crm-table-wrap"><table class="crm-table">
            <thead><tr><th scope="col">Referentie</th><th scope="col">Naam</th><th scope="col">Reis</th><th scope="col">Vertrek</th><th scope="col">Status</th>
              <th scope="col">Totaal</th><th scope="col">Betaald</th><th scope="col">Openstaand</th><th scope="col">Aanbetaling uiterlijk</th><th scope="col">Restant uiterlijk</th></tr></thead>
            <tbody>${rows.map((row) => html`<tr>
              <td><a href="/app/betalingen/${row.id}/">${row.reference}</a></td>
              <td>${row.last_name}, ${row.call_name || row.first_names}</td>
              <td>${row.trip_title}${row.trip_code ? ` (${row.trip_code})` : ''}</td>
              <td>${formatDate(row.departure_date)}</td>
              <td><span class="crm-status crm-status--${row.summary.state}">${payments.PAYMENT_STATES[row.summary.state]}</span>${row.summary.overdue ? html` <span class="crm-badge">${row.summary.overdue} te laat</span>` : ''}</td>
              <td>${payments.formatAmount(row.summary.totalCents)}</td>
              <td>${payments.formatAmount(row.summary.paidCents)}</td>
              <td>${payments.formatAmount(row.summary.balanceCents)}</td>
              <td>${formatDate(row.summary.depositDueOn)}</td>
              <td>${row.summary.balanceDueOn ? formatDate(row.summary.balanceDueOn) : '–'}</td>
            </tr>`)}</tbody>
          </table></div>` : html`<p>Geen aanmeldingen in deze weergave.</p>`}`,
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/betalingen/overzicht.xlsx', guard, async (req, res, next) => {
    try {
      if (!limiter.hit(`gebruiker:${req.user.id}`)) {
        return res.status(429).send(renderCrmPage({
          title: 'Even wachten', user: req.user, csrf: req.session.csrf, path: '/app/betalingen/',
          body: html`${renderAlert(`Je hebt het maximum van ${EXPORT_LIMIT} exports per ${EXPORT_WINDOW_MINUTES} minuten bereikt. Probeer het straks opnieuw.`)}<p><a href="/app/betalingen/">Naar de betalingen</a></p>`,
        }));
      }
      const filter = readFilter(req.query);
      const clock = new Date(now());
      const { rows } = await loadOverview(db, { ...filter, terms: payments.termsFrom(settings), today: payments.localDay(clock) });
      let tripLabel = 'Alle reizen';
      if (filter.tripId) {
        const [trip] = await db.query('SELECT title, trip_code FROM trips WHERE id = $1', [filter.tripId]);
        tripLabel = trip ? `${trip.title}${trip.trip_code ? ` (${trip.trip_code})` : ''}` : 'onbekende reis';
      }
      const file = buildOverviewWorkbook({ rows, view: filter.view, tripLabel, userName: req.user.name, now: clock });
      // Eerst loggen: een export die niet gelogd kan worden gaat niet de deur uit.
      await auth.audit(req, { userId: req.user.id, action: 'export.betalingen', entity: 'trips', entityId: filter.tripId ?? undefined });
      return res.set({
        'Content-Type': XLSX_TYPE,
        'Content-Disposition': `attachment; filename="betalingen-${filter.view}-${payments.localDay(clock)}.xlsx"`,
        'Cache-Control': 'no-store',
      }).send(file);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createPaymentOverviewRoutes, loadOverview, buildOverviewWorkbook, VIEWS, MAX_ROWS, EXPORT_LIMIT, PAYMENT_OVERVIEW_ACTION_LABELS };
