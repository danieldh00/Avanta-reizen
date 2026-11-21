---
titel: Inzage-export en persoon wissen bij AVG-verzoeken
---

## Nieuws
- Bij een deelnemer staan nu de AVG-verzoeken: *Gegevens exporteren* geeft een Excel-bestand met alles wat het CRM van die persoon bewaart, en *Persoon wissen* anonimiseert de persoon direct (ook het reizigersaccount). *Nu opschonen* in Beheer vraagt nu een bevestiging.

## Changelog
- Nieuw recht `avg` (beheerder, kantoor) en `crm/person-privacy-routes.js`: POST `/app/deelnemers/:id/inzage/` (.xlsx met bladen Persoon, Aanmeldingen, Historie, Toestemmingen en Over deze export; blokken alleen met het recht van dat blok; audit `deelnemer.inzage` + per blok; limiet 20 per 10 min) en POST `/app/deelnemers/:id/wissen/` (bevestiging WISSEN, `anonymizePerson`, reizigersaccount met hetzelfde e-mailadres verwijderd, audit `deelnemer.gewist`).
- *Nu opschonen* vraagt een bevestigingsvinkje (422 zonder); de auditregel `avg.opschonen` verwijst nu naar de ronde in `retention_runs` (`run.runId`).
