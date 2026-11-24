---
titel: Design-controle in CI op de gewijzigde schermen
---

## Changelog
- Nieuwe CI-job `design` (`ci.yml`): draait de design-controle met Playwright alleen op de schermen die een PR raakt, op
  1440 en 375 px, en faalt bij bevindingen met ernst hoog. Een PR zonder geraakt scherm (docs, migraties, beveiliging,
  tests) slaat de job over; op `main` draait hij niet.
- `tools/design-check/changed-screens.js`: koppelt gewijzigde bestanden aan schermen (`SCREEN_RULES`); gedeelde opmaak
  (`site.css`, `crm.css`, `crm/ui.js`, layout) geeft een vaste set kernschermen van dat deel.
- `tools/design-check/ci-summary.js`: korte samenvatting bij de job; het rapport (.xlsx met uitsneden) staat in het
  artefact `design-controle` (7 dagen).
- `check.js`: een pad met `*` volgt in de gerichte run ook op de publieke site links onder dat pad (maximaal twee per
  soort scherm), bijvoorbeeld `/reis/*` voor de reislijst en twee reispagina's.
- `seed.js`: maakt de testbeheerder ook aan als er al gebruikers zijn (bijvoorbeeld na de testdata uit `src/dev/seed/`).
