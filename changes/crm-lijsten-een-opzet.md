---
titel: Lijsten in het CRM in één opzet
---

## Nieuws
- De lijsten Aanmeldingen, Deelnemers, Betalingen en Reizen zien er nu hetzelfde uit: filterknoppen bovenaan (bij
  aanmeldingen en deelnemers met het aantal erbij), daaronder zoeken, statussen als gekleurd label en onderaan bladeren.
- Knoppen als *Nieuwe reis* en *Excel (.xlsx)* staan rechts naast de titel van de pagina.

## Changelog
Gedeelde bouwstenen voor lijsten in `app/src/crm/ui.js` (`renderActions`, `renderFilterTabs`, `renderSearch`,
`renderTable`, `renderStatus`, `renderPager`, `listUrl`), toegepast op Aanmeldingen, Deelnemers, Betalingen en Reizen
(vervolgplan P1.2, bevinding B05). `renderCrmPage` kent `actions` voor de knoppen naast de titel. Aanmeldingen en
Deelnemers tellen per filter binnen de gekozen reis en zoektekst (één extra query per lijst, zelfde voorwaarden en
gebonden parameters). Adressen, filters en rechten zijn ongewijzigd; geen migratie.
