---
titel: Teksteditor (WYSIWYG) voor blokken en reisomschrijving
bump: minor
---

## Nieuws
- Tekstblokken, de reisomschrijving, reistypes en landen, reisleiders en FAQ-antwoorden bewerk je nu in een teksteditor: je ziet de tekst zoals op de site, Enter begint een nieuwe alinea en kopjes, vet, cursief, lijsten, citaat en links zet je met de knoppen. Geen `<p>` of `<br>` meer typen; met de knop *HTML* kan het nog wel.
- Een reis met een lange omschrijving of veel velden opslaan gaf soms een fout; dat is opgelost.

## Changelog
- Nieuwe eigen teksteditor zonder externe bibliotheek: `public/js/rich-editor.js` (contenteditable met knoppenbalk, plakken opgeschoond, HTML-weergave) en `public/js/rich-text-clean.js` (opschoner met dezelfde allowlist als `sanitizeHtml`, ook in Node getest). Zet zich op elk `textarea.cms-richtext`; zonder JavaScript blijft het tekstvak. Vervangt de oude opmaakknoppen in `crm.js`.
- Reisomschrijving (`/app/reizen/`) en tekst van reistypes en landen gebruiken de editor; nieuwe uitleg `RICHTEXT_HELP`.
- Formulieren onder `/app/reizen/` en `/app/reistypes-en-landen/` krijgen een eigen limiet (512 kB, 400 velden); de algemene limiet van 20 velden liet het opslaan van een reis mislukken.
- Bij velden met een maximum (reisleiders, FAQ) toont de editor een teller met de lengte van de HTML.
- Server-side opschoning (`sanitizeHtml`) ongewijzigd.
