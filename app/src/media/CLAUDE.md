# Foto's (`app/src/media/`)

Alleen wat voor deze map geldt; de algemene regels staan in de root-`CLAUDE.md` en gaan bij tegenspraak voor.
Indeling in modules en parallel werken: `docs/ARCHITECTUUR.md`. Wie in deze map een bestand toevoegt of de rol van
een bestand verandert, werkt dit bestand bij in dezelfde PR (niet de tabel in de root).

## Bestanden
- fotobibliotheek (recht `media`, rol Redacteur): `images.js` (magic bytes, `sharp`: rechtzetten, EXIF/GPS weg, WebP 400/800/1600/2400)
- `library.js` (tabel `media` + `media_countries`, landen = `trip_categories` met kind `bestemming`; kopie in
  `media_files` voor de back-up: van een upload de grootste variant, van een importfoto het bestand zelf, terugzetten
  met `restoreMissingFiles`)
- `routes.js` (`/app/fotobibliotheek/`, multipart via `busboy`)
- `picker.js` (foto kiezen op een bewerkscherm; bij opslaan altijd `lockMediaForUse`)
