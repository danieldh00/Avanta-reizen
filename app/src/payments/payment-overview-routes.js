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
const { renderCrmPage, renderAlert } = require('../crm/layout');
const ui = require('../crm/ui');
const { STATUSES } = require('../booking/crm-routes');
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

/** Weergave *te laat*: hoeveel keer het maximum de voorselectie (alle openstaande) mag zijn. */
const LATE_PRESELECT_FACTOR = 4;

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
    coalesce(c.total, 0)::int AS total_cents, coalesce(c.fees, 0)::int AS fee_cents, coalesce(p.paid, 0)::int AS paid_cents,
    r.last_at AS reminded_at
  FROM bookings b
  LEFT JOIN (SELECT booking_id, sum(amount_cents) AS total,
                    sum(amount_cents) FILTER (WHERE kind IN ('boekingskosten', 'sgr')) AS fees
               FROM booking_charges WHERE removed_at IS NULL GROUP BY booking_id) c ON c.booking_id = b.id
  LEFT JOIN (SELECT booking_id, sum(amount_cents) AS paid FROM payments GROUP BY booking_id) p ON p.booking_id = b.id
  LEFT JOIN LATERAL (SELECT max(created_at) AS last_at FROM payment_reminders pr WHERE pr.booking_id = b.id AND pr.sent) r ON true
  WHERE ($1::int IS NULL OR b.trip_id = $1)
    AND ($2 OR b.status <> 'geannuleerd')
    AND ($3 = 'alles' OR ($3 = 'teveel' AND coalesce(c.total, 0) < coalesce(p.paid, 0))
         OR ($3 IN ('open', 'te-laat') AND coalesce(c.total, 0) > coalesce(p.paid, 0)))
  ORDER BY b.departure_date NULLS LAST, b.trip_title, b.last_name, b.id
  LIMIT $4`;

/**
 * Het openstaande bedrag per reis: per aanmelding die niet geannuleerd is het verwachte bedrag (regels die niet zijn
 * weggehaald) min wat betaald is, alleen waar nog iets te betalen is. Dit zijn dezelfde tabellen en voorwaarden als
 * `OVERVIEW_SQL` in de weergave *Nog te betalen*, dus de som is gelijk aan *openstaand* op `/app/betalingen/?reis=<id>`.
 * @param {{query: Function}} db Database.
 * @param {number[]} tripIds Reizen waarvoor het bedrag gevraagd wordt.
 * @returns {Promise<Map<number, number>>} Per reis het openstaande bedrag in centen; een reis zonder openstaand bedrag ontbreekt.
 */
async function outstandingByTrip(db, tripIds) {
  if (!tripIds.length) return new Map();
  const rows = await db.query(
    `SELECT b.trip_id, sum(coalesce(c.total, 0) - coalesce(p.paid, 0))::bigint AS outstanding_cents
       FROM bookings b
       LEFT JOIN (SELECT booking_id, sum(amount_cents) AS total FROM booking_charges WHERE removed_at IS NULL GROUP BY booking_id) c ON c.booking_id = b.id
       LEFT JOIN (SELECT booking_id, sum(amount_cents) AS paid FROM payments GROUP BY booking_id) p ON p.booking_id = b.id
      WHERE b.trip_id = ANY($1::int[])
        AND b.status <> 'geannuleerd'
        AND coalesce(c.total, 0) > coalesce(p.paid, 0)
      GROUP BY b.trip_id`,
    [tripIds],
  );
  return new Map(rows.map((row) => [row.trip_id, Number(row.outstanding_cents)]));
}

/**
 * Leest de aanmeldingen voor het overzicht en rekent per aanmelding de stand uit.
 * @param {{query: Function}} db Database.
 * @param {{view: string, tripId: (number|null), terms: object, today: string, maxRows?: number}} filter Weergave, reis,
 *   termijnen, vandaag en (voor tests) het maximum aantal aanmeldingen.
 * @returns {Promise<{rows: object[], truncated: boolean, scanCapped: boolean}>} Regels met `summary`, of de lijst is
 *   afgekapt, en of dat kwam doordat de voorselectie vol zat (bij *te laat*: te veel openstaande om te bepalen welke te laat zijn).
 */
async function loadOverview(db, filter) {
  const withCancelled = filter.view === 'teveel' || filter.view === 'alles';
  const maxRows = filter.maxRows || MAX_ROWS;
  // De saldo-voorwaarde per weergave staat al in de SQL, zodat het maximum alleen de juiste kant telt. Of een termijn te
  // laat is wordt pas hieronder berekend; daarom haalt *te laat* een ruimere voorselectie op en telt het maximum pas na
  // het filter.
  const sqlLimit = filter.view === 'te-laat' ? maxRows * LATE_PRESELECT_FACTOR : maxRows;
  const rows = await db.query(OVERVIEW_SQL, [filter.tripId, withCancelled, filter.view, sqlLimit + 1]);
  const list = rows.slice(0, sqlLimit).map((row) => ({
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
  const kept = list.filter(keep);
  const scanCapped = rows.length > sqlLimit;
  return { rows: kept.slice(0, maxRows), truncated: scanCapped || kept.length > maxRows, scanCapped };
}

/**
 * De melding bij een afgekapte lijst, met een advies dat past bij de oorzaak en het filter.
 * @param {{view: string, tripId: (number|null)}} filter Weergave en reis.
 * @param {number} maxRows Maximum aantal aanmeldingen.
 * @param {boolean} scanCapped Of de voorselectie vol zat (alleen van belang bij *te laat*).
 * @param {('pagina'|'export')} where Op de pagina (er staat een deel) of bij de export (geweigerd).
 * @returns {string} Melding.
 */
function truncationMessage(filter, maxRows, scanCapped, where) {
  if (filter.view === 'te-laat' && scanCapped) {
    return `Er zijn te veel openstaande aanmeldingen om te bepalen welke te laat zijn${filter.tripId ? '' : '; kies een reis'}.`;
  }
  const lead = where === 'pagina'
    ? `Alleen de eerste ${maxRows} aanmeldingen${filter.tripId ? ' van deze reis' : ''} zijn meegenomen`
    : `${filter.tripId ? 'Deze reis heeft' : 'Er zijn'} in deze weergave meer dan ${maxRows} aanmeldingen`;
  if (!filter.tripId) return `${lead}; kies een reis${where === 'export' ? ' en exporteer per reis' : ''}.`;
  return filter.view === 'te-laat' ? `${lead}.` : `${lead}; kies een smallere weergave (bijvoorbeeld Te laat).`;
}

/**
 * Maakt het Excel-bestand van het overzicht.
 * @param {{rows: object[], view: string, tripLabel: string, userName: string, now: Date}} input Regels, filter, wie en wanneer.
 * @returns {Buffer} Het .xlsx-bestand.
 */
function buildOverviewWorkbook(input) {
  const euro = (cents) => cents / 100;
  const header = ['Referentie', 'Achternaam', 'Roepnaam', 'Reis', 'Reiscode', 'Vertrek', 'Status aanmelding', 'Betaalstatus',
    'Totaal (€)', 'Betaald (€)', 'Openstaand (€)', 'Aanbetaling (€)', 'Aanbetaling uiterlijk', 'Restant uiterlijk', 'Te late termijn', 'Laatste herinnering'];
  const rows = input.rows.map((row) => [
    row.reference, row.last_name, row.call_name || row.first_names, row.trip_title, row.trip_code || '', isoDate(row.departure_date),
    STATUSES[row.status] || row.status, payments.PAYMENT_STATES[row.summary.state], euro(row.summary.totalCents), euro(row.summary.paidCents),
    euro(row.summary.balanceCents), euro(row.summary.depositRequiredCents), row.summary.depositDueOn, row.summary.balanceDueOn || '', row.summary.overdue,
    row.reminded_at ? payments.localDay(row.reminded_at) : '',
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
 * @param {{db: object, auth: object, settings: object, now?: () => number, maxRows?: number}} options Database, sessie-
 *   en rechtenlaag, instellingen (termijnen), en voor tests de klok en het maximum aantal aanmeldingen.
 * @returns {express.Router} Router.
 */
function createPaymentOverviewRoutes(options) {
  const { db, auth, settings } = options;
  const now = options.now || Date.now;
  const maxRows = options.maxRows || MAX_ROWS;
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
      const [{ rows, truncated, scanCapped }, trips] = await Promise.all([
        loadOverview(db, { ...filter, maxRows, terms: payments.termsFrom(settings), today: payments.localDay(now()) }),
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
        actions: ui.renderActions([{ label: 'Excel (.xlsx)', href: `/app/betalingen/overzicht.xlsx?${query}` }]),
        body: html`${ui.renderFilterTabs({
          base: '/app/betalingen/',
          name: 'weergave',
          current: filter.view,
          params: { reis: filter.tripId },
          label: 'Weergave',
          options: Object.entries(VIEWS).map(([key, label]) => ({ value: key, label })),
        })}
          <form class="crm-search" method="get" action="/app/betalingen/">
            <input type="hidden" name="weergave" value="${filter.view}">
            <label for="veld-reis">Reis</label>
            <select id="veld-reis" name="reis"><option value="">Alle reizen</option>${trips.map((trip) => html`<option value="${trip.id}"${trip.id === filter.tripId ? raw(' selected') : ''}>${trip.title}${trip.trip_code ? ` (${trip.trip_code})` : ''}</option>`)}</select>
            <button class="btn btn--small btn--outline" type="submit">Tonen</button>
          </form>
          <p class="crm-summary">${rows.length} aanmelding${rows.length === 1 ? '' : 'en'} · openstaand ${payments.formatAmount(open)}${late ? ` · ${late} te laat` : ''}</p>
          ${truncated ? renderAlert(truncationMessage(filter, maxRows, scanCapped, 'pagina')) : ''}
          ${ui.renderTable({
          caption: 'Betalingen per aanmelding',
          empty: 'Geen aanmeldingen in deze weergave.',
          rows,
          columns: [
            { label: 'Referentie', cell: (row) => html`<a href="/app/betalingen/${row.id}/">${row.reference}</a>` },
            { label: 'Naam', cell: (row) => `${row.last_name}, ${row.call_name || row.first_names}` },
            { label: 'Reis', cell: (row) => `${row.trip_title}${row.trip_code ? ` (${row.trip_code})` : ''}` },
            { label: 'Vertrek', cell: (row) => formatDate(row.departure_date) },
            { label: 'Status', cell: (row) => html`${ui.renderStatus(row.summary.state, payments.PAYMENT_STATES[row.summary.state])}${row.summary.overdue ? html` <span class="crm-badge">${row.summary.overdue} te laat</span>` : ''}` },
            { label: 'Totaal', numeric: true, cell: (row) => payments.formatAmount(row.summary.totalCents) },
            { label: 'Betaald', numeric: true, cell: (row) => payments.formatAmount(row.summary.paidCents) },
            { label: 'Openstaand', numeric: true, cell: (row) => payments.formatAmount(row.summary.balanceCents) },
            { label: 'Aanbetaling uiterlijk', cell: (row) => formatDate(row.summary.depositDueOn) },
            { label: 'Restant uiterlijk', cell: (row) => (row.summary.balanceDueOn ? formatDate(row.summary.balanceDueOn) : '–') },
            { label: 'Laatste herinnering', cell: (row) => (row.reminded_at ? formatDate(payments.localDay(row.reminded_at)) : '–') },
          ],
        })}`,
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
      const { rows, truncated, scanCapped } = await loadOverview(db, { ...filter, maxRows, terms: payments.termsFrom(settings), today: payments.localDay(clock) });
      // Nooit stilletjes een onvolledig bestand: boven het maximum eerst op reis filteren.
      if (truncated) {
        return res.status(422).send(renderCrmPage({
          title: 'Te veel aanmeldingen', user: req.user, csrf: req.session.csrf, path: '/app/betalingen/',
          body: html`${renderAlert(truncationMessage(filter, maxRows, scanCapped, 'export'))}<p><a href="/app/betalingen/">Naar de betalingen</a></p>`,
        }));
      }
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

module.exports = { createPaymentOverviewRoutes, loadOverview, outstandingByTrip, buildOverviewWorkbook, truncationMessage, VIEWS, MAX_ROWS, EXPORT_LIMIT, PAYMENT_OVERVIEW_ACTION_LABELS };
