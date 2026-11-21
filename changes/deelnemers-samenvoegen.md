---
titel: Mogelijke dubbelen samenvoegen
---

## Nieuws
- Een deelnemer die als *mogelijk dubbel* is gemarkeerd, kan kantoor nu samenvoegen met de oorspronkelijke persoon:
  per afwijkend gegeven kies je welke waarde blijft. Aanmeldingen en toestemmingen gaan mee. Is het toch een ander
  persoon, dan haal je de markering weg.

## Changelog
- `crm/person-merge-routes.js`: `GET/POST /app/deelnemers/:id/samenvoegen/` (alleen voor een persoon met
  `duplicate_of`, nooit naar zichzelf; beide rijen in één query op id-volgorde `FOR UPDATE`, zodat er geen deadlock is; formulier gebonden aan het paar via `met`, anders 409) en `POST
  …/niet-dubbel/`; recht `deelnemers.wijzigen`, blokkeuze alleen met het `gegevens.*`-recht van dat blok (anders
  aanvullen). Audit `deelnemer.samengevoegd` (plus per blok met gegevens op het dubbel de keuze, nooit waarden) en `deelnemer.geen-dubbel`. Toestemmingen gaan altijd mee: ze zijn het bewijs van wat de persoon heeft gegeven.
- `persons.mergePersons`: NAW per keuze, blokken `fill`/`keep`/`remove` (opnieuw versleuteld met de AAD van de
  blijvende persoon), `bookings`, `consents` en andere dubbels verhuizen mee, dubbel verwijderd, `match_key` opnieuw.
  `persons.findPerson` voor beide routebestanden.
