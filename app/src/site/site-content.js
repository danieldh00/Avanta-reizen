/**
 * Vaste inhoud van de site die (nog) geen eigen plek in de database heeft: de koppen van de lijstpagina's (reizen,
 * reisleiders, blog, FAQ en aanmelden: pretitel, titel, foto en inleiding), de extra gegevens van reisleiders die de
 * huidige site toont (achternaam, woonplaats, bij Avanta sinds, citaat, portret, tweede foto, galerij en volgorde in
 * de lijst), de tags van het weblog (naam, foto en berichten per tag, plus de link naar het oude blogarchief), het
 * uitgelichte bericht (groot op de homepage en het blog) en de
 * fotogalerijen onder blogberichten en pagina's (titel, ondertitel en foto's per pad).
 *
 * Tot het CMS (pakket G voor reisleiders, H voor pagina's, I voor het blog) dit overneemt, staat het in `DATA_DIR/site-content.json`.
 * De import van de huidige site schrijft dat bestand (ook los met `--alleen-vaste-inhoud`). Alles uit het bestand
 * wordt gecontroleerd zoals in `homepage.js`: alleen tekst met een maximumlengte, links naar een eigen pad of https en
 * afbeeldingen onder `/media/`. Ontbreekt het bestand, dan gelden de teksten van de huidige site zonder foto's.
 */
const path = require('node:path');
const { createJsonFileStore } = require('./json-store');
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
 * @param {object} fallback Standaard.
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
 * @returns {object} Gecontroleerde gegevens.
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
 * @returns {(object|null)} Gecontroleerde tag, of null zonder geldige slug of naam.
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
 * Controleert de inhoud van het bestand en vult ontbrekende delen aan met de standaard.
 * @param {*} data Ingelezen JSON.
 * @returns {{archives: object, guides: Map<string, object>, guideOrder: string[], blogTags: object[], blogArchiveLink: object, featuredPost: string, galleries: Map<string, object>}} Inhoud.
 */
function normalizeSiteContent(data) {
  const source = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const archives = source.archives && typeof source.archives === 'object' ? source.archives : {};
  const guides = new Map();
  const guideSource = source.guides && typeof source.guides === 'object' && !Array.isArray(source.guides) ? source.guides : {};
  for (const slug of Object.keys(guideSource).slice(0, MAX_GUIDES)) {
    if (SLUG.test(slug)) guides.set(slug, normalizeGuide(guideSource[slug]));
  }
  const guideOrder = [...new Set((Array.isArray(source.guideOrder) ? source.guideOrder : [])
    .map((slug) => cleanString(slug, 120)).filter((slug) => SLUG.test(slug)))].slice(0, MAX_GUIDES);
  const blogTags = [];
  for (const value of (Array.isArray(source.blogTags) ? source.blogTags : []).slice(0, MAX_TAGS)) {
    const tag = normalizeTag(value);
    if (tag && !blogTags.some((other) => other.slug === tag.slug)) blogTags.push(tag);
  }
  const galleries = new Map();
  const gallerySource = source.galleries && typeof source.galleries === 'object' && !Array.isArray(source.galleries) ? source.galleries : {};
  for (const pagePath of Object.keys(gallerySource).slice(0, MAX_PAGE_GALLERIES)) {
    const gallery = pagePath.length <= 300 && PAGE_PATH.test(pagePath) ? normalizePageGallery(gallerySource[pagePath]) : null;
    if (gallery) galleries.set(pagePath, gallery);
  }
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

/** Lege extra gegevens voor een reisleider zonder regel in het bestand. */
const EMPTY_GUIDE = Object.freeze(normalizeGuide(null));

/**
 * Maakt een lezer die `site-content.json` uit DATA_DIR leest en onthoudt tot het bestand verandert.
 * @param {string} dataDir De datamap.
 * @returns {{load: Function}} `load()` geeft de (gecontroleerde) inhoud.
 */
function createSiteContentStore(dataDir) {
  return createJsonFileStore(path.join(dataDir, SITE_CONTENT_FILE), normalizeSiteContent);
}

/**
 * Zet reisleiders in de volgorde van de huidige site; wie daar niet in staat komt erachter op naam.
 * @param {object[]} guides Reisleiders (met `slug` en `name`).
 * @param {string[]} order Slugs in volgorde.
 * @returns {object[]} Gesorteerde kopie.
 */
function sortGuides(guides, order) {
  const position = new Map(order.map((slug, index) => [slug, index]));
  return [...guides].sort((a, b) => {
    const left = position.has(a.slug) ? position.get(a.slug) : Infinity;
    const right = position.has(b.slug) ? position.get(b.slug) : Infinity;
    if (left !== right) return left - right;
    return String(a.name).localeCompare(String(b.name), 'nl');
  });
}

/**
 * De extra gegevens van een reisleider voor de site: uit het CRM als hij daar beheerd wordt (`managed_in_crm`; het
 * portret is dan `photo_url`, de galerij komt nog uit het bestand), anders uit `site-content.json`.
 * @param {{slug: string, managed_in_crm?: boolean, surname?: string, city?: string, since?: string, quote?: string, image_url?: (string|null)}} guide Reisleider uit de database.
 * @param {Map<string, object>} guides Gegevens uit `site-content.json` per slug.
 * @returns {object} Gegevens zoals `normalizeGuide`.
 */
function guideExtra(guide, guides) {
  const fixed = guides.get(guide.slug) || EMPTY_GUIDE;
  if (!guide.managed_in_crm) return fixed;
  return { ...fixed, surname: guide.surname || '', city: guide.city || '', since: guide.since || '', quote: guide.quote || '', portrait: '', image: guide.image_url || '' };
}

module.exports = { SITE_CONTENT_FILE, SITE_CONTENT_VERSION, DEFAULT_ARCHIVES, DEFAULT_BLOG_ARCHIVE_LINK, EMPTY_GUIDE, normalizeSiteContent, createSiteContentStore, sortGuides, guideExtra };
