# Frontend van het CRM (`app/web/`)

Alleen wat voor deze map geldt; de algemene regels staan in de root-`CLAUDE.md` en gaan bij tegenspraak voor. Opbouw,
besluiten en werkwijze van de ombouw: `docs/VUE-OMBOUW.md`. Wie in deze map een bestand toevoegt of de rol van een
bestand verandert, werkt dit bestand bij in dezelfde PR.

## Wat het is
Vue 3 (`<script setup>`, Composition API) + TypeScript, gebouwd met Vite. Eigen `package.json` (vaste versies), los van
de server in `app/`. Eén ingang per omgebouwde module: elke map `src/modules/<module>/` met een `main.ts` wordt een
eigen bundel. De uitvoer (`dist/`, met manifest in `dist/.vite/manifest.json`) wordt bij het bouwen van het image
gemaakt (Dockerfile, stap `web`) en staat niet in git. Alles wordt geserveerd onder `/bundel/`; niets van een CDN.

## Bestanden
- `package.json`, `package-lock.json`: afhankelijkheden (vast op een versie; Renovate werkt ze bij).
- `vite.config.ts`: bouwen (`moduleEntries`: ingangen uit `src/modules/*/main.ts`, `PUBLIC_BASE` = `/bundel/`) en de
  tests (Vitest, jsdom, dekkingsdrempel 95/85/93 zoals de server).
- `tsconfig.json`: strikte typecontrole met `vue-tsc`.
- `eslint.config.js`: ESLint met TypeScript en Vue; `v-html`, `innerHTML`/`outerHTML`, `document.write` en `eval`
  verboden; dezelfde leesbaarheidsregels als de server.
- `src/shell/`: koppeling met de schil van de server. `mount.ts` (`mountModule`: zoekt het koppelpunt `#crm-app` met
  `data-module` en `data-base`, maakt app en router in history-modus onder het pad van de module, focus naar
  `#inhoud` na elke navigatie), `module-root.vue` (standaard buitenste component), `not-found-screen.vue` (onbekend
  pad binnen een module).
- `src/components/`: bouwstenen (vanaf V1.4). `rich-text-clean.d.ts` geeft de typen van de opschoner van de
  teksteditor (`app/public/js/rich-text-clean.js`, gedeeld met de server); `rich-text-clean.spec.ts` bewijst dat die
  in de frontend te importeren is.
- `src/api/`: getypte client voor `/app/api/` (vanaf V1.2).
- `src/modules/<module>/`: ingang (`main.ts`), schermen (`routes.ts`) en schermen per module, zelfde naam als
  `app/src/<module>/`, met een eigen `CLAUDE.md`.

## Regels
- Bestandsnamen in kebab-case, ook componenten (`bouwstenen-screen.vue`).
- Elk bestand een kopcommentaar en elke functie een `/** … */`-blok in het Nederlands; de typen staan in TypeScript,
  niet meer in `@param`.
- Tests heten `*.spec.ts` en staan naast het bestand dat ze testen (de testrunner van de server zoekt `*.test.js`).
- Geen losse `fetch` in schermen (vanaf V1.2 via `src/api/`), niets met persoonsgegevens in `localStorage` of
  `sessionStorage`, geen inline stijlen of scripts (CSP).
- Opmaak uit de bestaande klassen van `app/public/css/crm.css` en de `--av-*`-variabelen; het ontwerp verandert niet.

## Commando's (in `app/web/`)
```sh
npm ci                  # afhankelijkheden
npm run lint            # ESLint
npm run typecheck       # vue-tsc
npm test                # Vitest
npm run test:coverage   # Vitest met dekkingsdrempel (zoals CI)
npm run build           # bundels en manifest in dist/
npm run dev             # opnieuw bouwen bij elke wijziging (de app op poort 3400 serveert dist/)
```
