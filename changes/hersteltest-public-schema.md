---
titel: Hersteltest zet de back-up weer terug
---

## Nieuws
- De wekelijkse hersteltest van de back-ups slaagt weer en toont bij een mislukking de echte foutmelding van het terugzetten.

## Changelog
- `deploy/apps01/restore-test.sh`: `pg_restore` met `--clean --if-exists`, net als bij een echt herstel
  (`restore-backup.sh`). De dump van één schema bevat `CREATE SCHEMA public`, wat botste met het lege schema `public`
  van de wegwerpdatabase ("schema public already exists") en de hele transactie afbrak.
- Een mislukt terugzetten zet de eerste foutregel van `pg_restore` in de uitslag en de melding van de bewaking; waarden
  tussen aanhalingstekens die geen tabel-, kolom- of schemanaam zijn worden weggelaten en DETAIL/CONTEXT-regels niet
  overgenomen (geen persoonsgegevens in meldingen).
- Test: de back-up wordt teruggezet met de opties uit het hostscript in een nieuwe database waarin het schema al bestaat.
