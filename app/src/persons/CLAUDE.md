# Personen (`app/src/persons/`)

Alleen wat voor deze map geldt; de algemene regels staan in de root-`CLAUDE.md` en gaan bij tegenspraak voor.
Indeling in modules en parallel werken: `docs/ARCHITECTUUR.md`. Wie in deze map een bestand toevoegt of de rol van
een bestand verandert, werkt dit bestand bij in dezelfde PR (niet de tabel in de root).

## Bestanden
- personen en deelnemers in het CRM (ingang `index.js`): `persons.js` (personen: ontdubbelen via `match_key`, blokken per categorie versleuteld, `consents`, omzetten oude aanmeldingen)
- `person-routes.js` (`/app/deelnemers/`: lijst, *Toon* per blok met audit, wijzigen, toestemming intrekken; reisleider via `TRIP_SCOPED_ROLES` dicht tot eigen vertrekken bestaan)
- `person-merge-routes.js` (mogelijke dubbelen samenvoegen of markering weghalen)
- `person-privacy-routes.js` (recht `avg`: inzage-export .xlsx en persoon wissen)
- `participant-lists.js` + `participant-list-routes.js` (`/app/deelnemerslijsten/`: Excel-lijst per vertrek; venster en eigen vertrekken van de reisleider uit `trips/guide-window.js`)
- `retention.js` (AVG-opschoning: bewaartermijnen uit Beheer, `anonymizePerson`, rondes in `retention_runs`; een nieuwe tabel met persoonsgegevens hoort hier een regel te krijgen)
