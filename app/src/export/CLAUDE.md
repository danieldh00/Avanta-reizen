# Export (`app/src/export/`)

Alleen wat voor deze map geldt; de algemene regels staan in de root-`CLAUDE.md` en gaan bij tegenspraak voor.
Indeling in modules en parallel werken: `docs/ARCHITECTUUR.md`. Wie in deze map een bestand toevoegt of de rol van
een bestand verandert, werkt dit bestand bij in dezelfde PR (niet de tabel in de root).

## Bestanden
- `xlsx.js`: eigen .xlsx-schrijver (zip via `node:zlib`, formule-injectie onschadelijk)
- gebruik hem voor elke Excel-export
