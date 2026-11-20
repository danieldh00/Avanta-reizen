---
titel: Nieuwe website: reizen, reisleiders, blog, FAQ en aanmelden
bump: minor
---

## Nieuws
- De website van Avanta Reizen is nagebouwd: reisaanbod met zoeker, reispagina's, reisleiders, weblog, veelgestelde vragen en alle informatiepagina's.
- Aanmelden voor een reis gaat via een eigen formulier; bijzondere gegevens worden versleuteld bewaard.

## Changelog
- App-skelet: Node 22 + Express, server-gerenderde HTML, PostgreSQL 17 met migraties, Dockerfile en docker-compose.
- Huisstijl (Playfair Display, Open Sans, lokaal), menu, paginakop, kaarten; responsive op 1440 en 375 px.
- Routes gelijk aan de huidige site, met 301 voor oude adressen; noindex tot go-live; CSP en beveiligingskoppen.
- Importscript `tools/import-wordpress.js`: reizen, reisleiders, categorieën, blog, pagina's, FAQ en afbeeldingen uit de huidige site; HTML opgeschoond met een allowlist.
- Aanmeldformulier `/aanmelden/` → tabel `bookings` met versleutelde gevoelige velden (AES-256-GCM), limiet, herkomstcontrole, honeypot en ondertekend tijdstempel.
- CI: app-tests tegen PostgreSQL, npm audit en een smoketest van het image.
