---
titel: Google Analytics met cookiekeuze
---

## Nieuws
- In Beheer > Vindbaarheid kun je Google Analytics (GA4) aanzetten met je meet-ID. Bezoekers kiezen eerst zelf of ze
  statistieken toestaan; zonder toestemming wordt niets van Google geladen. De keuze is altijd te wijzigen via
  *Cookie-instellingen* onderaan elke pagina.

## Changelog
- Instellingen `analyticsEnabled` en `analyticsMeasurementId` (alleen een geldig `G-…`-ID), sectie *Google Analytics en
  cookies*; `site/analytics.js` (`activeMeasurementId`, `cspWith`).
- Zonder actief meet-ID: niets in de pagina en de Content-Security-Policy ongewijzigd. Met meet-ID (alleen de publieke
  site, nooit `/app/`): `data-analytics` op `<body>`, extern script `public/js/analytics.js`, knop *Cookie-instellingen*
  in de voettekst; `script-src` krijgt `https://www.googletagmanager.com`, `connect-src` ook `*.google-analytics.com` en
  `*.analytics.google.com`. Geen inline scripts.
- Consent Mode v2: standaard alles geweigerd; Accepteren zet alleen `analytics_storage` aan en laadt dan pas gtag
  (`allow_google_signals: false`); keuze met versie en datum in localStorage; weigeren of intrekken zet `ga-disable-<id>`
  en wist de `_ga`-cookies.
