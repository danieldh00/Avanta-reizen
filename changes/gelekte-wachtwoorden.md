---
titel: Controle op gelekte en veelgebruikte wachtwoorden
---

## Nieuws
- Een nieuw wachtwoord in het CRM of het reizigersaccount mag geen veelgebruikt woord of reeks meer zijn en wordt
  vergeleken met wachtwoorden uit bekende datalekken (Have I Been Pwned). Aan- en uitzetten in Beheer > Toegang en
  beveiliging > Wachtwoorden.

## Changelog
- Nieuw `app/src/security/password-check.js` (audit A09, ASVS 2.1.7): vaste regels uit `crm/passwords.js`, lokale
  controle (veelgebruikte woorden, samenstellingen en herhalingen daarvan, toetsenbord- en telreeksen, met hoogstens
  een jaartal of tekens eromheen) en de range-API van Have I Been Pwned (k-anonimiteit: 5 tekens van de SHA-1,
  `Add-Padding`, 3 s tijdslimiet, antwoord hoogstens 1 MB, ook zonder `Content-Length`). Onbereikbaar: alleen lokaal, logboekregel (bron
  `wachtwoordcontrole`) hoogstens eens per kwartier.
- Gebruikt bij installatie, eigen wachtwoord wijzigen, nieuwe gebruiker en wachtwoord instellen door de beheerder
  (CRM), en bij registreren, wachtwoord wijzigen en wachtwoord herstellen (reizigersaccount).
- Instelling `passwordBreachCheck` (standaard aan, startwaarde via `PASSWORD_BREACH_CHECK`) in de nieuwe sectie
  Beheer > Toegang en beveiliging > Wachtwoorden, met een paneel met de stand en de laatste uitkomsten (zonder
  wachtwoord, hash of gebruiker; `beheer/password-check-panel.js`).
- `npm test` draait met `PASSWORD_BREACH_CHECK=false`.
