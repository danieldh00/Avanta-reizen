/**
 * Deelnemerslijsten in het CRM (`/app/deelnemerslijsten/`, recht `export.deelnemers`): per vertrek een Excel-bestand
 * (.xlsx) met de deelnemers. Bijzondere en identiteitsgegevens kiest de gebruiker per categorie; de server weigert een
 * categorie zonder het recht ervoor (403). Elke export staat in het auditlog, met een eigen regel per categorie
 * bijzondere gegevens. De reisleider krijgt dit scherm pas met de beperking tot zijn eigen vertrekken (tot dan 403).
 */
const express = require('express');
const { html } = require('../site/html');
const { formatDate } = require('../site/format');
const { XLSX_TYPE } = require('../export/xlsx');
const { createRateLimiter } = require('../security/rate-limit');
const { roleHasRight } = require('./rights');
const { renderCrmPage, renderAlert } = require('./layout');
const { CATEGORIES, loadParticipants, buildParticipantWorkbook, participantFileName } = require('./participant-lists');

/** Hoogstens zoveel exports per gebruiker per venster (ontsleutelen per persoon is duur). */
const EXPORT_LIMIT = 30;

/** Venster van de exportlimiet (minuten). */
const EXPORT_WINDOW_MINUTES = 10;

/** Hoogstens zoveel deelnemers in één lijst (een vertrek heeft er veel minder; dit begrenst geheugen en ontsleutelen). */
const MAX_ROWS = 1000;

/** Hoogstens zoveel reizen in het overzicht. */
const MAX_TRIPS = 300;

/** Acties voor het auditlog (zie `ACTION_LABELS` in `crm/users.js`). */
const PARTICIPANT_LIST_ACTION_LABELS = {
  'export.deelnemers': 'Deelnemerslijst geëxporteerd (.xlsx)',
  ...Object.fromEntries(Object.entries(CATEGORIES).map(([slug, category]) => [`export.deelnemers.${slug}`, `Deelnemerslijst met ${category.label.toLowerCase()} geëxporteerd`])),
};

/**
 * Maakt de routes voor deelnemerslijsten.
 * @param {{db: object, auth: object, persons: object, now?: () => number}} options Database, sessie- en rechtenlaag,
 *   personen (`crm/persons.js`) en (voor tests) de klok van de limiet.
 * @returns {express.Router} Router.
 */
function createParticipantListRoutes(options) {
  const { db, auth, persons } = options;
  const router = express.Router();
  const guard = auth.requireGlobalRight('export.deelnemers');
  const limiter = createRateLimiter({ limit: EXPORT_LIMIT, windowMs: EXPORT_WINDOW_MINUTES * 60 * 1000, now: options.now });

  /**
   * De categorieën waarvoor de gebruiker het recht heeft.
   * @param {object} user Ingelogde gebruiker.
   * @returns {string[]} Sleutels van CATEGORIES.
   */
  const allowedCategories = (user) => Object.keys(CATEGORIES).filter((slug) => roleHasRight(user.role, CATEGORIES[slug].right));

  /**
   * Het overzicht met per reis (met aanmeldingen) een exportformulier.
   * @param {object} req Express-verzoek.
   * @param {{error?: string}} [state] Foutmelding.
   * @returns {Promise<string>} HTML-pagina.
   */
  const renderOverview = async (req, state = {}) => {
    const trips = await db.query(
      `SELECT t.id, t.title, t.trip_code, t.departure_date,
              count(b.id) FILTER (WHERE b.status <> 'geannuleerd')::int AS participant_count
         FROM trips t JOIN bookings b ON b.trip_id = t.id
        GROUP BY t.id
        ORDER BY (t.departure_date IS NULL OR t.departure_date < current_date), t.departure_date ASC, t.id
        LIMIT $1`,
      [MAX_TRIPS],
    );
    const categories = allowedCategories(req.user);
    const hidden = html`<input type="hidden" name="_csrf" value="${req.session.csrf}">`;
    return renderCrmPage({
      title: 'Deelnemerslijsten',
      user: req.user,
      csrf: req.session.csrf,
      path: '/app/deelnemerslijsten/',
      body: html`${renderAlert(state.error)}
        <p>Per vertrek een Excel-bestand met alle aanmeldingen die niet geannuleerd zijn. Kies alleen de bijzondere gegevens die je echt nodig hebt; elke export wordt gelogd.</p>
        ${trips.length ? html`<div class="crm-table-wrap"><table class="crm-table">
          <thead><tr><th scope="col">Reis</th><th scope="col">Vertrek</th><th scope="col">Deelnemers</th><th scope="col">Exporteren</th></tr></thead>
          <tbody>${trips.map((trip) => html`<tr id="reis-${trip.id}">
            <td>${trip.title}${trip.trip_code ? ` (${trip.trip_code})` : ''}</td>
            <td>${formatDate(trip.departure_date) || '–'}</td>
            <td>${trip.participant_count}</td>
            <td><form method="post" action="/app/deelnemerslijsten/${trip.id}/">${hidden}
              ${categories.map((slug) => html`<label class="choice"><input type="checkbox" name="${slug}" value="ja"> <span>${CATEGORIES[slug].label}</span></label>`)}
              <button class="btn btn--small" type="submit">Download (.xlsx)</button>
            </form></td>
          </tr>`)}</tbody>
        </table></div>` : html`<p>Nog geen reizen met aanmeldingen.</p>`}`,
    });
  };

  router.get('/deelnemerslijsten/', guard, async (req, res, next) => {
    try {
      return res.send(await renderOverview(req));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/deelnemerslijsten/:tripId(\\d{1,9})/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const requested = Object.keys(CATEGORIES).filter((slug) => req.body[slug] === 'ja');
      const allowed = allowedCategories(req.user);
      if (requested.some((slug) => !allowed.includes(slug))) return res.status(403).type('text').send('Je hebt geen toegang tot deze gegevens.');
      const [trip] = await db.query('SELECT id, slug, title, trip_code, departure_date FROM trips WHERE id = $1', [Number(req.params.tripId)]);
      if (!trip) {
        return res.status(404).send(renderCrmPage({
          title: 'Niet gevonden', user: req.user, csrf: req.session.csrf, path: '/app/deelnemerslijsten/', body: html`<p>Deze reis bestaat niet. <a href="/app/deelnemerslijsten/">Naar de deelnemerslijsten</a></p>`,
        }));
      }
      if (!limiter.hit(`gebruiker:${req.user.id}`)) {
        return res.status(429).type('text').send(`Je hebt het maximum van ${EXPORT_LIMIT} exports per ${EXPORT_WINDOW_MINUTES} minuten bereikt. Probeer het straks opnieuw.`);
      }
      const rows = await loadParticipants(db, trip.id, MAX_ROWS);
      if (rows.length > MAX_ROWS) return res.status(422).type('text').send(`Deze reis heeft meer dan ${MAX_ROWS} deelnemers; zo'n lijst maakt het CRM niet in één keer.`);
      const file = buildParticipantWorkbook({ trip, rows, categories: requested, openBlock: persons.openBlock, userName: req.user.name });
      // Eerst loggen: een export die niet gelogd kan worden gaat niet de deur uit.
      await db.transaction(async (client) => {
        await auth.audit(req, { userId: req.user.id, action: 'export.deelnemers', entity: 'trips', entityId: trip.id }, client);
        for (const slug of requested) await auth.audit(req, { userId: req.user.id, action: `export.deelnemers.${slug}`, entity: 'trips', entityId: trip.id }, client);
      });
      return res.set({
        'Content-Type': XLSX_TYPE,
        'Content-Disposition': `attachment; filename="${participantFileName(trip)}"`,
        'Cache-Control': 'no-store',
      }).send(file);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createParticipantListRoutes, PARTICIPANT_LIST_ACTION_LABELS, EXPORT_LIMIT, MAX_ROWS };
