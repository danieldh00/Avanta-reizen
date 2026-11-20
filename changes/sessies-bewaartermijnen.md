---
titel: Sessieduur en bewaartermijnen instelbaar
---

## Nieuws
- In Beheer > Toegang en beveiliging > Sessies en bewaartermijnen stel je in na hoeveel uur zonder activiteit iemand
  wordt uitgelogd, hoe lang een sessie hoogstens duurt en hoe lang het auditlog, de IP-adressen daarin en de 404-lijst
  bewaard blijven.

## Changelog
- Instellingen `sessionIdleHours` (1–24, standaard 8), `sessionMaxDays` (1–30, standaard 7), `auditRetentionMonths`
  (6–120, standaard 24), `auditIpRetentionDays` (7–730, standaard 90) en `notFoundRetentionDays` (7–365, standaard 90).
- `crm/auth.js`: de sessieduur komt uit de instellingen; korter geldt meteen, ook voor bestaande sessies (een sessie
  ouder dan de maximale duur telt als verlopen), een langere maximale duur alleen voor nieuwe sessies; de cookie krijgt de ingestelde levensduur.
- Dagelijks onderhoud (`purgeExpired`): auditregels na de bewaartermijn weg, IP-voorvoegsels in het auditlog na hun
  termijn gewist (de regel blijft), sessies ouder dan de maximale duur weg; de 404-lijst volgt de eigen termijn.
