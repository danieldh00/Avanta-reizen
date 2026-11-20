---
titel: Doorverwijzingen en 404-lijst in Beheer
---

## Nieuws
- In Beheer > Vindbaarheid kun je oude adressen doorverwijzen naar de nieuwe pagina (301 of 302).
- *Niet gevonden (404)* toont welke adressen bezoekers en zoekmachines vragen die niet bestaan, met een knop om ze
  meteen door te verwijzen.

## Changelog
- Migratie 6: tabellen `redirects` (uniek `from_path`, status 301/302, notitie, teller) en `not_found_log` (pad, aantal,
  eerste/laatste keer, host van de verwijzer; indexen op `last_seen_at` en `hits`).
- `site/redirects.js`: genormaliseerde paden, doorverwijzingen in het geheugen (middleware vóór statische bestanden en
  site; alleen GET/HEAD, querystring gaat mee, pad zonder slash telt ook met slash), 404's en gebruik geteld in het
  geheugen en per minuut weggeschreven, hoogstens 5000 regels (de vaakst gevraagde nieuwe eerst), opruimen na 90 dagen.
  Nooit querystring, volledige verwijzer of IP-adres (AVG); `/app/` en `/api/` (ook in hoofdletters) vallen erbuiten.
- `beheer/redirect-routes.js`: secties *Doorverwijzingen* (toevoegen met controle op dubbel, ketens, lussen, homepage en
  CRM; filteren; verwijderen) en *Niet gevonden (404)* (doorverwijzen, regel verwijderen, lijst leegmaken). Auditacties
  `doorverwijzing.aangemaakt`, `doorverwijzing.verwijderd`, `niet-gevonden.verwijderd` en `niet-gevonden.geleegd` (nooit
  een pad uit de 404-lijst in het auditlog).
