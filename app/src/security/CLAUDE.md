# Beveiliging (`app/src/security/`)

Alleen wat voor deze map geldt; de algemene regels staan in de root-`CLAUDE.md` en gaan bij tegenspraak voor.
Indeling in modules en parallel werken: `docs/ARCHITECTUUR.md`. Wie in deze map een bestand toevoegt of de rol van
een bestand verandert, werkt dit bestand bij in dezelfde PR (niet de tabel in de root).

## Bestanden
- `vault.js` (AES-256-GCM voor gevoelige velden; formaat `v2.<sleutel-id>`, vorige sleutels om te lezen)
- `key-rotation.js` + `key-rotation-cli.js` (sleutelrotatie: alles opnieuw versleutelen, `match_key` herberekenen; een nieuwe kolom met `vault.seal` hoort hier een regel te krijgen)
- `rate-limit.js`
- `netguard.js` (alleen openbare adressen voor uitgaande verbindingen)
- `captcha.js` (reCAPTCHA v3 op contact/aanmelden)
- `safe-request.js` (https naar door de beheerder ingevulde adressen, alleen openbaar)
- `csp.js` (bronnen toevoegen aan de CSP)
