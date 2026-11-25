// @ts-check
/**
 * Controle van de gebouwde bundels (`dist/`) op wat de CSP niet toelaat, na `npm run build` (CI, job `test`):
 * - geen `eval(`, `new Function(` of een tekst als argument van `setTimeout`/`setInterval` (de CSP heeft geen
 *   `unsafe-eval`; de runtime van Vue zonder compiler gebruikt dat niet);
 * - geen HTML-bestanden (de server levert de pagina's; een HTML-bestand in de uitvoer zou een inline script kunnen
 *   meebrengen);
 * - alleen JavaScript en CSS onder `assets/`, plus het manifest in `.vite/`.
 * Faalt met een lijst van de overtredingen.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Patronen die in een bundel niet mogen voorkomen. */
const FORBIDDEN = [
  { pattern: /\beval\s*\(/, reason: 'eval()' },
  { pattern: /\bnew\s+Function\s*\(/, reason: 'new Function()' },
  { pattern: /\bset(Timeout|Interval)\s*\(\s*["'`]/, reason: 'setTimeout/setInterval met tekst' },
];

/**
 * Alle bestanden onder een map, met paden ten opzichte van die map.
 * @param {string} dir Map.
 * @returns {string[]} Paden.
 */
export function listFiles(dir) {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((name) => statSync(join(dir, name)).isFile());
}

/**
 * Controleert de uitvoer.
 * @param {string} distDir Map met de uitvoer van Vite.
 * @returns {string[]} Overtredingen (leeg = in orde).
 */
export function checkBundle(distDir) {
  const problems = [];
  const files = listFiles(distDir).map((name) => name.split('\\').join('/'));
  if (!files.includes('.vite/manifest.json')) problems.push('manifest ontbreekt (.vite/manifest.json)');
  for (const file of files) {
    if (file === '.vite/manifest.json') continue;
    if (!/^assets\/[A-Za-z0-9_.-]+\.(js|css)$/.test(file)) {
      problems.push(`${file}: onverwacht bestand in de uitvoer`);
      continue;
    }
    if (!file.endsWith('.js')) continue;
    const source = readFileSync(join(distDir, file), 'utf8');
    for (const { pattern, reason } of FORBIDDEN) if (pattern.test(source)) problems.push(`${file}: ${reason}`);
  }
  return problems;
}

// Alleen bij het aanroepen vanaf de opdrachtregel; de functies hierboven zijn getest.
/* v8 ignore start */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const distDir = process.argv[2] || join(fileURLToPath(new URL('..', import.meta.url)), 'dist');
  const problems = checkBundle(distDir);
  if (problems.length) {
    console.error(`Bundel in ${relative(process.cwd(), distDir) || '.'} voldoet niet aan de CSP:\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  console.log('Bundel in orde: geen eval, geen HTML, alleen JS en CSS onder assets/.');
}
/* v8 ignore stop */
