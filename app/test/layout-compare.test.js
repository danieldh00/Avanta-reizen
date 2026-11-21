/**
 * Vergelijkende DOM-meting van het ontwerp (CMS-pakket E): de vergelijking zelf altijd, en de meting van een draaiende
 * nieuwe site tegen de opgeslagen meting van de huidige site (`test/fixtures/layout-live.json`, 1440 en 375 px) als
 * `LAYOUT_BASE_URL` is gezet (bijvoorbeeld http://localhost:3400) en Playwright met Chromium beschikbaar is.
 * Een nieuwe referentie: `node tools/layout-compare.js --live https://www.avantareizen.nl --opslaan test/fixtures/layout-live.json`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { LAYOUT_PAGES, WIDTHS, REFERENCE_FILE, compareMeasurements, measureSite } = require('../tools/layout-compare');

/**
 * Een gemeten onderdeel.
 * @param {object} [extra] Afwijkingen.
 * @returns {object} Meting.
 */
function box(extra = {}) {
  return { count: 1, x: 80, y: 100, w: 1280, h: 40, fontSize: '34px', fontWeight: '700', ...extra };
}

test('vergelijking: kleine afrondingen mogen, echte verschillen worden gemeld', () => {
  const reference = { 'blog@1440': { '.titel': box(), '.blok': box({ h: 600, y: 2000 }), '.weg': box(), '.leeg': null } };
  assert.deepEqual(compareMeasurements(reference, { 'blog@1440': { '.titel': box({ x: 82, h: 43 }), '.blok': box({ h: 900, y: 2400 }), '.weg': box(), '.leeg': null } }), [], 'binnen 3 px; hoge blokken en diepe posities hangen af van de tekst');
  const differences = compareMeasurements(reference, {
    'blog@1440': { '.titel': box({ w: 1200, fontSize: '28px' }), '.blok': box({ x: 60 }), '.leeg': box(), '@scrollWidth': { w: 1460 } },
  });
  assert.deepEqual(differences, [
    'blog@1440: horizontaal scrollen (1460 px breed)',
    'blog@1440 .titel: w 1280 → 1200',
    'blog@1440 .titel: fontSize 34px → 28px',
    'blog@1440 .blok: x 80 → 60',
    'blog@1440 .weg: ontbreekt op de nieuwe site',
    'blog@1440 .leeg: staat alleen op de nieuwe site',
  ]);
  assert.deepEqual(compareMeasurements(reference, {}), ['blog@1440: niet gemeten']);
  assert.deepEqual(compareMeasurements({ 'blog@1440': { '.titel': box() } }, { 'blog@1440': { '.titel': box({ w: 1 }) } }, { known: new Set(['blog@1440 .titel w']) }), [], 'bekend verschil');
});

test('opgeslagen meting van de huidige site dekt alle pagina\'s op 1440 en 375 px', () => {
  const reference = JSON.parse(fs.readFileSync(REFERENCE_FILE, 'utf8'));
  for (const page of LAYOUT_PAGES) {
    for (const width of WIDTHS) {
      const measured = reference[`${page.name}@${width}`];
      assert.ok(measured, `${page.name}@${width}`);
      assert.ok(measured['.page-header'], `${page.name}@${width}: kop gemeten`);
      assert.ok(measured['@scrollWidth'].w <= width, `${page.name}@${width}: live zonder horizontaal scrollen`);
    }
  }
});

test('nieuwe site gelijk aan de huidige site (DOM-meting op 1440 en 375 px)', { skip: !process.env.LAYOUT_BASE_URL && 'LAYOUT_BASE_URL niet gezet', timeout: 600000 }, async () => {
  const reference = JSON.parse(fs.readFileSync(REFERENCE_FILE, 'utf8'));
  const differences = compareMeasurements(reference, await measureSite(process.env.LAYOUT_BASE_URL));
  assert.deepEqual(differences, []);
});
