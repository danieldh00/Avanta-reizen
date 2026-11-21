---
titel: Opnieuw boeken met je gegevens alvast ingevuld
---

## Nieuws
- Ben je ingelogd met je reizigersaccount en meld je je aan voor een reis, dan staan je naam, adres en telefoon van je vorige aanmelding al ingevuld. Bijzondere gegevens en je paspoort vragen we elke keer opnieuw.

## Changelog
- `booking/routes.js`: optie `prefill`; bij een ingelogde reiziger vult GET `/aanmelden/` de gewone velden in uit de laatste aanmelding met het accountadres (`account/routes.js` → `prefillFor`, velden `PREFILL_FIELDS`), met een melding boven het formulier.
- Cookie `avanta_reiziger` staat nu op pad `/` (de oude cookie op `/account` wordt bij inloggen en uitloggen gewist).
