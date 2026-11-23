---
titel: Overzicht in het CRM met Te doen en komende vertrekken
---

## Nieuws
- De startpagina van het CRM laat nu zien wat aandacht vraagt: nieuwe aanmeldingen, te late betalingen, mogelijk
  dubbele deelnemers en reizen in concept. Een klik op een tegel opent de lijst met dat filter.
- Daaronder staan de komende vertrekken met het aantal bezette plaatsen en het openstaande bedrag, en de laatste
  wijzigingen aan aanmeldingen. De beheerder ziet ook de stand van de bewaking, de laatste back-up en de versie.
- Iedereen ziet alleen de onderdelen die bij de eigen rol horen.
- De lijst *Jouw rechten* en de losse knoppen staan niet meer op de startpagina; wachtwoord en tweestapsverificatie
  staan in het gebruikersmenu rechtsboven.

## Changelog
Nieuw `app/src/crm/dashboard.js` (`loadDashboard`, `renderDashboard`, `dashboardAccess`) voor `/app/` (vervolgplan
P1.3, bevinding B01); de tijdelijke tekst en de lijst met rechten zijn weg. Per recht één query, parallel; een onderdeel
zonder recht wordt niet opgehaald. *Te late betalingen* gebruikt `loadOverview` (hoogstens 500 aanmeldingen, daarboven
`500+`); openstaand per vertrek komt uit `outstandingByTrip` in het betaaloverzicht en is gelijk aan *openstaand* op
`/app/betalingen/?reis=<id>`. Elke tegel telt hetzelfde als de lijst waar hij naartoe linkt. Mislukt één onderdeel, dan
toont alleen dat onderdeel een melding en komt de fout (zonder inhoud) in het logboek. Geen migratie.
