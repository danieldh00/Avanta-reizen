---
titel: Reizigersaccount: registreren, bevestigen, inloggen en wachtwoord herstellen
bump: minor
---

## Nieuws
- Reizigers kunnen op de website een account aanmaken onder /account/: registreren met e-mailadres en wachtwoord, bevestigen via de mail, inloggen en een vergeten wachtwoord opnieuw instellen. In een volgende versie zie je daar je komende en eerdere reizen.

## Changelog
- Migratie 23: `customer_accounts`, `customer_sessions` (met `step_up_until` voor de code per e-mail in J3) en `customer_tokens` (bevestigen, herstellen, code).
- `app/src/account/`: `accounts.js` (opslag, sessies, eenmalige links met hash, max. 3 per soort per uur, opruimen van onbevestigde accounts na 7 dagen), `routes.js` (`/account/`, `/account/inloggen/`, `/account/uitloggen/`, `/account/registreren/`, `/account/bevestigen/`, `/account/wachtwoord-vergeten/`, `/account/wachtwoord-herstellen/`), `mails.js`, `views.js`.
- Bevestigen vraagt link én wachtwoord; opnieuw registreren van een onbevestigd adres overschrijft het wachtwoord en laat oude links vervallen.
- Inloglimieten gelijk aan het CRM; cookie `avanta_reiziger` (HttpOnly, SameSite=Strict, Secure, pad `/account`), eigen CSRF-sleutel; `Referrer-Policy: no-referrer` en `no-store` op alle accountpagina's.
- Captcha-acties `registreren` en `wachtwoord`; auditacties `reiziger.*` met omschrijving in het CRM-auditlog.
