---
titel: Leesbare code in crm/, persons/ en payments/ (P6a.2)
---

## Changelog
- `payments/payment-routes.js`: de betaalpagina is opgesplitst in losse tekenfuncties per blok (stand, aanmelding,
  bedragen, ontvangen betalingen, herinneringen, online betalen, formulieren); dezelfde HTML.
- `crm/login-routes.js`: het tellen van mislukte inlogpogingen (`countLoginAttempt`) en de actie in het auditlog
  (`failedLoginAction`) staan in eigen functies; limieten en volgorde ongewijzigd (tellen vóór de wachtwoordcontrole).
- `crm/qr-code.js`: `build` zet de vaste patronen en de data via eigen functies (zoekers en tijdlijnen, uitlijning,
  formaat en versie, data).
- `persons/person-routes.js`: de deelnemerslijst is opgesplitst in laden (`loadPersonList`) en tekenen
  (`renderPersonList`).
- ESLint bewaakt nu ook complexiteit (20) en bestandslengte (600) in `crm/`, `persons/` en `payments/`.
