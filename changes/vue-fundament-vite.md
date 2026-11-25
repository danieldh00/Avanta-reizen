---
titel: Fundament voor de nieuwe schermen van het CRM (Vue)
---

## Changelog
- Nieuw project `app/web/` voor de frontend van het CRM: Vue 3 + TypeScript, gebouwd met Vite, met een eigen bundel
  per module (`src/modules/<module>/main.ts`) en een manifest. `mountModule` start een module op het koppelpunt van de
  schil, met vue-router in history-modus onder het pad van de module (adressen blijven gelijk).
- Het image krijgt de bouwstap `web`; alleen de uitvoer (`web/dist/`) gaat het image in. Nog geen scherm gebruikt
  de bundel.
- CI controleert de frontend: ESLint met TypeScript en Vue (`v-html`, `innerHTML` en `eval` verboden), `vue-tsc`,
  Vitest met een dekkingsdrempel, een proefbouw en `npm audit`.
- Proef: de opschoner van de teksteditor (`public/js/rich-text-clean.js`) is in de frontend te importeren.
