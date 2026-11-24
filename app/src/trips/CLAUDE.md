# Reisaanbod (`app/src/trips/`)

Alleen wat voor deze map geldt; de algemene regels staan in de root-`CLAUDE.md` en gaan bij tegenspraak voor.
Indeling in modules en parallel werken: `docs/ARCHITECTUUR.md`. Wie in deze map een bestand toevoegt of de rol van
een bestand verandert, werkt dit bestand bij in dezelfde PR (niet de tabel in de root).

## Bestanden
- reizen beheren (recht `reizen`): `slugs.js` (`slugify`, `recordMove`: 301 bij gewijzigde of samengevoegde slug, zonder lus)
- `categories.js` + `category-routes.js` (`/app/reistypes-en-landen/`: icoon, volgorde, homepage, foto uit de bibliotheek, samenvoegen; alle landen van de wereld met `iso_code` uit migratie 33, een nieuw land met de hand krijgt geen code)
- `trips.js` + `trip-routes.js` (`/app/reizen/`: reis = één vertrek, landen/types via `trip_category_links`, reisleiders via `trip_guides`, `managed_in_crm` → import slaat over)
- `guides.js` + `guide-routes.js` (`/app/reisleiders/`: profiel, foto's, online; `managed_in_crm` → site leest de database via `guideExtra` in `site/site-content.js`, anders `site-content.json`, en de import slaat over)
- `trip-media.js` (`trip_media`: kop/kaart/galerij; schrijft `hero_image_url`/`card_image_url`/`gallery` als afgeleide kopie)
- `seats.js` (bezet = aanmeldingen niet geannuleerd; `fullyBookedSql` overal gebruiken voor *volgeboekt*, nooit alleen de kolom `fully_booked`)
- `guide-window.js` (venster van de reisleider uit Beheer > CRM > Reisleider en `ownTripSql`: beperking tot de reizen van het gekoppelde profiel; gebruikt door de deelnemerslijsten en het overzicht van de reisleider)
