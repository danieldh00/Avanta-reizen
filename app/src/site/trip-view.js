/**
 * HTML van de reispagina's in de opmaak van de huidige site (CMS-pakket E3): de reisbox in een lijst (liggend, met
 * prijsvak), het reisdetail (reisleider, kenmerken met iconen, inleiding, tekst, zijvak met prijs, gegevens,
 * gegarandeerd vertrek en aanmeldknop), de fotogalerij met titel, en de reisleiders (lijst en detail).
 * Geïmporteerde HTML (body_html) is bij de import opgeschoond en wordt als raw ingevoegd; al het andere wordt ge-escaped.
 */
const { html, raw } = require('./html');
const { formatDate, tripPath, categoryPath, guidePath } = require('./format');
const { icon, categoryIconName } = require('./icons');
const { cssImageUrl } = require('./layout');

/**
 * Bedrag zoals de huidige site het toont: euroteken, geen scheiding voor duizendtallen, ",-" bij hele euro's.
 * @param {number} cents Bedrag in centen.
 * @returns {string} Bijvoorbeeld `€1849,-` of `€799,50`.
 */
function themePrice(cents) {
  const value = Math.round(Number(cents) || 0);
  const euros = Math.floor(value / 100);
  const rest = value % 100;
  return `€${euros},${rest ? String(rest).padStart(2, '0') : '-'}`;
}

/**
 * Achtergrondfoto als style-attribuut (alleen veilige adressen, zie `cssImageUrl`).
 * @param {string} url Adres.
 * @returns {object|string} Attribuut of leeg.
 */
function backgroundStyle(url) {
  const safe = cssImageUrl(url);
  return safe ? html` style="background-image: url('${safe}')"` : '';
}

/**
 * Het prijsvak: prijs (met oude prijs en sterretje bij een aanbieding), bijkomende kosten en aanbiedingsdatum.
 * @param {object} trip Reis.
 * @returns {object|string} HTML, of leeg zonder prijs.
 */
function priceBox(trip) {
  if (trip.price_cents === null || trip.price_cents === undefined) return '';
  return html`<div class="box__additional">
    <span class="trip__price">${themePrice(trip.price_cents)}${trip.old_price_cents ? html`<span class="trip__price--old"><span class="visually-hidden">van </span>${themePrice(trip.old_price_cents)}</span>` : ''}${trip.offer_until ? html`<span class="trip__price-info" aria-hidden="true">*</span>` : ''}</span>
    ${trip.extra_costs_cents ? html`<span class="trip__additional-costs">Bijkomende kosten <span>${themePrice(trip.extra_costs_cents)}</span></span>` : ''}
    ${trip.offer_until ? html`<span class="trip__offer-date">* Bij boeking voor ${formatDate(trip.offer_until)}</span>` : ''}
  </div>`;
}

/**
 * Label op een reisbox: "Volgeboekt" gaat voor "Nieuw".
 * @param {object} trip Reis.
 * @returns {object|string} HTML of leeg.
 */
function tripLabel(trip) {
  if (trip.fully_booked) return html`<span class="box__label box__label--full">Volgeboekt</span>`;
  if (trip.is_new) return html`<span class="box__label">Nieuw</span>`;
  return '';
}

/**
 * Eén reis in een lijst: liggende box met foto, datum en reiscode, titel, samenvatting en het donkere prijsvak.
 * @param {object} trip Reis (kaartkolommen).
 * @returns {object} HTML.
 */
function tripListItem(trip) {
  return html`<div class="list__item">
    <a class="post-teaser post-teaser--landscape" href="${tripPath(trip.slug)}">
      <div class="box box--landscape box--additional">
        ${tripLabel(trip)}
        <figure class="box__image"${backgroundStyle(trip.card_image_url)}>${trip.card_image_url ? html`<img src="${trip.card_image_url}" alt="" loading="lazy" width="800" height="700">` : ''}</figure>
        <div class="box__inner">
          <span class="box__pretitle">${formatDate(trip.departure_date)}${trip.trip_code ? html` <span class="trip__code">${trip.trip_code}</span>` : ''}</span>
          <span class="box__title">${trip.title}</span>
          ${trip.summary ? html`<div class="box__content">${trip.summary}</div>` : ''}
          <span class="box__readon">Lees verder</span>
        </div>
        ${priceBox(trip)}
      </div>
    </a>
  </div>`;
}

/**
 * Lijst met reizen (reisoverzicht, categorie), met een melding als hij leeg is.
 * @param {object[]} trips Reizen.
 * @param {string} empty Melding bij een lege lijst.
 * @returns {object} HTML.
 */
function tripList(trips, empty) {
  if (!trips.length) return html`<div class="alert">${empty}</div>`;
  return html`<div class="list list--journey archive archive--journey">${trips.map(tripListItem)}</div>`;
}

/**
 * Het citaat van een reisleider zonder aanhalingstekens aan begin en eind; de weergave zet er zelf “ en ” omheen,
 * zoals de huidige site, ook als het citaat in het CRM al met aanhalingstekens is ingevoerd.
 * @param {string} quote Citaat.
 * @returns {string} Citaat zonder omringende aanhalingstekens.
 */
function quoteText(quote) {
  return String(quote).trim().replace(/^[`'"‘“„]+|[`'"’”]+$/g, '').trim();
}

/**
 * Reistypes als kleine tegels met icoon (de kenmerken bij een reis).
 * @param {object[]} types Reistypes (slug, naam).
 * @returns {object} HTML.
 */
function compactTripTypes(types) {
  return html`<div class="trip-types trip-types--compact">${types.map((type) => html`<a class="trip-type" href="${categoryPath(type.slug)}" title="${type.name}">
    ${icon(categoryIconName(type), { className: 'trip-type__icon' })}<span class="visually-hidden">${type.name}</span>
  </a>`)}</div>`;
}

/**
 * Fotogalerij met titel en subtitel: een strook die je opzij kunt schuiven (ook met de knoppen).
 * @param {{title?: string, subtitle?: string, images: Array<string|{url: string, alt?: string}>}} gallery Galerij.
 * @returns {object|string} HTML, of leeg zonder foto's.
 */
function renderGallery(gallery) {
  const images = (gallery.images || []).map((image) => (typeof image === 'string' ? { url: image, alt: '' } : image)).filter((image) => image && image.url);
  if (!images.length) return '';
  return html`<section class="section page-gallery">
    ${gallery.title ? html`<h2 class="section__title">${gallery.title}</h2>` : ''}
    ${gallery.subtitle ? html`<p class="section__subtitle">${gallery.subtitle}</p>` : ''}
    <div class="gallery-strip" data-scroller>
      <ul class="gallery-strip__track" data-scroller-track>${images.map((image) => html`<li class="gallery-strip__item"><img src="${image.url}" alt="${image.alt || ''}" loading="lazy" height="500"></li>`)}</ul>
      ${images.length > 1 ? html`<div class="gallery-strip__nav">
        <button class="slider-button" type="button" data-scroller-prev>${icon('chevron-left')}<span class="visually-hidden">Vorige foto</span></button>
        <button class="slider-button" type="button" data-scroller-next>${icon('chevron-right')}<span class="visually-hidden">Volgende foto</span></button>
      </div>` : ''}
    </div>
  </section>`;
}

/**
 * Detailpagina van een reis: links reisleider, kenmerken, inleiding en tekst; rechts het vak met prijs, gegevens,
 * gegarandeerd vertrek en de aanmeldknop; daaronder de galerij.
 * @param {object} trip Reis met categorieën en reisleider.
 * @param {{isPast: boolean}} state Of de reis al vertrokken is.
 * @returns {object} HTML van de inhoud.
 */
function tripDetail(trip, state) {
  const types = trip.categories.filter((category) => category.kind === 'type');
  const destinations = trip.categories.filter((category) => category.kind === 'bestemming');
  let action = html`<a class="btn" href="/aanmelden/?id=${trip.legacy_id || ''}&reis=${encodeURIComponent(trip.slug)}">Ik meld me aan!</a>`;
  if (trip.fully_booked) action = html`<span class="btn btn--inactive">Volgeboekt</span>`;
  else if (state.isPast) action = html`<span class="btn btn--inactive">Vertrokken</span>`;
  const guides = Array.isArray(trip.guides) ? trip.guides : [];
  const guide = guides.map((item) => html`<div class="block-ghost block-ghost--guide">
    <div class="guide-widget">
      <figure class="guide-widget__thumb">${item.photo_url ? html`<img src="${item.photo_url}" alt="" width="70" height="70">` : ''}</figure>
      <div class="guide-widget__inner">
        <span class="block-ghost__label">Reisleider</span>
        <h2 class="guide-widget__title"><a href="${guidePath(item.slug)}">${item.name}</a></h2>
      </div>
    </div>
  </div>`);
  const features = types.length ? html`<div class="block-ghost block-ghost--trip">
    <span class="block-ghost__label">Kenmerken</span>
    ${compactTripTypes(types)}
  </div>` : '';
  return html`<div class="content-main">
    <div class="layout-container">
      <div class="trip__single">
        <div class="trip__content">
          ${guides.length || features ? html`<div class="trip__content-header">${guide}${features}</div>` : ''}
          ${trip.tagline ? html`<div class="page-introduction">${trip.tagline}</div>` : ''}
          <div class="page-content"><div class="page-content__text">${raw(trip.body_html)}</div></div>
        </div>
        <aside class="trip__meta" aria-label="Reisgegevens">
          <div class="box">
            <div class="box__inner">
              ${priceBox(trip)}
              <dl>
                ${trip.trip_code ? html`<dt>Reiscode</dt><dd>${trip.trip_code}</dd>` : ''}
                <dt>Vertrek</dt><dd>${formatDate(trip.departure_date)}</dd>
                ${trip.duration_label ? html`<dt>Reisduur</dt><dd>${trip.duration_label}</dd>` : ''}
                ${destinations.length ? html`<dt>Bestemming</dt><dd>${destinations.map((destination, index) => html`${index ? ', ' : ''}<a href="${categoryPath(destination.slug)}">${destination.name}</a>`)}</dd>` : ''}
                ${guides.length ? html`<dt>${guides.length > 1 ? 'Reisleiders' : 'Reisleider'}</dt><dd>${guides.map((item, index) => html`${index ? ', ' : ''}<a href="${guidePath(item.slug)}">${item.name}</a>`)}</dd>` : ''}
              </dl>
              ${trip.guaranteed ? html`<div class="trip__guaranteed"><h3>Gegarandeerd vertrek</h3></div>` : ''}
              ${trip.status_label && !trip.fully_booked ? html`<p class="trip__status">${trip.status_label}</p>` : ''}
              ${action}
            </div>
          </div>
        </aside>
      </div>
    </div>
  </div>
  ${renderGallery({ title: trip.gallery_title, subtitle: trip.gallery_subtitle, images: Array.isArray(trip.gallery) ? trip.gallery : [] })}`;
}

/**
 * Inleiding boven een lijst (bijvoorbeeld "Ontmoet alvast onze reisleiders!").
 * @param {string} text Tekst.
 * @returns {object|string} HTML of leeg.
 */
function pageIntroduction(text) {
  return text ? html`<div class="page-introduction">${text}</div>` : '';
}

/**
 * Eén reisleider in de lijst: staande foto en voornaam.
 * @param {object} guide Reisleider met `extra` (gegevens uit `site-content.json`).
 * @returns {object} HTML.
 */
function guideTeaser(guide) {
  return html`<div class="grid__item">
    <a class="post-teaser post-teaser--guide" href="${guidePath(guide.slug)}">
      <figure class="post-teaser__thumb"${backgroundStyle(guide.extra.portrait || guide.photo_url)}></figure>
      <div class="post-teaser__inner">
        <h2 class="post-teaser__title">${guide.name}</h2>
        ${guide.extra.surname ? html`<span class="post-teaser__subtitle">${guide.extra.surname}</span>` : ''}
      </div>
    </a>
  </div>`;
}

/**
 * Lijst van reisleiders.
 * @param {object[]} guides Reisleiders (met `extra`).
 * @param {string} introduction Inleiding.
 * @returns {object} HTML van de inhoud.
 */
function guideList(guides, introduction) {
  return html`<div class="content-main">
    <div class="layout-container">
      ${pageIntroduction(introduction)}
      ${guides.length ? html`<div class="grid archive archive--guide">${guides.map(guideTeaser)}</div>` : html`<div class="alert">Er staan nog geen reisleiders op de site.</div>`}
    </div>
  </div>`;
}

/**
 * Detailpagina van een reisleider: links stempel, portret, tweede foto en citaat; rechts naam, achternaam,
 * woonplaats en "bij Avanta sinds", daaronder de tekst; onderaan de galerij.
 * @param {object} guide Reisleider met `extra`.
 * @returns {object} HTML van de inhoud.
 */
function guideDetail(guide) {
  const { extra } = guide;
  const portrait = extra.portrait || guide.photo_url;
  return html`<div class="content-main">
    <div class="layout-container">
      <div class="grid">
        <div class="grid__item">
          ${icon('badge', { className: 'stamp' })}
          <div class="guide__personal">
            ${portrait ? html`<span class="guide__featured-image"><img src="${portrait}" alt="${guide.name}" width="600" height="700"></span>` : ''}
            ${extra.image ? html`<span class="guide__image"><img src="${extra.image}" alt="" loading="lazy" width="1280" height="960"></span>` : ''}
            ${extra.quote ? html`<blockquote class="guide__quote">“${quoteText(extra.quote)}”</blockquote>` : ''}
          </div>
        </div>
        <div class="grid__item">
          <div class="guide__details">
            <h1 class="guide__name">${guide.name}</h1>
            ${extra.surname ? html`<p class="guide__surname">${extra.surname}</p>` : ''}
            ${extra.city || extra.since ? html`<div class="guide__stats">
              <div class="guide__stat"><span class="label">woonplaats</span><span class="guide__city">${extra.city}</span></div>
              <div class="guide__stat"><span class="label">bij avanta sinds</span><span class="guide__year">${extra.since}</span></div>
            </div>` : ''}
          </div>
          <div class="page-content"><div class="page-content__text">${raw(guide.body_html)}</div></div>
        </div>
      </div>
    </div>
  </div>
  ${renderGallery({ title: extra.galleryTitle, subtitle: extra.gallerySubtitle, images: extra.gallery })}`;
}

module.exports = { quoteText, themePrice, priceBox, tripListItem, tripList, compactTripTypes, renderGallery, tripDetail, guideTeaser, guideList, guideDetail, pageIntroduction };
