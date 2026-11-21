/**
 * Vaste inhoud van de site die (nog) geen eigen plek in de database heeft: de koppen van de lijstpagina's (reizen,
 * reisleiders, blog, FAQ: pretitel, titel, foto en inleiding) en de extra gegevens van reisleiders die de huidige site
 * toont (achternaam, woonplaats, bij Avanta sinds, citaat, portret, tweede foto, galerij en volgorde in de lijst).
 *
 * Tot het CMS (pakket G voor reisleiders, H voor pagina's) dit overneemt, staat het in `DATA_DIR/site-content.json`.
 * De import van de huidige site schrijft dat bestand (ook los met `--alleen-vaste-inhoud`). Alles uit het bestand
 * wordt gecontroleerd zoals in `homepage.js`: alleen tekst met een maximumlengte, links naar een eigen pad of https en
 * afbeeldingen onder `/media/`. Ontbreekt het bestand, dan gelden de teksten van de huidige site zonder foto's.
 */
const path = require('node:path');
const { createJsonFileStore } = require('./json-store');
const { cleanString, cleanImage } = require('./homepage');

/** Naam van het bestand in DATA_DIR. */
const SITE_CONTENT_FILE = 'site-content.json';
/** Maximum aantal foto's in de galerij van een reisleider. */
const MAX_GALLERY = 40;
/** Maximum aantal reisleiders met extra gegevens. */
const MAX_GUIDES = 500;

/** Koppen van de lijstpagina's op de huidige site (21-11-2026), voor als het bestand ontbreekt. */
const DEFAULT_ARCHIVES = Object.freeze({
  reis: { pretitle: '40 jaar wereldwijde ervaring', title: 'Ons reisaanbod', image: '', introduction: '' },
  reisleider: { pretitle: 'Ervaren avanturiers', title: 'Reisleiders', image: '', introduction: 'Ontmoet alvast onze reisleiders!' },
  blog: { pretitle: 'campfire stories', title: 'Weblog', image: '', introduction: 'Lees ervaringen van onze reisleiders en deelnemers!' },
  faq: { pretitle: 'Handig om te weten!', title: 'Veelgestelde vragen', image: '', introduction: '' },
});

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
 * Controleert de inhoud van het bestand en vult ontbrekende delen aan met de standaard.
 * @param {*} data Ingelezen JSON.
 * @returns {{archives: object, guides: Map<string, object>, guideOrder: string[]}} Inhoud.
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
  return {
    archives: Object.fromEntries(Object.entries(DEFAULT_ARCHIVES).map(([key, fallback]) => [key, normalizeArchive(archives[key], fallback)])),
    guides,
    guideOrder,
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

module.exports = { SITE_CONTENT_FILE, DEFAULT_ARCHIVES, EMPTY_GUIDE, normalizeSiteContent, createSiteContentStore, sortGuides };
