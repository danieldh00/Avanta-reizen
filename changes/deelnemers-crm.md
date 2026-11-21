---
titel: Deelnemers in het CRM
---

## Nieuws
- In het CRM staat nu het scherm *Deelnemers*: zoeken, per persoon de gegevens, aanmeldingen en toestemmingen.
  Bijzondere gegevens (paspoort, gezondheid, noodnummer, kerkgenootschap) zie je pas na *Toon*, en alleen met het
  recht voor dat soort gegevens; elke keer inzien staat in het auditlog.
- Een toestemming voor kerkgenootschap of gezondheid kan worden ingetrokken; de bijbehorende gegevens worden dan gewist.

## Changelog
- `crm/person-routes.js`: `GET /app/deelnemers/` (zoeken per woord met LIKE-escaping, filter `dubbel=1`, pagina's van
  50), `GET /app/deelnemers/:id/`, `POST …/toon/` (blok openen, audit `deelnemer.toon.<blok>`), `POST …/` (NAW,
  `match_key` opnieuw), `POST …/blok/` (blok wijzigen; art. 9 alleen met geldige toestemming), `POST
  …/toestemming/:id/intrekken/` (alleen samen met de persoon opgezocht; wist het blok).
- Nieuw recht `deelnemers.wijzigen` (beheerder, kantoor). `TRIP_SCOPED_ROLES`, `roleHasGlobalRight` en
  `auth.requireGlobalRight`: de reisleider krijgt schermen over álle records pas met de eigen-vertrekbeperking.
- `validateFields` in `booking/fields.js` (deel van de velden controleren); `persons.writeBlock` en `refreshMatchKey`.
- CSS: zoekbalk, twee kolommen, blokken, feitenlijst; `.crm-table-wrap` met `position: relative` (geen horizontale
  scroll van de pagina door verborgen kolomkoppen).
