---
titel: Auditlog filteren en exporteren naar Excel
---

## Nieuws
- Het auditlog in Beheer heeft nu filters: op gebruiker (ook systeem of onbekend), actie, soort record, recordnummer en
  periode. Een record met een eigen pagina is aanklikbaar en de filters blijven staan bij het bladeren.
- Met **Excel (.xlsx)** exporteer je dezelfde selectie, met een tweede blad dat vermeldt welke filters zijn gebruikt,
  door wie en wanneer. Een export komt zelf ook in het auditlog.

## Changelog
Pakket P4.4 (bevinding F06).
- `crm/audit-log.js` (filters, `auditWhere` met parameters en hele dagen in Europe/Amsterdam, pagina's op id, export met
  maximum van 50.000 regels, werkboek) en `crm/audit-routes.js` (`/app/auditlog/` en `/app/auditlog/export.xlsx`,
  recht `gebruikers`, 10 exports per 10 minuten per gebruiker, 422 boven het maximum); de oude route uit `crm/users.js`
  is vervallen.
- Migratie 31: indexen `audit_log (user_id, id)`, `(action, id)` en `(entity_id, id)`; de keuzelijst *Soort record* komt uit `ENTITIES` in plaats van uit het log.
- Opmaak `.crm-audit-filter` in `crm.css`; design-controle koppelt `crm/audit-*` aan `/app/auditlog/`.
