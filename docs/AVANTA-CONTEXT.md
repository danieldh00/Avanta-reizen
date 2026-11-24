# Avanta Reizen: projectcontext

Productspecifieke kennis. De algemene werkwijze staat in `docs/WERKWIJZE.md`; het technische werkgeheugen in `CLAUDE.md`;
de opzet van website en CRM in `docs/OPZET-WEBSITE.md`.

## Doel en product
- Avanta Reizen organiseert avontuurlijke, christelijke groepsreizen over de hele wereld: Europese kampeerreizen met
  eigen busjes (all-in), verre vliegreizen, winterreizen; doelgroepen jeugd, jongeren en plus. Zondag is een rustdag.
- Elke reis is één vertrek met een reiscode (bijv. `26-NAM-293`), vertrekdatum, prijs, bijkomende kosten, reisleider,
  bestemming(en) en kenmerken (types). Status: gegarandeerd vertrek, nog x plaatsen, volgeboekt.
- **Fase 1**: de publieke website nabouwen (www.avantareizen.nl, nu WordPress). **Fase 2**: CRM achter de site
  (aanmeldingen, deelnemers, reizen, reisleiders, betalingen, facturen).
- Niet bouwen: eigen boekhouding (koppelen aan het bestaande pakket).

## Bedrijfsregels
- Aanmelden: aanbetaling of totaalbedrag. Boekingskosten €15 (vervallen bij betaling van het totaalbedrag) en een
  verplichte SGR-garantie van €5. Aanbetaling handmatig binnen 24 uur naar NL94 RABO 0385 3731 55, of iDEAL.
- De hoogte van de aanbetaling is een veld per reis (`trips.deposit_cents`); op de huidige site staat die vaak op 0.
- Bijkomende kosten (brandstof, maaltijden, excursies) worden ter plaatse betaald en staan los van de reissom.

## AVG
- Het aanmeldformulier vraagt bijzondere persoonsgegevens: kerkgenootschap (religie) en medische bijzonderheden
  (gezondheid), beide vrijwillig en alleen met een eigen toestemmingsvinkje, plus geboortedatum, paspoortgegevens en
  een noodnummer. Die staan per categorie versleuteld bij de persoon en zijn in het CRM alleen zichtbaar voor rollen
  die ze nodig hebben (inzien met auditregel).
- Deelnemers jonger dan 16 (op de dag van aanmelden): een ouder of voogd geeft de toestemming; diens gegevens staan
  versleuteld bij de persoon en de ouder krijgt een bevestiging (migratie 29).
- Bewaartermijnen en opschonen zijn gebouwd (Beheer > Toegang en beveiliging > AVG en bewaartermijnen, dagelijks
  automatisch); de termijnen zijn voorstellen die Avanta nog moet bevestigen.
- Externe diensten: Google Analytics (GA4) en de onzichtbare captcha (reCAPTCHA v3) zijn gebouwd maar staan **standaard
  uit**; Analytics laadt alleen na toestemming van de bezoeker, YouTube pas na een klik. Online betalen via Mollie en
  back-ups naar Google Drive zijn optioneel. Fonts en scripts staan lokaal, er zijn geen andere trackers.
- Documenten (opzet, door Avanta vast te stellen): `docs/avg/` met verwerkingsregister, verwerkers, DPIA en een
  tekstvoorstel voor de privacyverklaring. Wie iets aan persoonsgegevens verandert, werkt die documenten bij.

## Omgeving
- Repo `danieldh00/Avanta-reizen`, hoofdbranch `main`, applicatie in `app/` (poort 3400).
- Hosting voor productie: nog te kiezen (audit A01; de testomgeving draait in Docker achter een tunnel). Database PostgreSQL 17.
- Huisstijl: tekst `#434248`, accent terracotta `#c47362`, groen `#81986a`; koppen Playfair Display, tekst Open Sans;
  logo `app/public/images/logo.png`.
- Contact: T 0118 638427, E info@avantareizen.nl.

## Voorkeuren
- Nederlands, Europe/Amsterdam.
- Exports als Excel (.xlsx), geen CSV, tenzij expliciet gevraagd.
- Term "KPI's" in plaats van "kengetallen" of "cijfers".

## Projectspecifieke werkafspraken
- Elke PR met wijziging in `app/` krijgt een fragment `changes/<naam>.md`; nooit `version` of `app/CHANGELOG.md` aanraken.
- Reviews: de verplichte checks zijn *Claude code review* en *Claude security review*.
- De nieuwe site blijft noindex tot go-live; de huidige site blijft tot dan de echte site.
- Bij de livegang (besluit 23-11-2026): tweestapsverificatie verplicht voor de rollen met bijzondere gegevens (Beheer >
  Toegang en beveiliging > Tweestapsverificatie op *gegevens*), balk "in ontwikkeling" uit en indexeren aan.
