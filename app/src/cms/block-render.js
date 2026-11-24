// @ts-check
/**
 * Weergave van blokken op de site: de tekenfunctie per bloktype (`BLOCK_RENDERERS`), het ophalen van de gegevens die
 * blokken nodig hebben (`loadBlockData`: FAQ, reistypes, landen, reizen, homepage-secties) en de hele lijst blokken
 * binnen `page-content` (`renderBlocks`). De bloktypes, hun velden en de controle staan in `blocks.js`. Alles gaat door
 * `html\`…\`` (escapen); opgemaakte tekst is bij het opslaan al door `sanitizeHtml` gegaan.
 */
const { html, raw } = require('../site/html');
const { isSafeUrl } = require('../../tools/import/sanitize');
const { contentBlocks, faqList, arrangePosts } = require('../site/page-view');
const { renderGallery, tripList } = require('../site/trip-view');
const {
  tripBox, renderSlides, renderFilterBar, renderLastMinutes, renderTripTypes, renderInspiration, renderDestinations, renderBlog, renderAbout,
} = require('../site/home-view');
const { cssImageUrl } = require('../site/layout');
const { icon, categoryIconName } = require('../site/icons');
const { categoryPath } = require('../site/format');
const { YOUTUBE_ORIGIN } = require('../site/homepage');
const { MAX_TRIP_BLOCKS, YOUTUBE_ID_PATTERN, normalizeBlocks, isDefaultStyle } = require('./blocks');

/**
 * Tekenfunctie per bloktype: `(block, context) => {markup, hasVideo}`. Een leeg blok geeft lege markup; de omhullende
 * sectie laat het dan weg.
 * @type {Object<string, (block: any, context: any) => {markup: (object|string), hasVideo: boolean}>}
 */
const BLOCK_RENDERERS = {
  'tekst': (block, context) => {
    const { data } = block;
    // Tekst gaat door dezelfde verdeling als de geïmporteerde pagina's (losse foto's, galerijen, video's).
    const { blocks, hasVideo } = contentBlocks(data.html, context.title);
    return { markup: blocks, hasVideo };
  },
  'kop': (block, _context) => {
    const { data } = block;
    if (!data.titel) return { markup: '', hasVideo: false };
    const title = data.niveau === 'h3' ? html`<h3 class="cms-heading__title cms-heading__title--small">${data.titel}</h3>` : html`<h2 class="cms-heading__title">${data.titel}</h2>`;
    return { markup: html`<div class="page-content__block cms-heading">${title}${data.subtitel ? html`<p class="cms-heading__subtitle">${data.subtitel}</p>` : ''}</div>`, hasVideo: false };
  },
  'afbeelding': (block, _context) => {
    const { data } = block;
    if (!data.foto) return { markup: '', hasVideo: false };
    const { foto } = data;
    return {
      markup: html`<figure class="page-content__image cms-image"><img src="${foto.url}" alt="${foto.alt}"${foto.width ? html` width="${foto.width}" height="${foto.height}"` : ''} loading="lazy">${data.bijschrift ? html`<figcaption class="cms-image__caption">${data.bijschrift}</figcaption>` : ''}</figure>`,
      hasVideo: false,
    };
  },
  'knoppen': (block, _context) => {
    const { data } = block;
    const buttons = data.knoppen.filter((row) => row.tekst && row.link && isSafeLink(row.link));
    if (!buttons.length) return { markup: '', hasVideo: false };
    return {
      markup: html`<div class="page-content__block cms-buttons">${buttons.map((row) => {
        const external = /^https:/i.test(row.link);
        return html`<a class="btn${row.stijl === 'omlijnd' ? ' btn--outline' : ''}" href="${row.link}"${external ? raw(' rel="noopener" target="_blank"') : ''}>${row.tekst}</a>`;
      })}</div>`,
      hasVideo: false,
    };
  },
  'citaat': (block, _context) => {
    const { data } = block;
    if (!data.tekst) return { markup: '', hasVideo: false };
    return {
      markup: html`<blockquote class="page-content__block cms-quote"><p class="cms-quote__text">${data.tekst}</p>${data.bron ? html`<p class="cms-quote__source">${data.bron}</p>` : ''}</blockquote>`,
      hasVideo: false,
    };
  },
  'tekst-afbeelding': (block, _context) => {
    const { data } = block;
    if (!data.html && !data.foto) return { markup: '', hasVideo: false };
    return {
      markup: html`<div class="page-content__block cms-media-text cms-media-text--${data.positie === 'links' ? 'links' : 'rechts'}">
        <div class="cms-media-text__text page-content__text">${raw(data.html)}</div>
        ${data.foto ? html`<figure class="cms-media-text__image"><img src="${data.foto.url}" alt="${data.foto.alt}" loading="lazy"></figure>` : ''}
      </div>`,
      hasVideo: false,
    };
  },
  'galerij': (block, _context) => {
    const { data } = block;
    if (!data.fotos.length) return { markup: '', hasVideo: false };
    return { markup: html`<div class="page-content__gallery">${renderGallery({ title: data.titel, subtitle: data.subtitel, images: data.fotos })}</div>`, hasVideo: false };
  },
  'kolommen': (block, _context) => {
    const { data } = block;
    const columns = data.kolommen.filter((row) => row.titel || row.tekst);
    if (!columns.length) return { markup: '', hasVideo: false };
    return {
      markup: html`<div class="page-content__block cms-columns cms-columns--${columns.length}">${columns.map((row) => html`<div class="cms-columns__item">
        ${row.titel ? html`<h3 class="cms-columns__title">${row.titel}</h3>` : ''}
        ${row.tekst ? html`<p class="cms-columns__text">${row.tekst}</p>` : ''}
        ${row.link && isSafeLink(row.link) ? html`<a class="cms-columns__link" href="${row.link}">${row.linktekst || 'Lees verder'}</a>` : ''}
      </div>`)}</div>`,
      hasVideo: false,
    };
  },
  'banner': (block, _context) => {
    const { data } = block;
    if (!data.titel) return { markup: '', hasVideo: false };
    const image = data.foto ? cssImageUrl(data.foto.url) : '';
    return {
      markup: html`<div class="page-content__block cms-banner${image ? '' : ' cms-banner--plain'}"${image ? html` style="background-image: url('${image}')"` : ''}>
        <div class="cms-banner__inner">
          <p class="cms-banner__title">${data.titel}</p>
          ${data.tekst ? html`<p class="cms-banner__text">${data.tekst}</p>` : ''}
          ${data.knoptekst && data.link && isSafeLink(data.link) ? html`<a class="btn" href="${data.link}">${data.knoptekst}</a>` : ''}
        </div>
      </div>`,
      hasVideo: false,
    };
  },
  'video': (block, context) => {
    const { data } = block;
    if (!data.youtube) return { markup: '', hasVideo: false };
    const title = data.titel || `Video bij ${context.title}`;
    const poster = data.foto ? cssImageUrl(data.foto.url) : '';
    // Eerst een startvlak; pas na een klik (of een eerder onthouden keuze) zet public/js/site.js de iframe neer.
    return {
      markup: html`<div class="page-content__video-wrapper cms-video" data-video-consent data-video-id="${data.youtube}" data-video-title="${title}" data-video-origin="${YOUTUBE_ORIGIN}">
        <div class="page-content__video cms-video__frame"${poster ? html` style="background-image: url('${poster}')"` : ''}>
          <div class="cms-video__notice">
            <p class="cms-video__title">${title}</p>
            <p class="cms-video__text">Deze video staat op YouTube. Speel je hem af, dan maakt je browser verbinding met YouTube (youtube-nocookie.com) en kan YouTube gegevens over je bezoek verwerken.</p>
            <p class="cms-video__actions"><button class="btn" type="button" data-video-play>Video afspelen</button>
              <a class="cms-video__link" href="${`https://www.youtube.com/watch?v=${data.youtube}`}" rel="noopener" target="_blank">Bekijk op YouTube</a></p>
            <label class="cms-video__remember"><input type="checkbox" data-video-remember> Video's op deze site voortaan direct laden (12 maanden, intrekbaar onder elke video)</label>
          </div>
        </div>
      </div>`,
      hasVideo: true,
    };
  },
  'faq': (block, context) => {
    const { data } = block;
    const faqs = (context.data && context.data.faqs) || [];
    const chosen = data.categorie ? faqs.filter((faq) => faq.category.toLowerCase() === data.categorie.toLowerCase()) : faqs;
    if (!chosen.length) return { markup: '', hasVideo: false };
    return { markup: html`<div class="page-content__block cms-embed">${faqList(chosen)}</div>`, hasVideo: false };
  },
  'reizen': (block, context) => {
    const { data } = block;
    const trips = (context.data && context.data.trips && context.data.trips.get(block.id)) || [];
    const list = data.weergave === 'lijst' ? tripList(trips, 'Op dit moment zijn er geen reizen die hierbij passen.')
      : (trips.length ? html`<div class="grid grid--3col">${trips.map((trip) => html`<div class="grid__item">${tripBox(trip)}</div>`)}</div>` : html`<div class="alert">Op dit moment zijn er geen reizen die hierbij passen.</div>`);
    return { markup: html`<div class="page-content__block cms-embed cms-trips">${list}</div>`, hasVideo: false };
  },
  'reistypes': (block, context) => {
    const { data } = block;
    const types = chooseCategories((context.data && context.data.types) || [], data.keuze);
    if (!types.length) return { markup: '', hasVideo: false };
    return {
      markup: html`<div class="page-content__block cms-embed"><div class="trip-types texture-overlay">${types.map((type) => html`<a class="trip-type" href="${categoryPath(type.slug)}">
        ${icon(categoryIconName(type), { className: 'trip-type__icon' })}
        <span class="trip-type__title">${type.name}</span>
      </a>`)}</div></div>`,
      hasVideo: false,
    };
  },
  'bestemmingen': (block, context) => {
    const { data } = block;
    const destinations = chooseCategories((context.data && context.data.destinations) || [], data.keuze);
    if (!destinations.length) return { markup: '', hasVideo: false };
    return {
      markup: html`<div class="page-content__block cms-embed"><div class="destinations" data-scroller>
        <ul class="destinations__track" data-scroller-track>${destinations.map((destination) => {
          const image = cssImageUrl(destination.image_url);
          return html`<li class="destinations__item"><a class="banner banner--fullimage" href="${categoryPath(destination.slug)}"${image ? html` style="background-image: url('${image}')"` : ''}>
            <span class="banner__title">${destination.name}</span>
          </a></li>`;
        })}</ul>
        <div class="destinations__nav">
          <button class="slider-button" type="button" data-scroller-prev>${icon('chevron-left')}<span class="visually-hidden">Vorige bestemmingen</span></button>
          <button class="slider-button" type="button" data-scroller-next>${icon('chevron-right')}<span class="visually-hidden">Volgende bestemmingen</span></button>
        </div>
      </div></div>`,
      hasVideo: false,
    };
  },
  'home-slider': (block, context) => {
    const { data } = block;
    const slides = data.dias.filter((row) => row.titel).map((row, index) => ({
      pretitle: row.bovenkop,
      title: row.titel,
      button: row.knoptekst,
      href: row.link && isSafeLink(row.link) ? row.link : '',
      videoId: typeof row.youtube === 'string' && YOUTUBE_ID_PATTERN.test(row.youtube) ? row.youtube : '',
      image: data.fotos[index] ? data.fotos[index].url : '',
      fallbackImage: data.fotos[index] ? '' : takeFallback(context),
    }));
    if (!slides.length) return { markup: '', hasVideo: false };
    return { markup: renderSlides(slides), hasVideo: slides.some((slide) => slide.videoId) };
  },
  'home-zoekbalk': (_block, context) => {
    const home = (context.data && context.data.home) || {};
    if (!home.finder) return { markup: '', hasVideo: false };
    return { markup: renderFilterBar(home.finder, home.newCount || 0), hasVideo: false };
  },
  'home-lastminutes': (block, context) => {
    const { data } = block;
    const home = (context.data && context.data.home) || {};
    return { markup: renderLastMinutes({ title: data.titel, subtitle: data.subtitel, button: data.knoptekst || 'Alle reizen' }, home.lastMinutes || []), hasVideo: false };
  },
  'home-reistypes': (block, context) => {
    const { data } = block;
    const types = chooseCategories((context.data && context.data.types) || [], 'homepage');
    return { markup: renderTripTypes({ title: data.titel, subtitle: data.subtitel }, types), hasVideo: false };
  },
  'home-inspiratie': (block, context) => {
    const { data } = block;
    const items = data.dias.filter((row) => row.titel).map((row, index) => ({
      title: row.titel,
      text: row.tekst,
      image: data.fotos[index] ? data.fotos[index].url : '',
      fallbackImage: data.fotos[index] ? '' : takeFallback(context),
    }));
    if (!items.length) return { markup: '', hasVideo: false };
    return { markup: renderInspiration(items), hasVideo: false };
  },
  'home-bestemmingen': (block, context) => {
    const { data } = block;
    const destinations = chooseCategories((context.data && context.data.destinations) || [], 'homepage');
    return { markup: renderDestinations({ title: data.titel, subtitle: data.subtitel }, destinations), hasVideo: false };
  },
  'home-blog': (block, context) => {
    const { data } = block;
    const home = (context.data && context.data.home) || {};
    return { markup: renderBlog({ title: data.titel, subtitle: data.subtitel, button: data.knoptekst || 'Meer blogberichten' }, home.posts || []), hasVideo: false };
  },
  'home-over': (block, context) => {
    const { data } = block;
    return {
      markup: renderAbout({
        title: data.titel,
        text: data.tekst,
        linkLabel: data.linktekst,
        href: data.link && isSafeLink(data.link) ? data.link : '',
        image: data.foto ? data.foto.url : '',
        fallbackImage: data.foto ? '' : takeFallback(context),
      }),
      hasVideo: false,
    };
  },
};

/**
 * HTML van de inhoud van één blok (zonder de omhullende sectie).
 * @param {any} block Genormaliseerd blok.
 * @param {{title: string, data?: any}} context Titel van de pagina (voor video's) en de gegevens uit `loadBlockData`.
 * @returns {{markup: (object|string), hasVideo: boolean}} HTML en of er een video in staat.
 */
function renderBlockContent(block, context) {
  const render = Object.hasOwn(BLOCK_RENDERERS, block.type) ? BLOCK_RENDERERS[block.type] : null;
  return render ? render(block, context) : { markup: '', hasVideo: false };
}

/**
 * De volgende reserve-foto (kaartfoto van een reis) voor een dia of blok zonder eigen foto, elke keer een andere.
 * @param {{data?: {home?: {fallbackImages?: string[]}}, fallbackIndex?: number}} context Context van `renderBlocks`.
 * @returns {string} Adres, of leeg.
 */
function takeFallback(context) {
  const pool = (context.data && context.data.home && context.data.home.fallbackImages) || [];
  if (!pool.length) return '';
  const index = context.fallbackIndex || 0;
  context.fallbackIndex = index + 1;
  return pool[index % pool.length];
}

/**
 * Of een link veilig is voor een knop of kolom (eigen site, https, mailto of tel; geen http of javascript:).
 * @param {string} link Adres.
 * @returns {boolean} Waar als het mag.
 */
function isSafeLink(link) {
  return isSafeUrl(link) && !/^http:/i.test(link);
}

/**
 * Kiest reistypes of landen voor een blok: "zoals op de homepage" zijn de categorieën met *tonen op de homepage*
 * (staat er geen aan, dan alle met reizen), "alle" zijn alle categorieën met komende reizen.
 * @param {{show_on_home: boolean, trip_count: number}[]} categories Categorieën uit `content.categories`.
 * @param {string} choice `homepage` of `alle`.
 * @returns {any[]} Gekozen categorieën.
 */
function chooseCategories(categories, choice) {
  const withTrips = categories.filter((category) => category.trip_count > 0);
  if (choice === 'alle') return withTrips;
  const chosen = categories.filter((category) => category.show_on_home);
  return chosen.length ? chosen : withTrips;
}

/**
 * Haalt de gegevens op die de blokken nodig hebben (FAQ, reistypes, landen, reizen per reizenblok), alleen wat er in de
 * blokken voorkomt.
 * @param {any[]} blocks Genormaliseerde blokken.
 * @param {{faqs: Function, categories: Function, upcomingTrips: Function, departureDates?: Function, newTripCount?: Function, posts?: Function, postsBySlugs?: Function}} content
 *   Queries uit `site/content.js`.
 * @param {{featuredSlug?: string}} [options] Het uitgelichte blogbericht (`site-content.json`) voor het blogblok van de homepage.
 * @returns {Promise<{faqs?: any[], types?: any[], destinations?: any[], trips: Map<string, any[]>, home?: any}>} Gegevens.
 */
async function loadBlockData(blocks, content, options = {}) {
  const types = new Set(blocks.map((block) => block.type));
  const needsTypes = types.has('reistypes') || types.has('home-reistypes') || types.has('home-zoekbalk');
  const needsDestinations = types.has('bestemmingen') || types.has('home-bestemmingen') || types.has('home-zoekbalk');
  const tripBlocks = blocks.filter((block) => block.type === 'reizen');
  // Eén query per verschillend filter, hoogstens MAX_TRIP_BLOCKS; een blok daarboven blijft leeg.
  const filters = new Map();
  const keyOfBlock = new Map();
  for (const block of tripBlocks) {
    const filter = {
      type: block.data.type || undefined,
      destination: block.data.land || undefined,
      onlyAvailable: block.data.beschikbaar === 'verbergen',
      limit: Number(block.data.aantal) || 6,
    };
    const key = [filter.type, filter.destination, filter.onlyAvailable, filter.limit].join('|');
    if (!filters.has(key) && filters.size < MAX_TRIP_BLOCKS) filters.set(key, filter);
    keyOfBlock.set(block.id, key);
  }
  const filterKeys = [...filters.keys()];
  const [faqs, typeRows, destinationRows, tripRows] = await Promise.all([
    types.has('faq') ? content.faqs() : undefined,
    needsTypes ? content.categories('type') : undefined,
    needsDestinations ? content.categories('bestemming') : undefined,
    Promise.all(filterKeys.map((key) => content.upcomingTrips(filters.get(key)))),
  ]);
  const rowsByKey = new Map(filterKeys.map((key, index) => [key, tripRows[index]]));
  const trips = new Map(tripBlocks.map((block) => [block.id, rowsByKey.get(keyOfBlock.get(block.id)) || []]));
  const home = await loadHomeData(types, content, options, { types: typeRows, destinations: destinationRows });
  return { faqs, types: typeRows, destinations: destinationRows, trips, ...(home ? { home } : {}) };
}

/**
 * De blogberichten voor de homepage: de nieuwste, met het uitgelichte bericht groot achteraan (ook als het niet bij de
 * nieuwste hoort; dan wordt het apart opgehaald).
 * @param {any[]} latest De nieuwste berichten.
 * @param {any} content Queries uit `site/content.js` (`postsBySlugs`).
 * @param {string} featuredSlug Slug van het uitgelichte bericht, of leeg.
 * @returns {Promise<any[]>} Berichten in de volgorde van de homepage.
 */
async function homePosts(latest, content, featuredSlug) {
  const featured = featuredSlug && !latest.some((post) => post.slug === featuredSlug) ? (await content.postsBySlugs([featuredSlug]))[0] : null;
  const arranged = arrangePosts(featured ? [...latest, featured] : latest, featuredSlug);
  return [...arranged.list, ...(arranged.featured ? [arranged.featured] : [])];
}

/**
 * De gegevens van de homepage-secties (H4): keuzes voor de zoekbalk, last-minutes, blogberichten (drie nieuwste en het
 * uitgelichte groot) en kaartfoto's van reizen als reserve voor dia's zonder foto. Alleen wat de blokken nodig hebben.
 * @param {Set<string>} types Bloktypes op de pagina.
 * @param {any} content Queries uit `site/content.js`.
 * @param {{featuredSlug?: string}} options Uitgelicht blogbericht.
 * @param {{types?: any[], destinations?: any[]}} categories Al opgehaalde reistypes en landen.
 * @returns {Promise<(any|null)>} Gegevens, of null zonder homepage-secties.
 */
async function loadHomeData(types, content, options, categories) {
  const needsFallback = types.has('home-slider') || types.has('home-inspiratie') || types.has('home-over');
  if (![...types].some((type) => type.startsWith('home-'))) return null;
  const [dates, newCount, lastMinutes, blog, upcoming] = await Promise.all([
    types.has('home-zoekbalk') ? content.departureDates() : undefined,
    types.has('home-zoekbalk') ? content.newTripCount() : undefined,
    types.has('home-lastminutes') ? content.upcomingTrips({ onlyAvailable: true, limit: 6 }) : undefined,
    types.has('home-blog') ? content.posts({ perPage: 5 }) : undefined,
    needsFallback ? content.upcomingTrips({ limit: 60 }) : undefined,
  ]);
  const posts = blog ? await homePosts(blog.posts, content, options.featuredSlug || '') : [];
  return {
    finder: types.has('home-zoekbalk') ? { destinations: categories.destinations || [], types: categories.types || [], dates: dates || [] } : null,
    newCount: newCount || 0,
    lastMinutes: lastMinutes || [],
    posts,
    fallbackImages: [...new Set((upcoming || []).map((trip) => cssImageUrl(trip.card_image_url)).filter(Boolean))],
  };
}

/**
 * CSS-klassen van de omhullende sectie van een blok.
 * @param {any} style Genormaliseerde stijl.
 * @returns {string} Klassen.
 */
function sectionClasses(style) {
  return [
    'cms-section',
    `cms-bg--${style.achtergrond}`,
    `cms-width--${style.breedte}`,
    `cms-align--${style.uitlijning}`,
    `cms-space-top--${style.ruimteBoven}`,
    `cms-space-bottom--${style.ruimteOnder}`,
  ].join(' ');
}

/**
 * HTML van een lijst blokken voor de site, binnen `page-content`. Een blok met de standaardstijl staat er los in (zoals
 * de geïmporteerde pagina's altijd stonden); een blok met een eigen stijl krijgt een omhullende sectie.
 * @param {*} blocks Opgeslagen blokken.
 * @param {{title: string, data?: any, homepage?: boolean}} context Titel van de pagina, de gegevens uit `loadBlockData`
 *   en of het de homepage is (dan omhult `homepage` in plaats van `page-content`, zoals de vaste homepage).
 * @returns {{body: (object|string), hasVideo: boolean}} HTML en of er een video in staat (voor de CSP).
 */
function renderBlocks(blocks, context) {
  let hasVideo = false;
  const parts = [];
  // Eigen kopie: de teller van de reservefoto's (`takeFallback`) loopt per weergave.
  const state = { ...context, fallbackIndex: 0 };
  for (const block of /** @type {any[]} */ (normalizeBlocks(blocks))) {
    const content = renderBlockContent(block, state);
    hasVideo = hasVideo || content.hasVideo;
    const empty = !content.markup || (Array.isArray(content.markup) && !content.markup.length);
    if (empty) continue;
    parts.push(isDefaultStyle(block.style) ? content.markup : html`<div class="${sectionClasses(block.style)}">${content.markup}</div>`);
  }
  if (!parts.length) return { body: '', hasVideo };
  return { body: context.homepage ? html`<div class="homepage">${parts}</div>` : html`<div class="page-content">${parts}</div>`, hasVideo };
}

module.exports = { BLOCK_RENDERERS, renderBlocks, loadBlockData, chooseCategories, isSafeLink };
