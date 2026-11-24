---
titel: Zoeken over het hele CRM vanuit de kopbalk
---

## Nieuws
- Bovenin het CRM staat nu een zoekveld (op de telefoon een zoekknop). Je zoekt in één keer in aanmeldingen,
  deelnemers, berichten, reizen, reisleiders, pagina's, blog, veelgestelde vragen en gebruikers, en ziet per onderdeel
  de eerste vijf treffers. Je vindt alleen wat je ook mag openen.

## Changelog
Pakket P4.3 (bevinding B03).
- `crm/search.js` (`SEARCH_SOURCES`: per bron het recht, vaste SQL, link en toelichting; `searchCrm` met
  `searchPatterns`) en `crm/search-routes.js` (`/app/zoeken/`, 403 zonder doorzoekbare bron).
- Kopbalk (`crm/layout.js`): zoekveld met de zoekterm, op ≤ 800 px een knop naar de zoekpagina; opmaak in `crm.css`.
- Design-controle: `crm/search*` koppelt aan `/app/zoeken/?q=test`.
