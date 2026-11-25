---
titel: Bouwstenen voor de nieuwe schermen (lijsten, formulieren, meldingen)
---

## Nieuws
- Het scherm Beheer > Systeem > Bouwstenen toont nu voorbeelden van de lijst, het filter, zoeken, bladeren,
  tabbladen, de opslaanbalk, formuliervelden, meldingen en het bevestigvenster.

## Changelog
- Frontend (`app/web/src/components/`): `data-table`, `status-badge`, `filter-tabs`, `search-field`, `pager-nav`,
  `tab-panels`, `save-bar`, `form-field`, `text-field`, `confirm-dialog` (modaal `<dialog>`) en `status-message`, met
  de opmaak en het gedrag van de bestaande schermen (`crm.css`, `crm/ui.js`, `public/js/crm.js`): kaarten op mobiel,
  `aria-current`, gekoppelde labels, hulp en fouten, focus terug na het venster, `role` alert of status.
- `beheer/routes.js`: commentaar weer bij de juiste regel (review van de vorige PR).
