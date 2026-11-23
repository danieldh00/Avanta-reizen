# Mail (`app/src/mail/`)

Alleen wat voor deze map geldt; de algemene regels staan in de root-`CLAUDE.md` en gaan bij tegenspraak voor.
Indeling in modules en parallel werken: `docs/ARCHITECTUUR.md`. Wie in deze map een bestand toevoegt of de rol van
een bestand verandert, werkt dit bestand bij in dezelfde PR (niet de tabel in de root).

## Bestanden
- `mailer.js` (nodemailer: SMTP of Exchange-connector, alleen openbare adressen, STARTTLS verplicht)
- `wan-ip.js`
- `layout.js` (mail-opmaak, alles ge-escaped)
- `notifications.js` (meldingen aan kantoor, nooit gevoelige velden)
