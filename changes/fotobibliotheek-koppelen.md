---
titel: Fotobibliotheek: foto's uit de import automatisch aan landen koppelen
---

## Nieuws
- Foto's van de huidige site krijgen automatisch de landen van de reizen waarin ze staan. Bij *Zonder land* staat een
  knop om dat opnieuw te doen; wat overblijft koppel je met de hand.

## Changelog
- `media/library.js`: `linkImportedMedia()` (één INSERT … SELECT: landen via `trip_category_links` van reizen die
  naar de foto verwijzen, plus landpagina's; alleen importfoto's zonder land; LIKE-patroon met escapes).
- Route `POST /app/fotobibliotheek/koppelen/` (recht `media`, CSRF, audit `media.gekoppeld`); de WordPress-import
  koppelt na het downloaden van de afbeeldingen automatisch.
