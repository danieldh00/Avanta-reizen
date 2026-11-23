# Boeken (`app/src/booking/`)

Alleen wat voor deze map geldt; de algemene regels staan in de root-`CLAUDE.md` en gaan bij tegenspraak voor.
Indeling in modules en parallel werken: `docs/ARCHITECTUUR.md`. Wie in deze map een bestand toevoegt of de rol van
een bestand verandert, werkt dit bestand bij in dezelfde PR (niet de tabel in de root).

## Bestanden
- aanmeldformulier: `fields.js` (velden + validatie)
- `routes.js` (`/aanmelden/`)
- aanmeldingen in het CRM (ingang `index.js`): `crm-routes.js` (`/app/aanmeldingen/`: lijst, status met vaste overgangen, notities, `booking_events`)

## Regels
- Deelnemer jonger dan 16 op de dag van aanmelden (`GUARDIAN_AGE`, `needsGuardian` in `fields.js`): de velden met
  `guardian: true` zijn dan verplicht (telefoon niet) en de ouder krijgt `guardianConfirmation`; daarboven maakt
  `validateBooking` ze leeg, zodat er nooit gegevens van een ouder zonder reden worden bewaard. Een nieuwe toestemmingstekst
  betekent `CONSENT_TEXT_VERSION` verhogen.
