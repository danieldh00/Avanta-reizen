---
titel: Oude aanmeldingen: kerkgenootschap en gezondheid gaan mee
---

## Nieuws
- Bij het omzetten van aanmeldingen van vóór de personen-tabel gaan kerkgenootschap en medische bijzonderheden nu mee
  naar de deelnemer. Bij de deelnemer staat dan een toestemming met de vermelding dat het oude formulier daar geen losse
  toestemming voor vroeg.

## Changelog
- `persons.backfillPersons`: art. 9-blokken worden overgenomen; per ingevuld art. 9-veld een `consents`-regel met
  `LEGACY_ART9_TEXT_VERSION` ('oud-formulier, geen losse art. 9-toestemming') en de oorspronkelijke `consent_at`.
  Lege velden geven geen art. 9-toestemming. Al omgezette aanmeldingen veranderen niet.
- Zo'n regel telt in het CRM niet als gegeven toestemming: nieuwe art. 9-gegevens opslaan kan er niet op (422), en de
  deelnemerspagina toont "niet los gegeven". Intrekken (en daarmee wissen) kan wel.
