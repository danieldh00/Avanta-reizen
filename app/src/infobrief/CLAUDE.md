# Infobrief (`app/src/infobrief/`)

Alleen wat voor deze map geldt; de algemene regels staan in de root-`CLAUDE.md` en gaan bij tegenspraak voor.
Indeling in modules en parallel werken: `docs/ARCHITECTUUR.md`. Wie in deze map een bestand toevoegt of de rol van
een bestand verandert, werkt dit bestand bij in dezelfde PR (niet de tabel in de root).

## Bestanden
- ingang `index.js` (koppelt de routes; de verzender komt uit `services.js` als `infobriefSender`)
- `infobrieven.js` (logica en queries: concept opslaan met `sanitizeHtml`, ontvangers bepalen, wachtrij, verzendoverzicht, `buildMail`)
- `infobrief-routes.js` (`/app/infobrieven/`, recht `infobrief`: opstellen, voorbeeld in een frame met eigen CSP, testmail, versturen, opnieuw, verzendoverzicht .xlsx)
- `sender.js` (versturen in de achtergrond: rondes elke 15 s, limiet `infobriefPerMinute` uit Beheer > E-mail > Infobrief)

## Regels
- Tabellen `infobrieven` en `infobrief_recipients` (migratie 32). In de wachtrij staan alleen aanmelding en rol, nooit
  een e-mailadres: `sender.js` zoekt het adres pas bij het versturen op (persoon, anders formulier; de ouder uit het
  versleutelde blok `guardian_data`).
- Nooit dubbel versturen: versturen alleen vanuit `concept` onder `FOR UPDATE`, unieke sleutel op (infobrief,
  aanmelding, rol), een ontvanger gaat op `bezig` vóór het versturen en wordt na een herstart `onzeker`, nooit
  opnieuw verstuurd. Alleen `mislukt` kan opnieuw.
- Na het versturen verandert de inhoud niet meer; een verstuurde infobrief kan niet worden verwijderd (alleen met de reis).
- De tekst is opgemaakte tekst (`textarea.cms-richtext`, de teksteditor zet zich daar vanzelf op); in de mail gaat hij
  opnieuw door `mail/rich-text.js` (opschonen, volledige adressen, inline stijlen).
