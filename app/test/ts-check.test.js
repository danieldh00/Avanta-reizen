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
  const missing = scripts.filter((file) => !startsWithTsCheck(fs.readFileSync(path.join(APP_DIR, file), 'utf8')));
  assert.deepEqual(missing, [], 'zet // @ts-check bovenaan deze bestanden en los de meldingen van npm run typecheck op');
});

test('geen bestand zet de typecontrole uit met @ts-nocheck', () => {
  const offenders = CHECKED_DIRS.flatMap(listScripts).filter((file) => fs.readFileSync(path.join(APP_DIR, file), 'utf8').includes('@ts-nocheck'));
  assert.deepEqual(offenders, []);
});
