---
titel: Wekelijkse hersteltest van de back-ups
---

## Nieuws
- Beheer > Back-ups en herstel > Hersteltest: elke week controleert de server dat de nieuwste back-up echt terug te
  zetten is (in een wegwerpdatabase met een wegwerp-app), en de app test de kopie op Google Drive. Beide ook op verzoek.

## Changelog
- `deploy/apps01/restore-test.sh` + systemd (`avanta-restore-test.timer`, zondag 04:30; `avanta-restore-test-now.path`
  voor *Nu testen*), geïnstalleerd door `install.sh`: ontsleutelen als stroom (`cli.js decrypt <naam> -`), terugzetten
  in een wegwerp-PostgreSQL 17 op een intern netwerk, het huidige app-image daarop starten (health + homepage) en rijen
  per tabel vergelijken; altijd opruimen.
- `app/src/backup/restore-test.js`: uitslag bepalen en begrensd bewaren (`restore-test.json`, 12 runs; waarschuwing bij
  meer dan 25% en meer dan 20 rijen verschil), test van de Drive-kopie (download, volledig ontsleutelen, vergelijken met
  de lokale back-up; wekelijks en op verzoek, `drive-restore-test.json`).
- `cli.js`: `decrypt <back-up> -` (naar stdout) en `restore-test-result` (JSON op stdin).
- Beheer: pagina *Hersteltest* met uitslagen en *Nu testen* (server en Drive, 3 per uur, in het auditlog).
