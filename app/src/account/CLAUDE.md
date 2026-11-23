# Reizigersaccount (`app/src/account/`)

Alleen wat voor deze map geldt; de algemene regels staan in de root-`CLAUDE.md` en gaan bij tegenspraak voor.
Indeling in modules en parallel werken: `docs/ARCHITECTUUR.md`. Wie in deze map een bestand toevoegt of de rol van
een bestand verandert, werkt dit bestand bij in dezelfde PR (niet de tabel in de root).

## Bestanden
- reizigersaccount onder `/account/` (CMS-pakket J): `accounts.js` (tabellen `customer_accounts`, `customer_sessions`, `customer_tokens`; eenmalige links, max. 3 per soort per uur)
- `routes.js` (registreren, bevestigen met link + wachtwoord, inloggen met dezelfde limieten als het CRM, wachtwoord vergeten/herstellen, code per e-mail vóór export en wachtwoord wijzigen; cookie `avanta_reiziger` op pad `/account`, eigen CSRF)
- `my-trips.js` (Mijn reizen/gegevens op het bevestigde e-mailadres, nooit bijzondere gegevens)
- `mails.js`
- `views.js`
- los van `users`/`sessions` van het CRM
