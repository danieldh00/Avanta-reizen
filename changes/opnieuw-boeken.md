---
titel: Opnieuw boeken met je gegevens alvast ingevuld
---

## Nieuws
- Ben je ingelogd met je reizigersaccount en meld je je aan voor een reis, dan staan je naam, adres en telefoon van je vorige aanmelding (ingelogd gedaan) al ingevuld. Bijzondere gegevens en je paspoort vragen we elke keer opnieuw.

## Changelog
- Migratie 24 `aanmelding-bij-account`: kolom `bookings.customer_account_id` (met index). Een aanmelding van een ingelogde reiziger met het e-mailadres van het account krijgt het account-id.
- `booking/routes.js`: opties `prefill` en `customerFor`; bij een ingelogde reiziger vult GET `/aanmelden/` de gewone velden in uit de laatste eigen aanmelding (`account/routes.js` → `prefillFor`, velden `PREFILL_FIELDS`), met een melding boven het formulier. Op e-mailadres alleen nooit: het formulier bevestigt dat adres niet.
- Cookie `avanta_reiziger` staat nu op pad `/` (de oude cookie op `/account` wordt bij inloggen en uitloggen gewist).
