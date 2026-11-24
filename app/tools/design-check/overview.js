/**
 * Design-controle, overzicht: maakt van elk soort scherm uit een eerdere run (`results.json` van `check.js`) één
 * volledige schermafbeelding op 1440 en op 375 px. Bedoeld om met het oog te beoordelen of een scherm logisch en
 * overzichtelijk is (wat een DOM-meting niet ziet), en als referentiebeeld voor een latere visuele vergelijking.
 *
 * Gebruik:
 *   DESIGN_BASE_URL=http://localhost:3400 node tools/design-check/overview.js --results=/tmp/design/results.json --out=/tmp/design/overzicht
 * Hoge pagina's worden afgekapt op `MAX_HEIGHT` px (de rest staat in de uitsneden van de bevindingen).
 */
const fs = require('node:fs');
const path = require('node:path');
const { login } = require('./login');
const { accounts } = require('./credentials');
const { assertLocalBaseUrl } = require('./guards');

const BASE_URL = (process.env.DESIGN_BASE_URL || 'http://localhost:3400').replace(/\/$/, '');
const VIEWPORTS = [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobiel', width: 375, height: 812 }];
const MAX_HEIGHT = 5000;

/**
 * Leest een optie `--naam=waarde` van de opdrachtregel.
 * @param {string} name Naam.
 * @returns {string} Waarde of lege tekst.
 */
const option = (name) => (process.argv.find((argument) => argument.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=');

/**
 * Een bestandsnaam bij een soort scherm.
 * @param {string} area Onderdeel.
 * @param {string} type Soort scherm, bijv. `/app/aanmeldingen/:id/`.
 * @returns {string} Bestandsnaam zonder extensie.
 */
const fileName = (area, type) => `${area}-${type}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90);

/**
 * Logt in zoals het onderdeel vraagt (zie `login.js`).
 * @param {object} context Playwright-context.
 * @param {string} area Onderdeel uit `check.js`.
 * @returns {Promise<void>}
 */
async function loginFor(context, area) {
  if (area === 'CRM en Beheer') await login(context, 'crm', BASE_URL);
  if (area === 'Reizigersaccount (ingelogd)') await login(context, 'customer', BASE_URL);
}

/**
 * Maakt de overzichtsbeelden.
 * @returns {Promise<void>}
 */
async function main() {
  // Vóór de eerste login: alleen tegen een lokale app, en het wachtwoord moet er al zijn (seed.js maakt het aan).
  assertLocalBaseUrl(BASE_URL);
  accounts();
  // Playwright is geen dependency van de app; het staat in de ontwikkelomgeving.
  const { chromium } = require('playwright');
  const results = JSON.parse(fs.readFileSync(option('results'), 'utf8'));
  const out = option('out') || path.join(path.dirname(option('results')), 'overzicht');
  fs.mkdirSync(out, { recursive: true });
  // Eén voorbeeld per onderdeel en soort scherm (de eerste die met status 200 laadde; anders de eerste).
  const examples = new Map();
  for (const page of results.pages) {
    const key = `${page.area}|${page.type}`;
    if (!examples.has(key) || (examples.get(key).status !== 200 && page.status === 200)) examples.set(key, page);
  }
  const browser = await chromium.launch();
  const contexts = new Map();
  const index = [];
  try {
    for (const page of examples.values()) {
      if (!contexts.has(page.area)) {
        const context = await browser.newContext();
        await loginFor(context, page.area);
        contexts.set(page.area, context);
      }
      const tab = await contexts.get(page.area).newPage();
      for (const viewport of VIEWPORTS) {
        await tab.setViewportSize({ width: viewport.width, height: viewport.height });
        await tab.goto(`${BASE_URL}${page.url}`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
        await tab.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        const height = await tab.evaluate(() => document.documentElement.scrollHeight).catch(() => viewport.height);
        const file = `${fileName(page.area, page.type)}-${viewport.name}.png`;
        await tab.screenshot({ path: path.join(out, file), fullPage: height <= MAX_HEIGHT, clip: height > MAX_HEIGHT ? { x: 0, y: 0, width: viewport.width, height: MAX_HEIGHT } : undefined, animations: 'disabled', timeout: 20000 }).catch(() => {});
        index.push({ area: page.area, type: page.type, url: page.url, viewport: viewport.name, file });
      }
      await tab.close();
      process.stdout.write(`${page.area} ${page.type}\n`);
    }
    fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(index, null, 2));
  } finally {
    for (const context of contexts.values()) await context.close();
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
