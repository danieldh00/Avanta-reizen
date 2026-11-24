/**
 * Design-controle met Playwright: opent schermen van de publieke site, het reizigersaccount, het CRM en Beheer op
 * 1440 en 375 px, meet uitlijning, overlap, overloop en afkappen (`page-checks.js`) en schrijft de bevindingen naar
 * `results.json` met een uitsnede (screenshot) per bevinding.
 *
 * Twee standen:
 * - volledig (`--full`): alle URL's uit de sitemap, de vaste schermen van account en formulieren, en alles wat onder
 *   `/app/` bereikbaar is via links (GET, maximaal twee per soort scherm). Voor de eenmalige volledige run.
 * - gericht (`--paths=/reis/,/app/beheer/`): alleen de genoemde paden (en bij een pad dat op `*` eindigt alle URL's die
 *   ermee beginnen). Bedoeld voor de lichte run die alleen gewijzigde schermen controleert.
 *
 * Gebruik (app draait lokaal met testgegevens uit `seed.js`):
 *   DESIGN_BASE_URL=http://localhost:3400 node tools/design-check/check.js --full --out=/tmp/design
 * Exitcode 1 als er bevindingen zijn met ernst "hoog" (overloop, overlap, afgekapt, afbeelding), zodat een CI-stap kan
 * falen; met `--no-fail` altijd 0.
 */
const fs = require('node:fs');
const path = require('node:path');
const { runPageChecks } = require('./page-checks');
const { login } = require('./login');
const { accounts } = require('./credentials');
const { assertLocalBaseUrl } = require('./guards');

const BASE_URL = (process.env.DESIGN_BASE_URL || 'http://localhost:3400').replace(/\/$/, '');
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, mobile: false },
  { name: 'mobiel', width: 375, height: 812, mobile: true },
];
/** Ernst per soort controle: hoog = zichtbaar kapot, midden = scheef of rommelig, laag = toegankelijkheid/verfijning. */
const SEVERITY = { ingekort: 'midden', overloop: 'hoog', overlap: 'hoog', afgekapt: 'hoog', afbeelding: 'hoog', knophoogte: 'midden', uitlijning: 'midden', rand: 'midden', 'kleine-tekst': 'laag', klikdoel: 'laag' };
/** Links onder /app/ die de controle nooit opent: uitloggen en downloads. */
const SKIP_LINK = /\/uitloggen\/|\.xlsx|\/download\/|\/export\/|\/media\/|\/voorbeeld\/.*\.(jpg|webp)$/;
/** Gelijktijdige pagina's per context. */
const PARALLEL = 4;

/**
 * Leest de opdrachtregel.
 * @param {string[]} argv Argumenten.
 * @returns {{full: boolean, paths: string[], out: string, fail: boolean}} Opties.
 */
function parseArguments(argv) {
  const value = (name) => (argv.find((argument) => argument.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=');
  return {
    full: argv.includes('--full'),
    paths: value('paths') ? value('paths').split(',').map((entry) => entry.trim()).filter(Boolean) : [],
    out: value('out') || path.join(process.cwd(), 'design-check-output'),
    fail: !argv.includes('--no-fail'),
  };
}

/**
 * Het soort scherm van een URL: numerieke id's en slugs worden vervangen, zodat gelijke schermen samen tellen.
 * @param {string} url Pad met eventuele query.
 * @returns {string} Soort, bijv. `/reis/:slug/` of `/app/aanmeldingen/:id/`.
 */
function screenType(url) {
  const { pathname, searchParams } = new URL(url, BASE_URL);
  let type = pathname.replace(/\/\d+(?=\/|$)/g, '/:id');
  type = type.replace(/^\/(reis|reisleider|reis-categorie|tag|category)\/[^/]+\/$/, '/$1/:slug/');
  if (!type.startsWith('/app/') && !type.startsWith('/account/') && /^\/[^/]+\/$/.test(type) && !['/reis/', '/reisleider/', '/blog/', '/faq/', '/contact/', '/zoeken/'].includes(type)) type = '/:pagina-of-blog/';
  if (!type.startsWith('/app/') && /^\/[^/]+\/[^/]+\/.*$/.test(type) && !/^\/(reis|reisleider|reis-categorie|tag|category|account|aanmelden)\//.test(type)) type = '/:pagina/:subpagina/';
  const keys = [...searchParams.keys()].sort();
  return keys.length ? `${type}?${keys.join('&')}` : type;
}

/**
 * De onderdelen van de applicatie, met hun vaste startschermen.
 * @returns {Array<{area: string, login: (string|null), start: string[]}>} Onderdelen.
 */
function areas() {
  return [
    { area: 'Publieke site', login: null, start: ['/', '/zoeken/?s=noorwegen', '/aanmelden/', '/bedankt-voor-je-aanmelding/', '/deze-pagina-bestaat-niet/'] },
    { area: 'Reizigersaccount', login: null, start: ['/account/inloggen/', '/account/registreren/', '/account/wachtwoord-vergeten/'] },
    { area: 'Reizigersaccount (ingelogd)', login: 'customer', start: ['/account/', '/account/gegevens/', '/account/code/'] },
    { area: 'CRM inloggen', login: null, start: ['/app/inloggen/'] },
    { area: 'CRM en Beheer', login: 'crm', start: ['/app/'] },
  ];
}

/** Schermen van het reizigersaccount die alleen ingelogd te zien zijn. */
const CUSTOMER_ONLY = /^\/account\/($|gegevens\/|code\/|wachtwoord\/$)/;

/**
 * Bij welk onderdeel een pad hoort (voor de gerichte run).
 * @param {string} entry Pad, eventueel eindigend op `*`.
 * @returns {string} Naam van het onderdeel uit `areas()`.
 */
function areaOf(entry) {
  if (entry.startsWith('/app/inloggen/')) return 'CRM inloggen';
  if (entry.startsWith('/app/')) return 'CRM en Beheer';
  if (CUSTOMER_ONLY.test(entry)) return 'Reizigersaccount (ingelogd)';
  if (entry.startsWith('/account/')) return 'Reizigersaccount';
  return 'Publieke site';
}

/**
 * Maakt een browsercontext die alleen de app zelf laadt: verzoeken naar andere sites (video's van YouTube, kaarten,
 * analytics) worden afgebroken, zodat een trage of geblokkeerde externe dienst de controle niet ophoudt.
 * @param {object} browser Playwright-browser.
 * @param {object} [options] Extra contextopties (bijv. `deviceScaleFactor`, `storageState`).
 * @returns {Promise<object>} Context.
 */
async function newLocalContext(browser, options = {}) {
  const context = await browser.newContext(options);
  const origin = new URL(BASE_URL).origin;
  await context.route('**/*', (route) => (route.request().url().startsWith(origin) || route.request().url().startsWith('data:') ? route.continue() : route.abort()));
  return context;
}

/**
 * Alle URL's uit de sitemap, omgezet naar het lokale basisadres.
 * @returns {Promise<string[]>} Paden.
 */
async function sitemapPaths() {
  const response = await fetch(`${BASE_URL}/sitemap.xml`);
  const xml = await response.text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]).pathname);
}

/**
 * Een aanmeldformulier voor een bestaande reis (het formulier zonder reis is een ander scherm).
 * @param {object} context Playwright-context.
 * @returns {Promise<string[]>} Pad naar het formulier van de eerste reis met een knop Aanmelden.
 */
async function bookingFormPath(context) {
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/reis/`);
  const href = await page.locator('a[href*="/reis/"]').nth(1).getAttribute('href').catch(() => null);
  let result = [];
  if (href) {
    await page.goto(new URL(href, BASE_URL).toString());
    const booking = await page.locator('a[href*="/aanmelden/"]').first().getAttribute('href').catch(() => null);
    if (booking) result = [new URL(booking, BASE_URL).pathname + new URL(booking, BASE_URL).search];
  }
  await page.close();
  return result;
}

/**
 * Controleert één URL op alle vensterbreedtes.
 * @param {object} context Playwright-context.
 * @param {string} url Pad.
 * @returns {Promise<{url: string, status: number, findings: object[], links: string[], consoleErrors: string[]}>} Uitslag.
 */
async function checkUrl(context, url) {
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const consoleErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 200)); });
  page.on('pageerror', (error) => consoleErrors.push(String(error.message).slice(0, 200)));
  const findings = [];
  let status = 0;
  let links = [];
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const response = await page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
    status = response ? response.status() : 0;
    await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
    await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
    // Lui ladende afbeeldingen laden: één keer naar beneden scrollen en terug.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((resolve) => { setTimeout(resolve, 30); }); }
      window.scrollTo(0, 0);
    }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const pageFindings = await page.evaluate(runPageChecks, { mobile: viewport.mobile }).catch((error) => [{ check: 'fout', message: String(error.message), selector: '', rect: null }]);
    for (const finding of pageFindings) findings.push({ ...finding, viewport: viewport.name, width: viewport.width });
    if (viewport === VIEWPORTS[0]) {
      links = await page.$$eval('a[href]', (anchors) => anchors.map((anchor) => anchor.getAttribute('href'))).catch(() => []);
    }
  }
  await page.close();
  return { url, status, findings, links, consoleErrors: [...new Set(consoleErrors)] };
}

/**
 * Maakt uitsneden van alle bevindingen op één pagina en venster: de pagina wordt één keer geladen, per bevinding wordt
 * het element rood omlijnd en daaromheen een uitsnede gemaakt.
 * @param {object} context Playwright-context met `deviceScaleFactor: 2` (scherpe uitsneden), ingelogd zoals het onderdeel.
 * @param {string} url Pad van de pagina.
 * @param {string} viewportName Naam van het venster (`desktop` of `mobiel`).
 * @param {Array<{group: object, file: string}>} shots Bevindingen met het doelbestand (.png).
 * @returns {Promise<void>} Zet bij een gelukte uitsnede `group.screenshot`.
 */
async function screenshotFindings(context, url, viewportName, shots) {
  const viewport = VIEWPORTS.find((entry) => entry.name === viewportName);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  try {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const size = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
    for (const { group, file } of shots) {
      const rect = group.rect;
      await page.evaluate((box) => {
        document.querySelectorAll('[data-design-marker]').forEach((marker) => marker.remove());
        const marker = document.createElement('div');
        marker.setAttribute('data-design-marker', '');
        marker.style.cssText = `position:absolute;left:${box.x - 3}px;top:${box.y - 3}px;width:${box.width + 6}px;height:${box.height + 6}px;outline:3px solid #e00;z-index:2147483647;pointer-events:none;`;
        document.body.appendChild(marker);
      }, rect).catch(() => {});
      // Ruime uitsnede (240 px rondom) zodat de omgeving zichtbaar is; bij overloop de volle breedte.
      const padding = 240;
      const x = group.check === 'overloop' ? 0 : Math.max(0, Math.min(rect.x - padding, size.width - 1));
      const y = Math.max(0, Math.min(rect.y - padding, size.height - 1));
      const clip = {
        x,
        y,
        width: group.check === 'overloop' ? Math.min(size.width, 1600) : Math.min(rect.width + padding * 2, size.width - x),
        height: Math.min(rect.height + padding * 2, 1400, size.height - y),
      };
      if (clip.width < 1 || clip.height < 1) continue;
      const done = await page.screenshot({ path: file, clip, animations: 'disabled', timeout: 15000 }).then(() => true, () => false);
      if (done) group.screenshot = `screenshots/${path.basename(file)}`;
    }
  } catch {
    // Pagina laadt niet meer: geen uitsneden, de bevinding blijft wel in de lijst.
  } finally {
    await page.close();
  }
}

/**
 * Voert taken uit met een maximum aan gelijktijdige taken.
 * @param {Array} items Invoer.
 * @param {number} limit Maximaal gelijktijdig.
 * @param {Function} worker Asynchrone functie per item.
 * @returns {Promise<Array>} Uitkomsten in dezelfde volgorde.
 */
async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const run = async () => { while (next < items.length) { const index = next++; results[index] = await worker(items[index], index); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

/**
 * Controleert één onderdeel: startschermen, sitemap (publieke site, volledige run) en links onder `/app/` (CRM).
 * @param {object} browser Playwright-browser.
 * @param {object} area Onderdeel uit `areas()`.
 * @param {{full: boolean, paths: string[]}} options Opties.
 * @returns {Promise<{area: string, context: object, pages: object[]}>} Uitslagen per pagina, met de context voor uitsneden.
 */
async function checkArea(browser, area, options) {
  const context = await newLocalContext(browser);
  const loginResult = area.login ? await login(context, area.login, BASE_URL) : null;
  let queue;
  if (options.full) {
    queue = [...area.start];
    if (area.area === 'Publieke site') queue.push(...await sitemapPaths(), ...await bookingFormPath(context));
  } else {
    queue = options.paths.filter((entry) => areaOf(entry) === area.area);
  }
  const seen = new Set();
  const perType = new Map();
  const pages = [];
  const crawl = area.login === 'crm' && (options.full || options.paths.some((entry) => entry.endsWith('*')));
  /**
   * Zet een pad in de wachtrij als het nieuw is en zijn soort scherm nog geen twee keer is gezien.
   * @param {string} url Pad.
   * @returns {void}
   */
  const enqueue = (url) => {
    if (seen.has(url)) return;
    const type = screenType(url);
    if ((perType.get(type) || 0) >= 2 && area.area !== 'Publieke site') return;
    seen.add(url);
    perType.set(type, (perType.get(type) || 0) + 1);
    pending.push(url);
  };
  const pending = [];
  queue.map((entry) => entry.replace(/\*$/, '')).forEach(enqueue);
  while (pending.length) {
    const batch = pending.splice(0, pending.length);
    const results = await pool(batch, PARALLEL, (url) => checkUrl(context, url));
    for (const result of results) {
      pages.push({ ...result, area: area.area, type: screenType(result.url) });
      process.stdout.write(`${area.area} ${result.status} ${result.url} (${result.findings.length})\n`);
      if (!crawl) continue;
      for (const href of result.links) {
        if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/.test(href)) continue;
        const target = new URL(href, `${BASE_URL}${result.url}`);
        if (target.origin !== new URL(BASE_URL).origin || !target.pathname.startsWith('/app/') || SKIP_LINK.test(target.pathname)) continue;
        if (!options.full && !options.paths.some((entry) => entry.endsWith('*') && target.pathname.startsWith(entry.slice(0, -1)))) continue;
        enqueue(target.pathname + target.search);
      }
    }
  }
  return { area: area.area, context, pages, loginResult };
}

/**
 * Voegt dezelfde bevinding op verschillende pagina's samen (zelfde onderdeel, soort, selector en venster).
 * @param {object[]} pages Uitslagen per pagina.
 * @returns {object[]} Samengevoegde bevindingen, ernstigste en meest voorkomende eerst.
 */
function groupFindings(pages) {
  const groups = new Map();
  for (const page of pages) {
    for (const finding of page.findings) {
      const key = [page.area, finding.check, finding.selector, finding.viewport].join('|');
      if (!groups.has(key)) {
        groups.set(key, { area: page.area, check: finding.check, severity: SEVERITY[finding.check] || 'midden', selector: finding.selector, viewport: finding.viewport, message: finding.message, example: page.url, type: page.type, rect: finding.rect, urls: new Set(), types: new Set() });
      }
      groups.get(key).urls.add(page.url);
      groups.get(key).types.add(page.type);
    }
  }
  const order = { hoog: 0, midden: 1, laag: 2 };
  return [...groups.values()]
    .map((group) => ({ ...group, count: group.urls.size, urls: [...group.urls].slice(0, 20), types: [...group.types] }))
    .sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count);
}

/**
 * Voert de controle uit en schrijft `results.json` en de uitsneden.
 * @returns {Promise<void>}
 */
async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.full && !options.paths.length) throw new Error('Geef --full of --paths=/pad/,/ander-pad/ mee.');
  // Vóór de eerste login: alleen tegen een lokale app, en het wachtwoord moet er al zijn (seed.js maakt het aan).
  assertLocalBaseUrl(BASE_URL);
  accounts();
  const shotsDir = path.join(options.out, 'screenshots');
  fs.mkdirSync(shotsDir, { recursive: true });
  // Playwright is geen dependency van de app; het staat in de ontwikkelomgeving (cloud-sandbox, CI met browser).
  // eslint-disable-next-line global-require
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const areaResults = [];
  try {
    for (const area of areas()) areaResults.push(await checkArea(browser, area, options));
    const pages = areaResults.flatMap((result) => result.pages);
    const groups = groupFindings(pages);
    // Uitsneden: niet voor ernst "laag" (kleine tekst, klikdoelen), per pagina en venster in één keer.
    const shotContexts = new Map();
    const byPage = new Map();
    let shotIndex = 0;
    for (const group of groups) {
      if (!group.rect || group.severity === 'laag') continue;
      const key = [group.area, group.example, group.viewport].join('|');
      if (!byPage.has(key)) byPage.set(key, []);
      const file = `${String(++shotIndex).padStart(3, '0')}-${group.check}-${group.viewport}.png`;
      group.shotFile = file;
      byPage.get(key).push({ group, file: path.join(shotsDir, file) });
    }
    for (const [key, shots] of byPage) {
      const [areaName, url, viewportName] = key.split('|');
      if (!shotContexts.has(areaName)) {
        const source = areaResults.find((result) => result.area === areaName).context;
        shotContexts.set(areaName, await newLocalContext(browser, { deviceScaleFactor: 2, storageState: await source.storageState() }));
      }
      await screenshotFindings(shotContexts.get(areaName), url, viewportName, shots);
    }
    const summary = {
      baseUrl: BASE_URL,
      date: new Date().toISOString(),
      mode: options.full ? 'volledig' : 'gericht',
      pages: pages.map(({ url, status, area, type, consoleErrors, findings }) => ({ url, status, area, type, consoleErrors, findings: findings.length })),
      findings: groups,
      // Werkt een inlogformulier niet in de browser, dan staat dat hier (de controle logde dan via een los verzoek in).
      logins: areaResults.filter((result) => result.loginResult).map((result) => ({ area: result.area, ...result.loginResult })),
    };
    fs.writeFileSync(path.join(options.out, 'results.json'), JSON.stringify(summary, null, 2));
    const high = groups.filter((group) => group.severity === 'hoog').length;
    console.log(`${pages.length} pagina's, ${groups.length} bevindingen (${high} hoog). Uitslag: ${path.join(options.out, 'results.json')}`);
    if (options.fail && high > 0) process.exitCode = 1;
    for (const context of shotContexts.values()) await context.close();
  } finally {
    for (const result of areaResults) await result.context.close();
    await browser.close();
  }
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 2; });

module.exports = { screenType, areaOf, groupFindings };
