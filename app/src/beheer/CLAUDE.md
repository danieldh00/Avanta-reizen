# Beheer (`app/src/beheer/`)

Alleen wat voor deze map geldt; de algemene regels staan in de root-`CLAUDE.md` en gaan bij tegenspraak voor.
Indeling in modules en parallel werken: `docs/ARCHITECTUUR.md`. Wie in deze map een bestand toevoegt of de rol van
een bestand verandert, werkt dit bestand bij in dezelfde PR (niet de tabel in de root).

## Bestanden
- Beheer onder `/app/beheer/` (recht `systeem`): `instellingen/<groep>.js` (per groep van Beheer de instellingen `FIELDS` en de secties `GROUP`; `index.js` noemt de groepen)
- `settings.js` (`SETTING_FIELDS` = alle groepen samen, database → env → standaard, geheimen via vault)
- `indeling.js` (`GROUPS` + zoeken)
- `routes.js` (startpagina met stand en kaarten, systeemoverzicht, lijst met alle instellingen, formulieren)
- `redirect-routes.js` (doorverwijzingen, 404-lijst)
- `mail-routes.js` (testmail, WAN-IP)
- `captcha-routes.js` (sleutelcontrole)
- `backup-routes.js` (back-ups: Nu maken, lijst, downloaden)
- `drive-routes.js` (Google Drive koppelen)
- `restore-test-routes.js` (hersteltest)
- `update-routes.js` (updates, onderhoudsmodus)
- `host-task-routes.js` (servertaken)
- `log-routes.js` (logboek)
- `monitor-routes.js` (bewaking: stand, incidenten, testmelding)
- `retention-routes.js` (AVG-opschoning: rondes, voorbeeld, Nu opschonen)
- `go-live-check.js` (controle voor de livegang: instellingen uit `docs/GO-LIVE.md` en homepage als blokpagina en of de vaste inhoud is overgezet) en `go-live-routes.js` (`/app/beheer/livegang/`)
