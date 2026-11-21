---
titel: Personen en toestemmingen in het CRM (migratie 10)
bump: minor
---

## Nieuws
- Een aanmelding komt nu ook bij een persoon in het CRM: één persoon, meerdere reizen. Dezelfde persoon wordt herkend
  op e-mailadres en geboortedatum; het formulier overschrijft nooit bestaande gegevens, bij twijfel staat de persoon
  als *mogelijk dubbel* klaar voor kantoor.
- Kerkgenootschap en bijzonderheden (gezondheid) zijn vrijwillig en worden alleen bewaard met een eigen
  toestemmingsvinkje. Elke toestemming wordt met de versie van de tekst vastgelegd.

## Changelog
- Migratie 10: tabellen `persons` (NAW leesbaar; `identity_data`, `special_data`, `health_data`, `emergency_data`
  apart versleuteld met AAD `persons:<blok>:<id>`; `match_key` = HMAC-SHA256 over e-mail + geboortedatum met een via
  HKDF afgeleide sleutel; `duplicate_of`) en `consents` (`voorwaarden`, `art9_religie`, `art9_gezondheid`, met
  `text_version`); `bookings.person_id`, `bookings.sensitive_data` mag leeg.
- `crm/persons.js`: zoeken of aanmaken in de transactie van de aanmelding (advisory lock per e-mailadres), alleen lege
  velden aanvullen, anders nieuwe persoon met `duplicate_of`; toestemmingen vastleggen; `backfillPersons` zet bij het
  starten oude aanmeldingen om (per aanmelding een transactie, alleen aantallen in het log).
- `vault.deriveKey(doel)` (HKDF-SHA256) voor afgeleide sleutels.
- Aanmeldformulier: kerkgenootschap niet meer verplicht; vinkjes `consent_religion` en `consent_health` (`consentFor`),
  verplicht zodra het bijbehorende veld is ingevuld.
