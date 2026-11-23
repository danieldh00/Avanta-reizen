---
titel: Toestemming van ouder of voogd bij deelnemers onder de 16
---

## Nieuws
- Is een deelnemer op de dag van aanmelden jonger dan 16, dan vraagt het aanmeldformulier de gegevens en de toestemming van een ouder of voogd. De ouder krijgt een eigen bevestiging per mail.
- In het CRM staat bij de deelnemer een blok *Ouder of voogd* en bij elke toestemming wie hem gaf. De deelnemerslijst neemt de ouder mee bij de categorie gezondheid.

## Changelog
- Migratie 29: `persons.guardian_data` (versleuteld blok, AAD `persons:guardian_data:<id>`), `consents.given_by` (`deelnemer` of `ouder_voogd`) en soort `ouder_voogd` (A02 uit de audit).
- `booking/fields.js`: groep *Ouder of voogd* (`guardian: true`), `ageOn`, `needsGuardian`, `GUARDIAN_AGE = 16`; boven de grens worden de velden leeggemaakt. Tekstversie toestemmingen naar `2026-11-23`.
- `persons/persons.js`: blok `guardian_data` (recht `gegevens.gezondheid`), `recordConsents` legt vast wie de toestemming gaf. De toestemming `ouder_voogd` is niet los in te trekken in het CRM.
- `mail/notifications.js`: `guardianConfirmation` (soort `bevestiging-ouder`, nooit bijzondere gegevens), onder dezelfde instelling als de bevestiging aan de reiziger.
- AVG-opschoning, anonimiseren, samenvoegen, inzage-export en deelnemerslijst nemen het nieuwe blok mee. Testdata: deelnemers onder de 16 krijgen een verzonnen ouder.
