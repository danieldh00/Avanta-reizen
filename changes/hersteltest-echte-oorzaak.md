---
titel: Hersteltest noemt de stap die echt mislukte
---

## Nieuws
- Mislukt de hersteltest, dan staat in Beheer nu de echte oorzaak: de fout van het terugzetten of de reden waarom het
  ontsleutelen mislukte, in plaats van steeds "Ontsleutelen mislukt".

## Changelog
- `deploy/apps01/restore-test.sh`: stopt `pg_restore` bij een fout, dan eindigt het ontsleutelen met een gesloten pijp
  (EPIPE) en werd dat als oorzaak gemeld. Nieuwe functie `restore_failure` kiest de echte oorzaak: het ontsleutelen
  alleen bij een andere fout dan EPIPE, anders de foutregel van `pg_restore`. De melding van `cli.js decrypt` (eigen
  tekst, geen gegevens uit de back-up) komt nu ook in de uitslag.
- Test op de keuze van de oorzaak in `app/test/backup.test.js`.
