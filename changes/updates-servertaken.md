---
titel: Updates vanuit de app, onderhoudsmodus en servertaken
bump: minor
---

## Nieuws
- Beheer > Systeem > Updates en onderhoud: zie welke versie klaarstaat met de releasenotes, start de update zelf met
  *Nu updaten* (met je wachtwoord) of laat de server automatisch bijwerken.
- Onderhoudsmodus: tijdens een update en met de hand kan niemand iets versturen of opslaan; elke pagina toont een
  melding en inloggen blijft werken.
- Beheer > Systeem > Servertaken: een afvinklijst voor taken op de server, met één vast commando voor de Proxmox-host.

## Changelog
- `app/src/system/system-update.js`: koppeling met `deploy/apps01/update.sh` via `/update/status` (alleen-lezen:
  `status.json`, `run.json`, `changelog.md`, `maintenance.json`) en `/update/request` (`request.json` met de commit of
  `check: true`, `policy.json`); alles gesaneerd, schrijven via tijdelijk bestand + rename, een te oude uitrol of
  onderhoudsbestand verloopt; afgeronde uitrollen één keer in het auditlog.
- `app/src/system/maintenance.js` + `request-context.js`: 503 met Retry-After op elk schrijfverzoek tijdens onderhoud
  (behalve inloggen/uitloggen, en bij handmatig onderhoud het uitzetten), balk in de site- en CRM-layout via
  AsyncLocalStorage. Instellingen `updateAuto`, `maintenanceMode`, `maintenanceMessage`, `hostTasksDone`.
- `app/src/system/host-tasks.js` + `deploy/apps01/servertaken.sh`: `HOST_TASKS` met één vast commando (script op de
  exacte commit van main), acties `status`, `logs`, `update`, `openstaand`; gedane taken in `update/status/host-tasks.json`.
- `update.sh`: aanvraag eerst lezen en weghalen, bouwen vóór de onderhoudsmodus (`INSTALL_PHASE=build` in
  `install.sh`), back-up, wisselen, versiecontrole op `/api/health`, terugval en `.failed-commit`; alles in `main()`.
  `install.sh` maakt `update/status` (root) en `update/request` (uid 1000), de path-unit `avanta-update-now.path` en
  vervangt het updatescript via rename. Compose koppelt beide mappen.
- Tests: `app/test/system-update.test.js`, `tests/deploy-update.test.js` (update.sh met echte git-repo en nep-docker).
