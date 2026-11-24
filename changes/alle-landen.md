---
titel: Alle landen van de wereld bij Reistypes en landen
---

## Nieuws
- Bij Reistypes en landen staan nu alle landen van de wereld, met hun Nederlandse naam en landcode. Bestaande landen
  houden hun naam, adres, reizen en foto's.
- De overgebleven lege categorieën uit de oude site (Bestemming, Type, NaN, nederland en de tweede Saudi Arabië) zijn
  opgeruimd; het oude adres van de dubbele Saudi Arabië verwijst door.
- Bij een reis staat boven de landen een zoekveld, zodat je een land snel vindt.

## Changelog
- Migratie 33 (`033-website-alle-landen.js`): kolom `trip_categories.iso_code` (uniek, twee hoofdletters) en de vaste
  lijst van alle 249 ISO 3166-1-codes plus Kosovo (XK). Eerst gaan ongebruikte restcategorieën weg (plaatshouders, namen
  zonder hoofdletter, dubbelingen met een 301 naar de categorie die blijft); dan krijgen bestaande landen hun code
  (herkend op slug of naam en op andere namen zoals `vs`, `saudi-arabie`, `macedonie`), en daarna komen de overige
  landen erbij (slug uit de naam; bezet door een reistype: met de code erachter).
- CRM: kolom *Code* bij de landen en *Landcode (ISO)* op de pagina van een land; zoekveld boven de landen bij een reis
  (`data-checklist-filter` in `public/js/crm.js`; aangevinkte landen blijven zichtbaar; zonder JavaScript de hele lijst).
- Sitemap: alleen reistypes en landen met komende gepubliceerde reizen of eigen inhoud; `llms.txt`: alleen landen met komende reizen of op de
  homepage.
- Tests: `countries-migration.test.js` (lijst en migratie op een database zoals na de import); tests die zelf landen
  maken, beginnen zonder de landenlijst.
