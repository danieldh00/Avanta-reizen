# Opzet: website Avanta Reizen nabouwen (fase 1) en CRM (fase 2)

Status: fase 1 grotendeels gebouwd (2026-11-19): skelet, import, pagina's en aanmeldformulier. Bron: analyse van de huidige site www.avantareizen.nl (WordPress + Gravity Forms + Pronamic Pay).

## Doel
1. **Fase 1 — website**: de huidige publieke site 1-op-1 functioneel nabouwen in eigen code, met dezelfde URL's (geen
   SEO-verlies bij overstap), dezelfde huisstijl en alle content overgezet.
2. **Fase 2 — CRM**: achter de site een beheeromgeving (`/app/`) voor reizen, vertrekdata, aanmeldingen, deelnemers,
   reisleiders en betalingen. De aanmelding op de site komt direct in het CRM.

## Huidige site (inventaris)
| Onderdeel | Aantal | URL-patroon | Bron |
|---|---|---|---|
| Reizen (één per vertrek, met reiscode) | 119 | `/reis/<slug>/` | HTML (eigen posttype, niet in REST-API) |
| Reiscategorieën (bestemming, type) | 83 | `/reis-categorie/<slug>/` | HTML |
| Reisleiders | 96 | `/reisleider/<slug>/` | HTML |
| Blogberichten | 58 | `/<slug>/`, overzicht `/blog/` | REST-API `wp/v2/posts` |
| Pagina's | 36 | `/<slug>/`, `/avanta-reizen/…` | REST-API `wp/v2/pages` |
| FAQ + categorieën | 16 + 5 | `/faq/…`, `/faq-categorie/…` | HTML |
| Blogcategorieën / tags | 21 / 5 | `/category/…`, `/tag/…` | REST-API |

**Reis bevat**: titel, intro/kenmerken, lange omschrijving, prijs (all-in), bijkomende kosten, reiscode
(bijv. `26-NAM-293`), vertrekdatum, reisduur, bestemming(en), reisleider, type(s) (jeugd, jongeren, plus, kamperen,
hostel, vliegreis, Avanta-vervoer, OV), status (gegarandeerd vertrek, volgeboekt, nog x plaatsen), fotogalerij.

**Homepage**: slider, last-minutes, reistypes, inspiratie, zoeker (bestemming / type / vertrekdatum), populair,
blog, over Avanta.

**Aanmelden** (`/aanmelden/?id=<reis>`): reisgegevens + bedragen (aanbetaling, boekingskosten €15, SGR-garantie €5,
restant), persoonsgegevens, adres, beroep, kerkgenootschap, noodnummer, paspoort/ID (nr., geldig tot, nationaliteit),
reisgenoot, bijzonderheden (medisch), eerdere reizen, creditcard, chauffeur (interesse/ervaring), betaalmethode
(iDEAL of handmatig), aanbetaling of volledig, akkoord voorwaarden.

**Huisstijl**: tekst `#434248`, accent terracotta `#c47362`, groen `#81986a`, grijs `#6b6b6b`/`#bcbcbd`;
koppen Playfair Display, tekst Open Sans.

## Keuzes (aanbeveling)
| Onderwerp | Keuze | Waarom |
|---|---|---|
| Backend | Node 22 + Express, server-gerenderde HTML | geen build-stap buiten het image (daar alleen verkleinen van CSS/JS), snel, SEO-vriendelijk; CRM in dezelfde app |
| Database | PostgreSQL 17 | CRM-gegevens en content in één database |
| Frontend | gewone HTML/CSS/JS, geen CDN, fonts lokaal | AVG (geen Google Fonts/trackers) |
| Content-overzetting | eenmalig importscript (`tools/import-wordpress.js`) → PostgreSQL; afbeeldingen naar de dataopslag | herhaalbaar tot go-live |
| Formulieren | eigen formulieren met eigen captcha en limieten | geen reCAPTCHA (Google) |
| Betalen | iDEAL via Mollie (of de huidige provider), pas bij go-live | nu alleen "handmatig" |
| Hosting | Docker op de eigen server | updaten vanuit de app |
| Indexeren | **noindex tot go-live** | geen dubbele content naast de huidige site |

## AVG-aandachtspunten (vóór het CRM)
- **Kerkgenootschap** (religie) en **bijzonderheden/medisch** (gezondheid) zijn bijzondere persoonsgegevens (art. 9 AVG).
  Vraag: is kerkgenootschap echt nodig? Zo ja: uitdrukkelijke toestemming, versleuteld opslaan, beperkte toegang.
- Paspoortnummer en geboortedatum versleuteld opslaan; alleen zichtbaar voor rollen die het nodig hebben.
- Bewaartermijn per gegevenstype; automatisch opschonen na afloop van de reis + termijn.
- Geen trackingscripts van derden zonder cookietoestemming.

## Fasering (kleine PR's)
1. ✅ Opzet + context + inventaris.
2. ✅ App-skelet: Express, PostgreSQL-migraties, layout/huisstijl, header/footer/menu, health-check, tests.
3. ✅ Importscript: reizen, reisleiders, categorieën, blog, pagina's, FAQ, media (1776 afbeeldingen).
4. ✅ Pagina's: home, reisoverzicht met zoeker/filters, reisdetail, categorie, reisleiders, blog, FAQ, zoeken, losse pagina's.
5. ✅ Aanmeldformulier → opslag in database (basis voor CRM), bevestigingsmail aan reiziger (en ouder onder de 16).
6. ✅ Contactformulier, sitemap.xml (actief zodra indexeren aan staat), online betalen via Mollie (optioneel). ⏳ Nieuwsbrief.
7. ✅ CRM fase 2: aparte opzet in `docs/OPZET-CRM.md`; AVG-documenten in `docs/avg/`.

## Open vragen
1. Hosting voor productie: nog open (audit A01). De testomgeving draait in Docker achter een tunnel.
2. Betaalprovider: Mollie gebouwd (optioneel, Beheer > CRM > Online betalen).
3. Uiterlijk: zelfde ontwerp als nu, of meteen een opgefriste versie in dezelfde huisstijl?
4. Kerkgenootschap: blijft, vrijwillig met eigen toestemming (besluit 21-11-2026).
