---
titel: Lijstpagina's in de nieuwe schermen
---

## Nieuws
- De koppen van de lijstpagina's (Reizen, Reisleiders, Blog, Veelgestelde vragen en het aanmeldformulier) staan in
  de nieuwe schermen: teksten opslaan en een foto kiezen zonder dat de pagina herlaadt.

## Changelog
- Fase V3 van de ombouw naar Vue: JSON-API `cms/list-header-api.js` (`/app/api/lijstpaginas/…`, recht `content`):
  overzicht met de bron van de inhoud, kop lezen en wijzigen, foto kiezen of weghalen en de fotokiezer. Invoer met zod
  (`.strict()`) en daarna `validateListHeaderFields`; dezelfde auditacties; de site toont een wijziging meteen.
- Schermen in Vue in `app/web/src/modules/lijstpaginas/`; met bundel geven de GET-routes van `list-header-routes.js`
  het koppelpunt, zonder bundel de oude schermen.
