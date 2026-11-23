# Systeem (`app/src/system/`)

Alleen wat voor deze map geldt; de algemene regels staan in de root-`CLAUDE.md` en gaan bij tegenspraak voor.
Indeling in modules en parallel werken: `docs/ARCHITECTUUR.md`. Wie in deze map een bestand toevoegt of de rol van
een bestand verandert, werkt dit bestand bij in dezelfde PR (niet de tabel in de root).

## Bestanden
- `system-update.js` (koppeling met `deploy/apps01/update.sh` via `/update/status` en `/update/request`)
- `maintenance.js` (503 op schrijven + balk)
- `host-tasks.js` (`HOST_TASKS` + vast commando; gelijk houden met `deploy/apps01/servertaken.sh`)
- `request-context.js` (AsyncLocalStorage per verzoek)
- `app-log.js` (logboek `app_logs`: privacyfilter, foutcodes, request-id's; nooit persoonsgegevens loggen)
- `monitor.js` (bewaking: controles, `monitor_incidents`, meldingen mail/webhook/heartbeat)
