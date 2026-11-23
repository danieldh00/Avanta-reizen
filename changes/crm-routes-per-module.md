---
titel: Routes van het CRM per module
---

## Changelog
Modulestructuur, stap 2 (geen gedragswijziging): `app/src/crm/routes.js` is alleen nog de schil van `/app/` (limiet,
formuliergrootte, sessie laden, 404). Inloggen, uitloggen, installatie en wachtwoord wijzigen staan in
`crm/login-routes.js`, het overzicht in `crm/dashboard-routes.js`, de invoerhulpjes in `crm/input.js`. De modules
Reisaanbod, Website-inhoud en Foto's koppelen hun eigen routes via een ingang `trips/index.js`, `cms/index.js` en
`media/index.js`; een nieuw scherm in zo'n module raakt `crm/routes.js` niet meer. Alle adressen, de volgorde van de
routes en de limieten zijn ongewijzigd. `docs/ARCHITECTUUR.md` beschrijft de ingang per module.
