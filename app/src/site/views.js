/**
 * HTML-onderdelen van de website: reiskaarten, zoeker, detailpagina's, lijsten. Geïmporteerde HTML (body_html)
 * is bij de import opgeschoond en wordt hier als raw ingevoegd; al het andere wordt ge-escaped.
 */
const { html, raw } = require('./html');
const { formatPrice, formatDate, formatLongDate, isoDate, tripPath, categoryPath, guidePath, postPath } = require('./format');

/**
 * Eén reis als kaart in een lijst.
 * @param {object} trip Reis (kolommen van een kaart).
 * @returns {object} HTML.
 */
function tripCard(trip) {
  const label = trip.fully_booked ? 'Volgeboekt' : trip.is_new ? 'Nieuw' : trip.status_label ? trip.status_label : '';
  return html`<a class="trip-card${trip.fully_booked ? ' trip-card--full' : ''}" href="${tripPath(trip.slug)}">
    <figure class="trip-card__image">
      ${trip.card_image_url ? html`<img src="${trip.card_image_url}" alt="" loading="lazy" width="800" height="700">` : ''}
      ${label ? html`<span class="trip-card__label">${label}</span>` : ''}
    </figure>
    <div class="trip-card__body">
      <span class="trip-card__meta">${formatDate(trip.departure_date)}${trip.trip_code ? html` <span class="trip-card__code">${trip.trip_code}</span>` : ''}</span>
      <h3 class="trip-card__title">${trip.title}</h3>
      ${trip.summary ? html`<p class="trip-card__summary">${trip.summary}</p>` : ''}
    </div>
    <div class="trip-card__footer">
      ${priceBlock(trip)}
      <span class="trip-card__more">Lees verder</span>
    </div>
  </a>`;
}

/**
 * Prijs met eventuele oude prijs, aanbiedingsdatum en bijkomende kosten.
 * @param {object} trip Reis.
 * @returns {object} HTML.
 */
function priceBlock(trip) {
  if (trip.price_cents === null || trip.price_cents === undefined) return html``;
  return html`<div class="price">
    <span class="price__amount">${trip.old_price_cents ? html`<s class="price__old">${formatPrice(trip.old_price_cents)}</s> ` : ''}${formatPrice(trip.price_cents)}${trip.offer_until ? html` <span class="price__star">*</span>` : ''}</span>
    ${trip.extra_costs_cents ? html`<span class="price__extra">Bijkomende kosten <strong>${formatPrice(trip.extra_costs_cents)}</strong></span>` : ''}
    ${trip.offer_until ? html`<span class="price__offer">* Bij boeking vóór ${formatDate(trip.offer_until)}</span>` : ''}
  </div>`;
}

/**
 * Raster van reiskaarten, met een melding als er geen zijn.
 * @param {object[]} trips Reizen.
 * @param {string} [empty] Tekst als de lijst leeg is.
 * @returns {object} HTML.
 */
function tripGrid(trips, empty = 'Geen reizen gevonden.') {
  if (!trips.length) return html`<p class="notice">${empty}</p>`;
  return html`<div class="card-grid">${trips.map(tripCard)}</div>`;
}

/**
 * Zoeker op bestemming, type en vertrekdatum.
 * @param {{destinations: object[], types: object[], dates: string[], selected?: object, compact?: boolean}} finder Keuzes en huidige selectie.
 * @returns {object} HTML.
 */
function tripFinder(finder) {
  const selected = finder.selected || {};
  /**
   * Eén keuzelijst.
   * @param {string} name Veldnaam.
   * @param {string} label Label.
   * @param {{value: string, label: string}[]} options Opties.
   * @returns {object} HTML.
   */
  const select = (name, label, options) => html`<label class="finder__field">
    <span class="finder__label">${label}</span>
    <select name="${name}">
      <option value="">Maak jouw keuze</option>
      ${options.map((option) => html`<option value="${option.value}"${option.value === selected[name] ? raw(' selected') : ''}>${option.label}</option>`)}
    </select>
  </label>`;
  return html`<form class="finder${finder.compact ? ' finder--compact' : ''}" action="/reis/" method="get" role="search">
    ${select('bestemming', 'Bestemming', finder.destinations.filter((item) => item.trip_count > 0).map((item) => ({ value: item.slug, label: item.name })))}
    ${select('type', 'Type reis', finder.types.map((item) => ({ value: item.slug, label: item.name })))}
    ${select('vertrek', 'Vertrek', finder.dates.map((day) => ({ value: day, label: formatDate(day) })))}
    <button class="btn" type="submit">Vind jouw reis</button>
  </form>`;
}

/**
 * Detailpagina van een reis: kop, kenmerken, tekst, feitenblok, galerij.
 * @param {object} trip Reis met categorieën en reisleider.
 * @param {{isPast: boolean}} state Of de reis al vertrokken is.
 * @returns {object} HTML van de inhoud.
 */
function tripDetail(trip, state) {
  const types = trip.categories.filter((category) => category.kind === 'type');
  const destinations = trip.categories.filter((category) => category.kind === 'bestemming');
  let action = html`<a class="btn btn--large" href="/aanmelden/?id=${trip.legacy_id || ''}&reis=${encodeURIComponent(trip.slug)}">Ik meld me aan!</a>`;
  if (trip.fully_booked) action = html`<span class="btn btn--inactive">Volgeboekt</span>`;
  else if (state.isPast) action = html`<span class="btn btn--inactive">Vertrokken</span>`;
  return html`<div class="container trip">
    <div class="trip__main">
      <div class="trip__badges">
        ${trip.guide_name ? html`<a class="guide-badge" href="${guidePath(trip.guide_slug)}">
          ${trip.guide_photo ? html`<img src="${trip.guide_photo}" alt="" width="64" height="64">` : ''}
          <span><small>Reisleider</small>${trip.guide_name}</span></a>` : ''}
        ${types.length ? html`<div class="type-list"><small>Kenmerken</small>${types.map((type) => html`<a class="type-pill" href="${categoryPath(type.slug)}">${type.name}</a>`)}</div>` : ''}
      </div>
      ${trip.tagline ? html`<p class="lead">${trip.tagline}</p>` : ''}
      <div class="prose">${raw(trip.body_html)}</div>
    </div>
    <aside class="trip__facts" aria-label="Reisgegevens">
      <div class="facts">
        ${priceBlock(trip)}
        <dl>
          ${trip.trip_code ? html`<dt>Reiscode</dt><dd>${trip.trip_code}</dd>` : ''}
          <dt>Vertrek</dt><dd>${formatDate(trip.departure_date)}</dd>
          ${trip.duration_label ? html`<dt>Reisduur</dt><dd>${trip.duration_label}</dd>` : ''}
          ${destinations.length ? html`<dt>Bestemming</dt><dd>${destinations.map((destination, index) => html`${index ? ', ' : ''}<a href="${categoryPath(destination.slug)}">${destination.name}</a>`)}</dd>` : ''}
          ${trip.guide_name ? html`<dt>Reisleider</dt><dd><a href="${guidePath(trip.guide_slug)}">${trip.guide_name}</a></dd>` : ''}
        </dl>
        ${trip.guaranteed ? html`<p class="facts__guaranteed">Gegarandeerd vertrek</p>` : ''}
        ${trip.status_label && !trip.fully_booked ? html`<p class="facts__status">${trip.status_label}</p>` : ''}
        ${action}
      </div>
    </aside>
  </div>
  ${trip.gallery && trip.gallery.length ? html`<section class="section section--soft">
    <div class="container">
      ${trip.gallery_title ? html`<h2 class="section__title">${trip.gallery_title}</h2>` : ''}
      ${trip.gallery_subtitle ? html`<p class="section__subtitle">${trip.gallery_subtitle}</p>` : ''}
      <div class="gallery">${trip.gallery.map((image) => html`<img src="${image.url}" alt="${image.alt || ''}" loading="lazy">`)}</div>
    </div>
  </section>` : ''}`;
}

/**
 * Kaart van een blogbericht.
 * @param {object} post Bericht.
 * @returns {object} HTML.
 */
function postCard(post) {
  return html`<a class="post-card" href="${postPath(post.slug)}">
    <figure class="post-card__image">${post.image_url ? html`<img src="${post.image_url}" alt="" loading="lazy">` : ''}</figure>
    <div class="post-card__body">
      ${post.published_at ? html`<time datetime="${new Date(post.published_at).toISOString()}">${formatLongDate(new Date(post.published_at))}</time>` : ''}
      <h3 class="post-card__title">${post.title}</h3>
      ${post.excerpt ? html`<p>${post.excerpt}</p>` : ''}
    </div>
  </a>`;
}

/**
 * Kaart van een reisleider.
 * @param {object} guide Reisleider.
 * @returns {object} HTML.
 */
function guideCard(guide) {
  return html`<a class="guide-card" href="${guidePath(guide.slug)}">
    <figure class="guide-card__image">${guide.photo_url ? html`<img src="${guide.photo_url}" alt="" loading="lazy">` : ''}</figure>
    <h3 class="guide-card__name">${guide.name}</h3>
  </a>`;
}

/**
 * Paginering met vorige/volgende.
 * @param {{page: number, pages: number, basePath: string}} paging Huidige pagina, aantal pagina's en basispad.
 * @returns {object} HTML.
 */
function pagination(paging) {
  if (paging.pages <= 1) return html``;
  const link = (page) => (page === 1 ? paging.basePath : `${paging.basePath}?pagina=${page}`);
  return html`<nav class="pagination" aria-label="Paginering">
    ${paging.page > 1 ? html`<a href="${link(paging.page - 1)}">Vorige</a>` : ''}
    <span>Pagina ${paging.page} van ${paging.pages}</span>
    ${paging.page < paging.pages ? html`<a href="${link(paging.page + 1)}">Volgende</a>` : ''}
  </nav>`;
}

module.exports = { tripCard, tripGrid, tripFinder, tripDetail, priceBlock, postCard, guideCard, pagination, isoDate };
