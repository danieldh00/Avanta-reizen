---
titel: Lijsten in het CRM blijven tabellen voor schermlezers
---

## Changelog
`crm/ui.js` `renderTable`: expliciete rollen (`table`, `rowgroup`, `row`, `columnheader`, `cell`), zodat de
tabelsemantiek en de kolomnamen behouden blijven in de kaartweergave op mobiel (`display: block`; Safari/VoiceOver).
Tests bijgewerkt (`crm-ui`, `crm-audit`, `dashboard`, `trips`, `beheer-livegang`).
