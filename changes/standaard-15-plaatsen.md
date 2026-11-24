---
titel: Standaard 15 plaatsen bij een nieuwe reis
---

## Nieuws
- Bij een nieuwe reis staat het aantal plaatsen vooraf op 15, het normale maximum aantal deelnemers. Kantoor past de standaard aan in Beheer > CRM > Reizen; bestaande reizen veranderen niet.

## Changelog
- Nieuwe instelling `tripDefaultCapacity` (Beheer > CRM, sectie Reizen; standaard 15, 1 tot en met 10000). `/app/reizen/nieuw/` vult *Aantal plaatsen* daarmee in (`defaultCapacity` in `trips/trip-routes.js`, terugval 15); de module Reisaanbod krijgt de instellingen mee.
- Testdata: alle reizen 15 plaatsen; aanmeldingen per reis passen daarbinnen, Wintersport Tirol blijft vol.
