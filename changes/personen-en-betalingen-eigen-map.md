---
titel: Personen en betalingen in een eigen map
---

## Changelog
Modulestructuur, stap 2b (geen gedragswijziging, alleen bestanden verplaatst): uit `app/src/crm/` zijn de personen
(`persons.js`, `person-*.js`, `participant-list*.js`, `retention.js`) naar `app/src/persons/` gegaan, de betalingen
(`payments.js`, `payment-*.js`, `mollie.js`, `online-payment*.js`) naar `app/src/payments/` en de aanmeldingen in het
CRM naar `app/src/booking/crm-routes.js`. Elke module koppelt haar routes via een eigen ingang `index.js`.
`crm/` bevat nu alleen de schil van het CRM: toegang, gebruikers, rechten, opmaak en het overzicht. Adressen,
rechten en gedrag zijn ongewijzigd; alleen de `require`-paden en verwijzingen in commentaar en documentatie zijn
aangepast.
