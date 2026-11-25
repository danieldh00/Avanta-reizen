/**
 * Tests van de controle op de gebouwde bundels (`tools/check-bundle.js`).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkBundle } from './check-bundle.js';

let dir = '';

/**
 * Maakt een uitvoermap met de gegeven bestanden.
 * @param files Inhoud per pad.
 * @returns De map.
 */
function distWith(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), 'bundel-'));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('controle van de bundel', () => {
  it('keurt een nette uitvoer goed', () => {
    expect(checkBundle(distWith({ '.vite/manifest.json': '{}', 'assets/faq-abc.js': 'export const x = 1;', 'assets/faq-abc.css': 'a{}' }))).toEqual([]);
  });

  it('meldt eval, new Function en tekst in setTimeout', () => {
    const problems = checkBundle(distWith({
      '.vite/manifest.json': '{}',
      'assets/a.js': 'eval("1")',
      'assets/b.js': 'const f = new Function("return 1")',
      'assets/c.js': 'setTimeout("alert(1)", 10)',
    }));
    expect(problems).toEqual(['assets/a.js: eval()', 'assets/b.js: new Function()', 'assets/c.js: setTimeout/setInterval met tekst']);
  });

  it('meldt HTML, andere bestanden en een ontbrekend manifest', () => {
    const problems = checkBundle(distWith({ 'index.html': '<script>x</script>', 'assets/logo.svg': '<svg/>' }));
    expect(problems).toContain('manifest ontbreekt (.vite/manifest.json)');
    expect(problems).toContain('index.html: onverwacht bestand in de uitvoer');
    expect(problems).toContain('assets/logo.svg: onverwacht bestand in de uitvoer');
  });
});
