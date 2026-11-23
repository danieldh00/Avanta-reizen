---
titel: Overzicht in het CRM met Te doen en komende vertrekken
---

## Nieuws
- De startpagina van het CRM laat nu zien wat aandacht vraagt: nieuwe aanmeldingen, te late betalingen, mogelijk
  dubbele deelnemers en reizen in concept. Een klik op een tegel opent de lijst met dat filter.
- Daaronder staan de komende vertrekken met het aantal bezette plaatsen en het openstaande bedrag, en de laatste
  wijzigingen aan aanmeldingen. De beheerder ziet ook de stand van de bewaking, de laatste back-up en de versie.
- Iedereen ziet alleen de onderdelen die bij de eigen rol horen.

## Changelog
Nieuw `app/src/crm/dashboard.js` (`loadDashboard`, `renderDashboard`, `dashboardAccess`) voor `/app/` (vervolgplan
P1.3, bevinding B01); de tijdelijke tekst en de lijst met rechten zijn weg. Per recht één query, parallel; een onderdeel
zonder recht wordt niet opgehaald. *Te late betalingen* gebruikt `loadOverview` (hoogstens 500 aanmeldingen, daarboven
`500+`); openstaand per vertrek telt per niet-geannuleerde aanmelding verwacht min betaald. Geen migratie.
