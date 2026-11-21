---
titel: Beheer als eigen omgeving met een tweede zijbalk
---

## Nieuws
- Beheer staat nu in een eigen omgeving, zoals in AquaTech: in de hoofdzijbalk staat één knop *Beheer*, en daarin
  vind je alle onderdelen (gebruikers, instellingen, e-mail, beveiliging, back-ups, vindbaarheid) in een tweede
  zijbalk, met een zoekveld en een weg terug naar het CRM. Op de telefoon opent een knop boven de pagina die lijst.

## Changelog
- `crm/layout.js`: de groepen van Beheer en het zoekveld zijn uit de hoofdzijbalk; daar staat één ingang *Beheer*
  (`/app/beheer/` met recht `systeem`, anders `/app/gebruikers/` met recht `gebruikers`). Op paden onder
  `/app/beheer/`, `/app/gebruikers/` en `/app/auditlog/` (`isBeheerPath`) tekent `renderCrmPage` een tweede zijbalk
  (`aside.crm-sub`) met *Terug naar het CRM*, het zoekveld en de groepen; Gebruikers en Auditlog zijn daarheen
  verhuisd en tellen mee bij het zoeken.
- `public/js/crm.js`: inklapbare groepen gedeeld door beide zijbalken; knop `data-sub-toggle` voor de tweede zijbalk op
  een smal scherm.
- `site.css`: stijl `.crm-beheer`/`.crm-sub` (licht, terracotta markering, sticky); regels van de ingeklapte
  hoofdzijbalk gelden alleen nog binnen `.crm-nav`.
