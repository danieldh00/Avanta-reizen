# Module Lijstpagina's in de frontend (`app/web/src/modules/lijstpaginas/`)

Hoort bij `app/src/cms/` (`list-headers.js`, `list-header-routes.js`, `list-header-api.js`). Basispad
`/app/lijstpaginas/`, recht `content`. Fase V3 van de ombouw (`docs/VUE-OMBOUW.md`).

## Bestanden
- `main.ts`: ingang; start de module op het koppelpunt (`mountModule`).
- `routes.ts`: `/`, `/<sleutel>/` en `/<sleutel>/foto/`, gelijk aan de oude adressen; alleen de vaste sleutels
  (`reis`, `reisleider`, `blog`, `faq`, `aanmelden`).
- `list-header-api.ts`: getypte functies op `/app/api/lijstpaginas/…` (`createListHeaderApi`, `listHeaderApi`) en de
  vaste meldingen (`NOTICES`). In de zoekvraag van de fotokiezer staat een punt als `%2E` (`checkPath` weigert `..`).
- `list-header-overview-screen.vue`: de vijf koppen met titel, foto ja of nee en waar de inhoud vandaan komt.
- `list-header-edit-screen.vue`: pretitel, titel en inleiding met de knoppenbalk (uitleg bij Reizen en FAQ, die geen
  inleiding tonen), de foto met een link naar de fotokiezer.
- `list-header-photo-screen.vue`: fotokiezer met zoeken en bladeren, een foto gebruiken of weghalen; daarna terug
  naar de kop met een melding.
- `list-header-screens.spec.ts`: tests van de schermen met een nagebootste API.

## Regels
- De server blijft de maatstaf: controle en de meldingen per veld komen van `list-header-api.js`; de site toont een
  wijziging meteen (gedeelde kopie van de koppen in het geheugen).
