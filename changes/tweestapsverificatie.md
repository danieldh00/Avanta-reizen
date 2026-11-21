---
titel: Tweestapsverificatie voor het CRM
bump: minor
---

## Nieuws
- Inloggen in het CRM vraagt na het wachtwoord een code uit een authenticator-app (bijv. Microsoft of Google
  Authenticator). Bij de eerste keer inloggen stel je het in met een QR-code en krijg je tien herstelcodes.
- Een nieuwe gebruiker krijgt van de beheerder een activatiecode (Gebruikers > gebruiker > Activatiecode maken); die is
  nodig om de app te koppelen. De eerste beheerder gebruikt de installatiecode.
- Een beheerder kan de tweestapsverificatie van een collega uitzetten als die zijn toestel kwijt is.
- Na deze update logt iedereen opnieuw in.

## Changelog
- Migratie 9: `users.totp_secret` (versleuteld, AAD `users:totp:<id>`), `totp_enabled_at`, `totp_last_step`,
  `totp_recovery` (SHA-256), `totp_activation_hash`/`totp_activation_expires_at`; `sessions.mfa_setup_ok`; bestaande
  sessies vervallen. Verkeerde codes per account in `users.totp_failures` (5 per kwartier, overleeft een herstart).
- Activatiecode (eenmalig, 7 dagen, SHA-256) verplicht voor instellen vanuit een halve sessie, gebonden aan die sessie
  (`POST /app/tweestaps/activeren/`, `POST /app/gebruikers/:id/activatiecode/`).
- `crm/totp.js` (TOTP volgens RFC 6238, herstelcodes) en `crm/qr-code.js` overgenomen uit AquaTech; `crm/two-factor.js`
  met de opslag, de codestap `/app/inloggen/code/` en het scherm `/app/tweestaps/` (instellen, nieuwe herstelcodes,
  uitzetten als het niet verplicht is).
- Halve sessie na het wachtwoord (`mfa_ok` onwaar, 15 minuten, alleen de tweede stap bereikbaar); na de code een nieuwe
  sessie met een nieuw token. Verkeerde codes tellen per account in de database (5 per kwartier), los van het IP-adres.
- Instelling `mfaRequiredFor` (Beheer > Toegang en beveiliging > Tweestapsverificatie): iedereen (standaard) of alleen
  rollen met `gegevens.*`-rechten. Gebruikerslijst toont de 2FA-stand; beheerder kan 2FA uitzetten
  (`POST /app/gebruikers/:id/tweestaps/`). Nieuwe auditacties voor alle stappen.
- `vault.seal`/`open` met optionele context (AAD).
