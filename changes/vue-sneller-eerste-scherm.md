---
titel: Nieuwe schermen openen sneller
---

## Nieuws
- De nieuwe schermen (veelgestelde vragen, categorieën en tags, menu's, reistypes en landen, lijstpagina's) openen
  even snel als de oude: de gegevens komen meteen met de pagina mee, zonder extra wachten.

## Changelog
- Ombouw naar Vue: de GET-route van een scherm zet de antwoorden van de eerste GET-verzoeken in het koppelpunt
  (`data-voorgeladen`, `renderMountPoint` met `preload`); per module één leesfunctie voor API en pagina
  (`createFaqReads`, `createPostTermReads`, `createMenuReads`, `createCategoryReads`, `createListHeaderReads`). De
  client (`web/src/api/preload.ts`) gebruikt elk antwoord één keer en laat de rest vallen na de eerste wissel. Lokaal
  met 60 ms vertraging: van ~150 naar ~100 ms tot de inhoud er staat (oud scherm ~95 ms).
- Tests: `checkPreload` in `test/helpers/api-app.js` vergelijkt het voorgeladen antwoord met de API; escaping van het
  attribuut in `web-bundle.test.js`.
