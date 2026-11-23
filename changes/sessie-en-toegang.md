---
titel: Kortere CRM-sessie en waarschuwingen over toegang in Beheer
---

## Nieuws
- Het CRM logt standaard uit na een uur zonder activiteit en uiterlijk na een dag (was 8 uur en 7 dagen); instelbaar in
  Beheer > Toegang en beveiliging > Sessies en bewaartermijnen.
- De startpagina van Beheer meldt het als tweestapsverificatie nog optioneel is of als er maar één actieve beheerder is.

## Changelog
- Standaard sessieduur CRM: `IDLE_HOURS` 1 en `MAX_DAYS` 1 (`crm/auth.js`), standaard van `sessionIdleHours` en
  `sessionMaxDays` mee (audit A07). Een in Beheer opgeslagen waarde blijft gelden. Het reizigersaccount verandert niet.
- Startpagina Beheer: tegels *Tweestapsverificatie* (open zolang `mfaRequiredFor` op `niemand` staat; audit A05, besluit
  23-11-2026: verplicht maken bij de livegang) en *Actieve beheerders* (open bij minder dan twee; bevinding F07), met een
  melding bovenaan. Zes tegels in drie kolommen (`crm-tiles--three`), op mobiel twee.
