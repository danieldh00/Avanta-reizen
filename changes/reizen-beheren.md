---
titel: Reizen aanmaken en wijzigen in het CRM
bump: minor
---

## Nieuws
- In het CRM staat onder *Website* het scherm **Reizen**: reizen zoeken en filteren, een nieuwe reis aanmaken en een
  reis wijzigen (prijs, aanbetaling, plaatsen, teksten, meerdere landen en reistypes, tot drie reisleiders). Een reis
  begint als concept en staat pas op de site na *Gepubliceerd*. Een reis kan nu meer dan één reisleider hebben.

## Changelog
- Migratie 15: tabel `trip_guides` (reisleiders per reis op volgorde, gevuld uit `trips.guide_id`); `trips.guide_id`
  en `trips.destinations` vervallen (landen uit `trip_category_links`); `trips` krijgt `capacity`, `managed_in_crm`,
  `created_at`, `updated_at`, `updated_by` en een index op `lower(trip_code)`.
- Nieuw `app/src/trips/trips.js` en `trip-routes.js` onder `/app/reizen/` (recht `reizen`), auditacties `reis.*`;
  slugwijziging → 301 via `recordMove`.
- Site: reisdetail toont alle reisleiders; zoeken op land via de koppeltabel; reisleiderpagina via `trip_guides`.
- Import (`tools/import-wordpress.js`): schrijft reisleiders naar `trip_guides` en slaat reizen met `managed_in_crm` over.
