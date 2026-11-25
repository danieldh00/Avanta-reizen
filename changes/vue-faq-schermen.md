---
titel: Veelgestelde vragen in de nieuwe schermen
---

## Nieuws
- De veelgestelde vragen in het CRM werken nu met de nieuwe schermen: zelfde adressen en opmaak, wisselen zonder de
  pagina te herladen, en categorieën en vragen zet je met Omhoog en Omlaag op hun plaats.

## Changelog
- Nieuw: module `faq` in `app/web/src/modules/faq/` (overzicht, vraag toevoegen/wijzigen, categorie wijzigen) op de
  API uit `cms/faq-api.js`, met de bouwstenen uit V1. Proef van fase V2 van de ombouw naar Vue.
- `faq-routes.js`: de GET-routes geven het koppelpunt van de bundel `faq` als die er is (in het image altijd); zonder
  bundel blijven de schermen van de server werken. Een onbekend id blijft een 404 van de server.
- `web/src/shell/page-title.ts`: titel in tabblad en kop bij een wissel binnen een module.
- Design-controle: `app/web/src/modules/faq/` raakt alleen de schermen onder `/app/faq/`.
