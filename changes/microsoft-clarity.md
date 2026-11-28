---
titel: Microsoft Clarity op de website, alleen na toestemming
---

## Nieuws
- Bezoekersgedrag bekijken met Microsoft Clarity (heatmaps en opnames): vul in Beheer > Vindbaarheid > Statistieken en
  cookies het project-ID in. Clarity laadt pas als de bezoeker in de cookiebalk toestemming geeft, maskeert altijd wat
  er in formulieren staat en draait nooit op Mijn Avanta, het aanmeldformulier, online betalen of in het CRM.

## Changelog
- Nieuwe instelling `clarityProjectId` (groep Vindbaarheid, sectie *Statistieken en cookies*, leeg = uit).
- `site/analytics.js`: `activeClarityId`, `clarityAllowedOn` (niet op `/app/`, `/account/`, `/aanmelden/`,
  `/betalen/`) en `cspWith` met de Clarity-adressen (`www.clarity.ms`, `scripts.clarity.ms`, `*.clarity.ms`; geen
  `c.bing.com`).
- `public/js/analytics.js`: cookiebalk voor Google Analytics en Clarity samen; Clarity pas na toestemming met
  `consentv2` (alleen statistieken), `data-clarity-mask` op elk formulier, intrekken wist `_clck`/`_clsk` en laadt de
  pagina opnieuw. De bewaarde keuze noemt de diensten; een nieuwe dienst vraagt opnieuw om toestemming.
- Layout: `data-clarity` op `<body>`, cookiescript en knop *Cookie-instellingen* zodra één van beide actief is.
