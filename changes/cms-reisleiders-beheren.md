---
titel: Reisleiders beheren
bump: minor
---

## Nieuws
- Onder *Website > Reisleiders* beheer je de reisleiders: naam, adres, woonplaats, sinds wanneer bij Avanta, citaat, tekst, portret en tweede foto uit de fotobibliotheek, en online of offline. Je kunt ook een nieuwe reisleider aanmaken.
- Tot je een reisleider voor het eerst opslaat, toont de site de gegevens van de huidige site; die staan al in het formulier en gaan bij opslaan mee.

## Changelog
- Migratie 22: bij `guides` de kolommen `surname`, `city`, `since`, `quote`, `image_url`, `managed_in_crm`, `updated_at` en `updated_by`.
- `trips/guides.js` en `trips/guide-routes.js` (`/app/reisleiders/`, recht `reizen`, audit `reisleider.*`); een ander adres geeft een 301, verwijderen kan alleen offline, zonder reizen en niet uit de import.
- Site: `guideExtra` (`site/site-content.js`) kiest de gegevens uit de database als het CRM de reisleider beheert, anders uit `site-content.json`; de galerij komt nog uit het bestand.
- De WordPress-import laat een reisleider uit het CRM staan en koppelt reizen aan hem, ook na een nieuw adres. De fotobibliotheek ziet de tweede foto als gebruik.
