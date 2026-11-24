---
titel: Typecontrole op bijna alle bestanden (B08, deel 1)
---

## Changelog
- `// @ts-check` (JSDoc-typecontrole) in 138 bestanden van `src/` en `tools/` die het nog niet hadden; `tools/` valt
  nu ook onder `npm run typecheck`. Geen gedragswijziging: alleen JSDoc-typen rechtgezet (`object` → `any` of de echte
  vorm, ontbrekende opties en uitkomsten aangevuld) en een paar typeaanwijzingen.
- `crm/ui.js`: `renderTable` is generiek over het soort rij, zodat de cellen de velden van hun rij kennen.
- Nieuwe test `test/ts-check.test.js`: elk bestand in `src/` en `tools/` begint met `// @ts-check` en `@ts-nocheck` is
  niet toegestaan. De bestanden die tegelijk in W28 veranderen (28) volgen in deel 2.
