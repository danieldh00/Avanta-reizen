# Database (`app/src/database/`)

Alleen wat voor deze map geldt; de algemene regels staan in de root-`CLAUDE.md` en gaan bij tegenspraak voor.
Indeling in modules en parallel werken: `docs/ARCHITECTUUR.md`. Wie in deze map een bestand toevoegt of de rol van
een bestand verandert, werkt dit bestand bij in dezelfde PR (niet de tabel in de root).

## Bestanden
- `db.js` (pool, transactie, migreren)
- `migrations.js` (lader van `MIGRATIONS`)
- `migrations/NNN-korte-naam.js` (één bestand per migratie, positioneel)
