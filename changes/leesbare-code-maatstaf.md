---
titel: Maatstaf voor leesbare code en bewaking in ESLint (P6a.1)
---

## Changelog
- Maatstaf voor leesbare code vastgelegd in `docs/WERKWIJZE.md` (*Leesbare code*): namen, lengte en vertakkingen van
  functies, bestandslengte, opbouw van een routebestand en commentaar.
- ESLint bewaakt die maatstaf: `id-length` (één letter alleen voor `i`, `j`, `x`, `y`), `max-depth` 4, `max-params` 5
  en `max-nested-callbacks` 4 overal; `complexity` 20 en `max-lines` 600 per map zodra die in P6a is nagelopen
  (`P6A_NOG_NALOPEN` in `app/eslint.config.js`).
- De bestaande overtredingen opgelost zonder gedragswijziging: korte namen hernoemd (vergelijkers, testcontext,
  scrypt-parameters), `fieldControl` en het tekstvak van het reisformulier krijgen hun opties als object, de
  wachtwoordbevestiging in Beheer, de foto- en herhaalvelden van blokken en de import van alleen de vaste inhoud staan
  in eigen functies.
