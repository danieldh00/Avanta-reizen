/**
 * Reizen beheren in het CRM (`/app/reizen/`, recht `reizen`, CMS-pakket G2): lijst met filter (komend, vertrokken,
 * concept, alle) en zoeken, een nieuwe reis aanmaken en een reis wijzigen: alle velden van de huidige reis, meerdere
 * landen en reistypes, tot drie reisleiders op volgorde, aantal plaatsen, aanbetaling en concept of gepubliceerd.
 * Een gewijzigde slug krijgt automatisch een 301. Elke wijziging in de auditlog.
 */
const express = require('express');
const { html, raw } = require('../site/html');
const { renderCrmPage, renderAlert, formatDateTime } = require('../crm/layout');
const { searchPatterns } = require('../crm/person-routes');
const { formatDate, isoDate, tripPath } = require('../site/format');
const { KINDS } = require('./categories');
const { createTrips, validateTrip, eurosText, LIMITS, MAX_GUIDES } = require('./trips');

/** Basispad van het scherm. */
const BASE = '/app/reizen/';

/** Aantal reizen per pagina. */
const PAGE_SIZE = 50;

/** Filters van de lijst. */
const STATUS_FILTERS = { komend: 'Komend', vertrokken: 'Vertrokken', concept: 'Concept', alle: 'Alle' };

/** Acties voor het auditlog (zie `ACTION_LABELS` in `crm/users.js`). */
const TRIP_ACTION_LABELS = {
  'reis.aangemaakt': 'Reis aangemaakt',
  'reis.gewijzigd': 'Reis gewijzigd',
};

/**
 * Zet een reis uit de database om naar de waarden van het formulier.
 * @param {object} trip Reis uit `trips.get`.
 * @returns {object} Waarden per veldnaam.
 */
function formValues(trip) {
  const values = {
    ...trip,
    departure_date: isoDate(trip.departure_date),
    offer_until: isoDate(trip.offer_until),
    price: eurosText(trip.price_cents),
    old_price: eurosText(trip.old_price_cents),
    extra_costs: eurosText(trip.extra_costs_cents),
    deposit: eurosText(trip.deposit_cents),
    duration_days: trip.duration_days === null ? '' : String(trip.duration_days),
    capacity: trip.capacity === null ? '' : String(trip.capacity),
    trip_code: trip.trip_code || '',
    categorie: (trip.category_ids || []).map(String),
  };
  (trip.guide_ids || []).forEach((id, index) => { values[`reisleider_${index + 1}`] = String(id); });
  return values;
}

/**
 * Maakt de routes voor reizen.
 * @param {{db: object, auth: object, redirects?: object}} options Database, sessie- en rechtenlaag en doorverwijzingen.
 * @returns {express.Router} Router.
 */
function createTripRoutes(options) {
  const { db, auth } = options;
  const trips = createTrips({ db });
  const router = express.Router();
  const guard = auth.requireRight('reizen');

  /**
   * Laadt de doorverwijzingen opnieuw na een nieuwe 301 (een fout daarin laat de wijziging zelf staan).
   * @returns {Promise<void>}
   */
  const reloadRedirects = async () => {
    if (options.redirects) await options.redirects.reload().catch(() => {});
  };

  /**
   * 404-pagina binnen het CRM.
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @returns {void}
   */
  const notFound = (req, res) => res.status(404).send(renderCrmPage({
    title: 'Niet gevonden', user: req.user, csrf: req.session.csrf, path: BASE, body: html`<p>Deze reis bestaat niet. <a href="${BASE}">Naar de reizen</a></p>`,
  }));

  router.get('/reizen/', guard, async (req, res, next) => {
    try {
      const status = Object.hasOwn(STATUS_FILTERS, req.query.status) ? req.query.status : 'komend';
      const { text, patterns } = searchPatterns(req.query.q);
      const page = Math.min(Math.max(Number.parseInt(req.query.pagina, 10) || 1, 1), 1000);
      const rows = await trips.list({ status, patterns, limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE });
      const items = rows.slice(0, PAGE_SIZE);
      const query = (extra) => new URLSearchParams({ status, ...(text ? { q: text } : {}), ...extra }).toString();
      return res.send(renderCrmPage({
        title: 'Reizen',
        user: req.user,
        csrf: req.session.csrf,
        path: BASE,
        body: html`<p><a class="btn btn--small" href="${BASE}nieuw/">Nieuwe reis</a></p>
          <nav class="media-folders" aria-label="Filter"><ul>${Object.entries(STATUS_FILTERS).map(([key, label]) => html`<li><a href="${BASE}?${new URLSearchParams({ status: key, ...(text ? { q: text } : {}) }).toString()}"${key === status ? raw(' aria-current="page"') : ''}>${label}</a></li>`)}</ul></nav>
          <form class="crm-search" method="get" action="${BASE}" role="search">
            <input type="hidden" name="status" value="${status}">
            <label for="veld-q">Zoek op titel, reiscode of slug</label>
            <input id="veld-q" name="q" type="search" value="${text}" maxlength="100">
            <button class="btn btn--small" type="submit">Zoeken</button>
          </form>
          ${items.length ? html`<div class="crm-table-wrap"><table class="crm-table">
            <thead><tr><th>Vertrek</th><th>Reiscode</th><th>Titel</th><th>Landen</th><th>Reisleider</th><th>Plaatsen</th><th>Status</th></tr></thead>
            <tbody>${items.map((trip) => html`<tr>
              <td>${formatDate(trip.departure_date) || '–'}</td>
              <td>${trip.trip_code || '–'}</td>
              <td><a href="${BASE}${trip.id}/">${trip.title}</a></td>
              <td>${trip.countries.join(', ') || '–'}</td>
              <td>${trip.guides.join(', ') || '–'}</td>
              <td>${trip.capacity === null ? '–' : String(trip.capacity)}</td>
              <td>${trip.published ? (trip.fully_booked ? 'volgeboekt' : 'gepubliceerd') : html`<span class="crm-badge">concept</span>`}</td>
            </tr>`)}</tbody>
          </table></div>` : html`<p>Geen reizen gevonden.</p>`}
          <p>${page > 1 ? html`<a href="${BASE}?${query({ pagina: String(page - 1) })}">Vorige</a> ` : ''}${rows.length > PAGE_SIZE ? html`<a href="${BASE}?${query({ pagina: String(page + 1) })}">Volgende</a>` : ''}</p>`,
      }));
    } catch (error) {
      return next(error);
    }
  });

  /**
   * Het formulier van een reis (nieuw of wijzigen).
   * @param {object} req Express-verzoek.
   * @param {{trip?: object, values: object, errors?: object, error?: string, notice?: string}} state De reis (bij
   *   wijzigen), de waarden in het formulier, fouten en meldingen.
   * @returns {Promise<string>} HTML.
   */
  const renderForm = async (req, state) => {
    const { categories, guides } = await trips.choices();
    const values = state.values;
    const errors = state.errors || {};
    const trip = state.trip || null;
    const action = trip ? `${BASE}${trip.id}/` : `${BASE}nieuw/`;
    const chosen = new Set([].concat(values.categorie || []).map(String));
    const error = (name) => (errors[name] ? html`<span class="field__error" id="veld-${name}-fout">${errors[name]}</span>` : '');
    const invalid = (name) => (errors[name] ? raw(` aria-invalid="true" aria-describedby="veld-${name}-fout"`) : '');
    const input = (name, label, attributes = {}) => html`<div class="field"><span class="field__label"><label for="veld-${name}">${label}</label></span>
      <input id="veld-${name}" name="${name}" type="${attributes.type || 'text'}" value="${values[name] ?? ''}"${attributes.max ? raw(` maxlength="${Number(attributes.max)}"`) : ''}${attributes.inputmode ? raw(` inputmode="${attributes.inputmode}"`) : ''}${attributes.required ? raw(' required') : ''}${invalid(name)}>${error(name)}
      ${attributes.help ? html`<span class="field__help">${attributes.help}</span>` : ''}</div>`;
    const textarea = (name, label, rows, max, help) => html`<div class="field"><span class="field__label"><label for="veld-${name}">${label}</label></span>
      <textarea id="veld-${name}" name="${name}" rows="${rows}"${max ? raw(` maxlength="${Number(max)}"`) : ''}${invalid(name)}>${values[name] ?? ''}</textarea>${error(name)}
      ${help ? html`<span class="field__help">${help}</span>` : ''}</div>`;
    const checkbox = (name, label) => html`<div class="field field--checkbox"><label><input type="checkbox" name="${name}" value="1"${values[name] === true || values[name] === '1' ? raw(' checked') : ''}> ${label}</label></div>`;
    const categoryGroup = (kind, title) => {
      const items = categories.filter((category) => category.kind === kind);
      return items.length ? html`<fieldset class="crm-checklist"><legend>${title}</legend>${items.map((category) => html`<label><input type="checkbox" name="categorie" value="${category.id}"${chosen.has(String(category.id)) ? raw(' checked') : ''}> ${category.name}</label>`)}</fieldset>` : '';
    };
    const guideSelect = (index) => html`<div class="field"><span class="field__label"><label for="veld-reisleider_${index}">Reisleider ${index}</label></span>
      <select id="veld-reisleider_${index}" name="reisleider_${index}"><option value="">–</option>${guides.map((guide) => html`<option value="${guide.id}"${String(values[`reisleider_${index}`] || '') === String(guide.id) ? raw(' selected') : ''}>${guide.name}${guide.published ? '' : ' (niet gepubliceerd)'}</option>`)}</select></div>`;
    return renderCrmPage({
      title: trip ? trip.title : 'Nieuwe reis',
      user: req.user,
      csrf: req.session.csrf,
      path: BASE,
      body: html`<p><a href="${BASE}">Naar de reizen</a>${trip && trip.published ? html` · <a href="${tripPath(trip.slug)}">Bekijk op de site</a>` : ''}</p>
        ${state.notice ? html`<p class="notice" role="status">${state.notice}</p>` : ''}
        ${renderAlert(state.error)}
        ${trip ? html`<p class="field__help">Laatst gewijzigd ${formatDateTime(trip.updated_at)}${trip.updated_by_name ? html` door ${trip.updated_by_name}` : ''}.${trip.managed_in_crm ? '' : ' Deze reis komt nog uit de import van de huidige site; na opslaan beheer je hem hier en slaat de import hem over.'}</p>` : ''}
        <form class="form" method="post" action="${action}">
          <input type="hidden" name="_csrf" value="${req.session.csrf}">
          <div class="crm-columns">
            <section class="crm-narrow">
              <h2>Reis</h2>
              ${input('title', 'Titel', { max: LIMITS.title, required: true })}
              ${input('slug', 'Slug (deel van het adres; leeg = uit de titel)', { max: 80, help: 'Wijzig je de slug van een bestaande reis, dan verwijst het oude adres automatisch door (301).' })}
              ${input('trip_code', 'Reiscode', { max: LIMITS.trip_code })}
              ${input('departure_date', 'Vertrekdatum', { type: 'date', required: true })}
              ${input('duration_label', 'Reisduur (tekst, bijvoorbeeld 20 dagen)', { max: LIMITS.duration_label })}
              ${input('duration_days', 'Aantal dagen', { inputmode: 'numeric' })}
              ${input('capacity', 'Aantal plaatsen', { inputmode: 'numeric', help: 'Leeg = onbekend.' })}
              ${input('tagline', 'Inleiding (onder de titel)', { max: LIMITS.tagline })}
              ${textarea('summary', 'Samenvatting (in de lijsten)', 3, LIMITS.summary)}
              ${textarea('body_html', 'Tekst (HTML; alleen veilige opmaak blijft over)', 14, null)}
            </section>
            <section class="crm-narrow">
              <h2>Prijs</h2>
              ${input('price', 'Reissom (€)', { inputmode: 'decimal' })}
              ${input('old_price', 'Oude prijs bij een aanbieding (€)', { inputmode: 'decimal' })}
              ${input('offer_until', 'Aanbieding geldig tot', { type: 'date' })}
              ${input('extra_costs', 'Bijkomende kosten (€)', { inputmode: 'decimal' })}
              ${input('deposit', 'Aanbetaling (€)', { inputmode: 'decimal' })}
              ${input('price_note', 'Opmerking bij de prijs', { max: LIMITS.price_note })}
              <h2>Status</h2>
              <div class="field"><span class="field__label"><label for="veld-published">Zichtbaar op de site</label></span>
                <select id="veld-published" name="published"><option value="0">Concept (niet zichtbaar)</option><option value="1"${values.published === true || values.published === '1' ? raw(' selected') : ''}>Gepubliceerd</option></select></div>
              ${input('status_label', 'Statustekst (bijvoorbeeld "Nog 3 plaatsen")', { max: LIMITS.status_label })}
              ${checkbox('guaranteed', 'Gegarandeerd vertrek')}
              ${checkbox('fully_booked', 'Volgeboekt')}
              ${checkbox('is_new', 'Nieuw (label op de reis)')}
              <h2>Reisleiders</h2>
              ${Array.from({ length: MAX_GUIDES }, (_, index) => guideSelect(index + 1))}
              <h2>Landen en reistypes</h2>
              ${categoryGroup('bestemming', 'Landen')}
              ${categoryGroup('type', 'Reistypes')}
              ${categoryGroup('overig', KINDS.overig)}
            </section>
          </div>
          <div><button class="btn" type="submit">${trip ? 'Opslaan' : 'Reis aanmaken'}</button></div>
        </form>`,
    });
  };

  router.get('/reizen/nieuw/', guard, async (req, res, next) => {
    try {
      return res.send(await renderForm(req, { values: { published: false } }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/reizen/nieuw/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const { values, errors } = validateTrip(req.body);
      if (Object.keys(errors).length) return res.status(422).send(await renderForm(req, { values: req.body, errors, error: 'Controleer de velden.' }));
      const result = await trips.create(values, {
        userId: req.user.id,
        audit: (client, id) => auth.audit(req, { userId: req.user.id, action: 'reis.aangemaakt', entity: 'trips', entityId: id }, client),
      });
      if (result.errors) return res.status(422).send(await renderForm(req, { values: req.body, errors: result.errors, error: 'Controleer de velden.' }));
      await reloadRedirects();
      return res.redirect(303, `${BASE}${result.id}/?opgeslagen=1`);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/reizen/:id(\\d{1,9})/', guard, async (req, res, next) => {
    try {
      const trip = await trips.get(req.params.id);
      if (!trip) return notFound(req, res);
      const notices = { 1: 'De reis is opgeslagen.', 2: 'De reis is opgeslagen. Het oude adres verwijst automatisch door naar het nieuwe.' };
      return res.send(await renderForm(req, { trip, values: formValues(trip), notice: notices[req.query.opgeslagen] || '' }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/reizen/:id(\\d{1,9})/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const { values, errors } = validateTrip(req.body);
      const showErrors = async (fieldErrors) => {
        const trip = await trips.get(req.params.id);
        if (!trip) return notFound(req, res);
        return res.status(422).send(await renderForm(req, { trip, values: req.body, errors: fieldErrors, error: 'Controleer de velden.' }));
      };
      if (Object.keys(errors).length) return await showErrors(errors);
      const result = await trips.update(req.params.id, values, {
        userId: req.user.id,
        audit: (client) => auth.audit(req, { userId: req.user.id, action: 'reis.gewijzigd', entity: 'trips', entityId: req.params.id }, client),
      });
      if (result.status === 'weg') return notFound(req, res);
      if (result.status === 'fout') return await showErrors(result.errors);
      if (result.moved) await reloadRedirects();
      return res.redirect(303, `${BASE}${Number(req.params.id)}/?opgeslagen=${result.moved ? 2 : 1}`);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createTripRoutes, TRIP_ACTION_LABELS, formValues };
