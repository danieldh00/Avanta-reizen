/**
 * Tests voor de design-controle (`tools/design-check/`): het indelen van URL's in soorten schermen en onderdelen, het
 * samenvoegen van bevindingen over pagina's en het Excel-rapport altijd; de metingen in de browser (`page-checks.js`)
 * alleen als Playwright met Chromium beschikbaar is (het is geen dependency van de app).
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { screenType, areaOf, groupFindings } = require('../tools/design-check/check');
const { buildSheets } = require('../tools/design-check/report');
const { runPageChecks } = require('../tools/design-check/page-checks');
const { assertLocalDatabase, assertLocalBaseUrl } = require('../tools/design-check/guards');
const { accounts, designPassword } = require('../tools/design-check/credentials');
const { screensFor, SITE_CORE, CRM_CORE, SMOKE } = require('../tools/design-check/changed-screens');
const { summaryMarkdown, cell, MAX_ROWS } = require('../tools/design-check/ci-summary');

/** Omgevingsvariabelen die de seed-controle lezen; per test leeg begonnen en daarna teruggezet. */
const SEED_ENV = ['NODE_ENV', 'DESIGN_SEED_TOEGESTAAN', 'PGHOST', 'PGHOSTADDR'];

/**
 * Wist de omgevingsvariabelen van de seed-controle voor deze test en zet ze na afloop terug, zodat een CI-omgeving
 * met bijvoorbeeld `DESIGN_SEED_TOEGESTAAN=1` de uitkomst niet verandert.
 * @param {object} t Testcontext.
 * @returns {void}
 */
function isolateSeedEnv(t) {
  const saved = Object.fromEntries(SEED_ENV.map((key) => [key, process.env[key]]));
  for (const key of SEED_ENV) delete process.env[key];
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

/**
 * Laadt Playwright als het beschikbaar is.
 * @returns {(object|null)} De module of null.
 */
function loadPlaywright() {
  try {
    // eslint-disable-next-line global-require
    return require('playwright');
  } catch {
    return null;
  }
}

test('soort scherm: id\'s en slugs tellen als één soort', () => {
  assert.equal(screenType('/app/aanmeldingen/12/'), '/app/aanmeldingen/:id/');
  assert.equal(screenType('/app/betalingen/7/bedragen/3/weg/'), '/app/betalingen/:id/bedragen/:id/weg/');
  assert.equal(screenType('/reis/ijsland-2027/'), '/reis/:slug/');
  assert.equal(screenType('/reisleider/23250/'), '/reisleider/:slug/');
  assert.equal(screenType('/contact/'), '/contact/');
  assert.equal(screenType('/algemene-voorwaarden/'), '/:pagina-of-blog/');
  assert.equal(screenType('/avanta-reizen/voorpret/inpaktips/'), '/:pagina/:subpagina/');
  assert.equal(screenType('/zoeken/?s=noorwegen'), '/zoeken/?s');
});

test('onderdeel van een pad (gerichte run)', () => {
  assert.equal(areaOf('/app/inloggen/'), 'CRM inloggen');
  assert.equal(areaOf('/app/beheer/*'), 'CRM en Beheer');
  assert.equal(areaOf('/account/'), 'Reizigersaccount (ingelogd)');
  assert.equal(areaOf('/account/gegevens/'), 'Reizigersaccount (ingelogd)');
  assert.equal(areaOf('/account/inloggen/'), 'Reizigersaccount');
  assert.equal(areaOf('/reis/'), 'Publieke site');
});

test('bevindingen: dezelfde fout op meerdere pagina\'s wordt één regel, ernstigste eerst', () => {
  const finding = (check, selector) => ({ check, selector, viewport: 'desktop', message: 'x', rect: { x: 0, y: 0, width: 10, height: 10 } });
  const pages = [
    { url: '/reis/a/', area: 'Publieke site', type: '/reis/:slug/', findings: [finding('klikdoel', 'a.klein'), finding('overlap', 'p.prijs')] },
    { url: '/reis/b/', area: 'Publieke site', type: '/reis/:slug/', findings: [finding('overlap', 'p.prijs')] },
  ];
  const groups = groupFindings(pages);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].check, 'overlap');
  assert.equal(groups[0].severity, 'hoog');
  assert.equal(groups[0].count, 2);
  assert.deepEqual(groups[0].urls, ['/reis/a/', '/reis/b/']);
  assert.equal(groups[1].severity, 'laag');

  const sheets = buildSheets({ findings: groups, pages: [{ area: 'Publieke site', url: '/reis/a/', type: '/reis/:slug/', status: 200, findings: 2, consoleErrors: [] }], logins: [{ area: 'CRM en Beheer', viaForm: false, formStatus: 403 }] });
  assert.deepEqual(sheets.map((sheet) => sheet.name), ['Bevindingen', "Gecontroleerde pagina's", 'Inloggen']);
  assert.equal(sheets[0].rows[1][0], 'A01');
  assert.equal(sheets[0].rows.length, 3);
  assert.deepEqual(sheets[2].rows[1], ['CRM en Beheer', 'NEE', 403]);
});

test('gewijzigde schermen (CI): bestanden zonder scherm leveren niets op', () => {
  assert.deepEqual(screensFor([]), []);
  assert.deepEqual(screensFor(['README.md', 'docs/WERKWIJZE.md', 'changes/iets.md', 'app/src/database/migrations/029-x.js', 'app/test/units.test.js', 'app/src/security/vault.js', '']), []);
  // Documentatie in een map met schermen start de zware job niet.
  assert.deepEqual(screensFor(['app/src/site/CLAUDE.md', 'app/src/payments/CLAUDE.md', 'app/tools/design-check/README.md']), []);
});

test('gewijzigde schermen (CI): module en gedeelde opmaak naar hun schermen', () => {
  assert.deepEqual(screensFor(['app/src/payments/payments.js']), ['/app/betalingen/*']);
  assert.deepEqual(screensFor(['app/src/booking/crm-routes.js']), ['/app/aanmeldingen/*']);
  assert.deepEqual(screensFor(['app/src/booking/manual-routes.js']), ['/app/aanmeldingen/*']);
  assert.deepEqual(screensFor(['app/src/crm/search-routes.js']), ['/app/zoeken/?q=test']);
  assert.deepEqual(screensFor(['app/src/booking/save-booking.js']), ['/aanmelden/']);
  assert.deepEqual(screensFor(['app/src/booking/fields.js']), ['/aanmelden/']);
  assert.deepEqual(screensFor(['app/src/contact/routes.js']), ['/contact/']);
  assert.deepEqual(screensFor(['app/src/contact/message-routes.js']), ['/app/berichten/*']);
  // Gedeelde opmaak: de kernschermen van dat deel, niets van het andere deel.
  assert.deepEqual(new Set(screensFor(['app/public/css/crm.css'])), new Set(CRM_CORE));
  assert.ok(screensFor(['app/public/css/site.css']).every((screen) => !screen.startsWith('/app/')));
  assert.deepEqual(new Set(screensFor(['app/public/css/site.css'])), new Set(SITE_CORE));
  // De controle zelf of de CI-opzet: alleen een rooktest.
  assert.deepEqual(new Set(screensFor(['app/tools/design-check/page-checks.js'])), new Set(SMOKE));
  assert.deepEqual(new Set(screensFor(['.github/workflows/ci.yml'])), new Set(SMOKE));
});

test('gewijzigde schermen (CI): samengevoegd, zonder dubbelen, exact pad onder een * vervalt, vaste volgorde', () => {
  const screens = screensFor(['app/src/trips/trips.js', 'app/public/css/crm.css', 'app/src/trips/guides.js']);
  assert.equal(new Set(screens).size, screens.length, 'geen dubbelen');
  assert.ok(screens.includes('/app/reizen/*'));
  assert.ok(!screens.includes('/app/reizen/'), '/app/reizen/ komt al mee met /app/reizen/*');
  assert.ok(screens.includes('/app/aanmeldingen/'), 'kernscherm zonder * blijft');
  const firstCrm = screens.findIndex((screen) => screen.startsWith('/app/'));
  assert.ok(screens.slice(firstCrm).every((screen) => screen.startsWith('/app/')), 'eerst de site, dan het CRM');
  assert.ok(screens.every((screen) => /^\/[a-z0-9/?=*_-]*$/.test(screen)), 'alleen veilige tekens in de paden');
  // Elk pad hoort bij een onderdeel dat check.js kent.
  for (const screen of screens) assert.ok(areaOf(screen));
});

test('samenvatting design-controle (CI): aantallen, ernstigste eerst, ingekort en veilig voor een tabel', () => {
  assert.match(summaryMarkdown({ pages: [{}, {}], findings: [] }), /2 pagina's gecontroleerd.*Geen bevindingen/s);
  const findings = [
    { severity: 'laag', check: 'klikdoel', viewport: 'mobiel', example: '/a/', message: 'klein' },
    { severity: 'hoog', check: 'overloop', viewport: 'mobiel', example: '/b/', message: 'breder | dan <scherm>\nregel' },
  ];
  const markdown = summaryMarkdown({ pages: [{}], findings });
  assert.match(markdown, /1 hoog, 0 midden, 1 laag/);
  assert.ok(markdown.indexOf('overloop') < markdown.indexOf('klikdoel'), 'hoog eerst');
  assert.equal(cell('a | b\nc <x>'), 'a   b c x');
  assert.ok(!/<scherm>/.test(markdown) && !/breder \| dan/.test(markdown), 'geen | of html in een cel');
  const many = summaryMarkdown({ pages: [], findings: Array.from({ length: MAX_ROWS + 5 }, () => findings[0]) });
  assert.match(many, /En nog 5 bevindingen/);
});

test('testgegevens alleen in een lokale test- of ontwerpdatabase', (t) => {
  isolateSeedEnv(t);
  assert.doesNotThrow(() => assertLocalDatabase('postgres://avanta:x@localhost:5432/avanta_design'));
  assert.doesNotThrow(() => assertLocalDatabase('postgres://avanta:x@127.0.0.1/avanta_test'));
  assert.throws(() => assertLocalDatabase('postgres://avanta:x@db.example.nl/avanta_design'), /alleen tegen een lokale database/);
  assert.throws(() => assertLocalDatabase('postgres://avanta:x@localhost/avanta_design?host=db.example.nl'), /db\.example\.nl/);
  assert.throws(() => assertLocalDatabase('postgres://avanta:x@localhost/avanta?hostaddr=10.0.0.5'), /10\.0\.0\.5/);
  assert.throws(() => assertLocalDatabase('postgres://avanta:x@localhost/avanta'), /test- of ontwerpdatabase/);
  assert.throws(() => assertLocalDatabase(''), /DATABASE_URL ontbreekt/);
  assert.throws(() => assertLocalDatabase('postgres://avanta:x@localhost/avanta_latest'), /test- of ontwerpdatabase/, 'alleen als los deel van de naam');
  assert.doesNotThrow(() => assertLocalDatabase('postgres://avanta:x@localhost/avanta-test'));
});

test('testgegevens alleen via een lokale app', (t) => {
  isolateSeedEnv(t);
  assert.doesNotThrow(() => assertLocalBaseUrl('http://localhost:3400'));
  assert.doesNotThrow(() => assertLocalBaseUrl('http://127.0.0.1:3400/'));
  assert.throws(() => assertLocalBaseUrl('https://www.avantareizen.nl'), /alleen tegen een lokale app/);
  assert.throws(() => assertLocalBaseUrl('geen adres'), /DESIGN_BASE_URL is ongeldig/);
});

test('testgegevens: zonder host in het adres tellen PGHOST en PGHOSTADDR mee', (t) => {
  isolateSeedEnv(t);
  assert.doesNotThrow(() => assertLocalDatabase('postgres:///avanta_design'), 'geen host: standaard lokaal');
  process.env.PGHOST = 'db.example.nl';
  assert.throws(() => assertLocalDatabase('postgres:///avanta_design'), /db\.example\.nl/);
  process.env.PGHOST = '/var/run/postgresql';
  assert.doesNotThrow(() => assertLocalDatabase('postgres:///avanta_design'), 'Unix-socket is lokaal');
  process.env.PGHOSTADDR = '10.0.0.5';
  assert.throws(() => assertLocalDatabase('postgres:///avanta_design'), /10\.0\.0\.5/);
});

test('testgegevens: productie weigert altijd, de vlag staat een wegwerpcontainer toe', (t) => {
  isolateSeedEnv(t);
  process.env.DESIGN_SEED_TOEGESTAAN = '1';
  assert.doesNotThrow(() => assertLocalDatabase('postgres://avanta:x@postgres/avanta'), 'vlag: andere host en naam toegestaan');
  assert.throws(() => assertLocalDatabase('niet-een-url'), /DATABASE_URL ontbreekt/, 'ook met de vlag een geldige URL');
  process.env.NODE_ENV = 'production';
  assert.throws(() => assertLocalDatabase('postgres://avanta:x@localhost/avanta_design'), /NODE_ENV=production/, 'productie weigert, ook met de vlag');
});

test('testaccounts: wachtwoord uit DESIGN_WACHTWOORD, met de minimale lengte van het CRM', (t) => {
  const saved = process.env.DESIGN_WACHTWOORD;
  t.after(() => {
    if (saved === undefined) delete process.env.DESIGN_WACHTWOORD;
    else process.env.DESIGN_WACHTWOORD = saved;
  });
  process.env.DESIGN_WACHTWOORD = 'lokaal-wachtwoord-van-test';
  const { ADMIN, CUSTOMER } = accounts();
  assert.equal(ADMIN.password, 'lokaal-wachtwoord-van-test');
  assert.equal(CUSTOMER.password, 'lokaal-wachtwoord-van-test');
  process.env.DESIGN_WACHTWOORD = 'te-kort';
  assert.throws(() => designPassword(), /minimaal 12 tekens/);
});

test('check.js en overview.js weigeren een niet-lokale app vóór de eerste login', () => {
  const env = { ...process.env, DESIGN_BASE_URL: 'https://www.voorbeeld.nl', DESIGN_WACHTWOORD: 'lokaal-wachtwoord-van-test' };
  delete env.DESIGN_SEED_TOEGESTAAN;
  for (const [script, args] of [['check.js', ['--full']], ['overview.js', ['--results=/bestaat-niet.json']]]) {
    const run = spawnSync(process.execPath, [path.join(__dirname, '../tools/design-check', script), ...args], { env, encoding: 'utf8' });
    assert.notEqual(run.status, 0, `${script} stopt`);
    assert.match(run.stderr, /alleen tegen een lokale app/, `${script} noemt de reden`);
  }
});

const playwright = loadPlaywright();
test('metingen in de browser: overlap, knophoogte, scheve rand en overloop', { skip: !playwright && 'Playwright niet beschikbaar' }, async (t) => {
  const browser = await playwright.chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 375, height: 800 } });
  await page.setContent(`<!doctype html><body style="margin:0;font:16px sans-serif">
    <div style="padding:20px"><p id="een" style="margin:0">Eerste regel tekst</p><p id="twee" style="margin:-14px 0 0">Tweede regel tekst</p></div>
    <form style="display:flex;gap:8px;padding:20px"><input id="veld" style="height:40px"><button id="knop" style="height:28px">Zoeken</button></form>
    <div style="padding:20px"><div style="margin-left:0">Blok een</div><div style="margin-left:4px">Blok twee</div><div>Blok drie</div></div>
    <div style="width:500px;padding-left:20px">Te breed</div>
  </body>`);
  const findings = await page.evaluate(runPageChecks, { mobile: true });
  const checks = new Set(findings.map((finding) => finding.check));
  for (const expected of ['overlap', 'knophoogte', 'uitlijning', 'overloop']) assert.ok(checks.has(expected), `${expected} gevonden`);

  await page.setContent(`<!doctype html><body style="margin:0;font:16px sans-serif"><main style="padding:24px">
    <h1 style="margin:0 0 16px">Netjes</h1><p style="margin:0 0 16px">Alles staat op één lijn.</p>
    <form style="display:flex;gap:8px;align-items:stretch"><input style="height:40px;box-sizing:border-box"><button style="height:40px">Zoeken</button></form>
  </main></body>`);
  assert.deepEqual(await page.evaluate(runPageChecks, { mobile: true }), [], 'een nette pagina geeft geen bevindingen');
});

test('metingen in de browser: afgekapt telt geen schuifbalk of verborgen dia, wel tekst die eruit loopt', { skip: !playwright && 'Playwright niet beschikbaar' }, async (t) => {
  const browser = await playwright.chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 375, height: 800 } });
  // Schuifbalk met kaarten binnen het afknipvak, plus een verborgen dia die buiten het vak staat: geen melding.
  await page.setContent(`<!doctype html><body style="margin:0;font:16px sans-serif">
    <div id="vak" style="overflow:hidden;width:375px">
      <ul style="display:flex;overflow-x:auto;margin:0;padding:0;list-style:none">
        <li style="flex:0 0 300px">Kaart een</li><li style="flex:0 0 300px">Kaart twee</li>
      </ul>
      <p style="visibility:hidden;margin:0;position:relative;left:400px;white-space:nowrap">Verborgen dia</p>
    </div>
  </body>`);
  const clean = await page.evaluate(runPageChecks, { mobile: true });
  assert.ok(!clean.some((finding) => finding.check === 'afgekapt'), 'schuifbalk en verborgen dia geven geen afgekapt');
  // Tekst die zelf buiten het vak loopt: wel een melding.
  await page.setContent(`<!doctype html><body style="margin:0;font:16px sans-serif">
    <div style="overflow:hidden;width:200px"><p style="white-space:nowrap;width:max-content;margin:0">Deze tekst is veel te lang voor het vak en valt weg</p></div>
  </body>`);
  const clipped = await page.evaluate(runPageChecks, { mobile: true });
  assert.ok(clipped.some((finding) => finding.check === 'afgekapt'), 'echte afkapping blijft een melding');
});
