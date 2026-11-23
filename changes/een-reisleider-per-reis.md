---
titel: Eén reisleider per reis
---

## Nieuws
- Een reis heeft voortaan één reisleider. Het bewerkscherm van een reis toont één keuzeveld *Reisleider* in plaats van drie.

## Changelog
Een reis heeft hoogstens één reisleider (besluit 23-11-2026). `validateTrip` leest het veld `reisleider` en bewaart
hoogstens één id; de drie velden `reisleider_1` t/m `reisleider_3` en `MAX_GUIDES` vervallen. De koppeltabel
`trip_guides` blijft ongewijzigd (geen migratie): een reis die nog meer dan één reisleider heeft, houdt die tot hij
opnieuw wordt opgeslagen; daarna blijft alleen de gekozen reisleider over.
