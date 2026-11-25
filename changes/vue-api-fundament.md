---
titel: JSON-API als fundament voor de nieuwe schermen
---

## Changelog
- Nieuw: `app/src/api/` met de router voor `/app/api/` (in de schil van het CRM, na de sessie): vaste kop
  `X-Avanta-Api: 1`, herkomstcontrole en `application/json` bij schrijven tegen CSRF, `Cache-Control: no-store`,
  401/403 in JSON in plaats van een doorverwijzing, één foutformaat (ook 404, 413, 415, 429, 500 met foutcode en 503
  bij onderhoud) en invoer via zod met een melding per veld. `GET /app/api/sessie/` geeft naam, rol en rechten.
- Nieuwe afhankelijkheid: `zod` (alleen in de API-routes).
- Frontend: getypte client `app/web/src/api/client.ts` (zelfde herkomst, vaste kop, geen cache, 401 naar het
  inlogscherm, nette meldingen bij 403/404/429/503).
