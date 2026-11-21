---
titel: Deelnemerslijst per vertrek als Excel-bestand
bump: minor
---

## Nieuws
- Nieuw in het CRM: *Deelnemerslijsten*. Per vertrek download je een Excel-bestand met alle deelnemers. Bijzondere
  gegevens (identiteit, gezondheid, kerkgenootschap) komen er alleen in als je ze aanvinkt en het recht hebt.

## Changelog
- `/app/deelnemerslijsten/` (recht `export.deelnemers`, nog niet voor de reisleider): overzicht van reizen met
  aanmeldingen en per reis een POST-export (.xlsx via `export/xlsx.js`) met blad *Deelnemers* en *Over deze lijst*.
- Geannuleerde aanmeldingen vallen weg; NAW uit `persons`, anders de momentopname van de aanmelding.
- Categorieën per vinkje, server-side op recht gecontroleerd (403); art. 9-blokken alleen met een niet ingetrokken
  toestemming, anders "(geen toestemming)". Audit `export.deelnemers` en `export.deelnemers.<categorie>` per reis.
- Limiet 30 exports per gebruiker per 10 minuten; `Cache-Control: no-store`. Link vanuit de aanmeldingenlijst per reis.
