# Testdata (`app/src/dev/seed/`)

Alleen wat voor deze map geldt; de algemene regels staan in de root-`CLAUDE.md` en gaan bij tegenspraak voor.
Indeling in modules en parallel werken: `docs/ARCHITECTUUR.md`. Wie in deze map een bestand toevoegt of de rol van
een bestand verandert, werkt dit bestand bij in dezelfde PR (niet de tabel in de root).

## Bestanden
- testdata voor de testomgeving: `data.js` (verzonnen inhoud, `test-`-slugs, `@example.com`)
- `seed.js` (ook berichten via het contactformulier; `seedBlockReason`: weigert op avantareizen.nl, bij indexeren en zonder `--testomgeving`; vullen via `persons/persons.js` en `payments/payments.js`, verwijderen alleen testdata)
- `cli.js`; via `servertaken.sh testdata`
