---
titel: Typecontrole op alle bestanden (B08, deel 2)
---

## Changelog
- `// @ts-check` in de laatste 28 bestanden van `src/` en `tools/` (de bestanden die W28 tegelijk aanpaste en wat op hun
  typen leunt); alle meldingen opgelost zonder gedragswijziging (JSDoc-typen rechtgezet, ontbrekende opties aangevuld).
- `tsconfig.json`: `checkJs` staat aan, dus elk bestand onder `src/` en `tools/` wordt gecontroleerd, ook zonder de
  regel. De lijst met tijdelijke uitzonderingen in `test/ts-check.test.js` is weg.
