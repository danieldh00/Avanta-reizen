---
titel: Reistypes en landen in de nieuwe schermen
---

## Nieuws
- Reistypes en landen staan in de nieuwe schermen: een tabblad per soort en zoeken op naam, slug of landcode in de
  lange lijst met alle landen; opslaan, een foto kiezen en samenvoegen zonder dat de pagina herlaadt. Samenvoegen en
  verwijderen vragen eerst om een bevestiging.

## Changelog
- Fase V3 van de ombouw naar Vue: JSON-API `trips/category-api.js` (`/app/api/reistypes-en-landen/…`, recht
  `reizen`): lijst met tellingen en de vormen van de iconen, aanmaken, lezen, wijzigen (301 bij een nieuwe slug),
  verwijderen (alleen ongebruikt), foto kiezen of weghalen, fotokiezer (bij een land standaard de foto's van dat land)
  en samenvoegen. Invoer met zod (`.strict()`) en daarna `validateCategory` met `sanitizeHtml`; dezelfde auditacties.
- `api/router.js`: een grotere JSON-grens (`LARGE_JSON_LIMIT`, 512 kB) op paden met een lange opgemaakte tekst
  (`largeJsonPaths`: antwoord van een FAQ-vraag en de tekst van een reistype of land), gelijk aan de formulieren.
- `api/module-helpers.js`: `photoQuerySchema` en `photoPickerPage` voor de fotokiezer van een module.
- Schermen in Vue in `app/web/src/modules/reistypes/`; met bundel geven de GET-routes van `category-routes.js` het
  koppelpunt, zonder bundel de oude schermen.
