---
titel: Afbeeldingen uit de import in de back-up
---

## Nieuws
- De afbeeldingen die van de oude website zijn overgenomen zitten nu ook in elke back-up en worden na het terugzetten
  vanzelf hersteld.

## Changelog
- Bevinding A14 (plan PR 6.2): `backfillImportFiles` in `media/library.js` zet elk importbestand (JPEG, PNG, WebP,
  GIF, tot 15 MB, alleen namen zoals de import ze maakt) byte voor byte in `media_files`, één tegelijk, bij het starten
  en daarna dagelijks. `restoreMissingFiles` zet ook importbestanden ongewijzigd terug (SHA-256-controle).
- Nieuw in `media/images.js`: `importImageWidth` (breedte lezen zonder omzetten). Geen migratie.
- Logboek (bron *fotobibliotheek*): aantal importfoto's in de database gezet en aantal zonder bruikbaar bestand.
- De back-up groeit met de grootte van de import (circa 250 MB). README en draaiboek bijgewerkt.
