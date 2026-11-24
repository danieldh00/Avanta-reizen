---
titel: Hersteltest herkent een afgebroken pijp en wacht op de echte database
---

## Changelog
- `deploy/apps01/restore-test.sh`: stopt `pg_restore` bij een fout, dan kan `docker compose exec` zelf door SIGPIPE
  stoppen (code 141, zonder melding). Dat werd als "Ontsleutelen mislukt" gemeld. Het ontsleutelen is nu alleen de
  oorzaak bij een eigen fout van `cli.js` (geen EPIPE), of als `pg_restore` slaagde of alleen te weinig invoer kreeg;
  anders staat de fout van `pg_restore` in de melding. Zonder eigen melding staat de afsluitcode erbij.
- De wegwerpdatabase telt pas als gereed als hij via TCP bereikbaar is: de tijdelijke server van het opstartscript van
  het image luistert alleen op de socket en stopt daarna weer.
- Tests voor beide gevallen in `app/test/backup.test.js`.
