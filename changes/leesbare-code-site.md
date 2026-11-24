---
titel: Leesbare code in site/, booking/, account/, mail/, contact/ en infobrief/ (P6a.4)
---

## Changelog
- `booking/fields.js`: `cleanFieldInput` en `formatProblem` uit `validateFields`.
- `booking/routes.js` en `booking/manual-routes.js`: het invoerelement van een veld in `renderFormControl` en
  `renderControl`.
- `infobrief/infobrief-routes.js`: de pagina van een infobrief is opgesplitst in concept (`renderConcept`) en verstuurd
  (`renderSent`), met de feiten in `infobriefFacts`.
- `mail/mailer.js`: `connectionAdvice` (uitleg bij een verbindingsfout) uit `mailFailure`.
- `site/layout.js`: `pageSettings` (waarden met standaarden) uit `renderPage`; `site/site-content.js`:
  `plainObject`, `normalizeGuides`, `normalizeTags` en `normalizeGalleries` uit `normalizeSiteContent`.
- ESLint bewaakt nu ook complexiteit (20) en bestandslengte (600) in deze zes mappen.
