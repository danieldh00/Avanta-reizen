/**
 * Bouwinstellingen van de frontend (Vite) en de tests (Vitest).
 *
 * - Eén ingang per omgebouwde module: elk bestand `src/modules/<module>/main.ts` wordt een eigen bundel. Er is geen
 *   grote app; de server laadt per pagina alleen de bundel van die module (`docs/VUE-OMBOUW.md`, *Opbouw*).
 * - Uitvoer in `dist/` met een manifest (`dist/.vite/manifest.json`): daarin zoekt de server de bestandsnamen met hash
 *   op. De map wordt bij het bouwen van het image gemaakt en staat niet in git.
 * - Alles wordt geserveerd onder `/bundel/` van de eigen server; niets van een CDN.
 * - De CSP blijft `script-src 'self'` en `style-src 'self'`: de sjablonen worden vooraf gecompileerd (de runtime van Vue
 *   zonder compiler, dus geen `eval`), de opmaak van componenten komt in losse CSS-bestanden en er komt geen inline
 *   script in een pagina (geen polyfill voor modulepreload).
 */
import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

/** Map van dit project (`app/web/`). */
const WEB_DIR = fileURLToPath(new URL('.', import.meta.url));

/** Publiek pad waaronder de server de bundels aanbiedt (`app/src/web-bundle.js`). */
export const PUBLIC_BASE = '/bundel/';

/**
 * Zoekt de ingangen: elke map in `src/modules/` met een `main.ts` is een module met een eigen bundel.
 * @param modulesDir Map met de modules.
 * @returns Ingang per modulenaam, bijvoorbeeld `{ faq: '/…/src/modules/faq/main.ts' }`.
 */
export function moduleEntries(modulesDir: string): Record<string, string> {
  const entries: Record<string, string> = {};
  if (!existsSync(modulesDir)) return entries;
  for (const entry of readdirSync(modulesDir, { withFileTypes: true })) {
    const main = resolve(modulesDir, entry.name, 'main.ts');
    if (entry.isDirectory() && existsSync(main)) entries[entry.name] = main;
  }
  return entries;
}

export default defineConfig({
  base: PUBLIC_BASE,
  plugins: [vue()],
  define: {
    // Alleen de Composition API; geen devtools en geen uitgebreide meldingen in de productiebundel.
    __VUE_OPTIONS_API__: 'false',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
  },
  build: {
    outDir: resolve(WEB_DIR, 'dist'),
    emptyOutDir: true,
    manifest: true,
    // Een polyfill voor modulepreload zou een inline script vragen; alle ondersteunde browsers kunnen het zelf.
    modulePreload: { polyfill: false },
    target: 'es2022',
    rolldownOptions: {
      input: moduleEntries(resolve(WEB_DIR, 'src/modules')),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.ts'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,vue}'],
      exclude: ['src/**/*.spec.ts', 'src/**/main.ts', 'src/**/*.d.ts'],
      // Zelfde drempel als de server (regels, takken, functies); verhoog hem als de dekking duurzaam hoger ligt,
      // verlaag hem nooit stil.
      thresholds: { lines: 95, branches: 85, functions: 93 },
    },
  },
});
