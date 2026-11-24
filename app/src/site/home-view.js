// @ts-check
/**
 * De homepage, gelijk aan de huidige site (CMS-pakket E2): slider met foto's, filterbalk, last-minutes in boxen met
 * label, reistypes met iconen, inspiratie-slider, bestemmingen als fotobanners, blog en het blok "Voor Avanta Reizen is
 * geen bestemming te ver". Alles via `html\`…\``; de vaste teksten komen uit `homepage.js` (gecontroleerd), de rest uit
 * de database. De sliders werken met `public/js/site.js`; zonder JavaScript staat de eerste dia stil en zijn de
 * bestemmingen gewoon te scrollen.
 */
const { html } = require('./html');
const { icon, categoryIconName } = require('./icons');
const { cssImageUrl } = require('./layout');
const { imageAttributes, sizedImageUrl } = require('../media/formats');
const { formatDate, tripPath, categoryPath, postPath } = require('./format');
const { YOUTUBE_ORIGIN } = require('./homepage');

/** Weergegeven breedte van de foto's per plek (attribuut `sizes`), zodat de browser een passende versie kiest. */
const IMAGE_SIZES = {
  tripCard: '(max-width: 768px) 100vw, 400px',
  postTeaser: '(max-width: 768px) 100px, 450px',
  about: '(max-width: 1024px) 100vw, 520px',
};

/**
 * Een achtergrondfoto als style-attribuut (leeg zonder veilige URL), in de lichtste versie die breed genoeg is.
 * @param {string} url Adres van de foto.
 * @param {number} width Benodigde breedte in pixels (voor scherpe schermen al verdubbeld waar nodig).
 * @returns {any|string} Het attribuut.
 */
function backgroundStyle(url, width) {
  const safe = cssImageUrl(sizedImageUrl(url, width));
  return safe ? html` style="background-image: url('${safe}')"` : '';
}

/**
 * Kort een tekst in op een woordgrens, met " ..." zoals de huidige site.
 * @param {string} text Tekst.
 * @param {number} length Maximumlengte.
 * @returns {string} Ingekorte tekst.
 */
function truncate(text, length) {
  const value = String(text || '').replace(/\s*…$/, '').trim();
  return value.length > length ? `${value.slice(0, length).replace(/\s+\S*$/, '')} ...` : value;
}

/**
 * Datum van een blogbericht als dd/mm/jjjj (zoals de huidige site).
 * @param {(Date|string)} value Datum.
 * @returns {string} Datum.
 */
function slashDate(value) {
  return value ? formatDate(value).replace(/-/g, '/') : '';
}

/**
 * Adres van een YouTube-video als stille achtergrond van een dia (zoals op de huidige site): zonder geluid, zonder
 * knoppen, herhalend, via youtube-nocookie.com.
 * @param {string} videoId YouTube-id (gecontroleerd in `homepage.js`).
 * @returns {string} Het adres voor de iframe.
 */
function videoUrl(videoId) {
  const query = new URLSearchParams({ autoplay: '1', mute: '1', loop: '1', playlist: videoId, controls: '0', disablekb: '1', modestbranding: '1', playsinline: '1', rel: '0', iv_load_policy: '3' });
  return `${YOUTUBE_ORIGIN}/embed/${encodeURIComponent(videoId)}?${query}`;
}

/**
 * De slider bovenaan: foto (of stille YouTube-video) over de volle breedte, pretitel, titel en een knop; ruitjes links om te wisselen en een
 * muis-icoon naar de last-minutes.
 * @param {any[]} slides Dia's (`homepage.js`), met eventueel `fallbackImage`.
 * @returns {any} HTML.
 */
function renderSlides(slides) {
  return html`<section class="homepage__slides" data-slider data-interval="7000" aria-roledescription="carousel" aria-label="Uitgelicht">
    <ul class="slides">${slides.map((slide, index) => html`
      <li class="slide${index === 0 ? ' is-active' : ''}" data-slide aria-roledescription="slide" aria-label="${index + 1} van ${slides.length}"${index === 0 ? '' : html` aria-hidden="true"`}>
        <div class="slide__image"${backgroundStyle(slide.image || slide.fallbackImage, 1600)}></div>
        ${slide.videoId ? html`<div class="slide__video"><iframe src="${videoUrl(slide.videoId)}" title="Video: ${slide.title}" allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" loading="lazy" tabindex="-1"></iframe></div>` : ''}
        <div class="slide__content">
          ${slide.pretitle ? html`<p class="slide__pretitle">${slide.pretitle}</p>` : ''}
          <p class="slide__title">${slide.title}</p>
          ${slide.button && slide.href ? html`<a class="btn btn--ghost slide__btn" href="${slide.href}"${index === 0 ? '' : html` tabindex="-1"`}>${slide.button}</a>` : ''}
        </div>
      </li>`)}
    </ul>
    ${slides.length > 1 ? html`<div class="slides-navigation">${slides.map((slide, index) => html`<button class="slides-navigation__dot" type="button" data-slide-to="${index}"${index === 0 ? html` aria-current="true"` : ''}><span class="visually-hidden">Dia ${index + 1}: ${slide.title}</span></button>`)}</div>` : ''}
    <a class="anchorlink" href="#last-minutes">${icon('mouse')}<span class="visually-hidden">Naar de last-minutes</span></a>
  </section>`;
}

/**
 * De filterbalk onder de slider: bestemming, type, vertrek, "nieuwe reizen bovenaan" en de zoekknop.
 * @param {{destinations: any[], types: any[], dates: string[]}} finder Keuzes.
 * @param {number} newCount Aantal nieuwe reizen.
 * @param {{bestemming?: string, type?: string, vertrek?: string, nieuw?: boolean}} [selected] Huidige keuze (op `/reis/`).
 * @returns {any} HTML.
 */
function renderFilterBar(finder, newCount, selected = {}) {
  /**
   * Eén keuzelijst met label en icoon.
   * @param {string} name Veldnaam.
   * @param {string} label Label.
   * @param {string} iconName Icoon links.
   * @param {{value: string, label: string}[]} options Opties.
   * @returns {any} HTML.
   */
  const select = (name, label, iconName, options) => html`<div class="filter__item">
    <label class="filter__label" for="filter-${name}">${label}</label>
    <span class="filter__control">${icon(iconName, { className: 'filter__icon' })}<select id="filter-${name}" name="${name}">
      <option value="">Maak jouw keuze</option>
      ${options.map((option) => html`<option value="${option.value}"${option.value === selected[name] ? html` selected` : ''}>${option.label}</option>`)}
    </select>${icon('chevron-down', { className: 'filter__arrow' })}</span>
  </div>`;
  return html`<div class="filter">
    <div class="layout-container">
      <form class="filter__form" action="/reis/" method="get" role="search" aria-label="Vind jouw reis">
        ${select('bestemming', 'Bestemming', 'location', finder.destinations.filter((item) => item.trip_count > 0).map((item) => ({ value: item.slug, label: item.name })))}
        ${select('type', 'Type reis', 'label', finder.types.map((item) => ({ value: item.slug, label: item.name })))}
        ${select('vertrek', 'Vertrek', 'calendar', finder.dates.map((day) => ({ value: day, label: formatDate(day) })))}
        <div class="filter__item filter__item--toggle">
          <span class="filter__label filter__label--relative" id="filter-nieuw-label">Nieuwe reizen (${newCount})</span>
          <span class="filter__select">
            <input class="filter__switch" type="checkbox" value="1" id="filter-nieuw" name="nieuw"${selected.nieuw ? html` checked` : ''} aria-labelledby="filter-nieuw-label filter-nieuw-info">
            <label class="filter__select-label" for="filter-nieuw"></label>
            <span class="filter__select-info" id="filter-nieuw-info">Toon bovenaan</span>
          </span>
        </div>
        <div class="filter__item"><button class="btn filter__submit" type="submit">Vind jouw reis</button></div>
      </form>
    </div>
  </div>`;
}

/**
 * Eén reis als box (last-minutes en straks het reisoverzicht): foto met papierrand, datum en reiscode, titel en
 * "Lees verder"; label "Nieuw" (blauw) of "Volgeboekt" (donker).
 * @param {any} trip Reis (kaartkolommen).
 * @returns {any} HTML.
 */
function tripBox(trip) {
  const label = trip.fully_booked ? html`<span class="box__label box__label--full">Volgeboekt</span>` : trip.is_new ? html`<span class="box__label">Nieuw</span>` : '';
  return html`<a class="post-teaser post-teaser--trip" href="${tripPath(trip.slug)}">
    <div class="box">
      ${label}
      <figure class="box__image">${trip.card_image_url ? html`<img${imageAttributes(trip.card_image_url, IMAGE_SIZES.tripCard, 800)} alt="" loading="lazy" width="800" height="700">` : ''}</figure>
      <div class="box__inner">
        <span class="box__pretitle">${formatDate(trip.departure_date)}${trip.trip_code ? html` <span class="trip__code">${trip.trip_code}</span>` : ''}</span>
        <span class="box__title">${trip.title}</span>
        <span class="box__readon">Lees verder</span>
      </div>
    </div>
  </a>`;
}

/**
 * Sectie "Inpakken en wegwezen!" met de eerstvolgende reizen.
 * @param {any} section Titel, subtitel en knoptekst.
 * @param {any[]} trips Reizen.
 * @returns {any} HTML.
 */
function renderLastMinutes(section, trips) {
  return html`<section class="homepage__last-minutes section section--multiplebgs" id="last-minutes">
    <div class="layout-container">
      <h2 class="section__title">${section.title}</h2>
      <p class="section__subtitle">${section.subtitle}</p>
      ${trips.length ? html`<div class="grid grid--3col">${trips.map((trip) => html`<div class="grid__item">${tripBox(trip)}</div>`)}</div>` : html`<p class="notice">Op dit moment geen last-minutes.</p>`}
      <div class="section__footer"><a class="btn btn--ghost section__btn" href="/reis/">${section.button}</a></div>
    </div>
  </section>`;
}

/**
 * Sectie met de reistypes als tegels met icoon op de "aarde"-achtergrond.
 * @param {any} section Titel en subtitel.
 * @param {any[]} types Reistypes (slug, naam).
 * @returns {any} HTML.
 */
function renderTripTypes(section, types) {
  if (!types.length) return '';
  return html`<section class="homepage__trip-types section section--bg-soil">
    <div class="layout-container">
      <h2 class="section__title">${section.title}</h2>
      <p class="section__subtitle">${section.subtitle}</p>
      <div class="trip-types texture-overlay">${types.map((type) => html`<a class="trip-type" href="${categoryPath(type.slug)}">
        ${icon(categoryIconName(type), { className: 'trip-type__icon' })}
        <span class="trip-type__title">${type.name}</span>
      </a>`)}</div>
    </div>
  </section>`;
}

/**
 * De inspiratie-slider: grote foto met een groen tekstvak en pijlen.
 * @param {any[]} items Dia's (titel, tekst, foto, eventueel `fallbackImage`).
 * @returns {any} HTML.
 */
function renderInspiration(items) {
  return html`<section class="homepage__inspiration section" data-slider aria-roledescription="carousel" aria-label="De Avanta manier van reizen">
    <ul class="slides">${items.map((item, index) => html`
      <li class="slide${index === 0 ? ' is-active' : ''}" data-slide aria-roledescription="slide" aria-label="${index + 1} van ${items.length}"${index === 0 ? '' : html` aria-hidden="true"`}>
        <figure class="slide__figure"${backgroundStyle(item.image || item.fallbackImage, 1600)}></figure>
        <div class="slide__content">
          <p class="slide__title">${item.title}</p>
          <p class="slide__text">${item.text}</p>
        </div>
      </li>`)}
    </ul>
    ${items.length > 1 ? html`<button class="slider-arrow slider-arrow--prev" type="button" data-slide-prev>${icon('arrow-left')}<span class="visually-hidden">Vorige</span></button>
    <button class="slider-arrow slider-arrow--next" type="button" data-slide-next>${icon('arrow-right')}<span class="visually-hidden">Volgende</span></button>` : ''}
  </section>`;
}

/**
 * Sectie "Onze bestemmingen": fotobanners per land in een strook die je kunt scrollen, met pijlen eronder.
 * @param {any} section Titel en subtitel.
 * @param {any[]} destinations Bestemmingen met reizen (slug, naam, foto).
 * @returns {any} HTML.
 */
function renderDestinations(section, destinations) {
  if (!destinations.length) return '';
  return html`<section class="homepage__popular section">
    <h2 class="section__title">${section.title}</h2>
    <p class="section__subtitle">${section.subtitle}</p>
    <div class="destinations" data-scroller>
      <ul class="destinations__track" data-scroller-track>${destinations.map((destination) => html`<li class="destinations__item">
        <a class="banner banner--fullimage" href="${categoryPath(destination.slug)}"${backgroundStyle(destination.image_url, 800)}>
          <span class="banner__title">${destination.name}</span>
        </a>
      </li>`)}</ul>
      <div class="destinations__nav">
        <button class="slider-button" type="button" data-scroller-prev>${icon('chevron-left')}<span class="visually-hidden">Vorige bestemmingen</span></button>
        <button class="slider-button" type="button" data-scroller-next>${icon('chevron-right')}<span class="visually-hidden">Volgende bestemmingen</span></button>
      </div>
    </div>
  </section>`;
}

/**
 * Eén blogbericht als teaser.
 * @param {any} post Bericht (slug, titel, `summary` uit `content.posts` of anders `excerpt`, foto, datum).
 * @param {number} summaryLength Lengte van de samenvatting.
 * @param {{heading?: ('h2'|'h3'), landscape?: boolean}} [options] Kopniveau van de titel (standaard h3, op de
 *   blogpagina h2 zoals de huidige site) en of de teaser liggend is (tagpagina).
 * @returns {any} HTML.
 */
function postTeaser(post, summaryLength, options = {}) {
  const published = post.published_at ? new Date(post.published_at) : null;
  // De samenvatting uit de tekst (zoals de huidige site); zonder (oude aanroep) de ingekorte inleiding.
  const summary = typeof post.summary === 'string' ? post.summary : truncate(post.excerpt, summaryLength);
  const title = options.heading === 'h2' ? html`<h2 class="post-teaser__title">${post.title}</h2>` : html`<h3 class="post-teaser__title">${post.title}</h3>`;
  return html`<a class="post-teaser${options.landscape ? ' post-teaser--landscape' : ''}" href="${postPath(post.slug)}">
    <figure class="post-teaser__thumb">${post.image_url ? html`<img${imageAttributes(post.image_url, IMAGE_SIZES.postTeaser, 400)} alt="" loading="lazy" width="800" height="700">` : ''}</figure>
    <div class="post-teaser__inner">
      ${published ? html`<div class="post-teaser__meta"><time datetime="${published.toISOString()}">${slashDate(published)}</time></div>` : ''}
      ${title}
      ${summary ? html`<span class="post-teaser__summary">${summary}</span>` : ''}
    </div>
  </a>`;
}

/**
 * Sectie "Blog": links drie berichten onder elkaar, rechts een groot bericht.
 * @param {any} section Titel, subtitel en knoptekst.
 * @param {any[]} posts De nieuwste berichten (de eerste drie links, de vierde rechts).
 * @returns {any} HTML.
 */
function renderBlog(section, posts) {
  if (!posts.length) return '';
  const list = posts.slice(0, 3);
  const featured = posts[3];
  return html`<section class="homepage__blog section">
    <div class="layout-container">
      <h2 class="section__title">${section.title}</h2>
      <p class="section__subtitle">${section.subtitle}</p>
      <div class="grid">
        <div class="grid__item"><div class="list">${list.map((post) => html`<div class="post-wrapper">${postTeaser(post, 200)}</div>`)}</div></div>
        ${featured ? html`<div class="grid__item"><div class="post-wrapper featured-post">${postTeaser(featured, 200)}</div></div>` : ''}
      </div>
      <div class="section__footer"><a class="btn btn--ghost section__btn" href="/blog/">${section.button}</a></div>
    </div>
  </section>`;
}

/**
 * Het blok "Voor Avanta Reizen is geen bestemming te ver" met foto en stempel.
 * @param {any} about Titel, tekst, link en foto.
 * @returns {any} HTML.
 */
function renderAbout(about) {
  const image = cssImageUrl(about.image || about.fallbackImage);
  return html`<section class="homepage__about section section--bg">
    <div class="layout-container">
      <div class="grid">
        <div class="grid__item homepage__about-images">
          ${icon('badge', { className: 'stamp' })}
          ${image ? html`<span class="about__image"><img${imageAttributes(image, IMAGE_SIZES.about, 800)} alt="" loading="lazy" width="1024" height="683"></span>` : ''}
        </div>
        <div class="grid__item homepage__about-text">
          <h1 class="section__title">${about.title}</h1>
          <div class="section__content">
            <p>${about.text}</p>
            ${about.href && about.linkLabel ? html`<a class="readon" href="${about.href}">${about.linkLabel}</a>` : ''}
          </div>
        </div>
      </div>
    </div>
  </section>`;
}

/**
 * De hele homepage.
 * @param {{home: any, finder: any, newCount: number, lastMinutes: any[], types: any[], destinations: any[], posts: any[]}} data Inhoud.
 * @returns {any} HTML van de inhoud (binnen `<main>`).
 */
function renderHome(data) {
  const { home } = data;
  return html`<div class="homepage">
    ${renderSlides(home.slides)}
    ${renderFilterBar(data.finder, data.newCount)}
    ${renderLastMinutes(home.sections.lastMinutes, data.lastMinutes)}
    ${renderTripTypes(home.sections.types, data.types)}
    ${renderInspiration(home.inspiration)}
    ${renderDestinations(home.sections.destinations, data.destinations)}
    ${renderBlog(home.sections.blog, data.posts)}
    ${renderAbout(home.about)}
  </div>`;
}

/**
 * Vult ontbrekende foto's van de slider, de inspiratie en "over Avanta" aan met foto's van reizen, elk een andere.
 * @param {any} home Inhoud (`homepage.js`).
 * @param {string[]} images Kaartfoto's van reizen.
 * @returns {any} Inhoud met `fallbackImage` waar een eigen foto ontbreekt.
 */
function withFallbackImages(home, images) {
  const pool = [...new Set(images.filter(Boolean))];
  let next = 0;
  const take = () => (pool.length ? pool[next++ % pool.length] : '');
  return {
    ...home,
    slides: home.slides.map((slide) => (slide.image ? slide : { ...slide, fallbackImage: take() })),
    inspiration: home.inspiration.map((item) => (item.image ? item : { ...item, fallbackImage: take() })),
    about: home.about.image ? home.about : { ...home.about, fallbackImage: take() },
  };
}

module.exports = {
  renderHome, renderSlides, renderFilterBar, renderLastMinutes, renderTripTypes, renderInspiration, renderDestinations, renderBlog, renderAbout,
  tripBox, postTeaser, withFallbackImages, truncate, slashDate,
};
