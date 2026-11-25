---
titel: Categorieën en tags van het blog en de menu's in de nieuwe schermen
---

## Nieuws
- Categorieën en tags van het blog en de menu's van de website staan in de nieuwe schermen: opslaan zonder dat de
  pagina herlaadt, met Verwijderen en Opslaan samen onderaan. Een menu-item verwijder je nu na een bevestiging.

## Changelog
- Fase V3 van de ombouw naar Vue: JSON-API `cms/post-term-api.js` (`/app/api/blog-indeling/…`) en `cms/menu-api.js`
  (`/app/api/menus/…`), recht `content`, invoer met zod (`.strict()`) en daarna de bestaande controle
  (`validateTermFields`, `validateMenuItem`), eigen limiet op schrijven, dezelfde auditacties als de oude schermen. Een
  nieuw adres van een categorie of tag laadt de doorverwijzingen meteen opnieuw.
- Gedeelde stukken voor de API van een module in `api/module-helpers.js` (`createWriteLimit`, `apiFieldNames`,
  `sortOrderSchema`); de API-router krijgt doorverwijzingen, menu's, lijstkoppen en de fotobibliotheek mee.
- Schermen in Vue: `app/web/src/modules/blog-indeling/` en `app/web/src/modules/menus/`; met bundel geven de
  GET-routes van `post-term-routes.js` en `menu-routes.js` het koppelpunt, zonder bundel de oude schermen.
  `moveId` en `readOrder` staan nu gedeeld in `components/order-tools.ts`.
- Testhulp `test/helpers/api-app.js` (app in een eigen schema met ingelogde gebruikers, `checkAccess` voor 401/403).
