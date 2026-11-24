/**
 * HTML van het weblog, de pagina's, de FAQ en de contactpagina in de opmaak van de huidige site (CMS-pakket E4):
 * het blogoverzicht (tags, drie berichten links, één groot rechts, daaronder de rest in twee kolommen), de tagpagina
 * (liggende teasers), een bericht of pagina (inleiding, video's en tekstblokken), de FAQ per categorie (uitklappen
 * met `<details>`, zonder JavaScript) en de contactpagina (adres, verwijzing naar de FAQ en het formulier in een box).
 * Geïmporteerde HTML (body_html, answer_html) is bij de import opgeschoond en wordt als raw ingevoegd; al het andere
 * wordt ge-escaped.
 */
const { html, raw } = require('./html');
const { icon } = require('./icons');
const { postTeaser } = require('./home-view');
const { YOUTUBE_ORIGIN } = require('./homepage');
const { renderGallery } = require('./trip-view');
const { imageAttributes } = require('../media/formats');
const { parse } = require('node-html-parser');

/** Lengte van de samenvatting in een teaser, zoals de huidige site (200 tekens en " ..."). */
const SUMMARY_LENGTH = 200;

/**
 * Een video uit de import: de opschoning maakt van een YouTube-iframe een alinea met alleen de link "Bekijk de
 * video" naar het embed-adres. Het id is altijd 11 tekens uit letters, cijfers, `-` en `_`. Na een tweede opschoning
 * (tekstblok opgeslagen in het CRM) staan `target` en `rel` in omgekeerde volgorde; beide vormen tellen.
 */
const VIDEO_PARAGRAPH = /^<p><a href="https:\/\/www\.youtube(?:-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{11})(?:[?#][^"]*)?" (?:rel="noopener" target="_blank"|target="_blank" rel="noopener")>Bekijk de video<\/a><\/p>$/;

/** Hoeveel opgeschoonde HTML er per bericht of pagina in blokken wordt verdeeld (daarboven: één tekstblok). */
const MAX_BLOCK_SOURCE = 500000;

/**
 * Een iframe met een YouTube-video via youtube-nocookie.com, in de verhouding 16:9 zoals de huidige site.
 * @param {string} videoId YouTube-id (11 tekens, gecontroleerd door `VIDEO_PARAGRAPH`).
 * @param {string} title Titel voor schermlezers.
 * @returns {object} HTML.
 */
function videoBlock(videoId, title) {
  return html`<div class="page-content__video-wrapper"><div class="page-content__video">
    <iframe src="${`${YOUTUBE_ORIGIN}/embed/${videoId}`}" title="${`Video: ${title}`}" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" loading="lazy"></iframe>
  </div></div>`;
}

/**
 * Een losse foto uit opgeschoonde tekst opnieuw opgebouwd, met `srcset` als er lichtere versies zijn.
 * @param {{getAttribute: (name: string) => (string|undefined)}} node Het `<img>`-element uit de opgeschoonde HTML.
 * @returns {object} HTML.
 */
function bodyImage(node) {
  const width = node.getAttribute('width');
  const height = node.getAttribute('height');
  const size = /^\d{1,5}$/.test(width || '') && /^\d{1,5}$/.test(height || '') ? html` width="${width}" height="${height}"` : '';
  return html`<img${imageAttributes(node.getAttribute('src') || '', '(max-width: 768px) 100vw, 800px', 800)} alt="${node.getAttribute('alt') || ''}"${size} loading="lazy">`;
}

/**
 * Zet opgeschoonde HTML om in de blokken van de huidige site: tekst in `page-content__text`, een losse foto in
 * `page-content__image` (gecentreerd, breder dan de tekst), een fotogalerij als strook en een YouTube-video op volle
 * breedte. De blokken zijn letterlijke stukken van de opgeschoonde HTML (geen nieuwe opmaak); alleen galerij en video
 * worden opnieuw opgebouwd uit gecontroleerde waarden.
 * @param {string} bodyHtml Opgeschoonde HTML uit de import.
 * @param {string} title Titel van het bericht of de pagina (voor de video).
 * @returns {{blocks: object[], hasVideo: boolean}} De blokken en of er een video in staat (voor de CSP).
 */
function contentBlocks(bodyHtml, title) {
  const source = String(bodyHtml || '');
  const blocks = [];
  let hasVideo = false;
  let textStart = -1;
  let textEnd = -1;
  /** Sluit het lopende tekstblok af (als het meer dan witruimte bevat). */
  const flushText = () => {
    const part = textStart >= 0 ? source.slice(textStart, textEnd).trim() : '';
    if (part) blocks.push(html`<div class="page-content__text">${raw(part)}</div>`);
    textStart = -1;
  };
  if (source.length > MAX_BLOCK_SOURCE) {
    textStart = 0;
    textEnd = source.length;
    flushText();
    return { blocks, hasVideo };
  }
  for (const node of parse(source, { comment: false }).childNodes) {
    const [from, to] = node.range;
    const part = source.slice(from, to);
    const tag = node.nodeType === 1 ? node.rawTagName.toLowerCase() : '';
    const video = tag === 'p' ? VIDEO_PARAGRAPH.exec(part) : null;
    if (tag === 'img') {
      flushText();
      blocks.push(html`<div class="page-content__image">${bodyImage(node)}</div>`);
    } else if (tag === 'figure') {
      flushText();
      blocks.push(html`<div class="page-content__image">${raw(part)}</div>`);
    } else if (tag === 'div' && /(^|\s)gallery(\s|$)/.test(node.getAttribute('class') || '')) {
      flushText();
      const images = node.querySelectorAll('img').map((image) => ({ url: image.getAttribute('src') || '', alt: image.getAttribute('alt') || '' }));
      blocks.push(html`<div class="page-content__gallery">${renderGallery({ images })}</div>`);
    } else if (video) {
      flushText();
      blocks.push(videoBlock(video[1], title));
      hasVideo = true;
    } else {
      if (textStart < 0) textStart = from;
      textEnd = to;
    }
  }
  flushText();
  return { blocks, hasVideo };
}

/**
 * Inleiding boven de inhoud (grote Playfair-tekst), als die er is.
 * @param {string} text Inleiding.
 * @returns {(object|string)} HTML of leeg.
 */
function introduction(text) {
  return text ? html`<div class="page-introduction">${text}</div>` : '';
}

/**
 * Een bericht of pagina: inleiding, de blokken en eventueel de fotogalerij eronder (uit `site-content.json`).
 * @param {{title: string, intro?: string, body_html?: string}} item Bericht of pagina.
 * @param {({title: string, subtitle: string, images: string[]}|null)} [gallery] Galerij onder de inhoud.
 * @returns {{body: object, hasVideo: boolean}} HTML en of er een video in staat.
 */
function articleBody(item, gallery = null) {
  const { blocks, hasVideo } = contentBlocks(item.body_html, item.title);
  return {
    body: html`${introduction(item.intro)}${blocks.length ? html`<div class="page-content">${blocks}</div>` : ''}${gallery ? renderGallery(gallery) : ''}`,
    hasVideo,
  };
}

/**
 * De tags boven het weblog met de link naar het oude blogarchief.
 * @param {{slug: string, name: string}[]} tags Tags.
 * @param {{label: string, href: string}} archiveLink Link naar het oude archief (extern).
 * @returns {object} HTML.
 */
function tagBar(tags, archiveLink) {
  return html`<div class="tags">
    ${tags.map((tag) => html`<a class="tags__item" href="${`/tag/${tag.slug}/`}">${tag.name}</a>`)}
    ${archiveLink ? html`<a class="tags__item tags__item--extern" href="${archiveLink.href}" rel="noopener" target="_blank">${archiveLink.label}</a>` : ''}
  </div>`;
}

/**
 * Verdeelt de berichten zoals de huidige site: het uitgelichte bericht (in WordPress "sticky") groot rechts, de drie
 * nieuwste andere links en de rest eronder. Zonder (bestaand) uitgelicht bericht is het vierde bericht groot.
 * @param {object[]} posts Berichten, nieuwste eerst.
 * @param {string} [featuredSlug] Slug van het uitgelichte bericht.
 * @returns {{list: object[], featured: (object|null), rest: object[]}} De verdeling.
 */
function arrangePosts(posts, featuredSlug) {
  const chosen = featuredSlug ? posts.find((post) => post.slug === featuredSlug) : null;
  const others = chosen ? posts.filter((post) => post !== chosen) : posts;
  const featured = chosen || others[3] || null;
  const remaining = others.filter((post) => post !== featured);
  return { list: remaining.slice(0, 3), featured, rest: remaining.slice(3) };
}

/**
 * Het blogoverzicht: inleiding, tags, links de drie nieuwste berichten, rechts het vierde groot, daaronder de rest in
 * twee kolommen.
 * @param {{posts: object[], introduction: string, tags: object[], archiveLink: object, featured?: string}} blog Berichten
 *   (nieuwste eerst), inleiding, tags, de link naar het oude archief en de slug van het uitgelichte bericht.
 * @returns {object} HTML.
 */
function blogArchive(blog) {
  const teaser = (post) => postTeaser(post, SUMMARY_LENGTH, { heading: 'h2' });
  const { list, featured, rest } = arrangePosts(blog.posts, blog.featured);
  return html`<div class="layout-container blog-archive">
    ${introduction(blog.introduction)}
    ${tagBar(blog.tags, blog.archiveLink)}
    ${list.length || featured ? html`<div class="grid">
      ${list.length ? html`<div class="grid__item"><div class="list archive archive--post"><div class="list__item">
        ${list.map((post) => html`<div class="post-wrapper">${teaser(post)}</div>`)}
      </div></div></div>` : ''}
      ${featured ? html`<div class="grid__item"><div class="post-wrapper featured-post">${teaser(featured)}</div></div>` : ''}
    </div>` : html`<div class="alert">Er zijn nog geen berichten.</div>`}
    ${rest.length ? html`<div class="grid archive archive--post">
      ${rest.map((post) => html`<div class="grid__item"><div class="post-wrapper">${teaser(post)}</div></div>`)}
    </div>` : ''}
  </div>`;
}

/**
 * Berichten als liggende teasers onder elkaar (tagpagina, zoekresultaten).
 * @param {object[]} posts Berichten.
 * @returns {object} HTML.
 */
function postList(posts) {
  return html`<div class="list archive archive--post">${posts.map((post) => html`<div class="list__item">${postTeaser(post, SUMMARY_LENGTH, { heading: 'h2', landscape: true })}</div>`)}</div>`;
}

/**
 * De berichten van één tag als liggende teasers onder elkaar.
 * @param {object[]} posts Berichten.
 * @returns {object} HTML.
 */
function tagArchive(posts) {
  return html`<div class="layout-container">
    ${posts.length ? postList(posts) : html`<div class="alert">Er zijn geen berichten met deze tag.</div>`}
  </div>`;
}

/**
 * Anker van een FAQ-categorie, gelijk aan de slug van de oude categoriepagina (`/faq-categorie/<slug>/`).
 * @param {string} category Naam van de categorie.
 * @returns {string} Anker.
 */
function faqAnchor(category) {
  return String(category).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * De FAQ per categorie: titel en vragen die uitklappen (plusje draait een kwartslag).
 * @param {{question: string, answer_html: string, category: string}[]} faqs Vragen, op categorie gesorteerd.
 * @returns {object} HTML.
 */
function faqList(faqs) {
  const groups = new Map();
  for (const faq of faqs) groups.set(faq.category, [...(groups.get(faq.category) || []), faq]);
  const usedAnchors = new Set();
  /**
   * Uniek anker per categorie: twee categorieën met hetzelfde anker krijgen een volgnummer.
   * @param {string} category Categorie.
   * @returns {string} Anker.
   */
  const uniqueAnchor = (category) => {
    const base = faqAnchor(category) || 'faq';
    let anchor = base;
    for (let number = 2; usedAnchors.has(anchor); number += 1) anchor = `${base}-${number}`;
    usedAnchors.add(anchor);
    return anchor;
  };
  return html`<div class="layout-container">
    ${groups.size ? [...groups.entries()].map(([category, items]) => html`<div class="category category--faq" id="${uniqueAnchor(category)}">
      <h3 class="category__title">${category}</h3>
      <div class="list archive archive--faq">
        ${items.map((faq) => html`<div class="list__item"><details class="faq">
          <summary class="faq__summary"><h2 class="faq__question">${faq.question}</h2>${icon('plus')}</summary>
          <div class="faq__answer">${raw(faq.answer_html)}</div>
        </details></div>`)}
      </div>
    </div>`) : html`<div class="alert">Er zijn nog geen vragen.</div>`}
  </div>`;
}

/**
 * De contactpagina: links het adres en een verwijzing naar de FAQ, rechts het formulier in een box.
 * @param {{siteName: string, contact: {phone: string, email: string}, organisation?: object, kvk?: string}} site Site-instellingen.
 * @param {object} form HTML van het formulier of de bedanktmelding.
 * @returns {object} HTML.
 */
function contactLayout(site, form) {
  const organisation = site.organisation || {};
  const contact = site.contact || {};
  const place = [organisation.postalCode, organisation.city].filter(Boolean).join(' ');
  return html`<div class="layout-container">
    <div class="grid contact-extra-info">
      <div class="grid__item">
        <div class="box"><div class="box__inner"><div class="location"><div class="location__inner">
          <h3 class="location__name">${site.siteName}</h3>
          ${organisation.street || place ? html`<div class="location__address">${organisation.street ? html`<span>${organisation.street}</span>` : ''}${place ? html`<span>${place}</span>` : ''}</div>` : ''}
          ${contact.phone ? html`<span class="location__phone">T: <a href="${`tel:${contact.phone.replace(/[^0-9+]/g, '')}`}">${contact.phone}</a></span>` : ''}
          ${contact.email ? html`<span class="location__mail">E: <a href="${`mailto:${contact.email}`}">${contact.email}</a></span>` : ''}
          ${organisation.kvk ? html`<ul class="location__extra"><li>Kvk: ${organisation.kvk}</li></ul>` : ''}
        </div></div></div></div>
        <div class="box"><div class="box__inner"><div class="page-content__text">
          <p><strong>FAQ</strong><br>Misschien kunnen we je vraag al wel beantwoorden bij onze <a href="/faq/">veelgestelde vragen</a>!</p>
        </div></div></div>
      </div>
      <div class="grid__item">
        <div class="box"><div class="box__inner">
          <h2 class="box__title" id="contact-titel">Verstuur bericht</h2>
          ${form}
        </div></div>
      </div>
    </div>
  </div>`;
}

module.exports = { SUMMARY_LENGTH, VIDEO_PARAGRAPH, contentBlocks, articleBody, introduction, tagBar, arrangePosts, blogArchive, postList, tagArchive, faqAnchor, faqList, contactLayout };
