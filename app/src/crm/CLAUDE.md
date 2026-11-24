# CRM (schil) (`app/src/crm/`)

Alleen wat voor deze map geldt; de algemene regels staan in de root-`CLAUDE.md` en gaan bij tegenspraak voor.
Indeling in modules en parallel werken: `docs/ARCHITECTUUR.md`. Wie in deze map een bestand toevoegt of de rol van
een bestand verandert, werkt dit bestand bij in dezelfde PR (niet de tabel in de root).

## Bestanden
- CRM onder `/app/`: `routes.js` (schil: limiet, formuliergrootte, sessie, en de modules via hun ingang `<module>/index.js` in `persons/`, `booking/`, `payments/`, `trips/`, `cms/`, `media/`, `contact/`; een nieuw scherm komt in de ingang van zijn module)
- `login-routes.js` (inloggen, uitloggen, installatie, wachtwoord wijzigen)
- `dashboard-routes.js` (route van het overzicht; de reisleider krijgt `guide-dashboard.js`)
- `input.js` (`normalizeEmail`, `textField`)
- `users.js` (gebruikers, auditlog, 2FA uitzetten)
- `auth.js` (sessies, halve sessie tot de tweede stap, CSRF, `requireRight`, audit)
- `two-factor.js` (2FA: opslag, codestap `/app/inloggen/code/`, scherm `/app/tweestaps/`)
- `totp.js` (TOTP + herstelcodes)
- `qr-code.js`
- `rights.js`
- `passwords.js`
- `layout.js`
- `menu-counters.js` (tellers naast menu-items, bijv. nieuwe berichten; `counter` in `CRM_MENU`)
- `ui.js` (bouwstenen voor lijsten)
- `dashboard.js` (overzicht `/app/`: per recht ophalen en tekenen)
- `guide-dashboard.js` (overzicht `/app/` voor de reisleider: eigen vertrekken, aantallen, stand van het venster, link naar de deelnemerslijst)
