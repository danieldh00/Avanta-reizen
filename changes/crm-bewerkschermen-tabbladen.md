---
titel: Bewerkschermen in het CRM met tabbladen en een vaste opslaanbalk
---

## Nieuws
- Het scherm van een reis is opgedeeld in tabbladen: Algemeen, Prijs, Tekst en programma, Foto's en Aanmeldingen.
  Zichtbaarheid staat in een eigen kolom rechts en de knop *Opslaan* blijft onderaan in beeld.
- Pagina's, blogberichten en reisleiders hebben dezelfde opzet met tabbladen.
- Zit er een fout in een veld, dan opent het tabblad waar dat veld staat.
- *Bekijk op de site* en *Voorbeeld* staan als knop naast de titel.

## Changelog
Tabbladen en opslaanbalk als bouwstenen in `app/src/crm/ui.js` (`renderTabNav`, `renderTabPanel`, `renderSaveBar`) met
het bijbehorende script in `app/public/js/crm.js` (vervolgplan P1.4, bevinding B05). Toegepast op `trips/trip-routes.js`,
`cms/page-routes.js`, `cms/post-routes.js` en `trips/guide-routes.js`. Routes, veldnamen, ankers en validatie zijn
ongewijzigd; zonder JavaScript staan alle panelen onder elkaar. Geen migratie.
