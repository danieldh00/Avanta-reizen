// @ts-check
/**
 * Vaste inhoud van de huidige site uit `DATA_DIR/site-content.json`: de koppen van de lijstpagina's, de extra gegevens
 * van reisleiders (achternaam, woonplaats, bij Avanta sinds, citaat, foto's, galerij en volgorde), de tags van het
 * weblog met de link naar het oude blogarchief, het uitgelichte bericht en de fotogalerijen onder berichten en pagina's.
 *
 * De import van de huidige site schrijft dat bestand (ook los met `--alleen-vaste-inhoud`). Sinds W28 (migratie 34) is
 * het alleen nog bron voor de eenmalige overname naar de database (`content-transfer.js`); de site en het CRM lezen
 * het niet meer. Alles uit het bestand wordt gecontroleerd zoals in `homepage.js`: alleen tekst met een maximumlengte,
 * links naar een eigen pad of https en afbeeldingen onder `/media/`.
 */
const path = require('node:path');
const { readJsonFile } = require('./json-store');
const { cleanString, cleanHref, cleanImage } = require('./homepage');

/** Naam van het bestand in DATA_DIR. */
const SITE_CONTENT_FILE = 'site-content.json';
/**
 * Versie van de inhoud die de import schrijft. `deploy/apps01/install.sh` haalt de vaste inhoud opnieuw op als het
 * bestand een oudere versie heeft (zoek daar op `"version": 2,`); verhoog beide samen.
 */
const SITE_CONTENT_VERSION = 2;
/** Maximum aantal foto's in de galerij van een reisleider. */
const MAX_GALLERY = 40;
/** Maximum aantal reisleiders met extra gegevens. */
const MAX_GUIDES = 500;
/** Maximum aantal tags van het weblog, en berichten per tag. */
const MAX_TAGS = 50;
const MAX_TAG_POSTS = 500;
/** Maximum aantal fotogalerijen onder berichten en pagina's. */
const MAX_PAGE_GALLERIES = 1000;
/** Pad van een bericht of pagina: begint en eindigt met `/`, zonder `//`, spaties, aanhalingstekens of `<>\\`. */
const PAGE_PATH = /^\/(?:[^\s/"'<>\\]+\/)+$/;

/** Koppen van de lijstpagina's op de huidige site (21-11-2026), voor als het bestand ontbreekt. */
const DEFAULT_ARCHIVES = Object.freeze({
  reis: { pretitle: '40 jaar wereldwijde ervaring', title: 'Ons reisaanbod', image: '', introduction: '' },
  reisleider: { pretitle: 'Ervaren avanturiers', title: 'Reisleiders', image: '', introduction: 'Ontmoet alvast onze reisleiders!' },
  blog: { pretitle: 'campfire stories', title: 'Weblog', image: '', introduction: 'Lees ervaringen van onze reisleiders en deelnemers!' },
  faq: { pretitle: 'Handig om te weten!', title: 'Veelgestelde vragen', image: '', introduction: '' },
  aanmelden: { pretitle: 'Ja! Ik ga graag mee op reis', title: 'Aanmelden', image: '', introduction: 'Doorloop onderstaande stappen om je aan te melden voor de reis.' },
});

/** Link naar het oude blogarchief naast de tags, zoals op de huidige site. */
const DEFAULT_BLOG_ARCHIVE_LINK = Object.freeze({ label: 'Bekijk blog archief', href: 'https://avantareizen.blogspot.com/' });

/** Slug van een reisleider: kleine letters, cijfers en streepjes. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;

/**
 * Eén lijstkop met standaardwaarden.
 * @param {*} value Waarde uit het bestand.
 * @param {any} fallback Standaard.
 * @returns {{pretitle: string, title: string, image: string, introduction: string}} De kop.
 */
function normalizeArchive(value, fallback) {
  const own = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    pretitle: cleanString(own.pretitle, 120) || fallback.pretitle,
    title: cleanString(own.title, 120) || fallback.title,
    image: cleanImage(own.image),
    introduction: cleanString(own.introduction, 400) || fallback.introduction,
  };
}

/**
 * Extra gegevens van één reisleider.
 * @param {*} value Waarde uit het bestand.
 * @returns {any} Gecontroleerde gegevens.
 */
function normalizeGuide(value) {
  const own = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const since = cleanString(own.since, 4);
  return {
    surname: cleanString(own.surname, 120),
    city: cleanString(own.city, 120),
    since: /^(19|20)\d\d$/.test(since) ? since : '',
    quote: cleanString(own.quote, 400),
    portrait: cleanImage(own.portrait),
    image: cleanImage(own.image),
    galleryTitle: cleanString(own.galleryTitle, 120),
    gallerySubtitle: cleanString(own.gallerySubtitle, 160),
    gallery: (Array.isArray(own.gallery) ? own.gallery : []).map(cleanImage).filter(Boolean).slice(0, MAX_GALLERY),
  };
}

/**
 * Eén tag van het weblog.
 * @param {*} value Waarde uit het bestand.
 * @returns {(any|null)} Gecontroleerde tag, of null zonder geldige slug of naam.
 */
function normalizeTag(value) {
  const own = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const slug = cleanString(own.slug, 120);
  const name = cleanString(own.name, 120);
  if (!SLUG.test(slug) || !name) return null;
  const posts = [...new Set((Array.isArray(own.posts) ? own.posts : []).map((post) => cleanString(post, 120)).filter((post) => SLUG.test(post)))];
  return { slug, name, image: cleanImage(own.image), posts: posts.slice(0, MAX_TAG_POSTS) };
}

/**
 * De link naar het oude blogarchief: alleen met tekst en een veilig adres, anders de standaard.
 * @param {*} value Waarde uit het bestand.
 * @returns {{label: string, href: string}} De link.
 */
function normalizeArchiveLink(value) {
  const own = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const label = cleanString(own.label, 60);
  const href = cleanHref(own.href);
  return label && href ? { label, href } : { ...DEFAULT_BLOG_ARCHIVE_LINK };
}

/**
 * Eén fotogalerij onder een bericht of pagina.
 * @param {*} value Waarde uit het bestand.
 * @returns {({title: string, subtitle: string, images: string[]}|null)} De galerij, of null zonder foto's.
 */
function normalizePageGallery(value) {
  const own = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const images = (Array.isArray(own.images) ? own.images : []).map(cleanImage).filter(Boolean).slice(0, MAX_GALLERY);
  if (!images.length) return null;
  return { title: cleanString(own.title, 120), subtitle: cleanString(own.subtitle, 160), images };
}

/**
 * Het object zelf als het een gewoon object is (geen array), anders een leeg object.
 * @param {*} value Waarde uit de JSON.
 * @returns {any} Object.
 */
function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/**
 * De extra gegevens per reisleider, op een geldige slug, hoogstens `MAX_GUIDES`.
 * @param {any} guideSource `guides` uit het bestand.
 * @returns {Map<string, any>} Gegevens per slug.
 */
function normalizeGuides(guideSource) {
  const guides = new Map();
  for (const slug of Object.keys(guideSource).slice(0, MAX_GUIDES)) {
    if (SLUG.test(slug)) guides.set(slug, normalizeGuide(guideSource[slug]));
  }
  return guides;
}

/**
 * De tags van het blog, zonder dubbele slugs, hoogstens `MAX_TAGS`.
 * @param {*} value `blogTags` uit het bestand.
 * @returns {any[]} Tags.
 */
function normalizeTags(value) {
  const blogTags = [];
  for (const item of (Array.isArray(value) ? value : []).slice(0, MAX_TAGS)) {
    const tag = normalizeTag(item);
    if (tag && !blogTags.some((other) => other.slug === tag.slug)) blogTags.push(tag);
  }
  return blogTags;
}

/**
 * De fotogalerijen per pagina-adres (geldig pad van hoogstens 300 tekens), hoogstens `MAX_PAGE_GALLERIES`.
 * @param {any} gallerySource `galleries` uit het bestand.
 * @returns {Map<string, any>} Galerij per pad.
 */
function normalizeGalleries(gallerySource) {
  const galleries = new Map();
  for (const pagePath of Object.keys(gallerySource).slice(0, MAX_PAGE_GALLERIES)) {
    const gallery = pagePath.length <= 300 && PAGE_PATH.test(pagePath) ? normalizePageGallery(gallerySource[pagePath]) : null;
    if (gallery) galleries.set(pagePath, gallery);
  }
  return galleries;
}

/**
 * Controleert de inhoud van het bestand en vult ontbrekende delen aan met de standaard.
 * @param {*} data Ingelezen JSON.
 * @returns {{archives: any, guides: Map<string, any>, guideOrder: string[], blogTags: any[], blogArchiveLink: any, featuredPost: string, galleries: Map<string, any>}} Inhoud.
 */
function normalizeSiteContent(data) {
  const source = plainObject(data);
  const archives = source.archives && typeof source.archives === 'object' ? source.archives : {};
  const guideOrder = [...new Set((Array.isArray(source.guideOrder) ? source.guideOrder : [])
    .map((slug) => cleanString(slug, 120)).filter((slug) => SLUG.test(slug)))].slice(0, MAX_GUIDES);
  const guides = normalizeGuides(plainObject(source.guides));
  const blogTags = normalizeTags(source.blogTags);
  const galleries = normalizeGalleries(plainObject(source.galleries));
  return {
    archives: Object.fromEntries(Object.entries(DEFAULT_ARCHIVES).map(([key, fallback]) => [key, normalizeArchive(archives[key], fallback)])),
    guides,
    guideOrder,
    blogTags,
    blogArchiveLink: normalizeArchiveLink(source.blogArchiveLink),
    featuredPost: SLUG.test(cleanString(source.featuredPost, 120)) ? cleanString(source.featuredPost, 120) : '',
    galleries,
  };
}

/**
 * Leest `site-content.json` uit de datamap, voor de overname naar de database.
 * @param {string} dataDir De datamap.
 * @returns {any|null} De gecontroleerde inhoud, of null als het bestand ontbreekt of kapot is.
 */
function readSiteContentFile(dataDir) {
  return readJsonFile(path.join(dataDir, SITE_CONTENT_FILE), normalizeSiteContent);
}

module.exports = { SITE_CONTENT_FILE, SITE_CONTENT_VERSION, DEFAULT_ARCHIVES, DEFAULT_BLOG_ARCHIVE_LINK, normalizeSiteContent, readSiteContentFile };
