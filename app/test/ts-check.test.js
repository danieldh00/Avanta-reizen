// @ts-check
/**
 * Bewaakt de typecontrole (B08): elk JavaScript-bestand onder `src/` en `tools/` begint met `// @ts-check` (na een
 * eventuele shebang), zodat `npm run typecheck` het op zijn JSDoc controleert. Een nieuw bestand zonder die regel
 * laat deze test falen. `@ts-nocheck` is nergens toegestaan.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP_DIR = path.join(__dirname, '..');
/** Mappen waarvan de bestanden gecontroleerd worden (zie `include` in `tsconfig.json`). */
const CHECKED_DIRS = ['src', 'tools'];

/**
 * Tijdelijk nog zonder `@ts-check`: bestanden die tegelijk in een ander lopend pakket (W28) veranderen, en de
 * bestanden die op hun typen leunen. Ze krijgen de regel in de tweede PR van B08; daarna is deze lijst leeg.
 */
const PENDING = new Set([
  'src/beheer/go-live-check.js',
  'src/booking/crm-routes.js',
  'src/booking/routes.js',
  'src/cms/block-editor.js',
  'src/cms/index.js',
  'src/cms/page-routes.js',
  'src/cms/post-routes.js',
  'src/contact/routes.js',
  'src/crm/audit-log.js',
  'src/crm/audit-routes.js',
  'src/crm/layout.js',
  'src/crm/users.js',
  'src/media/library.js',
  'src/payments/payment-overview-routes.js',
  'src/payments/payment-reminders.js',
  'src/server.js',
  'src/services.js',
  'src/site/content.js',
  'src/site/routes.js',
  'src/site/site-content.js',
  'src/trips/categories.js',
  'src/trips/category-routes.js',
  'src/trips/guide-routes.js',
  'src/trips/guides.js',
  'src/trips/index.js',
  'src/trips/trip-routes.js',
  'tools/design-check/changed-screens.js',
  'tools/import-wordpress.js',
]);

/**
 * Alle .js-bestanden onder een map, als pad ten opzichte van `app/`.
 * @param {string} dir Map ten opzichte van `app/`.
 * @returns {string[]} Paden met `/` als scheidingsteken.
 */
function listScripts(dir) {
  return fs.readdirSync(path.join(APP_DIR, dir), { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.js'))
    .map((name) => path.posix.join(dir, name.split(path.sep).join('/')))
    .sort();
}

/**
 * Of een bestand met `// @ts-check` begint (na een eventuele shebang).
 * @param {string} text Inhoud van het bestand.
 * @returns {boolean} Waar als de eerste coderegel `// @ts-check` is.
 */
function startsWithTsCheck(text) {
  const lines = text.split('\n');
  const first = lines[0].startsWith('#!') ? lines[1] : lines[0];
  return (first || '').trim() === '// @ts-check';
}

test('elk bestand in src/ en tools/ begint met // @ts-check', () => {
  const scripts = CHECKED_DIRS.flatMap(listScripts);
  assert.ok(scripts.length > 100, 'er zijn bestanden gevonden');
  const missing = scripts.filter((file) => !PENDING.has(file) && !startsWithTsCheck(fs.readFileSync(path.join(APP_DIR, file), 'utf8')));
  assert.deepEqual(missing, [], 'zet // @ts-check bovenaan deze bestanden en los de meldingen van npm run typecheck op');
});

test('geen bestand zet de typecontrole uit met @ts-nocheck', () => {
  const offenders = CHECKED_DIRS.flatMap(listScripts).filter((file) => fs.readFileSync(path.join(APP_DIR, file), 'utf8').includes('@ts-nocheck'));
  assert.deepEqual(offenders, []);
});

test('de lijst met tijdelijke uitzonderingen bevat alleen bestaande bestanden zonder @ts-check', () => {
  for (const file of PENDING) {
    const full = path.join(APP_DIR, file);
    assert.ok(fs.existsSync(full), `${file} bestaat niet meer; haal hem uit PENDING`);
    assert.ok(!startsWithTsCheck(fs.readFileSync(full, 'utf8')), `${file} heeft al // @ts-check; haal hem uit PENDING`);
  }
});
