---
titel: Plaatsen van een reis en Kopiëren naar nieuw vertrek
---

## Nieuws
- Bij een reis in het CRM zie je hoeveel plaatsen bezet en vrij zijn. Zijn alle plaatsen bezet, dan staat de reis
  vanzelf als volgeboekt op de site en kan niemand zich meer aanmelden.
- Met *Kopiëren naar nieuw vertrek* maak je in één klik een nieuwe reis (als concept) met dezelfde teksten, prijs,
  landen, reistypes, reisleiders en foto's.

## Changelog
- `app/src/trips/seats.js`: `bookedSeatsSql` (aanmeldingen met status ≠ `geannuleerd`), `fullyBookedSql` (vinkje of
  bezet ≥ `capacity`) en `seatSummary`; gebruikt in de lijsten en reispagina's (`site/content.js`), het aanmeldformulier
  en het CRM.
- Aanmelden: de reis wordt bij het opslaan `FOR UPDATE` vergrendeld en opnieuw geteld; vol → 409.
- `POST /app/reizen/<id>/kopieren/` (recht `reizen`, CSRF, audit `reis.gekopieerd`): concept met teksten, prijs,
  `trip_category_links`, `trip_guides`, `trip_media` en de afgeleide fotokolommen; zonder vertrekdatum, aanbieding,
  statustekst, gegarandeerd, volgeboekt en aanmeldingen; vrije slug `<slug>-kopie[-n]` (ook niet als oud adres in
  `redirects`).
- Foto's bij een reis: het herkennen van foto's uit de import zonder rij in de bibliotheek doet nu één lookup op
  `media.local_name` (plus één variantcontrole voor de rest) in plaats van een scan per adres; de galerijlimiet van 60
  telt die foto's mee.
