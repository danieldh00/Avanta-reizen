---
titel: Geüploade foto's in de back-up
---

## Nieuws
- Foto's die je in de fotobibliotheek uploadt, zitten nu in elke back-up en in de kopie op Google Drive. Na het
  terugzetten van een back-up (bijvoorbeeld op een nieuwe server) zet de app de foto's vanzelf terug.

## Changelog
- Migratie 13: tabel `media_files` (grootste WebP-variant per upload, breedte, SHA-256; `STORAGE EXTERNAL`), met
  `ON DELETE CASCADE` op `media`.
- Upload schrijft de grootste variant in dezelfde transactie naar `media_files`.
- `media/library.js`: `backfillFiles()` (uploads van vóór M13), `restoreMissingFiles()` (ontbrekende bestanden terug,
  kleinere varianten via `resizeWebp`, hash gecontroleerd); bij het starten en dagelijks, met meldingen in het logboek.
- `docs/DRAAIBOEK-VPS-VERHUIZING.md` bijgewerkt.
