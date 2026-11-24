---
titel: Mobiele site gelijk aan de huidige site, opschonen in Beheer netjes en één keer per dag
---

## Nieuws
- De zoekfilters op de homepage en het reisaanbod zien er op de telefoon weer uit als op de huidige site: geen kaders,
  alles links uitgelijnd, de schakelaar Nieuwe reizen op één lijn en de menuknop met stevige streepjes.
- Reispagina: de kenmerken zijn weer vakjes met alleen het icoon, en de tekst springt op de telefoon in zoals op de
  huidige site. Reiskaarten: Bijkomende kosten staat links onder de prijs.
- Reisleider: het citaat staat tussen aanhalingstekens en de afstanden rond naam, woonplaats en jaar zijn gelijk aan de
  huidige site.
- Beheer > AVG en bewaartermijnen: het bevestigingsvinkje staat boven de knoppen, en Voorbeeld berekenen en Nu
  opschonen staan op één lijn.
- De automatische AVG-opschoning draait echt één keer per dag; eerder startte elke herstart van de app (bij elke update)
  een extra ronde.

## Changelog
- `site.css`: zoekfilter op ≤ 768 px zonder rand en zonder binnenmarge (label, icoon en schakelaar tegen de linkerrand,
  pijltje tegen de rechterrand, geen witruimte onder het derde keuzevak, 22 px boven de zoekknop); `.filter__select-info`
  19 px van de schakelaar; `.menutoggle__open` lijndikte 2,3.
- Reisdetail: de tekstkolom-correctie uit de designcontrole teruggedraaid (op de huidige site springt de tekst in);
  op mobiel `padding: 0 15px` voor `.page-content__text`. Kenmerken (`.trip-types--compact`): vakjes van 60 px met alleen
  het icoon (30 px), die doorlopen op een volgende regel; de naam staat in `title` en voor schermlezers.
- Reiskaart op mobiel: `Bijkomende kosten` en de actiedatum links uitgelijnd.
- Reisleider: `quoteText` (`site/trip-view.js`) zet het citaat tussen “ en ” (zonder dubbele aanhalingstekens);
  `.guide__name` regelhoogte 1, citaat op mobiel 15 px marge onder; correcties op naam, statistieken en jaar uit de
  designcontrole teruggedraaid; stempel op ≤ 1024 px op `right: -40px` en 100 px, zoals de huidige site.
- Beheer > AVG: bevestigingsvinkje in een eigen formulier (`.beheer-confirm`) boven de rij knoppen; *Nu opschonen*
  hoort er via `form=` bij.
- `persons/retention.js`: de planner controleert elk uur (`tick`) en start alleen een dagelijkse ronde als de vorige
  dagelijkse ronde in `retention_runs` minstens 23 uur geleden begon, ook over een herstart heen.
