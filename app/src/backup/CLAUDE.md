# Back-ups (`app/src/backup/`)

Alleen wat voor deze map geldt; de algemene regels staan in de root-`CLAUDE.md` en gaan bij tegenspraak voor.
Indeling in modules en parallel werken: `docs/ARCHITECTUUR.md`. Wie in deze map een bestand toevoegt of de rol van
een bestand verandert, werkt dit bestand bij in dezelfde PR (niet de tabel in de root).

## Bestanden
- `backups.js` (pg_dump → AES-256-GCM, `DATA_DIR/backups`, planner, bewaartermijn)
- `drive.js` (OAuth `drive.file`, upload + bewaartermijn op Drive, stand in `drive-state.json`)
- `restore-test.js` (uitslag hostscript `deploy/apps01/restore-test.sh`, test van de Drive-kopie)
- `cli.js` (`create [--update]`, `list`, `decrypt`, `restore-test-result`)
