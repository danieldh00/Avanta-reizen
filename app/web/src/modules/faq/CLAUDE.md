# Module Veelgestelde vragen in de frontend (`app/web/src/modules/faq/`)

Hoort bij `app/src/cms/` (`faqs.js`, `faq-routes.js`, `faq-api.js`). Basispad `/app/faq/`, recht `content`. De eerste
module die helemaal in Vue staat: de proef van fase V2 (`docs/VUE-OMBOUW.md`). De naam van de bundel is `faq` (niet
`cms`): de andere schermen van `cms/` hebben eigen basispaden en gaan later als eigen bundel over.

## Bestanden
- `main.ts`: ingang; start de module op het koppelpunt (`mountModule`).
- `routes.ts`: `/`, `/nieuw/`, `/<id>/` en `/categorieen/<id>/`, gelijk aan de oude adressen.
- `faq-api.ts`: getypte functies op `/app/api/faq/…` (`createFaqApi`, `faqApi`), plus `moveId` (een plaats verschuiven)
  en `readOrder` (veld Volgorde; leeg = geen volgorde).
- `notices.ts`: vaste meldingen op het overzicht na een wissel (`?melding=<sleutel>`).
- `faq-overview-screen.vue`: per categorie de vragen, omhoog/omlaag voor categorieën en vragen, losse vragen uit de
  import, categorie toevoegen.
- `faq-question-screen.vue`: vraag toevoegen (`?categorie=<id>` kiest de categorie voor) of wijzigen, met teksteditor
  en verwijderen na bevestigen.
- `faq-category-screen.vue`: naam en volgorde, verwijderen alleen als de categorie leeg is.
- `faq-screens.spec.ts`: tests van de schermen met een nagebootste API.

## Regels
- De server blijft de maatstaf: controle, opschoning (`sanitizeHtml`) en de meldingen per veld komen van `faq-api.js`.
- Een scherm zet zijn titel met `setPageTitle` (`shell/page-title.ts`); de server zet dezelfde titel bij het laden.
