# Module Reistypes en landen in de frontend (`app/web/src/modules/reistypes/`)

Hoort bij `app/src/trips/` (`categories.js`, `category-routes.js`, `category-api.js`). Basispad
`/app/reistypes-en-landen/`, recht `reizen`. Fase V3 van de ombouw (`docs/VUE-OMBOUW.md`).

## Bestanden
- `main.ts`: ingang; start de module op het koppelpunt (`mountModule`).
- `routes.ts`: `/` en `/<id>/`, gelijk aan de oude adressen.
- `category-api.ts`: getypte functies op `/app/api/reistypes-en-landen/…` (`createCategoryApi`, `categoryApi`) en de
  vaste meldingen (`NOTICES`). In de zoekvraag van de fotokiezer staat een punt als `%2E` (`checkPath` weigert `..`).
- `category-form.ts`: de velden van het formulier (`CategoryForm`) en het omzetten van en naar de API.
- `category-fields.vue`: de velden (naam, slug, soort, icoon, inleiding, tekst met teksteditor, volgorde, homepage),
  gedeeld door overzicht en bewerkscherm.
- `category-icon.vue`: icoon van een reistype als SVG uit de vormen van de server (`ICONS` in `site/icons.js`), zonder
  `v-html`.
- `category-overview-screen.vue`: tabbladen per soort met het aantal, zoeken op naam, slug of landcode (soort en
  zoekterm in het adres), de lijst met kolommen per soort, nieuw aanmaken.
- `category-item-screen.vue`: velden opslaan, verwijderen alleen als er niets aan hangt, gebruik, samenvoegen na
  bevestigen (opent de categorie die blijft), foto kiezen of weghalen (bij een land standaard de foto's van dat land,
  met een vinkje voor alle landen).
- `category-screens.spec.ts`: tests van de schermen met een nagebootste API.

## Regels
- De server blijft de maatstaf: controle, opschoning (`sanitizeHtml`) en de meldingen per veld komen van `category-api.js`.
- De lijst komt in één keer (alle landen van de wereld, ruim 250 regels); filteren en zoeken gebeurt in het scherm.
