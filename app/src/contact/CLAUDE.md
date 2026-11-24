# Contact (`app/src/contact/`)

Alleen wat voor deze map geldt; de algemene regels staan in de root-`CLAUDE.md` en gaan bij tegenspraak voor.
Indeling in modules en parallel werken: `docs/ARCHITECTUUR.md`. Wie in deze map een bestand toevoegt of de rol van
een bestand verandert, werkt dit bestand bij in dezelfde PR (niet de tabel in de root).

## Bestanden
- contactformulier: `fields.js` (velden + validatie)
- `routes.js` (`/contact/`: formulier tonen en versturen, met de controles voor openbare formulieren)
- berichten in het CRM (ingang `index.js`): `messages.js` (lijst, één bericht, afhandelen, weer openen, verwijderen, `countNewMessages` voor de teller) en `message-routes.js` (`/app/berichten/`, recht `berichten`)
