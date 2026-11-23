# Site (`app/src/site/`)

Alleen wat voor deze map geldt; de algemene regels staan in de root-`CLAUDE.md` en gaan bij tegenspraak voor.
Indeling in modules en parallel werken: `docs/ARCHITECTUUR.md`. Wie in deze map een bestand toevoegt of de rol van
een bestand verandert, werkt dit bestand bij in dezelfde PR (niet de tabel in de root).

## Bestanden
- `routes.js` (alle publieke URL's)
- `content.js` (queries)
- `layout.js` (kop/voet)
- `page-view.js` (blog, tags, pagina's, FAQ, contact)
- `html.js` (escaping)
- `format.js`
- `seo.js` (JSON-LD, sitemap, robots.txt, llms.txt)
- `site-settings.js` (`res.locals.site`)
- `redirects.js` (doorverwijzingen + 404-tellers)
- `analytics.js` (GA4-meet-ID, CSP)
- `icons.js` (eigen SVG-iconen, inline)
- `homepage.js` (vaste homepage-inhoud uit `DATA_DIR/homepage.json`, gecontroleerd) en `home-view.js` (HTML van de homepage)
- `trip-view.js` (reizen en reisleiders)
- `site-content.js` (lijstkoppen en reisleidergegevens uit `DATA_DIR/site-content.json`)
- `json-store.js` (lezer voor die JSON-bestanden)
