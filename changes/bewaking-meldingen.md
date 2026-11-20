---
titel: Bewaking en meldingen
bump: minor
---

## Nieuws
- Beheer > Systeem > Bewaking en meldingen: de app controleert elke vijf minuten de back-up, de kopie op Google Drive, de hersteltest, het versturen van mail, de schijfruimte, het aantal fouten en de laatste update. Een probleem wordt een incident met een melding per mail en eventueel webhook (Teams, Slack, Discord, ntfy); is het opgelost, dan volgt ook een melding.
- Optioneel een heartbeat-URL (bijvoorbeeld Healthchecks.io of Uptime Kuma), zodat je ook gewaarschuwd wordt als de hele server plat ligt.

## Changelog
- Migratie 8 (`beheer: bewaking`): tabel `monitor_incidents` met een unieke gedeeltelijke index (hoogstens één open incident per controle) en een index op `opened_at`.
- `app/src/system/monitor.js`: controles, incidenten openen/bijwerken/sluiten, één gebundelde melding per ronde (nieuw, ernstiger, herinnering na `monitorRepeatHours`, opgelost), heartbeat zolang er geen ernstig incident open staat, gesloten incidenten een jaar bewaard. Meldingen bevatten geen persoonsgegevens, adressen of URL's.
- `app/src/security/safe-request.js`: kort https-verzoek alleen naar een openbaar adres (via `netguard`), verbinding naar het gecontroleerde IP, geen omleidingen, tijdslimiet.
- `app/src/beheer/monitor-routes.js`: stand per controle, open en gesloten incidenten, laatste meldingen, *Nu controleren* (12 per tien minuten) en *Testmelding versturen* (5 per tien minuten, in het auditlog).
- Instellingen `monitorEnabled`, `monitorEmail`, `monitorWebhookUrl` en `monitorHeartbeatUrl` (versleuteld), `monitorRepeatHours`, `monitorBackupMaxHours`, `monitorDiskMinPercent`, `monitorErrorsPerHour`. Het overzicht van Beheer toont open incidenten.
