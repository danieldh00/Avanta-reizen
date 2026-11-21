/**
 * De vaste inhoud van de homepage die niet uit reizen, categorieën of blog komt: de slider bovenaan, de vier
 * "inspiratie"-dia's, het blok "Voor Avanta Reizen is geen bestemming te ver" en de titels van de secties.
 *
 * Tot de homepage in CMS-pakket H uit blokken bestaat, staat die inhoud in `DATA_DIR/homepage.json`. De import van de
 * huidige site (`tools/import-wordpress.js`, ook los met `--alleen-homepage`) schrijft dat bestand, met de
 * afbeeldingen lokaal onder `/media/`. Ontbreekt het, dan gelden de teksten van de huidige site hieronder (zonder
 * foto's; de route vult dan foto's van reizen in). Alles uit het bestand wordt gecontroleerd voordat het op de pagina
 * komt: alleen tekst met een maximumlengte, links naar een eigen pad of https en afbeeldingen onder `/media/`.
 */
const path = require('node:path');
const { createJsonFileStore } = require('./json-store');

/** Naam van het bestand in DATA_DIR. */
const HOMEPAGE_FILE = 'homepage.json';
/** Adres waar de video van een videodia vandaan komt (de privacyvriendelijke variant van YouTube). */
const YOUTUBE_ORIGIN = 'https://www.youtube-nocookie.com';
/** Maximum aantal dia's per slider. */
const MAX_SLIDES = 8;

/** De teksten van de huidige site (21-11-2026), voor als het bestand ontbreekt. */
const DEFAULT_HOMEPAGE = Object.freeze({
  slides: [
    { pretitle: 'chase the snow!', title: 'winters avantuur', button: 'al onze winterreizen', href: '/reis/?bestemming=wintersport&nieuw=1', image: '', videoId: '' },
    { pretitle: 'your adventure starts here', title: 'Ons reisaanbod', button: 'start exploring', href: '/reis/', image: '', videoId: '' },
    { pretitle: 'minder spullen, meer ruimte voor avontuur', title: 'pack your bag!', button: 'inpaktips', href: '/vijf-reisessentials-en-extra-inpaktips-van-emma/', image: '', videoId: '' },
    { pretitle: 'our way of life', title: 'Wildkamperen', button: 'pitch your tent here', href: '/reis/', image: '', videoId: '' },
    { pretitle: 'geen uithoek te ver', title: 'All over the world', button: 'laat je inspireren', href: '/blog/', image: '', videoId: 'Cs45NTbOzqg' },
  ],
  sections: {
    lastMinutes: { title: 'Inpakken en wegwezen!', subtitle: 'voor plotselinge reiskriebels', button: 'Meer last-minutes' },
    types: { title: 'Met Avanta reis je zoals reizen bedoeld is', subtitle: 'voor verschillende leeftijden' },
    destinations: { title: 'Onze bestemmingen', subtitle: 'naar alle hoeken van de wereld' },
    blog: { title: 'Blog', subtitle: "Tips, inspirerende reisverhalen en veel foto's", button: 'Meer blogberichten' },
  },
  inspiration: [
    { title: 'De Avanta way of life', text: 'Wie kiest voor een reis met Avanta, kiest voor een reis waarin natuur, cultuur en contact met de plaatselijke bevolking centraal staan.', image: '' },
    { title: 'Back to the basics', text: 'Onze wildkampeerreizen zijn zo relaxed door het ontbreken van luxe. Een tentje om in te slapen, een vuurtje om op te koken en een rivier om in te wassen. Meer heb je niet nodig.', image: '' },
    { title: 'Met medechristenen op reis', text: 'Respect voor elkaar, de schepping, de mensen die je ontmoet. Dat vinden wij vanzelfsprekend.', image: '' },
    { title: 'Wij kijken verder', text: "Landen waar nauwelijks toeristen komen, regio's waar alle wegen onverhard zijn - daar houden wij van en daar komen wij graag.", image: '' },
  ],
  about: {
    title: 'Voor Avanta Reizen is geen bestemming te ver',
    text: "Wie kiest voor een reis met Avanta, kiest voor een reis waarin natuur, cultuur en contact met de plaatselijke bevolking centraal staan. Met Avanta ga je 'back to the basics'; wanneer je wilt luieren op het strand en tijdens je vakantie omringd wilt zijn met luxe, ben je aan het verkeerde adres.",
    linkLabel: 'Dit zijn wij!',
    href: '/avanta-reizen/',
    image: '',
  },
  /** Reistypes op de homepage, in deze volgorde (slugs van de huidige site). */
  typeSlugs: ['hostel', 'jeugd', 'jongeren', 'kamperen', 'plus'],
});

/**
 * Tekst uit het bestand: alleen een string, witruimte samengevoegd en ingekort.
 * @param {*} value Waarde.
 * @param {number} max Maximumlengte.
 * @returns {string} Tekst (leeg als het geen string is).
 */
function cleanString(value, max) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/**
 * Link uit het bestand: een eigen pad (niet `//`) of https, zonder witruimte of tekens die HTML of CSS openbreken.
 * @param {*} value Waarde.
 * @returns {string} De link, of leeg.
 */
function cleanHref(value) {
  const href = cleanString(value, 300);
  return /^(\/(?!\/)|https:\/\/)[^\s"'<>\\]*$/.test(href) ? href : '';
}

/**
 * Afbeelding uit het bestand: alleen een lokaal bestand onder `/media/` (zoals de import ze maakt).
 * @param {*} value Waarde.
 * @returns {string} Het pad, of leeg.
 */
function cleanImage(value) {
  const image = cleanString(value, 200);
  return /^\/media\/[A-Za-z0-9._-]+\.(jpe?g|png|webp|gif)$/i.test(image) && !image.includes('..') ? image : '';
}

/**
 * YouTube-id van een videodia: precies 11 tekens uit letters, cijfers, `-` en `_`.
 * @param {*} value Waarde.
 * @returns {string} Het id, of leeg.
 */
function cleanVideoId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value) ? value : '';
}

/**
 * Een tekstvak met een standaardwaarde.
 * @param {*} value Waarde uit het bestand.
 * @param {string} fallback Standaard.
 * @param {number} max Maximumlengte.
 * @returns {string} Tekst.
 */
function textOr(value, fallback, max) {
  return cleanString(value, max) || fallback;
}

/**
 * Controleert de inhoud van het bestand en vult ontbrekende delen aan met de standaard.
 * @param {*} data Ingelezen JSON.
 * @returns {object} Inhoud in de vorm van `DEFAULT_HOMEPAGE`.
 */
function normalizeHomepage(data) {
  const source = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const defaults = DEFAULT_HOMEPAGE;
  const slides = (Array.isArray(source.slides) ? source.slides : [])
    .slice(0, MAX_SLIDES)
    .map((slide) => ({
      pretitle: cleanString(slide && slide.pretitle, 120),
      title: cleanString(slide && slide.title, 120),
      button: cleanString(slide && slide.button, 60),
      href: cleanHref(slide && slide.href),
      image: cleanImage(slide && slide.image),
      videoId: cleanVideoId(slide && slide.videoId),
    }))
    .filter((slide) => slide.title);
  const inspiration = (Array.isArray(source.inspiration) ? source.inspiration : [])
    .slice(0, MAX_SLIDES)
    .map((item) => ({ title: cleanString(item && item.title, 120), text: cleanString(item && item.text, 600), image: cleanImage(item && item.image) }))
    .filter((item) => item.title);
  const sections = source.sections && typeof source.sections === 'object' ? source.sections : {};
  /**
   * Eén sectietitel met subtitel (en knop) met standaardwaarden.
   * @param {string} key Sleutel in `sections`.
   * @returns {object} De sectie.
   */
  const section = (key) => {
    const own = sections[key] && typeof sections[key] === 'object' ? sections[key] : {};
    const fallback = defaults.sections[key];
    const result = { title: textOr(own.title, fallback.title, 120), subtitle: textOr(own.subtitle, fallback.subtitle, 160) };
    if (fallback.button) result.button = textOr(own.button, fallback.button, 60);
    return result;
  };
  const about = source.about && typeof source.about === 'object' ? source.about : {};
  const typeSlugs = (Array.isArray(source.typeSlugs) ? source.typeSlugs : [])
    .map((slug) => cleanString(slug, 80)).filter((slug) => /^[a-z0-9-]+$/.test(slug)).slice(0, 12);
  return {
    slides: slides.length ? slides : defaults.slides.map((slide) => ({ ...slide })),
    sections: { lastMinutes: section('lastMinutes'), types: section('types'), destinations: section('destinations'), blog: section('blog') },
    inspiration: inspiration.length ? inspiration : defaults.inspiration.map((item) => ({ ...item })),
    about: {
      title: textOr(about.title, defaults.about.title, 160),
      text: textOr(about.text, defaults.about.text, 1200),
      linkLabel: textOr(about.linkLabel, defaults.about.linkLabel, 60),
      href: cleanHref(about.href) || defaults.about.href,
      image: cleanImage(about.image),
    },
    typeSlugs: typeSlugs.length ? typeSlugs : [...defaults.typeSlugs],
  };
}

/**
 * Maakt een lezer die `homepage.json` uit DATA_DIR leest en onthoudt tot het bestand verandert.
 * @param {string} dataDir De datamap.
 * @returns {{load: Function}} `load()` geeft de (gecontroleerde) inhoud.
 */
function createHomepageStore(dataDir) {
  return createJsonFileStore(path.join(dataDir, HOMEPAGE_FILE), normalizeHomepage);
}

module.exports = { HOMEPAGE_FILE, DEFAULT_HOMEPAGE, normalizeHomepage, createHomepageStore, cleanString, cleanHref, cleanImage, cleanVideoId, YOUTUBE_ORIGIN };
