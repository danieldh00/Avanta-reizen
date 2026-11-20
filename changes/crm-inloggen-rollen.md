---
titel: CRM - inloggen, rollen en auditlog
bump: minor
---

## Nieuws
- Het CRM heeft een eigen beveiligde omgeving op `/app/`: inloggen, gebruikers met een rol (beheerder, kantoor,
  reisleider, boekhouding) en een auditlog. De eerste beheerder maak je aan met een eenmalige installatiecode uit het
  serverlog.

## Changelog
- Migratie 4: tabellen `users` (uniek e-mailadres, rol, scrypt-hash, blokkade na mislukte pogingen), `sessions`
  (alleen SHA-256 van het token, inactiviteit 8 uur, maximaal 7 dagen) en `audit_log` (zonder persoonsgegevens,
  ingekort IP-adres).
- `app/src/crm/`: rechten als sleutels en rollen als bundels (`rights.js`), `requireRight` en CSRF-controle per route
  (`auth.js`), scrypt-wachtwoorden met rehash (`passwords.js`), inloggen/uitloggen/installatie/eigen wachtwoord
  (`routes.js`), gebruikersbeheer en auditlog (`users.js`).
- `/app/` krijgt `Cache-Control: no-store` en `noindex`; limiet op inloggen, installatie en wachtwoord wijzigen.
- `form-guard.js`: herkomstcontrole los beschikbaar als `isCrossSite`.
