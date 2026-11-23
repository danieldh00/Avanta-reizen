/**
 * Bewaakt de harde regel uit `CLAUDE.md`: in de bestanden van deze repository staat geen verwijzing naar een ander
 * project. De test loopt alle bestanden in git na en faalt met bestand en regelnummer bij een verboden naam.
 * De namen staan hier in stukken, zodat dit bestand zelf geen verwijzing bevat.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
/** Verboden projectnamen, in stukken geschreven; hoofdletters, spaties en streepjes ertussen tellen niet. */
const FORBIDDEN_NAMES = [['aqua', 'tech']];
const PATTERNS = FORBIDDEN_NAMES.map((parts) => new RegExp(parts.join('[\\s_-]?'), 'i'));
/**
 * Bekende oude vindplaatsen per bestand. `app/CHANGELOG.md` mag een PR niet wijzigen (controle
 * `version-must-increase`); de vier oude regels daarin wachten op een besluit over hoe ze worden gecorrigeerd.
 * Meer treffers dan dit aantal laat de test falen, zodat er geen nieuwe bij kan komen; na de correctie gaat het naar 0.
 */
const KNOWN_OLD_HITS = { 'app/CHANGELOG.md': 4 };
/** Bestanden zonder tekst (afbeeldingen, fonts) worden overgeslagen. */
const BINARY_FILE = /\.(png|jpe?g|webp|gif|ico|woff2?|ttf|otf|pdf|xlsx|zip)$/i;

/**
 * Zoekt de verboden namen in alle tekstbestanden die in git staan.
 * @returns {string[]} Vindplaatsen als `pad:regel`.
 */
function findReferences() {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
  const hits = [];
  for (const file of files) {
    if (BINARY_FILE.test(file)) continue;
    if (PATTERNS.some((pattern) => pattern.test(file))) hits.push(file);
    let text;
    try {
      text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    } catch {
      continue;
    }
    const fileHits = [];
    text.split('\n').forEach((line, index) => {
      if (PATTERNS.some((pattern) => pattern.test(line))) fileHits.push(`${file}:${index + 1}`);
    });
    if (fileHits.length > (KNOWN_OLD_HITS[file] || 0)) hits.push(...fileHits);
  }
  return hits;
}

test('geen verwijzing naar een ander project in de bestanden', () => {
  assert.deepEqual(findReferences(), []);
});
