# Boeken (`app/src/booking/`)

Alleen wat voor deze map geldt; de algemene regels staan in de root-`CLAUDE.md` en gaan bij tegenspraak voor.
Indeling in modules en parallel werken: `docs/ARCHITECTUUR.md`. Wie in deze map een bestand toevoegt of de rol van
een bestand verandert, werkt dit bestand bij in dezelfde PR (niet de tabel in de root).

## Bestanden
- aanmeldformulier: `fields.js` (velden + validatie)
- `routes.js` (`/aanmelden/`)
- aanmeldingen in het CRM (ingang `index.js`): `crm-routes.js` (`/app/aanmeldingen/`: lijst, status met vaste overgangen, notities, `booking_events`)
