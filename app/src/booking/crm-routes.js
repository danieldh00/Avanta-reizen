/**
 * Aanmeldingen in het CRM (`/app/aanmeldingen/`, recht `aanmeldingen`): lijst met filter op status en reis en zoeken,
 * de pagina van één aanmelding met de gegevens zoals ze zijn ingevuld (zonder bijzondere gegevens: die staan bij de
 * persoon), statuswijzigingen volgens vaste overgangen en notities, met de historie in `booking_events`.
 * Statussen: nieuw → bevestigd → aanbetaald → betaald, en geannuleerd (met reden). Geen wachtlijst (besluit 21-11-2026).
 * De reisleider krijgt dit scherm pas met de beperking tot zijn eigen vertrekken (tot dan 403).
 */
const express = require('express');
const { html, raw } = require('../site/html');
const { formatDate, formatPrice } = require('../site/format');
const { FIELDS } = require('./fields');
const { roleHasGlobalRight } = require('../crm/rights');
const { searchPatterns } = require('../persons/person-routes');
const { renderCrmPage, renderAlert, formatDateTime } = require('../crm/layout');
const ui = require('../crm/ui');
const payments = require('../payments/payments');

/** De statussen met hun naam op het scherm, in volgorde. */
const STATUSES = {
  nieuw: 'Nieuw',
  bevestigd: 'Bevestigd',
  aanbetaald: 'Aanbetaald',
  betaald: 'Betaald',
  geannuleerd: 'Geannuleerd',
};

/** Toegestane overgangen per status. */
const TRANSITIONS = {
  nieuw: ['bevestigd', 'geannuleerd'],
  bevestigd: ['aanbetaald', 'betaald', 'geannuleerd'],
  aanbetaald: ['betaald', 'geannuleerd'],
  betaald: ['geannuleerd'],
  geannuleerd: [],
};

/** Aantal aanmeldingen per pagina. */
const PAGE_SIZE = 50;

/** Maximale lengte van een notitie of annuleringsreden. */
const NOTE_MAX = 1000;

/** Acties voor het auditlog (zie `ACTION_LABELS` in `crm/users.js`). */
const BOOKING_ACTION_LABELS = {
  'aanmelding.status': 'Status van een aanmelding gewijzigd',
  'aanmelding.notitie': 'Notitie bij een aanmelding toegevoegd',
};

/** Labels van de formuliervelden op naam. */
const LABELS = Object.fromEntries(FIELDS.map((field) => [field.name, field.label]));

/** Kolommen van een aanmelding voor de detailpagina (nooit `sensitive_data`). */
const BOOKING_COLUMNS = `id, reference, trip_id, trip_title, trip_code, departure_date, status, created_at, gender, first_names, call_name,
  last_name, email, mobile, phone, street, postal_code, city, occupation, travel_with, earlier_trip, credit_card, driver_interest,
  driver_before, driver_when, payment_choice, price_cents, deposit_cents, person_id, consent_at, confirmed_at, cancelled_at, cancel_reason`;

/**
 * Of een overgang van status mag.
 * @param {string} from Huidige status.
 * @param {string} to Nieuwe status.
 * @returns {boolean} Waar als de overgang mag.
 */
function canTransition(from, to) {
  return Object.hasOwn(TRANSITIONS, from) && TRANSITIONS[from].includes(to);
}

/**
 * Leest een notitie: stuurtekens weg, regeleinden behouden, ingekort.
 * @param {*} value Invoer.
 * @returns {string} Tekst.
 */
function noteField(value) {
  // eslint-disable-next-line no-control-regex
  return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n/g, '\n').trim().slice(0, NOTE_MAX) : '';
}

/**
 * Het blok met de betaalstand op de pagina van een aanmelding (alleen voor wie het recht `betalingen` heeft).
 * @param {object} summary Uitkomst van `payments.summarize`.
 * @param {number} bookingId Id van de aanmelding.
 * @returns {object} HTML.
 */
function renderPaymentSummary(summary, bookingId) {
  return html`<h2>Betalingen</h2>
    <dl class="crm-facts">
      <dt>Betaalstatus</dt><dd><span class="crm-status crm-status--${summary.state}">${payments.PAYMENT_STATES[summary.state]}</span>${summary.overdue ? html` <span class="crm-badge">${summary.overdue} te laat</span>` : ''}</dd>
      <dt>Totaal</dt><dd>${payments.formatAmount(summary.totalCents)}</dd>
      <dt>Betaald</dt><dd>${payments.formatAmount(summary.paidCents)}</dd>
      <dt>Openstaand</dt><dd>${payments.formatAmount(summary.balanceCents)}</dd>
    </dl>
    ${summary.mismatch ? html`<p class="form-alert" role="status">${summary.mismatch}</p>` : ''}
    <p><a href="/app/betalingen/${bookingId}/">Betalingen bekijken en registreren</a></p>`;
}

/**
 * Maakt de routes voor aanmeldingen.
 * @param {{db: object, auth: object, settings: object, now?: () => number}} options Database, sessie- en rechtenlaag,
 *   instellingen (betaaltermijnen) en de klok (tests).
 * @returns {express.Router} Router.
 */
function createBookingRoutes(options) {
  const { db, auth, settings } = options;
  const now = options.now || Date.now;
  const router = express.Router();
  const guard = auth.requireGlobalRight('aanmeldingen');

  /**
   * Zoekt een aanmelding op id.
   * @param {{query: Function}} client Database of transactie-client.
   * @param {string} id Id uit de URL (alleen cijfers).
   * @param {{lock?: boolean}} [mode] De rij vergrendelen.
   * @returns {Promise<(object|null)>} Aanmelding, of null.
   */
  const findBooking = async (client, id, mode = {}) => {
    const [booking] = await client.query(`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE id = $1${mode.lock ? ' FOR UPDATE' : ''}`, [Number(id)]);
    return booking || null;
  };

  /**
   * 404-pagina binnen het CRM.
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @returns {void}
   */
  const notFound = (req, res) => res.status(404).send(renderCrmPage({
    title: 'Niet gevonden', user: req.user, csrf: req.session.csrf, path: '/app/aanmeldingen/', body: html`<p>Deze aanmelding bestaat niet. <a href="/app/aanmeldingen/">Naar de aanmeldingen</a></p>`,
  }));

  router.get('/aanmeldingen/', guard, async (req, res, next) => {
    try {
      const status = Object.hasOwn(STATUSES, req.query.status) ? req.query.status : '';
      const tripId = /^\d{1,9}$/.test(String(req.query.reis || '')) ? Number(req.query.reis) : null;
      const { text, patterns } = searchPatterns(req.query.q);
      const page = Math.min(Math.max(Number.parseInt(req.query.pagina, 10) || 1, 1), 10000);
      const [rows, trips, counts] = await Promise.all([
        db.query(
          `SELECT id, reference, trip_title, trip_code, departure_date, status, created_at, first_names, call_name, last_name, city
             FROM bookings
            WHERE ($1 = '' OR status = $1)
              AND ($2::int IS NULL OR trip_id = $2)
              AND NOT EXISTS (
                    SELECT 1 FROM unnest($3::text[]) AS term
                     WHERE lower(reference || ' ' || last_name || ' ' || first_names || ' ' || call_name || ' ' || email || ' ' || coalesce(trip_code, '')) NOT LIKE term
                  )
            ORDER BY created_at DESC, id DESC
            LIMIT $4 OFFSET $5`,
          [status, tripId, patterns, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE],
        ),
        // Alleen reizen met aanmeldingen, voor het filter.
        db.query(
          `SELECT t.id, t.title, t.trip_code, t.departure_date FROM trips t
            WHERE EXISTS (SELECT 1 FROM bookings b WHERE b.trip_id = t.id)
            ORDER BY t.departure_date DESC NULLS LAST, t.id`,
        ),
        // Aantallen per status binnen de gekozen reis en zoektekst, voor de filterknoppen.
        db.query(
          `SELECT status, count(*)::int AS total
             FROM bookings
            WHERE ($1::int IS NULL OR trip_id = $1)
              AND NOT EXISTS (
                    SELECT 1 FROM unnest($2::text[]) AS term
                     WHERE lower(reference || ' ' || last_name || ' ' || first_names || ' ' || call_name || ' ' || email || ' ' || coalesce(trip_code, '')) NOT LIKE term
                  )
            GROUP BY status`,
          [tripId, patterns],
        ),
      ]);
      const list = rows.slice(0, PAGE_SIZE);
      const filters = { q: text, reis: tripId };
      const perStatus = new Map(counts.map((row) => [row.status, row.total]));
      const total = counts.reduce((sum, row) => sum + row.total, 0);
      return res.send(renderCrmPage({
        title: 'Aanmeldingen',
        user: req.user,
        csrf: req.session.csrf,
        path: '/app/aanmeldingen/',
        actions: ui.renderActions([
          tripId && roleHasGlobalRight(req.user.role, 'export.deelnemers') ? { label: 'Deelnemerslijst (.xlsx)', href: `/app/deelnemerslijsten/#reis-${tripId}` } : null,
        ]),
        body: html`${ui.renderFilterTabs({
          base: '/app/aanmeldingen/',
          name: 'status',
          current: status,
          params: filters,
          label: 'Status',
          options: [{ value: '', label: 'Alle', count: total }, ...Object.entries(STATUSES).map(([key, label]) => ({ value: key, label, count: perStatus.get(key) || 0 }))],
        })}
          ${ui.renderSearch({
          action: '/app/aanmeldingen/',
          label: 'Zoek op referentie, naam, e-mailadres of reiscode',
          value: text,
          hidden: { status },
          extra: html`<label for="veld-reis" class="visually-hidden">Reis</label>
            <select id="veld-reis" name="reis"><option value="">Alle reizen</option>${trips.map((trip) => html`<option value="${trip.id}"${trip.id === tripId ? raw(' selected') : ''}>${trip.title}${trip.trip_code ? ` (${trip.trip_code})` : ''}</option>`)}</select>`,
        })}
          ${ui.renderTable({
          caption: 'Aanmeldingen',
          empty: 'Geen aanmeldingen gevonden.',
          rows: list,
          columns: [
            { label: 'Referentie', cell: (booking) => html`<a href="/app/aanmeldingen/${booking.id}/">${booking.reference}</a>` },
            { label: 'Naam', cell: (booking) => `${booking.last_name}, ${booking.call_name || booking.first_names}` },
            { label: 'Reis', cell: (booking) => `${booking.trip_title}${booking.trip_code ? ` (${booking.trip_code})` : ''}` },
            { label: 'Vertrek', cell: (booking) => formatDate(booking.departure_date) },
            { label: 'Status', cell: (booking) => ui.renderStatus(booking.status, STATUSES[booking.status] || booking.status) },
            { label: 'Aangemeld', cell: (booking) => formatDateTime(booking.created_at) },
          ],
        })}
          ${ui.renderPager({ base: '/app/aanmeldingen/', params: { ...filters, status }, page, hasNext: rows.length > PAGE_SIZE })}`,
      }));
    } catch (error) {
      return next(error);
    }
  });

  /**
   * De pagina van één aanmelding.
   * @param {object} req Express-verzoek.
   * @param {object} booking De aanmelding.
   * @param {{error?: string, notice?: string, note?: string}} [state] Foutmelding, melding en een ingevulde notitie.
   * @returns {Promise<string>} HTML-pagina.
   */
  const renderBooking = async (req, booking, state = {}) => {
    const showPayments = roleHasGlobalRight(req.user.role, 'betalingen');
    let paymentSummary = null;
    if (showPayments) {
      const summary = payments.summarize({ booking, ...(await payments.loadLines(db, booking.id)), terms: payments.termsFrom(settings), today: payments.localDay(now()) });
      paymentSummary = { ...summary, mismatch: payments.statusMismatch(booking.status, summary.state) };
    }
    const events = await db.query(
      `SELECT e.from_status, e.to_status, e.note, e.created_at, u.name AS user_name
         FROM booking_events e LEFT JOIN users u ON u.id = e.user_id
        WHERE e.booking_id = $1 ORDER BY e.created_at DESC, e.id DESC`,
      [booking.id],
    );
    const hidden = html`<input type="hidden" name="_csrf" value="${req.session.csrf}">`;
    const yesNo = (value) => (value ? 'ja' : 'nee');
    const nextStatuses = TRANSITIONS[booking.status] || [];
    const facts = [
      ['Reis', html`${booking.trip_title}${booking.trip_code ? ` (${booking.trip_code})` : ''}`],
      ['Vertrek', formatDate(booking.departure_date)],
      ['Reissom bij aanmelden', booking.price_cents ? formatPrice(booking.price_cents) : '–'],
      [LABELS.payment_choice, booking.payment_choice === 'totaal' ? 'Totaalbedrag' : 'Aanbetaling'],
      ['Aangemeld', formatDateTime(booking.created_at)],
      ['Akkoord voorwaarden', formatDateTime(booking.consent_at)],
      ['Bevestigd', formatDateTime(booking.confirmed_at)],
      ...(booking.cancelled_at ? [['Geannuleerd', html`${formatDateTime(booking.cancelled_at)}: ${booking.cancel_reason}`]] : []),
    ];
    const given = [
      ...['gender', 'first_names', 'call_name', 'last_name', 'email', 'mobile', 'phone', 'street', 'postal_code', 'city', 'occupation', 'travel_with'].map((name) => [LABELS[name], booking[name] || '–']),
      [LABELS.earlier_trip, yesNo(booking.earlier_trip)], [LABELS.credit_card, yesNo(booking.credit_card)],
      [LABELS.driver_interest, yesNo(booking.driver_interest)], [LABELS.driver_before, yesNo(booking.driver_before)],
      [LABELS.driver_when, booking.driver_when || '–'],
    ];
    return renderCrmPage({
      title: `Aanmelding ${booking.reference}`,
      user: req.user,
      csrf: req.session.csrf,
      path: '/app/aanmeldingen/',
      body: html`<p><a href="/app/aanmeldingen/">Naar de aanmeldingen</a>${booking.person_id && roleHasGlobalRight(req.user.role, 'deelnemers') ? html` · <a href="/app/deelnemers/${booking.person_id}/">Naar de deelnemer</a>` : ''}</p>
        ${state.notice ? html`<p class="notice" role="status">${state.notice}</p>` : ''}
        ${renderAlert(state.error)}
        <div class="crm-columns">
          <section>
            <h2>Status: <span class="crm-status crm-status--${booking.status}">${STATUSES[booking.status] || booking.status}</span></h2>
            ${nextStatuses.length ? html`<form class="form crm-narrow" method="post" action="/app/aanmeldingen/${booking.id}/status/">${hidden}
              <input type="hidden" name="van" value="${booking.status}">
              <div class="field"><span class="field__label"><label for="veld-naar">Nieuwe status</label></span>
                <select id="veld-naar" name="naar" required>${nextStatuses.map((status) => html`<option value="${status}">${STATUSES[status]}</option>`)}</select></div>
              <div class="field"><span class="field__label"><label for="veld-notitie">Toelichting (verplicht bij annuleren)</label></span>
                <textarea id="veld-notitie" name="notitie" rows="3" maxlength="${NOTE_MAX}">${state.note || ''}</textarea></div>
              <div><button class="btn" type="submit">Status wijzigen</button></div>
            </form>` : html`<p>Deze aanmelding is geannuleerd; de status verandert niet meer.</p>`}
            <h2>Notitie toevoegen</h2>
            <form class="form crm-narrow" method="post" action="/app/aanmeldingen/${booking.id}/notitie/">${hidden}
              <div class="field"><span class="field__label"><label for="veld-notitie-los">Notitie</label></span>
                <textarea id="veld-notitie-los" name="notitie" rows="3" maxlength="${NOTE_MAX}" required></textarea></div>
              <div><button class="btn btn--outline" type="submit">Notitie opslaan</button></div>
            </form>
            <h2>Historie</h2>
            ${events.length ? html`<ol class="crm-history">${events.map((event) => html`<li>
              <span class="crm-history__when">${formatDateTime(event.created_at)} · ${event.user_name || '–'}</span>
              ${event.from_status !== event.to_status ? html`<strong>${STATUSES[event.from_status] || event.from_status || '–'} → ${STATUSES[event.to_status] || event.to_status}</strong>` : ''}
              ${event.note ? html`<p>${event.note}</p>` : ''}
            </li>`)}</ol>` : html`<p>Nog geen wijzigingen.</p>`}
          </section>
          <section>
            ${paymentSummary ? renderPaymentSummary(paymentSummary, booking.id) : ''}
            <h2>Aanmelding</h2>
            <dl class="crm-facts">${facts.map(([label, value]) => html`<dt>${label}</dt><dd>${value}</dd>`)}</dl>
            <h2>Zoals ingevuld</h2>
            <p class="field__help">Momentopname van het formulier; de actuele gegevens en bijzondere gegevens staan bij de deelnemer.</p>
            <dl class="crm-facts">${given.map(([label, value]) => html`<dt>${label}</dt><dd>${value}</dd>`)}</dl>
          </section>
        </div>`,
    });
  };

  router.get('/aanmeldingen/:id(\\d{1,9})/', guard, async (req, res, next) => {
    try {
      const booking = await findBooking(db, req.params.id);
      if (!booking) return notFound(req, res);
      const notices = { status: 'De status is gewijzigd.', notitie: 'De notitie is opgeslagen.' };
      return res.send(await renderBooking(req, booking, { notice: notices[req.query.opgeslagen] || '' }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/aanmeldingen/:id(\\d{1,9})/status/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const to = String(req.body.naar || '');
      const from = String(req.body.van || '');
      const note = noteField(req.body.notitie);
      const outcome = await db.transaction(async (client) => {
        const booking = await findBooking(client, req.params.id, { lock: true });
        if (!booking) return { status: 'weg' };
        // Het formulier hoort bij de status die op het scherm stond; is die intussen gewijzigd, dan niet blind doorvoeren.
        if (booking.status !== from) return { status: 'gewijzigd', booking };
        if (!canTransition(booking.status, to)) return { status: 'ongeldig', booking };
        if (to === 'geannuleerd' && !note) return { status: 'reden', booking };
        await client.query(
          `UPDATE bookings SET status = $2, status_changed_at = now(),
             confirmed_at = CASE WHEN $2 = 'bevestigd' THEN coalesce(confirmed_at, now()) ELSE confirmed_at END,
             cancelled_at = CASE WHEN $2 = 'geannuleerd' THEN now() ELSE cancelled_at END,
             cancel_reason = CASE WHEN $2 = 'geannuleerd' THEN $3 ELSE cancel_reason END
           WHERE id = $1`,
          [booking.id, to, note],
        );
        await client.query('INSERT INTO booking_events (booking_id, from_status, to_status, user_id, note) VALUES ($1, $2, $3, $4, $5)', [booking.id, booking.status, to, req.user.id, note]);
        await auth.audit(req, { userId: req.user.id, action: 'aanmelding.status', entity: 'bookings', entityId: booking.id }, client);
        return { status: 'ok', booking };
      });
      if (outcome.status === 'weg') return notFound(req, res);
      const errors = {
        gewijzigd: [409, 'De status is intussen door iemand anders gewijzigd. Bekijk de nieuwe stand en probeer het opnieuw.'],
        ongeldig: [422, 'Deze statuswijziging is niet mogelijk.'],
        reden: [422, 'Vul bij annuleren een toelichting in.'],
      };
      if (errors[outcome.status]) {
        const [code, message] = errors[outcome.status];
        return res.status(code).send(await renderBooking(req, outcome.booking, { error: message, note }));
      }
      return res.redirect(303, `/app/aanmeldingen/${outcome.booking.id}/?opgeslagen=status`);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/aanmeldingen/:id(\\d{1,9})/notitie/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const note = noteField(req.body.notitie);
      const booking = await findBooking(db, req.params.id);
      if (!booking) return notFound(req, res);
      if (!note) return res.status(422).send(await renderBooking(req, booking, { error: 'Vul een notitie in.' }));
      const saved = await db.transaction(async (client) => {
        // Status in de transactie onder slot lezen, zodat de notitie nooit een verouderde status in de historie krijgt.
        const current = await findBooking(client, booking.id, { lock: true });
        if (!current) return false;
        await client.query('INSERT INTO booking_events (booking_id, from_status, to_status, user_id, note) VALUES ($1, $2, $2, $3, $4)', [current.id, current.status, req.user.id, note]);
        await auth.audit(req, { userId: req.user.id, action: 'aanmelding.notitie', entity: 'bookings', entityId: current.id }, client);
        return true;
      });
      if (!saved) return notFound(req, res);
      return res.redirect(303, `/app/aanmeldingen/${booking.id}/?opgeslagen=notitie`);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createBookingRoutes, canTransition, STATUSES, TRANSITIONS, BOOKING_ACTION_LABELS };
