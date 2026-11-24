/**
 * Leest de HTML van de huidige WordPress-site uit per paginasoort (reis, reisleider, categorie, blog, pagina, FAQ)
 * en geeft platte objecten terug. De HTML van de inhoud blijft ruw; die wordt bij het importeren opgeschoond.
 */
const { parse } = require('node-html-parser');

/**
 * Maakt van tekst met witruimte één nette regel.
 * @param {string} text De tekst.
 * @returns {string} Opgeschoonde tekst.
 */
function cleanText(text) {
  return String(text || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Zet een bedrag als "€1.849,-" of "€ 799,50" om naar centen.
 * @param {string} text Tekst met een bedrag.
 * @returns {(number|null)} Bedrag in centen of null.
 */
function parseEuros(text) {
  const match = /(\d[\d.]*)(?:,(\d{2}|-))?/.exec(String(text || '').replace(/\s/g, ''));
  if (!match) return null;
  const euros = Number(match[1].replace(/\./g, ''));
  const cents = match[2] && match[2] !== '-' ? Number(match[2]) : 0;
  return Number.isFinite(euros) ? euros * 100 + cents : null;
}

/**
 * Zet een datum "dd-mm-jjjj" om naar "jjjj-mm-dd".
 * @param {string} text Tekst met een datum.
 * @returns {(string|null)} ISO-datum of null.
 */
function parseDutchDate(text) {
  const match = /(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(String(text || ''));
  if (!match) return null;
  return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

/**
 * Haalt de URL uit een CSS-achtergrond (`background-image: url(...)`).
 * @param {string} style De style-attribuutwaarde.
 * @returns {(string|null)} De URL of null.
 */
function backgroundUrl(style) {
  const match = /url\(\s*['"]?([^'")]+)['"]?\s*\)/.exec(String(style || ''));
  return match ? match[1] : null;
}

/**
 * Geeft het laatste padsegment van een URL (gedecodeerd), bijv. de slug van een reis.
 * @param {string} url De URL.
 * @returns {string} De slug.
 */
function slugFromUrl(url) {
  const segments = new URL(url, 'https://www.avantareizen.nl').pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1] || '';
  try {
    return decodeURIComponent(last);
  } catch (_) {
    return last;
  }
}

/**
 * Geeft het pad van een URL zonder domein, met slash aan het eind.
 * @param {string} url De URL.
 * @returns {string} Het pad.
 */
function pathFromUrl(url) {
  let pathname = new URL(url, 'https://www.avantareizen.nl').pathname;
  try {
    pathname = decodeURI(pathname);
  } catch (_) { /* pad blijft zoals het is */ }
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

/**
 * De fotogalerij onder de inhoud (sectie `page-gallery`): titel, ondertitel en de foto's in volgorde.
 * @param {object} root Geparste pagina.
 * @returns {{title: string, subtitle: string, images: string[]}} De galerij (zonder foto's: lege lijst).
 */
function parsePageGallery(root) {
  const section = root.querySelector('.page-gallery');
  return {
    title: cleanText(section?.querySelector('.section__title')?.text),
    subtitle: cleanText(section?.querySelector('.section__subtitle')?.text),
    images: (section?.querySelectorAll('img') || []).map((image) => image.getAttribute('src')).filter(Boolean),
  };
}

/**
 * Leest de delen die elke pagina heeft: kop (afbeelding, pretitel, titel), intro, inhoud en metagegevens.
 * @param {string} markup De volledige HTML van de pagina.
 * @returns {object} De gemeenschappelijke gegevens, plus `root` voor verdere uitlezing.
 */
function parseCommon(markup) {
  const root = parse(markup, { comment: false });
  const bodyClass = root.querySelector('body')?.getAttribute('class') || '';
  const idMatch = /\b(?:postid|page-id|term)-(\d+)\b/.exec(bodyClass);
  const content = root.querySelector('.page-content') || root.querySelector('.page-content__text');
  const meta = (property) => root.querySelector(`meta[property="${property}"]`)?.getAttribute('content') || null;
  return {
    root,
    bodyClass,
    legacyId: idMatch ? Number(idMatch[1]) : null,
    title: cleanText(root.querySelector('.page-header__title')?.text || root.querySelector('h1')?.text),
    pretitle: cleanText(root.querySelector('.page-header__pretitle')?.text),
    intro: cleanText(root.querySelector('.page-introduction')?.text),
    headerImage: backgroundUrl(root.querySelector('.page-header__image')?.getAttribute('style')),
    bodyHtml: content ? content.innerHTML.trim() : '',
    gallery: parsePageGallery(root),
    ogImage: meta('og:image'),
    description: root.querySelector('meta[name="description"]')?.getAttribute('content') || meta('og:description'),
    publishedAt: meta('article:published_time'),
  };
}

/**
 * Leest de feitenlijst van een reis (`dt`/`dd` in `.trip__meta`) als knopen per label in kleine letters.
 * @param {object} root De geparste pagina.
 * @returns {Record<string, object>} De `dd`-knoop per label (bijv. `reiscode`, `vertrek`, `reisleider`).
 */
function readTripFacts(root) {
  const facts = {};
  const list = root.querySelector('.trip__meta dl');
  if (!list) return facts;
  let label = null;
  for (const node of list.childNodes) {
    if (node.nodeType !== 1) continue;
    if (node.rawTagName.toLowerCase() === 'dt') label = cleanText(node.text).toLowerCase();
    else if (node.rawTagName.toLowerCase() === 'dd' && label) facts[label] = node;
  }
  return facts;
}

/**
 * Leest de prijzen van een reis: reissom, oude prijs bij een aanbieding, einddatum van de aanbieding en bijkomende kosten.
 * @param {object} root De geparste pagina.
 * @returns {{priceCents: number|null, oldPriceCents: number|null, offerUntil: string|null, extraCostsCents: number|null}} De prijzen.
 */
function readTripPrices(root) {
  const priceNode = root.querySelector('.trip__meta .trip__price');
  const oldPriceNode = priceNode?.querySelector('.trip__price--old');
  let priceText = priceNode ? priceNode.text : '';
  if (oldPriceNode) priceText = priceText.replace(oldPriceNode.text, '');
  const extraCosts = root.querySelector('.trip__meta .trip__additional-costs span');
  return {
    priceCents: parseEuros(priceText),
    oldPriceCents: oldPriceNode ? parseEuros(oldPriceNode.text) : null,
    offerUntil: parseDutchDate(root.querySelector('.trip__meta .trip__offer-date')?.text),
    extraCostsCents: extraCosts ? parseEuros(extraCosts.text) : null,
  };
}

/**
 * Leest de fotogalerij van een reis met kop en ondertitel.
 * @param {object} root De geparste pagina.
 * @returns {{galleryTitle: string, gallerySubtitle: string, gallery: Array<{url: string, alt: string}>}} De galerij.
 */
function readTripGallery(root) {
  const gallerySection = root.querySelector('.page-gallery');
  const gallery = (gallerySection?.querySelectorAll('img') || []).map((image) => ({ url: image.getAttribute('src'), alt: image.getAttribute('alt') || '' })).filter((image) => image.url);
  return {
    galleryTitle: cleanText(gallerySection?.querySelector('.section__title')?.text),
    gallerySubtitle: cleanText(gallerySection?.querySelector('.section__subtitle')?.text),
    gallery,
  };
}

/**
 * Leest een reis (posttype journey).
 * @param {string} markup HTML van de reispagina.
 * @param {string} url Adres van de pagina.
 * @returns {object} De reis.
 */
function parseTrip(markup, url) {
  const common = parseCommon(markup);
  const { root } = common;
  const facts = readTripFacts(root);
  const guideLink = root.querySelector('.guide-widget__title a') || facts.reisleider?.querySelector('a');
  const guideMatch = /\/reisleider\/([^/]+)\/?/.exec(guideLink?.getAttribute('href') || '');
  const typeLinks = root.querySelectorAll('.trip-types a.trip-type').map((link) => ({ slug: slugFromUrl(link.getAttribute('href')), name: link.getAttribute('title') || '' }));
  const destinationLinks = (facts.bestemming?.querySelectorAll('a') || []).map((link) => ({ slug: slugFromUrl(link.getAttribute('href')), name: cleanText(link.text) }));
  const durationLabel = cleanText(facts.reisduur?.text);
  const daysMatch = /(\d+)/.exec(durationLabel);
  const bodyText = cleanText(parse(common.bodyHtml).text);
  const placesMatch = /\[\s*(NOG \d+ PLAATS(?:EN)?|VOLGEBOEKT|LAATSTE PLAATS(?:EN)?)\s*\]/i.exec(bodyText);
  const guaranteedText = cleanText(root.querySelector('.trip__guaranteed')?.text);
  return {
    legacyId: common.legacyId,
    slug: slugFromUrl(url),
    title: common.title,
    tagline: common.intro,
    headerImage: common.headerImage,
    ogImage: common.ogImage,
    description: common.description,
    bodyHtml: common.bodyHtml,
    tripCode: cleanText(facts.reiscode?.text) || null,
    departureDate: parseDutchDate(facts.vertrek?.text),
    durationLabel,
    durationDays: daysMatch ? Number(daysMatch[1]) : null,
    ...readTripPrices(root),
    destinations: destinationLinks,
    types: typeLinks,
    guideRef: guideMatch ? decodeURIComponent(guideMatch[1]) : null,
    guideName: cleanText(guideLink?.text),
    guaranteed: /gegarandeerd/i.test(guaranteedText),
    fullyBooked: /volgeboekt/i.test(cleanText(root.querySelector('.trip__meta .btn--inactive')?.text)),
    statusLabel: placesMatch ? placesMatch[1].toLowerCase() : '',
    ...readTripGallery(root),
  };
}

/**
 * Leest een reisleider.
 * @param {string} markup HTML van de pagina.
 * @param {string} url Adres van de pagina.
 * @returns {object} De reisleider.
 */
function parseGuide(markup, url) {
  const common = parseCommon(markup);
  const photo = common.root.querySelector('.page-content img, .guide__thumb img, .guide-widget__thumb img');
  return {
    legacyId: common.legacyId,
    slug: slugFromUrl(url),
    name: common.title,
    intro: common.intro,
    bodyHtml: common.bodyHtml,
    photo: common.ogImage || photo?.getAttribute('src') || common.headerImage,
    extra: parseGuideExtra(common.root),
  };
}

/**
 * De extra gegevens van een reisleider die de huidige site naast de tekst toont (voor `site-content.json`).
 * @param {object} root Geparste pagina.
 * @returns {{surname: string, city: string, since: string, quote: string, portrait: (string|null), image: (string|null), galleryTitle: string, gallerySubtitle: string, gallery: string[]}} Gegevens.
 */
function parseGuideExtra(root) {
  const text = (selector) => cleanText(root.querySelector(selector)?.text);
  const gallery = root.querySelector('.page-gallery');
  return {
    surname: text('.guide__surname'),
    city: text('.guide__city'),
    since: text('.guide__year'),
    quote: text('.guide__quote').replace(/^[`'"‘“]+|[`'"’”]+$/g, '').trim(),
    portrait: root.querySelector('.guide__featured-image img')?.getAttribute('src') || null,
    image: root.querySelector('.guide__image img')?.getAttribute('src') || null,
    galleryTitle: cleanText(gallery?.querySelector('.section__title')?.text),
    gallerySubtitle: cleanText(gallery?.querySelector('.section__subtitle')?.text),
    gallery: (gallery?.querySelectorAll('img') || []).map((image) => image.getAttribute('src')).filter(Boolean),
  };
}

/**
 * De kop van een lijstpagina (reisaanbod, reisleiders, blog, FAQ): pretitel, titel, foto en inleiding.
 * @param {string} markup HTML van de pagina.
 * @returns {{pretitle: string, title: string, image: (string|null), introduction: string}} De kop.
 */
function parseArchiveHeader(markup) {
  const root = parse(markup, { comment: false });
  return {
    pretitle: cleanText(root.querySelector('.page-header__pretitle')?.text),
    title: cleanText(root.querySelector('.page-header__title')?.text),
    image: backgroundUrl(root.querySelector('.page-header__image')?.getAttribute('style')),
    introduction: cleanText(root.querySelector('.page-introduction')?.text),
  };
}

/**
 * De volgorde van de reisleiders op de lijstpagina (slugs; een oud id als adres blijft een getal).
 * @param {string} markup HTML van `/reisleider/`.
 * @returns {string[]} Slugs of oude id's in volgorde.
 */
function parseGuideOrder(markup) {
  const root = parse(markup, { comment: false });
  return root.querySelectorAll('.archive--guide a.post-teaser').map((link) => slugFromUrl(link.getAttribute('href') || '')).filter(Boolean);
}

/**
 * De tags boven het weblog: naam en slug per tag, de link naar het oude blogarchief (http wordt https) en het
 * uitgelichte bericht.
 * @param {string} markup HTML van `/blog/`.
 * @returns {{tags: {slug: string, name: string}[], archiveLink: ({label: string, href: string}|null), featured: string}} Tags,
 *   link en de slug van het uitgelichte bericht (groot rechts).
 */
function parseBlogTags(markup) {
  const root = parse(markup, { comment: false });
  const featuredLink = root.querySelector('.featured-post a.post-teaser');
  const tags = [];
  let archiveLink = null;
  for (const link of root.querySelectorAll('.tags a.tags__item')) {
    const href = link.getAttribute('href') || '';
    const label = cleanText(link.text);
    if (/tags__item--extern/.test(link.getAttribute('class') || '')) {
      if (label && /^https?:\/\//i.test(href)) archiveLink = { label, href: href.replace(/^http:/i, 'https:') };
    } else if (/\/tag\/[^/]+\/?$/.test(href) && label) {
      tags.push({ slug: slugFromUrl(href), name: label });
    }
  }
  return { tags, archiveLink, featured: featuredLink ? slugFromUrl(featuredLink.getAttribute('href') || '') : '' };
}

/**
 * Een tagpagina van het weblog: de kopfoto en de berichten (slugs) in volgorde.
 * @param {string} markup HTML van `/tag/<slug>/`.
 * @returns {{image: string, posts: string[]}} Foto en berichten.
 */
function parseTagPage(markup) {
  const root = parse(markup, { comment: false });
  return {
    image: backgroundUrl(root.querySelector('.page-header__image')?.getAttribute('style')),
    posts: root.querySelectorAll('.archive--post a.post-teaser').map((link) => slugFromUrl(link.getAttribute('href') || '')).filter(Boolean),
  };
}

/**
 * Leest een reiscategorie (bestemming of reistype) inclusief de reizen in de lijst.
 * @param {string} markup HTML van de pagina.
 * @param {string} url Adres van de pagina.
 * @returns {object} De categorie.
 */
function parseCategory(markup, url) {
  const common = parseCommon(markup);
  const teasers = common.root.querySelectorAll('.archive--journey .list__item').map((item) => {
    const link = item.querySelector('a.post-teaser');
    return {
      slug: link ? slugFromUrl(link.getAttribute('href')) : null,
      isNew: link?.getAttribute('data-new') === '1',
      destinationIds: (item.getAttribute('data-destination') || '').split(',').filter(Boolean).map(Number),
      typeIds: (item.getAttribute('data-type') || '').split(',').filter(Boolean).map(Number),
      image: item.querySelector('img')?.getAttribute('src') || null,
    };
  }).filter((teaser) => teaser.slug);
  return {
    legacyId: common.legacyId,
    slug: slugFromUrl(url),
    name: common.title,
    intro: common.intro || common.pretitle,
    bodyHtml: common.root.querySelector('.page-content__text')?.innerHTML.trim() || '',
    headerImage: common.headerImage,
    teasers,
  };
}

/**
 * Leest een FAQ-categorie met alle vragen en antwoorden.
 * @param {string} markup HTML van de pagina.
 * @param {string} url Adres van de pagina.
 * @returns {{slug: string, name: string, items: {question: string, answerHtml: string}[]}} De categorie.
 */
function parseFaqCategory(markup, url) {
  const common = parseCommon(markup);
  const items = common.root.querySelectorAll('article.faq').map((article) => ({
    question: cleanText(article.querySelector('.faq__question')?.text),
    answerHtml: article.querySelector('.faq__answer')?.innerHTML.trim() || '',
  })).filter((item) => item.question);
  return { slug: slugFromUrl(url), name: common.title, items };
}

/**
 * Leest een blogbericht.
 * @param {string} markup HTML van de pagina.
 * @param {string} url Adres van de pagina.
 * @returns {object} Het bericht.
 */
function parsePost(markup, url) {
  const common = parseCommon(markup);
  const categories = common.root.querySelectorAll('a[rel~="category"]').map((link) => cleanText(link.text)).filter(Boolean);
  return {
    legacyId: common.legacyId,
    slug: slugFromUrl(url),
    title: common.title,
    intro: common.intro,
    bodyHtml: common.bodyHtml,
    image: common.ogImage || common.headerImage,
    headerImage: common.headerImage,
    publishedAt: common.publishedAt,
    categories: [...new Set(categories)],
    gallery: common.gallery,
  };
}

/**
 * Leest een gewone pagina.
 * @param {string} markup HTML van de pagina.
 * @param {string} url Adres van de pagina.
 * @returns {object} De pagina.
 */
function parsePage(markup, url) {
  const common = parseCommon(markup);
  return {
    legacyId: common.legacyId,
    path: pathFromUrl(url),
    title: common.title,
    pretitle: common.pretitle,
    intro: common.intro,
    bodyHtml: common.bodyHtml,
    headerImage: common.headerImage,
    gallery: common.gallery,
  };
}

/**
 * Leest de homepage: de slider (pretitel, titel, knop, link, foto of YouTube-video), de titels van de secties, de
 * inspiratie-dia's en het blok "Voor Avanta Reizen is geen bestemming te ver". Links en foto's blijven de adressen van
 * de huidige site; de import zet ze om naar eigen paden.
 * @param {string} markup HTML van de homepage.
 * @returns {object} De inhoud (zie `src/site/homepage.js`).
 */
function parseHome(markup) {
  const root = parse(markup, { comment: false });
  const text = (node) => cleanText(node && node.text);
  const sectionOf = (selector) => {
    const section = root.querySelector(selector);
    return {
      title: text(section && section.querySelector('.section__title')),
      subtitle: text(section && section.querySelector('.section__subtitle')),
      button: text(section && section.querySelector('.section__footer .btn')),
    };
  };
  const slides = root.querySelectorAll('.homepage__slides .slide').map((slide) => {
    const video = /\/embed\/([A-Za-z0-9_-]{11})/.exec(slide.querySelector('.slide__video iframe')?.getAttribute('src') || '');
    const button = slide.querySelector('.slide__btn');
    return {
      pretitle: text(slide.querySelector('.slide__pretitle')),
      title: text(slide.querySelector('.slide__title')),
      button: text(button),
      href: button?.getAttribute('href') || '',
      image: backgroundUrl(slide.querySelector('.slide__image')?.getAttribute('style')),
      videoId: video ? video[1] : null,
    };
  });
  const inspiration = root.querySelectorAll('.homepage__inspiration .slide').map((slide) => ({
    title: text(slide.querySelector('.slide__title')),
    text: text(slide.querySelector('.slide__text')),
    image: backgroundUrl(slide.querySelector('.slide__figure')?.getAttribute('style')),
  }));
  const about = root.querySelector('.homepage__about');
  const readon = about?.querySelector('.readon');
  const content = about?.querySelector('.section__content');
  if (readon && content) readon.remove();
  return {
    slides,
    sections: {
      lastMinutes: sectionOf('.homepage__last-minutes'),
      types: sectionOf('.homepage__trip-types'),
      destinations: sectionOf('.homepage__popular'),
      blog: sectionOf('.homepage__blog'),
    },
    inspiration,
    about: {
      title: text(about?.querySelector('.section__title')),
      text: text(content),
      linkLabel: text(readon),
      href: readon?.getAttribute('href') || '',
      image: about?.querySelector('.about__image img')?.getAttribute('src') || null,
    },
    typeSlugs: root.querySelectorAll('.homepage__trip-types .trip-type').map((link) => slugFromUrl(link.getAttribute('href') || '')).filter(Boolean),
  };
}

module.exports = {
  cleanText, parseEuros, parseDutchDate, backgroundUrl, slugFromUrl, pathFromUrl,
  parseCommon, parseTrip, parseGuide, parseGuideExtra, parseCategory, parseFaqCategory, parsePost, parsePage, parseHome,
  parseArchiveHeader, parseGuideOrder, parseBlogTags, parseTagPage, parsePageGallery,
};
