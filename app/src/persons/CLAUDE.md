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
- `retention.js` (AVG-opschoning: bewaartermijnen uit Beheer, `anonymizePerson`, rondes in `retention_runs`; de planner (`tick`, elk uur) start hooguit één dagelijkse ronde per 23 uur, ook na een herstart; een nieuwe tabel met persoonsgegevens hoort hier een regel te krijgen)

## Regels
- Een nieuw blok in `BLOCKS` krijgt ook een kolom (migratie), een recht in `BLOCK_RIGHTS`, een regel in `BLOCK_INFO`
  (`person-routes.js`) en hoort mee in `insertPerson`/`updatePerson`/`mergePersons`, de regel `blokken` en
  `anonymizePerson` in `retention.js`.
- `consents.given_by` zegt wie tekende (`deelnemer` of `ouder_voogd`). Alleen art. 9-toestemmingen zijn in het CRM los
  in te trekken (`isWithdrawable`); de voorwaarden en `ouder_voogd` horen bij de aanmelding.
