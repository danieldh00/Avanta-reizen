---
titel: Oude FAQ-schermen van de server weg
---

## Nieuws
- De veelgestelde vragen in het CRM werken alleen nog met de nieuwe schermen. De oude formulieren zijn weggehaald.

## Changelog
- `cms/faq-routes.js` geeft alleen nog de pagina's met het koppelpunt van de module `faq` (titel per scherm, 404 bij
  een onbekende vraag of categorie, zonder bundel de melding "niet beschikbaar"). De oude schermen en de POST-routes
  zijn weg; wijzigen loopt via `cms/faq-api.js`. Tests in `cms-faq.test.js` en `web-bundle.test.js` aangepast.
