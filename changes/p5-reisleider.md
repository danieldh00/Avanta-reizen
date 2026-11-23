---
titel: Eigen overzicht voor de reisleider en instelbaar venster
bump: minor
---

## Nieuws
- De reisleider ziet op het overzicht van het CRM zijn eigen vertrekken: datums, aantal deelnemers, of het venster
  voor bijzondere gegevens open is en een link naar de deelnemerslijst.
- Het venster waarin de reisleider identiteits- en gezondheidsgegevens mag exporteren is instelbaar in
  Beheer > CRM > Reisleider (standaard 14 dagen vóór vertrek tot en met de terugkomst, zoals tot nu toe).

## Changelog
- Nieuw `crm/guide-dashboard.js`: overzicht `/app/` voor rollen in `TRIP_SCOPED_ROLES`, alleen reizen van het
  gekoppelde reisleidersprofiel, alleen aantallen (geen persoonsgegevens); vertrekken verdwijnen als het venster na
  de terugkomst dicht is. `crm/dashboard-routes.js` kiest per rol.
- Nieuw `trips/guide-window.js`: venster uit de instellingen `guideWindowDaysBefore` en `guideWindowDaysAfter`
  (groep CRM, sectie Reisleider, 0 tot 60) en de gedeelde SQL voor venster en eigen vertrekken, met gebonden
  parameters. De vaste `GUIDE_WINDOW_DAYS` in de deelnemerslijsten is vervangen.
- Tests: `test/guide-dashboard.test.js` (eigen reizen, andere reisleider, aantallen, venster uit Beheer in overzicht
  en export, 403 buiten het venster).
