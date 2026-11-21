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
  return String(text || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
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
    ogImage: meta('og:image'),
    description: root.querySelector('meta[name="description"]')?.getAttribute('content') || meta('og:description'),
    publishedAt: meta('article:published_time'),
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
  const facts = {};
  const list = root.querySelector('.trip__meta dl');
  if (list) {
    let label = null;
    for (const node of list.childNodes) {
      if (node.nodeType !== 1) continue;
      if (node.rawTagName.toLowerCase() === 'dt') label = cleanText(node.text).toLowerCase();
      else if (node.rawTagName.toLowerCase() === 'dd' && label) facts[label] = node;
    }
  }
  const priceNode = root.querySelector('.trip__meta .trip__price');
  const oldPriceNode = priceNode?.querySelector('.trip__price--old');
  let priceText = priceNode ? priceNode.text : '';
  if (oldPriceNode) priceText = priceText.replace(oldPriceNode.text, '');
  const extraCosts = root.querySelector('.trip__meta .trip__additional-costs span');
  const guideLink = root.querySelector('.guide-widget__title a') || facts.reisleider?.querySelector('a');
  const guideMatch = /\/reisleider\/([^/]+)\/?/.exec(guideLink?.getAttribute('href') || '');
  const typeLinks = root.querySelectorAll('.trip-types a.trip-type').map((link) => ({ slug: slugFromUrl(link.getAttribute('href')), name: link.getAttribute('title') || '' }));
  const destinationLinks = (facts.bestemming?.querySelectorAll('a') || []).map((link) => ({ slug: slugFromUrl(link.getAttribute('href')), name: cleanText(link.text) }));
  const gallerySection = root.querySelector('.page-gallery');
  const gallery = (gallerySection?.querySelectorAll('img') || []).map((image) => ({ url: image.getAttribute('src'), alt: image.getAttribute('alt') || '' })).filter((image) => image.url);
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
    priceCents: parseEuros(priceText),
    oldPriceCents: oldPriceNode ? parseEuros(oldPriceNode.text) : null,
    offerUntil: parseDutchDate(root.querySelector('.trip__meta .trip__offer-date')?.text),
    extraCostsCents: extraCosts ? parseEuros(extraCosts.text) : null,
    destinations: destinationLinks,
    types: typeLinks,
    guideRef: guideMatch ? decodeURIComponent(guideMatch[1]) : null,
    guideName: cleanText(guideLink?.text),
    guaranteed: /gegarandeerd/i.test(guaranteedText),
    fullyBooked: /volgeboekt/i.test(cleanText(root.querySelector('.trip__meta .btn--inactive')?.text)),
    statusLabel: placesMatch ? placesMatch[1].toLowerCase() : '',
    galleryTitle: cleanText(gallerySection?.querySelector('.section__title')?.text),
    gallerySubtitle: cleanText(gallerySection?.querySelector('.section__subtitle')?.text),
    gallery,
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
  parseCommon, parseTrip, parseGuide, parseCategory, parseFaqCategory, parsePost, parsePage, parseHome,
};
