---
titel: Migraties in één bestand per migratie
---

## Changelog
Modulestructuur, stap 1 (geen gedragswijziging): de 28 databasemigraties staan niet meer in één groot
`app/src/database/migrations.js` maar elk in een eigen bestand `app/src/database/migrations/NNN-korte-naam.js`.
`migrations.js` is de lader: hij leest de map op volgorde en weigert te starten bij een gat, een dubbel nummer, een
afwijkend `id` of een verkeerde bestandsnaam. De inhoud van elke migratie (nummer, naam en SQL) is byte voor byte
gelijk gebleven. Een nieuwe migratie is voortaan een nieuw bestand, zodat twee takken niet meer in hetzelfde bestand
werken. `migrations/laatste-nummer.txt` bevat het laatste nummer, zodat twee takken met hetzelfde nummer een
git-conflict krijgen in plaats van een app die na de merge niet start. Nieuw: `docs/ARCHITECTUUR.md` met de indeling in modules, de gedeelde kernbestanden en de regels voor
parallel werken.
