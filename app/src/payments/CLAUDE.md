# Betalingen (`app/src/payments/`)

Alleen wat voor deze map geldt; de algemene regels staan in de root-`CLAUDE.md` en gaan bij tegenspraak voor.
Indeling in modules en parallel werken: `docs/ARCHITECTUUR.md`. Wie in deze map een bestand toevoegt of de rol van
een bestand verandert, werkt dit bestand bij in dezelfde PR (niet de tabel in de root).

## Bestanden
- betalingen in het CRM (ingang `index.js`): `payments.js` + `payment-routes.js` (`/app/betalingen/<aanmelding>/`, recht `betalingen`: `booking_charges` verwacht, `payments` ontvangen en nooit wijzigen; saldo, aanbetaling, vervaldatums en betaalstatus altijd berekend met `summarize`, nooit opgeslagen)
- `payment-overview-routes.js` (`/app/betalingen/` + .xlsx)
- `payment-reminders.js` (herinneringen, `payment_reminders`, dagelijkse ronde)
- `mollie.js` + `online-payments.js` + `online-payment-routes.js` (online betalen, optioneel: betaallink `/betalen/<id>-<token>/`, webhook, `online_payments`)
