/**
 * Reizen beheren in het CRM (`/app/reizen/`, recht `reizen`, CMS-pakket G2): lijst met filter (komend, vertrokken,
 * concept, alle) en zoeken, een nieuwe reis aanmaken en een reis wijzigen: alle velden van de huidige reis, meerdere
 * landen en reistypes, één reisleider, aantal plaatsen, aanbetaling en concept of gepubliceerd.
 * Een gewijzigde slug krijgt automatisch een 301. Pakket G4: de plaatsen (bezet uit de aanmeldingen, vrij, automatisch
 * volgeboekt) en *Kopiëren naar nieuw vertrek*. Elke wijziging in de auditlog.
 */
const express = require('express');
const { routePath } = require('../route-path');
const { html, raw } = require('../site/html');
const { renderCrmPage, renderAlert, formatDateTime } = require('../crm/layout');
const ui = require('../crm/ui');
const { RICHTEXT_HELP } = require('../cms/block-editor');
const { searchPatterns } = require('../persons/person-routes');
const { formatDate, isoDate, tripPath } = require('../site/format');
const { KINDS } = require('./categories');
const { createTrips, validateTrip, eurosText, LIMITS } = require('./trips');
const { createTripMedia, ROLES, MAX_GALLERY, GALLERY_TEXT_LIMIT } = require('./trip-media');
const { createMediaLibrary, mediaUrl } = require('../media/library');
const { pickerFilter, pickerPhotos, renderPhotoPicker } = require('../media/picker');
const { roleHasRight } = require('../crm/rights');
const { MAX_FILES } = require('../media/routes');
const { MAX_UPLOAD_BYTES } = require('../media/images');
const { seatSummary } = require('./seats');

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
  'reis.fotos': 'Foto\'s van een reis gewijzigd',
  'reis.gekopieerd': 'Reis gekopieerd naar nieuw vertrek',
};

/**
 * De veldbouwers van het reisformulier: tekstveld, tekstvak en vinkje, met foutmelding en `aria-invalid` per veld.
 * @param {any} values De waarden in het formulier.
 * @param {any} errors Fouten per veldnaam.
 * @returns {{input: Function, textarea: Function, checkbox: Function}} De bouwers.
 */
function formFieldHelpers(values, errors) {
  const error = (name) => (errors[name] ? html`<span class="field__error" id="veld-${name}-fout">${errors[name]}</span>` : '');
  const invalid = (name) => (errors[name] ? raw(` aria-invalid="true" aria-describedby="veld-${name}-fout"`) : '');
  const input = (name, label, attributes = {}) => html`<div class="field"><span class="field__label"><label for="veld-${name}">${label}</label></span>
    <input id="veld-${name}" name="${name}" type="${attributes.type || 'text'}" value="${values[name] ?? ''}"${attributes.max ? raw(` maxlength="${Number(attributes.max)}"`) : ''}${attributes.inputmode ? raw(` inputmode="${attributes.inputmode}"`) : ''}${attributes.required ? raw(' required') : ''}${invalid(name)}>${error(name)}
    ${attributes.help ? html`<span class="field__help">${attributes.help}</span>` : ''}</div>`;
  const textarea = (name, label, { rows, max = null, help = '', rich = false }) => html`<div class="field"><span class="field__label"><label for="veld-${name}">${label}</label></span>
    <textarea id="veld-${name}" name="${name}" rows="${rows}"${rich ? raw(' class="cms-richtext"') : ''}${max ? raw(` maxlength="${Number(max)}"`) : ''}${invalid(name)}>${values[name] ?? ''}</textarea>${error(name)}
    ${help ? html`<span class="field__help">${help}</span>` : ''}</div>`;
  const checkbox = (name, label) => html`<div class="field field--checkbox"><label><input type="checkbox" name="${name}" value="1"${values[name] === true || values[name] === '1' ? raw(' checked') : ''}> ${label}</label></div>`;
  return { input, textarea, checkbox };
}

/**
 * De samenvatting boven een bestaande reis: status, volgeboekt, reiscode, vertrekdatum en plaatsen.
 * @param {any} trip Reis uit `trips.get`.
 * @returns {object} HTML.
 */
function renderTripSummary(trip) {
  const status = trip.published ? ui.renderStatus('gepubliceerd', 'Gepubliceerd') : ui.renderStatus('concept', 'Concept');
  const parts = [trip.trip_code, formatDate(trip.departure_date), seatsText(trip)].filter(Boolean);
  return html`<p class="crm-summary">${status}${seatSummary(trip).full ? html` ${ui.renderStatus('vol', 'Volgeboekt')}` : ''}
          ${parts.map((part, index) => html`${index ? ' · ' : ''}<span class="crm-nowrap">${part}</span>`)}</p>`;
}

/**
 * Een groep vinkjes voor één soort categorie (landen, reistypes of overig); landen krijgen een zoekveld erboven.
 * @param {{categories: any[], chosen: Set<string>, kind: string, title: string}} group Alle categorieën, de gekozen
 *   id's, de soort en de kop van de groep.
 * @returns {object|string} HTML, of een lege tekst als er van deze soort geen categorieën zijn.
 */
function renderCategoryGroup({ categories, chosen, kind, title }) {
  const items = categories.filter((category) => category.kind === kind);
  // Landen: alle landen van de wereld staan erin, dus een zoekveld erboven (verborgen zonder JavaScript).
  const search = kind === 'bestemming' ? html`<input class="crm-checklist-search" type="search" placeholder="Zoek een land" aria-label="Zoek een land" data-checklist-search hidden>` : '';
  return items.length ? html`<fieldset class="crm-checklist"${kind === 'bestemming' ? raw(' data-checklist-filter') : ''}><legend>${title}</legend>${search}${items.map((category) => html`<label><input type="checkbox" name="categorie" value="${category.id}"${chosen.has(String(category.id)) ? raw(' checked') : ''}> ${category.name}</label>`)}</fieldset>` : '';
}

/**
 * De keuzelijst met reisleiders; een reisleider die niet online staat krijgt dat erachter.
 * @param {any[]} guides De reisleiders uit `trips.choices`.
 * @param {any} chosenId Het gekozen id uit het formulier.
 * @returns {object} HTML.
 */
function renderGuideSelect(guides, chosenId) {
  return html`<div class="field"><span class="field__label"><label for="veld-reisleider">Reisleider</label></span>
      <select id="veld-reisleider" name="reisleider"><option value="">–</option>${guides.map((guide) => html`<option value="${guide.id}"${String(chosenId || '') === String(guide.id) ? raw(' selected') : ''}>${guide.name}${guide.published ? '' : ' (niet gepubliceerd)'}</option>`)}</select></div>`;
}

/**
 * De tekst naast de knop Opslaan: wie de reis het laatst wijzigde, of bij een nieuwe reis dat hij een concept wordt.
 * @param {any} trip Reis uit `trips.get`, of `null` bij een nieuwe reis.
 * @returns {object|string} HTML of tekst.
 */
function renderSaveNote(trip) {
  if (!trip) return 'De reis wordt als concept aangemaakt, tenzij je bij Zichtbaarheid Gepubliceerd kiest.';
  return html`Laatst gewijzigd ${formatDateTime(trip.updated_at)}${trip.updated_by_name ? html` door ${trip.updated_by_name}` : ''}.`;
}

/**
 * De uitleg bij een reis die nog uit de import komt (nog niet in het CRM beheerd).
 * @param {any} trip Reis uit `trips.get`.
 * @returns {object|string} HTML, of een lege tekst als de reis al in het CRM wordt beheerd.
 */
function renderImportNote(trip) {
  return trip.managed_in_crm ? '' : html`<p class="field__help">Deze reis komt nog uit de import van de huidige site; na opslaan beheer je hem hier en slaat de import hem over.</p>`;
}

/**
 * Tekst voor de plaatsen in de lijst: bezet van totaal, of alleen bezet als het aantal plaatsen onbekend is.
 * @param {object} trip Reis met `booked_seats` en `capacity`.
 * @returns {string} Tekst.
 */
function seatsText(trip) {
  const seats = seatSummary(trip);
  return seats.capacity === null ? `${seats.booked} aangemeld` : `${seats.booked} van ${seats.capacity}`;
}

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
  if ((trip.guide_ids || []).length) values.reisleider = String(trip.guide_ids[0]);
  return values;
}

/** Standaard aantal plaatsen van een nieuwe reis zonder instellingen (Beheer > CRM > Reizen). */
const DEFAULT_CAPACITY = 15;

/**
 * Het aantal plaatsen dat vooraf ingevuld staat bij een nieuwe reis: de instelling `tripDefaultCapacity`, of 15.
 * @param {{get: (key: string) => *}} [settings] Instellingen (`beheer/settings.js`).
 * @returns {number} Aantal plaatsen (1 tot en met 10000).
 */
function defaultCapacity(settings) {
  const value = Number(settings ? settings.get('tripDefaultCapacity') : DEFAULT_CAPACITY);
  return Number.isInteger(value) && value >= 1 && value <= 10000 ? value : DEFAULT_CAPACITY;
}

/**
 * Maakt de routes voor reizen.
 * @param {{db: object, auth: object, redirects?: object, settings?: object}} options Database, sessie- en rechtenlaag,
 *   doorverwijzingen en de instellingen (standaard aantal plaatsen).
 * @returns {express.Router} Router.
 */
function createTripRoutes(options) {
  const { db, auth } = options;
  const trips = createTrips({ db });
  const tripMedia = createTripMedia({ db });
  const library = options.library || createMediaLibrary({ db, mediaDir: options.mediaDir || '' });
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
      return res.send(renderCrmPage({
        title: 'Reizen',
        user: req.user,
        csrf: req.session.csrf,
        path: BASE,
        actions: ui.renderActions([{ label: 'Nieuwe reis', href: `${BASE}nieuw/`, primary: true }]),
        body: html`${ui.renderFilterTabs({
          base: BASE,
          name: 'status',
          current: status,
          params: { q: text },
          label: 'Status',
          options: Object.entries(STATUS_FILTERS).map(([key, label]) => ({ value: key, label })),
        })}
          ${ui.renderSearch({ action: BASE, label: 'Zoek op titel, reiscode of slug', value: text, hidden: { status } })}
          ${ui.renderTable({
          caption: 'Reizen',
          empty: 'Geen reizen gevonden.',
          rows: items,
          columns: [
            { label: 'Vertrek', cell: (trip) => formatDate(trip.departure_date) || '–' },
            { label: 'Reiscode', cell: (trip) => trip.trip_code || '–' },
            { label: 'Titel', cell: (trip) => html`<a href="${BASE}${trip.id}/">${trip.title}</a>` },
            { label: 'Landen', cell: (trip) => trip.countries.join(', ') || '–' },
            { label: 'Reisleider', cell: (trip) => trip.guides.join(', ') || '–' },
            { label: 'Plaatsen', cell: (trip) => seatsText(trip) },
            { label: 'Status', cell: (trip) => (trip.published ? (seatSummary(trip).full ? ui.renderStatus('vol', 'Volgeboekt') : ui.renderStatus('gepubliceerd', 'Gepubliceerd')) : ui.renderStatus('concept', 'Concept')) },
          ],
        })}
          ${ui.renderPager({ base: BASE, params: { status, q: text }, page, hasNext: rows.length > PAGE_SIZE })}`,
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
    const { input, textarea, checkbox } = formFieldHelpers(values, errors);
    const published = values.published === true || values.published === '1';
    const tabs = [
      { key: 'algemeen', label: 'Algemeen' },
      { key: 'prijs', label: 'Prijs' },
      { key: 'tekst', label: 'Tekst en programma' },
      trip ? { key: 'fotos', label: 'Foto\'s' } : null,
      trip ? { key: 'aanmeldingen', label: 'Aanmeldingen', count: seatSummary(trip).booked } : null,
    ];
    const general = html`<div class="crm-edit-cols">
      <section class="crm-narrow">
        ${input('title', 'Titel', { max: LIMITS.title, required: true })}
        ${input('slug', 'Slug (deel van het adres; leeg = uit de titel)', { max: 80, help: 'Wijzig je de slug van een bestaande reis, dan verwijst het oude adres automatisch door (301).' })}
        ${input('trip_code', 'Reiscode', { max: LIMITS.trip_code })}
        ${input('departure_date', 'Vertrekdatum', { type: 'date', required: true })}
        ${input('duration_label', 'Reisduur (tekst, bijvoorbeeld 20 dagen)', { max: LIMITS.duration_label })}
        ${input('duration_days', 'Aantal dagen', { inputmode: 'numeric' })}
        ${input('capacity', 'Aantal plaatsen', { inputmode: 'numeric', help: 'Maximaal aantal deelnemers; normaal 15 (standaard in Beheer > CRM > Reizen). Leeg = onbekend.' })}
        ${renderGuideSelect(guides, values.reisleider)}
        <h2>Landen en reistypes</h2>
        ${renderCategoryGroup({ categories, chosen, kind: 'bestemming', title: 'Landen' })}
        ${renderCategoryGroup({ categories, chosen, kind: 'type', title: 'Reistypes' })}
        ${renderCategoryGroup({ categories, chosen, kind: 'overig', title: KINDS.overig })}
      </section>
      <aside class="crm-edit-side" aria-labelledby="reis-zichtbaarheid">
        <h2 id="reis-zichtbaarheid">Zichtbaarheid</h2>
        <div class="field"><span class="field__label"><label for="veld-published">Zichtbaar op de site</label></span>
          <select id="veld-published" name="published"><option value="0">Concept (niet zichtbaar)</option><option value="1"${published ? raw(' selected') : ''}>Gepubliceerd</option></select></div>
        ${input('status_label', 'Statustekst (bijvoorbeeld "Nog 3 plaatsen")', { max: LIMITS.status_label })}
        ${checkbox('guaranteed', 'Gegarandeerd vertrek')}
        ${checkbox('fully_booked', 'Volgeboekt (ook als er nog plaatsen vrij zijn)')}
        ${checkbox('is_new', 'Nieuw (label op de reis)')}
      </aside>
    </div>`;
    const price = html`<section class="crm-narrow">
      ${input('price', 'Reissom (€)', { inputmode: 'decimal' })}
      ${input('old_price', 'Oude prijs bij een aanbieding (€)', { inputmode: 'decimal' })}
      ${input('offer_until', 'Aanbieding geldig tot', { type: 'date' })}
      ${input('extra_costs', 'Bijkomende kosten (€)', { inputmode: 'decimal' })}
      ${input('deposit', 'Aanbetaling (€)', { inputmode: 'decimal' })}
      ${input('price_note', 'Opmerking bij de prijs', { max: LIMITS.price_note })}
    </section>`;
    const text = html`<section class="crm-narrow crm-narrow--wide">
      ${input('tagline', 'Inleiding (onder de titel)', { max: LIMITS.tagline })}
      ${textarea('summary', 'Samenvatting (in de lijsten)', { rows: 3, max: LIMITS.summary })}
      ${textarea('body_html', 'Reisomschrijving', { rows: 14, help: RICHTEXT_HELP, rich: true })}
    </section>`;
    const saveNote = renderSaveNote(trip);
    return renderCrmPage({
      title: trip ? trip.title : 'Nieuwe reis',
      user: req.user,
      csrf: req.session.csrf,
      path: BASE,
      actions: ui.renderActions([trip && trip.published ? { label: 'Bekijk op de site', href: tripPath(trip.slug) } : null]),
      body: html`${trip ? renderTripSummary(trip) : ''}
        ${state.notice ? html`<p class="notice" role="status">${state.notice}</p>` : ''}
        ${renderAlert(state.error)}
        ${trip ? renderImportNote(trip) : ''}
        <div class="crm-tabbed" data-tabs>
          ${ui.renderTabNav(tabs)}
          <form class="form" method="post" action="${action}" data-tab-form>
            <input type="hidden" name="_csrf" value="${req.session.csrf}">
            ${ui.renderTabPanel('algemeen', general)}
            ${ui.renderTabPanel('prijs', price)}
            ${ui.renderTabPanel('tekst', text)}
            ${ui.renderSaveBar({ label: trip ? 'Opslaan' : 'Reis aanmaken', note: saveNote })}
          </form>
          ${trip ? ui.renderTabPanel('fotos', await renderPhotos(req, trip)) : ''}
          ${trip ? ui.renderTabPanel('aanmeldingen', html`<section class="crm-block">
            <h2>Aanmeldingen en plaatsen</h2>
            ${renderSeats(req, trip)}
          </section>
          <form class="crm-block" method="post" action="${BASE}${trip.id}/kopieren/">
            <input type="hidden" name="_csrf" value="${req.session.csrf}">
            <h2>Nieuw vertrek van deze reis</h2>
            <p class="field__help">Maakt een concept met dezelfde teksten, prijs, landen, reistypes, reisleider en foto's. Niet opgeslagen wijzigingen gaan niet mee.</p>
            <button class="btn btn--small btn--outline" type="submit">Kopiëren naar nieuw vertrek</button>
          </form>`) : ''}
        </div>`,
    });
  };

  /**
   * De plaatsen van een reis: bezet (aanmeldingen die niet geannuleerd zijn), vrij en of de reis daardoor volgeboekt is.
   * @param {object} req Express-verzoek (voor het recht `aanmeldingen`).
   * @param {object} trip Reis uit `trips.get`.
   * @returns {object} HTML.
   */
  const renderSeats = (req, trip) => {
    const seats = seatSummary(trip);
    const booked = `${seats.booked} ${seats.booked === 1 ? 'aanmelding' : 'aanmeldingen'} (niet geannuleerd)`;
    return html`<div class="field" id="plaatsen"><span class="field__label">Plaatsen</span>
      <p>${seats.capacity === null ? html`${booked}; het aantal plaatsen is niet ingevuld.` : html`${booked} van ${seats.capacity} plaatsen, ${seats.free} vrij.`}
        ${seats.automatic ? html`<strong>Volgeboekt</strong> (automatisch: alle plaatsen zijn bezet; aanmelden kan niet meer).` : ''}
        ${roleHasRight(req.user.role, 'aanmeldingen') ? html`<a href="/app/aanmeldingen/?${new URLSearchParams({ reis: String(trip.id) }).toString()}">Aanmeldingen bekijken</a>` : ''}</p></div>`;
  };

  /**
   * Het blok met foto's van een reis: kop- en kaartfoto, galerij met volgorde, galerijtekst, kiezer en direct uploaden.
   * @param {object} req Express-verzoek.
   * @param {object} trip Reis uit `trips.get`.
   * @returns {Promise<object>} HTML.
   */
  const renderPhotos = async (req, trip) => {
    const [links, countries, imported] = await Promise.all([tripMedia.list(trip.id), library.countries(), tripMedia.imported(trip.id)]);
    const importedCount = imported.gallery.length + (imported.hero ? 1 : 0) + (imported.card ? 1 : 0);
    const tripCountries = countries.filter((country) => (trip.category_ids || []).includes(country.id));
    const filter = pickerFilter(req.query, countries, tripCountries.length ? tripCountries[0].id : null);
    const { photos, hasMore } = await pickerPhotos(library, filter);
    const pageUrl = `${BASE}${trip.id}/`;
    const csrf = req.session.csrf;
    const button = (link, action, label) => html`<form method="post" action="${pageUrl}fotos/${link.id}/${action}/"><input type="hidden" name="_csrf" value="${csrf}"><button class="btn btn--small btn--outline" type="submit">${label}</button></form>`;
    const tile = (link, controls) => html`<li class="media-grid__item">
      <img src="${mediaUrl(link, 400)}" alt="${link.alt_text}" loading="lazy" width="${link.width || 400}" height="${link.height || 300}">
      <span class="media-grid__title">${link.title || link.local_name}</span>
      <div class="crm-actions">${controls}</div>
    </li>`;
    const cover = (role) => {
      const link = links.find((item) => item.role === role);
      return html`<div><h3>${ROLES[role]}</h3>${link ? html`<ul class="media-grid">${tile(link, button(link, 'verwijderen', 'Weghalen'))}</ul>` : html`<p>Nog geen ${ROLES[role].toLowerCase()}.</p>`}</div>`;
    };
    const gallery = links.filter((item) => item.role === 'galerij');
    const canUpload = roleHasRight(req.user.role, 'media');
    return html`<section class="crm-block" id="fotos">
      <h2>Foto's</h2>
      <div class="crm-columns">${cover('kop')}${cover('kaart')}</div>
      <h3>Galerij (${String(gallery.length)} van maximaal ${String(MAX_GALLERY)})</h3>
      <form class="form crm-narrow" method="post" action="${pageUrl}galerij/">
        <input type="hidden" name="_csrf" value="${csrf}">
        <div class="field"><span class="field__label"><label for="veld-gallery_title">Titel van de galerij</label></span>
          <input id="veld-gallery_title" name="gallery_title" type="text" value="${trip.gallery_title || ''}" maxlength="${GALLERY_TEXT_LIMIT}"></div>
        <div class="field"><span class="field__label"><label for="veld-gallery_subtitle">Subtitel</label></span>
          <input id="veld-gallery_subtitle" name="gallery_subtitle" type="text" value="${trip.gallery_subtitle || ''}" maxlength="${GALLERY_TEXT_LIMIT}"></div>
        <div><button class="btn btn--small" type="submit">Tekst opslaan</button></div>
      </form>
      ${importedCount ? html`<form class="crm-actions" method="post" action="${pageUrl}fotos/import-weghalen/">
        <input type="hidden" name="_csrf" value="${csrf}">
        <span class="field__help">${importedCount === 1 ? 'Eén foto' : `${importedCount} foto's`} uit de import (${[imported.hero ? 'kopfoto' : '', imported.card ? 'kaartfoto' : '', imported.gallery.length ? `${imported.gallery.length} in de galerij` : ''].filter(Boolean).join(', ')}) staan niet in de bibliotheek. Ze blijven op de site staan tot je ze vervangt of hier weghaalt.</span>
        <button class="btn btn--small btn--outline" type="submit">Foto's uit de import weghalen</button>
      </form>` : ''}
      ${gallery.length ? html`<ol class="media-grid">${gallery.map((link, index) => tile(link, html`${index > 0 ? button(link, 'omhoog', 'Naar voren') : ''}${index < gallery.length - 1 ? button(link, 'omlaag', 'Naar achteren') : ''}${button(link, 'verwijderen', 'Weghalen')}`))}</ol>` : html`<p>Nog geen foto's in de galerij.</p>`}
      <h3>Foto's toevoegen uit de bibliotheek</h3>
      <p class="field__help">Standaard de foto's van ${tripCountries.length ? tripCountries[0].name : 'alle landen'}; zoek of kies een ander land. Kies een of meer foto's en waar ze komen.</p>
      ${renderPhotoPicker({
        pageUrl, action: `${pageUrl}fotos/`, csrf, countries, filter, photos, hasMore, multiple: true, anchor: 'fotos', button: 'Toevoegen',
        extraFields: html`<div class="field"><span class="field__label"><label for="veld-rol">Gebruiken als</label></span>
          <select id="veld-rol" name="rol">${Object.entries(ROLES).map(([role, label]) => html`<option value="${role}"${role === 'galerij' ? raw(' selected') : ''}>${label}</option>`)}</select>
          <span class="field__help">Bij kop- of kaartfoto telt de eerste gekozen foto.</span></div>`,
      })}
      ${canUpload ? html`<details class="crm-block media-upload">
        <summary><strong>Direct uploaden naar de bibliotheek</strong></summary>
        <form class="form" method="post" action="/app/fotobibliotheek/uploaden/" enctype="multipart/form-data">
          <input type="hidden" name="_csrf" value="${csrf}">
          <input type="hidden" name="terug" value="${pageUrl}">
          ${tripCountries.slice(0, 6).map((country) => html`<input type="hidden" name="land" value="${country.id}">`)}
          <div class="field"><span class="field__label"><label for="veld-foto">Foto's (JPEG, PNG of WebP, maximaal ${String(MAX_FILES)} per keer en ${String(MAX_UPLOAD_BYTES / 1024 / 1024)} MB per foto)</label></span>
            <input id="veld-foto" name="foto" type="file" accept="image/jpeg,image/png,image/webp" multiple required></div>
          <p class="field__help">De foto's krijgen de landen van deze reis${tripCountries.length ? html` (${tripCountries.map((country) => country.name).join(', ')})` : ''} en staan daarna bovenaan in de kiezer.</p>
          <div><button class="btn btn--small" type="submit">Uploaden</button></div>
        </form>
      </details>` : ''}
    </section>`;
  };

  router.get('/reizen/nieuw/', guard, async (req, res, next) => {
    try {
      return res.send(await renderForm(req, { values: { published: false, capacity: String(defaultCapacity(options.settings)) } }));
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

  router.get(routePath('/reizen/:id(\\d{1,9})/'), guard, async (req, res, next) => {
    try {
      const trip = await trips.get(req.params.id);
      if (!trip) return notFound(req, res);
      const notices = { 1: 'De reis is opgeslagen.', 2: 'De reis is opgeslagen. Het oude adres verwijst automatisch door naar het nieuwe.', 3: 'De foto\'s zijn opgeslagen.', 4: 'Dit is een kopie als concept. Vul de vertrekdatum in, pas zo nodig de slug en de reiscode aan en publiceer de reis.' };
      const uploaded = Number.parseInt(req.query.geupload, 10);
      if (Number.isInteger(uploaded) && uploaded > 0 && uploaded <= MAX_FILES) notices.upload = `${uploaded} ${uploaded === 1 ? 'foto' : 'foto\'s'} geüpload. Kies ze hieronder om ze toe te voegen.`;
      return res.send(await renderForm(req, { trip, values: formValues(trip), notice: notices[req.query.opgeslagen] || notices.upload || '' }));
    } catch (error) {
      return next(error);
    }
  });

  router.post(routePath('/reizen/:id(\\d{1,9})/'), guard, auth.checkCsrf, async (req, res, next) => {
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

  /**
   * Toont het bewerkscherm opnieuw met een foutmelding bij de foto's.
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @param {number} status HTTP-status.
   * @param {string} message Melding.
   * @returns {Promise<void>}
   */
  const photoError = async (req, res, status, message) => {
    const trip = await trips.get(req.params.id);
    if (!trip) return notFound(req, res);
    return res.status(status).send(await renderForm(req, { trip, values: formValues(trip), error: message }));
  };

  /**
   * De audit en gebruiker voor een wijziging aan de foto's.
   * @param {object} req Express-verzoek.
   * @returns {{userId: number, audit: Function}} Context.
   */
  const photoContext = (req) => ({
    userId: req.user.id,
    audit: (client) => auth.audit(req, { userId: req.user.id, action: 'reis.fotos', entity: 'trips', entityId: req.params.id }, client),
  });

  /**
   * Stuurt na een wijziging aan de foto's door, of toont de fout.
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @param {string} outcome Uitkomst van `tripMedia`.
   * @returns {Promise<void>}
   */
  const afterPhotoChange = async (req, res, outcome) => {
    if (outcome === 'weg') return notFound(req, res);
    if (outcome === 'foto-weg') return photoError(req, res, 409, 'Deze foto bestaat niet (meer). Laad de pagina opnieuw.');
    if (outcome === 'te-veel') return photoError(req, res, 422, `De galerij heeft maximaal ${MAX_GALLERY} foto's.`);
    return res.redirect(303, `${BASE}${Number(req.params.id)}/?opgeslagen=3#fotos`);
  };

  router.post(routePath('/reizen/:id(\\d{1,9})/kopieren/'), guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const result = await trips.copy(req.params.id, {
        userId: req.user.id,
        audit: (client, id) => auth.audit(req, { userId: req.user.id, action: 'reis.gekopieerd', entity: 'trips', entityId: id }, client),
      });
      if (result.status === 'weg') return notFound(req, res);
      return res.redirect(303, `${BASE}${result.id}/?opgeslagen=4`);
    } catch (error) {
      return next(error);
    }
  });

  router.post(routePath('/reizen/:id(\\d{1,9})/fotos/'), guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const role = Object.hasOwn(ROLES, req.body.rol) ? req.body.rol : null;
      const ids = [...new Set([].concat(req.body.media_id ?? []).filter((id) => typeof id === 'string' && /^\d{1,9}$/.test(id)).map(Number))].slice(0, MAX_GALLERY);
      if (!role || !ids.length) return await photoError(req, res, 422, 'Kies een of meer foto\'s en waar ze komen.');
      return await afterPhotoChange(req, res, await tripMedia.add(req.params.id, ids, role, photoContext(req)));
    } catch (error) {
      return next(error);
    }
  });

  router.post(routePath('/reizen/:id(\\d{1,9})/fotos/:link(\\d{1,9})/:action(omhoog|omlaag|verwijderen)/'), guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const context = photoContext(req);
      const outcome = req.params.action === 'verwijderen'
        ? await tripMedia.remove(req.params.id, req.params.link, context)
        : await tripMedia.move(req.params.id, req.params.link, req.params.action, context);
      if (outcome === 'rand') return res.redirect(303, `${BASE}${Number(req.params.id)}/#fotos`);
      return await afterPhotoChange(req, res, outcome);
    } catch (error) {
      return next(error);
    }
  });

  router.post(routePath('/reizen/:id(\\d{1,9})/fotos/import-weghalen/'), guard, auth.checkCsrf, async (req, res, next) => {
    try {
      return await afterPhotoChange(req, res, await tripMedia.dropImported(req.params.id, photoContext(req)));
    } catch (error) {
      return next(error);
    }
  });

  router.post(routePath('/reizen/:id(\\d{1,9})/galerij/'), guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const outcome = await tripMedia.setGalleryText(req.params.id, { title: req.body.gallery_title, subtitle: req.body.gallery_subtitle }, photoContext(req));
      return await afterPhotoChange(req, res, outcome);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createTripRoutes, TRIP_ACTION_LABELS, formValues, defaultCapacity };
