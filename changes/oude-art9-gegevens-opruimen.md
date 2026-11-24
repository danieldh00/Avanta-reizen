---
titel: Art. 9-gegevens van het oude formulier opruimen
---

## Nieuws
- Kerkgenootschap en medische bijzonderheden uit aanmeldingen van het oude formulier worden niet meer overgenomen en, waar dat eerder wel gebeurde, gewist: het oude formulier vroeg daar geen losse toestemming voor.

## Changelog
- `persons/persons.js`: `backfillPersons` neemt `church` en `particulars` niet meer over en legt geen regel `oud-formulier, geen losse art. 9-toestemming` meer vast; nieuwe `purgeLegacyArt9` wist bij het starten de blokken met zo'n regel (behalve bij een latere echte toestemming van dezelfde soort) en trekt die regels in (bevinding A10). `backfillPersons` geeft nu ook `purged` en `purgeFailed` terug, alleen als aantallen in het log; een fout bij één persoon houdt de opschoning van de anderen niet tegen.
- `persons/participant-lists.js`: een toestemming uit het oude formulier telt ook in de deelnemerslijst nooit als toestemming.
