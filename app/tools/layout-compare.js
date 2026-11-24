/**
 * Vergelijkende DOM-meting: meet dezelfde onderdelen op de huidige site (www.avantareizen.nl) en op de nieuwe site,
 * op 1440 en 375 px breed, en meldt waar positie, breedte, hoogte of letter verschillen. Zo blijft het ontwerp gelijk
 * aan de huidige site (CMS-pakket E) zonder schermafbeeldingen.
 *
 * Gebruik (Playwright met Chromium moet beschikbaar zijn; het is geen dependency van de app):
 *   node tools/layout-compare.js --nieuw http://localhost:3400                       # vergelijk met de opgeslagen meting
 *   node tools/layout-compare.js --nieuw http://localhost:3400 --live https://www.avantareizen.nl   # meet beide nu
 *   node tools/layout-compare.js --live https://www.avantareizen.nl --opslaan test/fixtures/layout-live.json
 * De test `test/layout-compare.test.js` doet de eerste variant als `LAYOUT_BASE_URL` is gezet.
 *
 * Gemeten wordt het eerste element per selector. De y-positie telt vanaf de bovenkant van `.page-header`, zodat de
 * balk "in ontwikkeling" (alleen op de nieuwe site) niet meetelt. Hoogtes worden alleen vergeleken tot 120 px: hogere
 * blokken hangen af van de tekst, en die mag verschillen; om dezelfde reden telt de y-positie alleen tot 900 px onder de
 * kop.
 */
const fs = require('node:fs');
const path = require('node:path');

/** Breedtes waarop gemeten wordt (desktop en mobiel, zoals de huidige site). */
const WIDTHS = [1440, 375];

/** Toegestaan verschil in pixels (afronding, lettertype-rendering). */
const TOLERANCE = 3;

/** Hoogtes boven deze waarde hangen af van de inhoud en worden niet vergeleken. */
const MAX_COMPARED_HEIGHT = 120;

/** Verticale posities verder dan dit onder de kop hangen af van de tekst erboven en worden niet vergeleken. */
const MAX_COMPARED_Y = 900;

/** Standaardbestand met de meting van de huidige site. */
const REFERENCE_FILE = path.join(__dirname, '..', 'test', 'fixtures', 'layout-live.json');

/** Pagina's en onderdelen. Alleen pagina's waarvan de inhoud op beide sites vast staat. */
const LAYOUT_PAGES = [
  {
    name: 'blog', path: '/blog/', selectors: [
      '.page-header', '.page-header__pretitle', '.page-header__title', '.content-main', '.page-introduction', '.tags', '.tags__item',
      '.tags__item--extern', '.list.archive--post .post-teaser', '.list.archive--post .post-teaser__thumb', '.list.archive--post .post-teaser__meta',
      '.list.archive--post .post-teaser__title', '.featured-post', '.featured-post .post-teaser__thumb', '.grid.archive--post .grid__item',
      '.grid.archive--post .post-teaser__thumb',
    ],
  },
  {
    name: 'tag', path: '/tag/citytrip/', selectors: [
      '.page-header', '.page-header__title', '.to-archive', '.content-main', '.post-teaser--landscape .post-teaser__thumb',
      '.post-teaser--landscape .post-teaser__inner', '.post-teaser--landscape .post-teaser__title',
    ],
  },
  {
    name: 'bericht', path: '/avanta-in-2017/', selectors: [
      '.page-header', '.page-header__pretitle time', '.page-header__title', '.to-archive', '.content-main', '.page-introduction',
      '.page-content__video-wrapper', '.page-content__video', '.page-content__text',
    ],
  },
  {
    name: 'pagina', path: '/avanta-reizen/onzemaniervanreizen/', selectors: [
      '.page-header', '.page-header__pretitle', '.page-header__title', '.content-main', '.page-introduction', '.page-content__text h2',
      '.page-gallery .section__title',
    ],
  },
  {
    name: 'faq', path: '/faq/', selectors: [
      '.page-header', '.page-header__title', '.content-main', '.category--faq', '.category__title', '.category--faq + .category--faq .category__title',
      '.faq', '.faq__question',
    ],
  },
  {
    name: 'contact', path: '/contact/', selectors: [
      '.page-header', '.page-header__title', '.content-main', '.contact-extra-info', '.contact-extra-info > .grid__item',
      '.contact-extra-info > .grid__item + .grid__item', '.contact-extra-info .box__inner', '.location__name', '.box__title',
    ],
  },
  {
    name: 'aanmelden', path: '/aanmelden/', selectors: [
      '.page-header', '.page-header__pretitle', '.page-header__title', '.content-main', '.page-introduction', '.page-introduction h2',
      '.page-introduction .btn',
    ],
  },
  {
    name: 'reisleiders', path: '/reisleider/', selectors: [
      '.page-header', '.page-header__title', '.content-main', '.page-introduction', '.archive--guide .grid__item',
      '.post-teaser--guide .post-teaser__thumb', '.post-teaser--guide .post-teaser__title',
    ],
  },
];

/**
 * Bekende verschillen (`pagina@breedte selector eigenschap`), met de reden:
 * - pagina@375: de huidige site deelt de tekst in twee blokken en zet alleen om het eerste 15 px marge; de import
 *   maakt er één blok van, dat net als het laatste blok live geen marge heeft.
 * - contact: naam en adres komen uit Beheer > Organisatie; zonder adres is de box lager en staat de rest hoger, en de
 *   breedte van de naam hangt af van de gespelde naam.
 */
const KNOWN_DIFFERENCES = new Set([
  'pagina@375 .page-content__text h2 x', 'pagina@375 .page-content__text h2 w', 'pagina@375 .page-content__text h2 h', 'pagina@375 .page-content__text h2 y',
  'contact@1440 .location__name w', 'contact@375 .location__name w',
  'contact@375 .contact-extra-info > .grid__item + .grid__item y', 'contact@375 .box__title y',
]);

/**
 * Meet de onderdelen van één pagina in de browser.
 * @param {object} browser Playwright-browser.
 * @param {string} url Volledig adres.
 * @param {number} width Breedte van het venster.
 * @param {string[]} selectors Selectors.
 * @returns {Promise<Record<string, (object|null)>>} Meting per selector (null als het onderdeel ontbreekt).
 */
async function measurePage(browser, url, width, selectors) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
    await page.waitForTimeout(1000);
    return await page.evaluate((list) => {
      const header = document.querySelector('.page-header');
      const top = header ? header.getBoundingClientRect().top + window.scrollY : 0;
      const result = {};
      for (const selector of list) {
        const all = document.querySelectorAll(selector);
        const element = all[0];
        const rect = element ? element.getBoundingClientRect() : null;
        if (!rect || (!rect.width && !rect.height)) {
          result[selector] = null;
          continue;
        }
        const style = getComputedStyle(element);
        result[selector] = {
          count: all.length,
          x: Math.round(rect.left),
          y: Math.round(rect.top + window.scrollY - top),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
        };
      }
      result['@scrollWidth'] = { w: document.documentElement.scrollWidth };
      return result;
    }, selectors);
  } finally {
    await page.close();
  }
}

/**
 * Meet alle pagina's op één site.
 * @param {string} baseUrl Basisadres zonder slash aan het eind.
 * @param {object[]} [pages] Pagina's (standaard `LAYOUT_PAGES`).
 * @returns {Promise<Record<string, object>>} Meting per `pagina@breedte`.
 */
async function measureSite(baseUrl, pages = LAYOUT_PAGES) {
  // Playwright is geen dependency van de app; het staat in de ontwikkelomgeving (cloud-sandbox, CI met browser).
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  try {
    const measurements = {};
    for (const page of pages) {
      for (const width of WIDTHS) {
        measurements[`${page.name}@${width}`] = await measurePage(browser, `${baseUrl.replace(/\/$/, '')}${page.path}`, width, page.selectors);
      }
    }
    return measurements;
  } finally {
    await browser.close();
  }
}

/**
 * Vergelijkt twee metingen. Positie x en breedte altijd, y tot 900 px onder de kop, hoogte tot 120 px, lettergrootte
 * en -gewicht exact;
 * horizontaal scrollen mag nooit.
 * @param {Record<string, object>} reference Meting van de huidige site.
 * @param {Record<string, object>} actual Meting van de nieuwe site.
 * @param {{tolerance?: number, known?: Set<string>}} [options] Toegestaan verschil en bekende verschillen.
 * @returns {string[]} De verschillen, leesbaar (leeg = gelijk).
 */
function compareMeasurements(reference, actual, options = {}) {
  const tolerance = options.tolerance ?? TOLERANCE;
  const known = options.known || KNOWN_DIFFERENCES;
  const differences = [];
  for (const [pageKey, expectedPage] of Object.entries(reference)) {
    const actualPage = actual[pageKey];
    if (!actualPage) {
      differences.push(`${pageKey}: niet gemeten`);
      continue;
    }
    const width = Number(pageKey.split('@')[1]);
    const scrollWidth = actualPage['@scrollWidth'];
    if (scrollWidth && width && scrollWidth.w > width) differences.push(`${pageKey}: horizontaal scrollen (${scrollWidth.w} px breed)`);
    for (const [selector, expected] of Object.entries(expectedPage)) {
      if (selector.startsWith('@')) continue;
      const found = actualPage[selector];
      /**
       * Voegt een verschil toe, behalve als het bekend is.
       * @param {string} property Eigenschap.
       * @param {string} text Omschrijving.
       */
      const report = (property, text) => {
        if (!known.has(`${pageKey} ${selector} ${property}`)) differences.push(`${pageKey} ${selector}: ${text}`);
      };
      if (!expected && !found) continue;
      if (!expected || !found) {
        report('aanwezig', expected ? 'ontbreekt op de nieuwe site' : 'staat alleen op de nieuwe site');
        continue;
      }
      for (const property of ['x', 'y', 'w', 'h']) {
        if (property === 'h' && expected.h > MAX_COMPARED_HEIGHT) continue;
        if (property === 'y' && expected.y > MAX_COMPARED_Y) continue;
        if (Math.abs(expected[property] - found[property]) > tolerance) report(property, `${property} ${expected[property]} → ${found[property]}`);
      }
      for (const property of ['fontSize', 'fontWeight']) {
        if (expected[property] !== found[property]) report(property, `${property} ${expected[property]} → ${found[property]}`);
      }
    }
  }
  return differences;
}

/**
 * Leest de opdrachtregel.
 * @param {string[]} argv Argumenten.
 * @returns {{live?: string, nieuw?: string, opslaan?: string, referentie: string}} Opties.
 */
function readOptions(argv) {
  const options = { referentie: REFERENCE_FILE };
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].replace(/^--/, '');
    if (['live', 'nieuw', 'opslaan', 'referentie'].includes(name)) options[name] = argv[++i];
  }
  return options;
}

/**
 * Meet en vergelijkt volgens de opdrachtregel; geeft exitcode 1 bij verschillen.
 * @returns {Promise<void>}
 */
async function main() {
  const options = readOptions(process.argv.slice(2));
  const reference = options.live ? await measureSite(options.live) : JSON.parse(fs.readFileSync(options.referentie, 'utf8'));
  if (options.opslaan) {
    fs.writeFileSync(options.opslaan, `${JSON.stringify(reference, null, 1)}\n`);
    console.log(`Meting opgeslagen in ${options.opslaan}`);
  }
  if (!options.nieuw) return;
  const differences = compareMeasurements(reference, await measureSite(options.nieuw));
  for (const line of differences) console.log(line);
  console.log(differences.length ? `${differences.length} verschillen` : 'Geen verschillen.');
  if (differences.length) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Meting mislukt: ${error.message}`);
    process.exit(2);
  });
}

module.exports = { LAYOUT_PAGES, WIDTHS, TOLERANCE, REFERENCE_FILE, KNOWN_DIFFERENCES, measurePage, measureSite, compareMeasurements };
