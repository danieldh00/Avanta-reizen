---
titel: CRM met kopbalk, menu in vier groepen en eigen opmaak
bump: minor
---

## Nieuws
- Het menu van het CRM is opnieuw ingedeeld in vier groepen: Boekingen, Reisaanbod, Website en Beheer. Reizen, reistypes en reisleiders staan nu onder Reisaanbod.
- Bovenaan elke pagina staat een kopbalk met het kruimelpad, een link naar de site en een gebruikersmenu met wachtwoord, tweestapsverificatie en uitloggen.
- Het CRM is rustiger en compacter opgemaakt, met beter leesbare knoppen en links.

## Changelog
Eerste stap van het nieuwe backend-ontwerp (vervolgplan P1, bevindingen B02, B03, B05 en B06).
- `crm/layout.js`: `CRM_MENU` in de groepen Boekingen, Reisaanbod en Website, als vaste groepen (`renderMainGroup`) in
  plaats van inklapbare; de tweede zijbalk van Beheer houdt haar inklapbare groepen. Nieuwe kopbalk (`renderHeader`) met
  het kruimelpad (`breadcrumbsFor`: groep, onderdeel en paginatitel uit het menu en de rechten van de gebruiker),
  *Bekijk de site* en het gebruikersmenu (`details.crm-user`); die drie regels zijn uit de zijbalk.
- `public/css/crm.css`: alle opmaak van het CRM en Beheer is uit `site.css` gehaald (site.css 95 → 72 kB) en wordt
  alleen in het CRM geladen, na `site.css`. Nieuwe maten (15 px, koppen in Open Sans, velden 40 px, op een telefoon
  44 px en 16 px) en binnen `.crm` een donkerdere accentkleur `#a8503f` (contrast met wit 5,4:1 in plaats van 3,5:1).
- `public/js/crm.js`: het gebruikersmenu sluit bij een klik ernaast of Esc.
- URL's, rechten en routes zijn ongewijzigd.
