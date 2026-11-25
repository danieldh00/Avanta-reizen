---
titel: Bouwstenen voor de nieuwe schermen (teksteditor, fotokiezer, uploaden)
---

## Nieuws
- Het scherm Beheer > Systeem > Bouwstenen toont nu ook de teksteditor, de fotokiezer en het uploadveld van de
  nieuwe schermen.

## Changelog
- Frontend (`app/web/src/components/`): `rich-text-editor` (zelfde knoppen en opschoner als `public/js/rich-editor.js`
  via `rich-text-tools.ts`; geen `v-html`, inhoud alleen via DOM-knopen na `DOMParser` en de opschoner; link via een
  veld in plaats van een venster van de browser; HTML-code wijzigen; teller bij `maxlength`), `photo-picker`
  (keuzerondjes of vinkjes, zoeken zonder eigen formulier, bladeren, *Geen foto*, oude antwoorden genegeerd, alleen
  lokale adressen) en `upload-field` (soort, grootte en aantal vooraf, melding per veld van de server).
