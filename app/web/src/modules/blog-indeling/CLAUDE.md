# Module Categorieën en tags van het blog in de frontend (`app/web/src/modules/blog-indeling/`)

Hoort bij `app/src/cms/` (`post-terms.js`, `post-term-routes.js`, `post-term-api.js`). Basispad
`/app/blog/categorieen-en-tags/`, recht `content`. Fase V3 van de ombouw (`docs/VUE-OMBOUW.md`). De naam van de bundel
is `blog-indeling`: de blogberichten (`/app/blog/`) gaan later als eigen bundel over.

## Bestanden
- `main.ts`: ingang; start de module op het koppelpunt (`mountModule`).
- `routes.ts`: `/` en `/<id>/`, gelijk aan de oude adressen.
- `term-api.ts`: getypte functies op `/app/api/blog-indeling/…` (`createTermApi`, `termApi`) en de vaste meldingen
  (`NOTICES`, `?melding=<sleutel>`).
- `term-overview-screen.vue`: per soort (categorieën, tags) de lijst met adres, aantal berichten en volgorde, en een
  formulier om er een toe te voegen.
- `term-edit-screen.vue`: naam, adres (een nieuw adres verwijst door), inleiding en volgorde; verwijderen na bevestigen.
- `term-screens.spec.ts`: tests van de schermen met een nagebootste API.

## Regels
- De server blijft de maatstaf: controle en meldingen per veld komen van `post-term-api.js`.
- Een scherm zet zijn titel met `setPageTitle` (`shell/page-title.ts`); de server zet dezelfde titel bij het laden.
