---
titel: Fotobibliotheek per land (uploaden en beschrijven)
bump: minor
---

## Nieuws
- Nieuw in het CRM: de **Fotobibliotheek**. Upload meerdere foto's tegelijk, koppel ze aan een of meer landen en geef
  ze een titel, alt-tekst, bijschrift en fotograaf. Locatie- en cameragegevens worden automatisch verwijderd.
- Nieuwe rol **Redacteur**: alleen de website (nu de fotobibliotheek, later pagina's en blog).

## Changelog
- Migratie 12: `media` krijgt `source`, `title`, `alt_text`, `caption`, `photographer`, `width`, `height`, `variants`,
  `uploaded_by`, `created_at`, `updated_at` (`original_url` mag leeg); koppeltabel `media_countries` naar
  `trip_categories`; rol `redacteur` toegestaan in `users`.
- Recht `media` (beheerder, kantoor, redacteur); menu-item *Fotobibliotheek*.
- `app/src/media/`: soort bestand op inhoud (magic bytes + `sharp`-formaat), rechtzetten, EXIF/GPS/XMP weg, WebP in
  400/800/1600/2400 px; uploads via `busboy` met grenzen (10 bestanden, 15 MB, 60 MP, 200 per uur per gebruiker,
  2 tegelijk), CSRF- en herkomstcontrole, audit `media.geupload` en `media.gewijzigd`.
- Nieuwe afhankelijkheden: `sharp`, `busboy`.
