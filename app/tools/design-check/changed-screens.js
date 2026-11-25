// @ts-check
/**
 * Design-controle in CI: bepaalt welke schermen een PR raakt, zodat `check.js --paths=…` alleen die schermen opent en
 * CI licht blijft. Invoer is de lijst gewijzigde bestanden (één per regel, paden vanaf de root van de repository);
 * uitvoer is één regel met de paden voor `--paths`, of een lege regel als de PR geen scherm raakt.
 *
 * Gebruik:
 *   git diff --name-only origin/main... | node app/tools/design-check/changed-screens.js
 *
 * Een pad dat op `*` eindigt laat `check.js` onder dat pad links volgen (maximaal twee per soort scherm). De koppeling
 * staat in `SCREEN_RULES`: een nieuwe module met eigen schermen krijgt daar een regel. Bestanden zonder scherm
 * (database, beveiliging, mail, export, tests, docs) leveren niets op.
 */
const fs = require('node:fs');

/** Kernschermen van de publieke site: voor wijzigingen aan de gedeelde opmaak (kop, voet, huisstijl). */
const SITE_CORE = ['/', '/reis/*', '/contact/', '/faq/', '/zoeken/?s=noorwegen', '/aanmelden/', '/account/inloggen/'];

/** Kernschermen van het CRM en Beheer: voor wijzigingen aan de gedeelde opmaak en bouwstenen. */
const CRM_CORE = ['/app/inloggen/', '/app/', '/app/aanmeldingen/', '/app/deelnemers/', '/app/reizen/', '/app/betalingen/', '/app/beheer/'];

/** Een klein vast setje om te controleren dat de design-controle zelf nog werkt. */
const SMOKE = ['/', '/app/'];

/** Het overzicht van de bouwstenen in Vue (Beheer > Systeem > Bouwstenen): elke bouwsteen met een voorbeeld. */
const BOUWSTENEN = ['/app/beheer/bouwstenen/'];

/** Een bestand van een module in de frontend: `app/web/src/modules/<module>/…`. */
const WEB_MODULE = /^app\/web\/src\/modules\/([a-z0-9-]+)\//;

/**
 * Koppeling van gewijzigde bestanden aan schermen. Elke regel die past telt mee (een bestand kan dus meerdere regels
 * raken); paden zijn vanaf de root van de repository.
 */
const SCREEN_RULES = [
  // Gedeelde opmaak en scripts.
  { pattern: /^app\/public\/(css\/site\.css|js\/|fonts\/|images\/)/, screens: SITE_CORE },
  { pattern: /^app\/src\/site\/(layout|icons|html|format)\.js$/, screens: SITE_CORE },
  { pattern: /^app\/public\/css\/crm\.css$/, screens: CRM_CORE },
  { pattern: /^app\/src\/crm\/(layout|ui)\.js$/, screens: CRM_CORE },
  // Publieke site.
  { pattern: /^app\/src\/site\/(home-view|homepage)\.js$/, screens: ['/'] },
  { pattern: /^app\/src\/site\/trip-view\.js$/, screens: ['/reis/*', '/reisleider/*'] },
  { pattern: /^app\/src\/site\/page-view\.js$/, screens: ['/faq/', '/contact/', '/blog/*'] },
  { pattern: /^app\/src\/site\//, screens: ['/'] },
  { pattern: /^app\/src\/contact\/(fields|routes)\.js$/, screens: ['/contact/'] },
  { pattern: /^app\/src\/contact\/(index|message|messages)/, screens: ['/app/berichten/*'] },
  // Aanmelden en reizigersaccount.
  { pattern: /^app\/src\/booking\/(fields|routes|views|form|save-booking)/, screens: ['/aanmelden/'] },
  { pattern: /^app\/src\/booking\/(crm-|manual-)/, screens: ['/app/aanmeldingen/*'] },
  { pattern: /^app\/src\/account\//, screens: ['/account/inloggen/', '/account/registreren/', '/account/wachtwoord-vergeten/', '/account/', '/account/gegevens/'] },
  // CRM.
  { pattern: /^app\/src\/crm\/dashboard\.js$/, screens: ['/app/'] },
  { pattern: /^app\/src\/crm\/(login-routes|passwords)\.js$/, screens: ['/app/inloggen/'] },
  { pattern: /^app\/src\/crm\/(users|rights)\.js$/, screens: ['/app/gebruikers/*', '/app/auditlog/'] },
  { pattern: /^app\/src\/crm\/two-factor\.js$/, screens: ['/app/tweestaps/'] },
  { pattern: /^app\/src\/crm\/search(-routes)?\.js$/, screens: ['/app/zoeken/?q=test'] },
  { pattern: /^app\/src\/crm\/whats-new(-routes)?\.js$/, screens: ['/app/wat-is-er-nieuw/'] },
  { pattern: /^app\/src\/crm\/audit-(log|routes)\.js$/, screens: ['/app/auditlog/', '/app/auditlog/?actie=inloggen'] },
  { pattern: /^app\/src\/persons\//, screens: ['/app/deelnemers/*', '/app/deelnemerslijsten/'] },
  { pattern: /^app\/src\/payments\//, screens: ['/app/betalingen/*'] },
  { pattern: /^app\/src\/infobrief\//, screens: ['/app/infobrieven/*'] },
  { pattern: /^app\/src\/trips\//, screens: ['/app/reizen/*', '/app/reisleiders/*', '/app/reistypes-en-landen/*', '/reis/*'] },
  { pattern: /^app\/src\/cms\//, screens: ['/app/paginas/*', '/app/blog/*', '/app/faq/*', '/app/lijstpaginas/*', '/app/menus/', '/'] },
  { pattern: /^app\/src\/media\//, screens: ['/app/fotobibliotheek/*'] },
  { pattern: /^app\/src\/(beheer|system|backup)\//, screens: ['/app/beheer/*'] },
  // Frontend in Vue (`app/web/`): het fundament en de bouwstenen raken elk scherm in Vue (het overzicht van de
  // bouwstenen) en de schil; een module raakt dezelfde schermen als haar map in `app/src/` (zie `serverPathOf`).
  { pattern: /^app\/web\/src\/(components|shell|api)\//, screens: [...BOUWSTENEN, '/app/'] },
  { pattern: /^app\/web\/(package(-lock)?\.json|vite\.config\.ts|tsconfig\.json)$/, screens: [...BOUWSTENEN, ...SMOKE] },
  { pattern: /^app\/web\/src\/modules\/beheer\//, screens: BOUWSTENEN },
  // De FAQ in Vue (fase V2) staat in `app/src/cms/`, maar raakt alleen de schermen van de FAQ.
  { pattern: /^app\/web\/src\/modules\/faq\//, screens: ['/app/faq/*'] },
  // Fase V3: categorieën en tags van het blog en de menu's (ook `app/src/cms/`), elk alleen de eigen schermen.
  { pattern: /^app\/web\/src\/modules\/blog-indeling\//, screens: ['/app/blog/categorieen-en-tags/*'] },
  { pattern: /^app\/web\/src\/modules\/menus\//, screens: ['/app/menus/*'] },
  { pattern: /^app\/src\/crm\/web-bundle\.js$/, screens: BOUWSTENEN },
  { pattern: /^app\/src\/beheer\/bouwstenen-routes\.js$/, screens: BOUWSTENEN },
  // De controle zelf en de CI-opzet: alleen nagaan dat het nog draait.
  { pattern: /^app\/tools\/design-check\//, screens: SMOKE },
  { pattern: /^\.github\/workflows\/ci\.yml$/, screens: SMOKE },
];

/**
 * Een bestand van een module in de frontend telt als een bestand van dezelfde module op de server: een wijziging in
 * `app/web/src/modules/trips/…` raakt dezelfde schermen als `app/src/trips/`. Testbestanden (`*.spec.ts`) raken geen
 * scherm.
 * @param {string} file Gewijzigd bestand.
 * @returns {string} Het overeenkomstige pad op de server, of leeg.
 */
function serverPathOf(file) {
  const match = WEB_MODULE.exec(file);
  if (!match || /\.spec\.ts$/.test(file)) return '';
  return `app/src/${match[1]}/index.js`;
}

/**
 * Zet de gewijzigde bestanden om naar de paden voor `check.js --paths`. Een exact pad dat al onder een pad met `*`
 * valt, vervalt (dat scherm komt al mee).
 * @param {string[]} files Gewijzigde bestanden, paden vanaf de root van de repository.
 * @returns {string[]} Paden in vaste volgorde (eerst de publieke site, dan account, dan CRM), zonder dubbelen.
 */
function screensFor(files) {
  const screens = new Set();
  // Documentatie (zoals de CLAUDE.md per map) verandert geen scherm, ook niet als die in een map met schermen staat.
  for (const file of files.map((entry) => entry.trim()).filter((entry) => entry && !/\.md$/i.test(entry))) {
    // Een module in de frontend zonder eigen regel telt als dezelfde module op de server (`serverPathOf`).
    let rules = SCREEN_RULES.filter((rule) => rule.pattern.test(file));
    if (!rules.length && serverPathOf(file)) rules = SCREEN_RULES.filter((rule) => rule.pattern.test(serverPathOf(file)));
    for (const rule of rules) rule.screens.forEach((screen) => screens.add(screen));
  }
  const prefixes = [...screens].filter((screen) => screen.endsWith('*')).map((screen) => screen.slice(0, -1));
  // Het overzicht van de bouwstenen blijft altijd staan: het volgen van links onder `/app/beheer/*` komt er niet vanzelf.
  const kept = [...screens].filter((screen) => screen.endsWith('*') || BOUWSTENEN.includes(screen) || !prefixes.some((prefix) => screen.startsWith(prefix)));
  /**
   * Volgorde: publieke site, reizigersaccount, CRM; binnen een groep alfabetisch.
   * @param {string} screen Pad.
   * @returns {string} Sorteersleutel.
   */
  const order = (screen) => `${screen.startsWith('/app/') ? 2 : screen.startsWith('/account/') ? 1 : 0}${screen}`;
  return kept.sort((first, second) => order(first).localeCompare(order(second)));
}

if (require.main === module) {
  const files = fs.readFileSync(0, 'utf8').split('\n');
  process.stdout.write(`${screensFor(files).join(',')}\n`);
}

module.exports = { screensFor, serverPathOf, SCREEN_RULES, SITE_CORE, CRM_CORE, SMOKE, BOUWSTENEN };
