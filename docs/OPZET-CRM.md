# Opzet: CRM achter de website (fase 2)

Status: voorstel ter beslissing (2026-11-19). Eerst kiezen, dan bouwen. Bouwt voort op fase 1 (`docs/OPZET-WEBSITE.md`),
migraties 1–2 in `app/src/database/migrations/` en `app/src/security/vault.js`.

## 1. Doel en afbakening
**Wel**
- Eén beheeromgeving onder `/app/` voor reizen, vertrekken, aanmeldingen, deelnemers, reisleiders en betalingen.
- De aanmelding op de site komt direct in het CRM (geen overtypen, geen Gravity Forms meer).
- Reizen in het CRM vervangen de WordPress-import als bron van de publieke site.
- AVG-proof: bijzondere gegevens versleuteld, alleen zichtbaar voor wie ze nodig heeft, met auditlog en opschoning.

**Niet**
- Geen eigen boekhouding (grootboek, btw-aangifte, debiteurenadministratie): export of koppeling naar het bestaande pakket.
- Geen betaalprovider in de MVP-kern (komt als aparte PR na de providerkeuze; tot dan handmatig afboeken).
- Geen klantportaal of reisleider-app in de MVP; geen nieuwsbrieftool (bestaand pakket blijft).

## 2. Modules en prioriteit
| # | Module | Inhoud | Prio |
|---|---|---|---|
| A | Inloggen en gebruikers | accounts, rollen, sessies, 2FA, auditlog | **MVP** |
| B | Aanmeldingen | lijst/filter per reis; status `nieuw → bevestigd → aanbetaald → betaald`, zijtakken `geannuleerd` en `wachtlijst`; notities; statushistorie | **MVP** |
| C | Deelnemers | één persoon, meerdere reizen; ontdubbelen op e-mail + geboortedatum; samenvoegen met controle door kantoor | **MVP** |
| D | Reizen en vertrekken | reis aanmaken/wijzigen/publiceren; `deposit_cents`, `capacity`, plaatsen-teller (berekend) i.p.v. tekst "[NOG 2 PLAATSEN]"; status gegarandeerd/volgeboekt automatisch | **MVP** |
| E | Deelnemerslijsten | per vertrek een **Excel-export (.xlsx, nooit CSV)**; varianten kantoor (volledig) en reisleider (beperkt) | **MVP** |
| F | Betalingen (handmatig) | verwachte bedragen per aanmelding (aanbetaling, restant, boekingskosten €15, SGR €5), betaling afboeken, openstaand saldo | **MVP** |
| G | Reisleiders | profiel (publiek deel bestaat al in `guides`), koppeling aan vertrek, account met rol reisleider | later (fase 2b) |
| H | Facturen | factuurnummer, PDF, export naar het boekhoudpakket | later |
| I | Betaalprovider | iDEAL-betaallink, webhook zet betaling automatisch | later (na keuze) |
| J | E-mails en communicatie | bevestiging, betaalherinnering (aanbetaling/restant), reisinformatie per vertrek, logboek verzonden mails | later (na mailkeuze); bevestiging zo vroeg mogelijk |
| K | KPI's-dashboard | bezetting per vertrek, aanmeldingen per week, omzet geboekt/ontvangen, openstaand, conversie wachtlijst | later |
| L | Content (blog, pagina's, FAQ) | beheren in het CRM i.p.v. WordPress-import | later (laatste stap vóór uitzetten WordPress) |

## 3. Datamodel
Uitgangspunt: bestaande tabellen blijven (`trips`, `guides`, `trip_categories`, `bookings`, …); nieuwe tabellen en
kolommen komen in nieuwe migraties (3, 4, …). Bedragen in centen (`INTEGER`), tijden `TIMESTAMPTZ`.

### Nieuwe tabellen
| Tabel | Kernkolommen | Relaties / indexen |
|---|---|---|
| `users` | `id`, `email` (uniek, lower), `name`, `role`, `password_hash`, `totp_secret` (versleuteld), `active`, `last_login_at` | `guide_id` → `guides` (voor rol reisleider) |
| `sessions` | `token_hash` (SHA-256), `user_id`, `created_at`, `last_seen_at`, `expires_at`, `mfa_ok` | index `user_id` |
| `persons` | `id`, `gender`, `first_names`, `call_name`, `last_name`, `email`, `mobile`, `phone`, `street`, `postal_code`, `city`, `occupation`, `match_key`, `identity_data`, `special_data`, `health_data`, `emergency_data` (versleuteld), `created_at`, `updated_at`, `last_activity_at` | index `lower(email)`, index `match_key` |
| `booking_events` | `booking_id`, `from_status`, `to_status`, `user_id`, `note`, `created_at` | index `booking_id` |
| `booking_charges` | `booking_id`, `kind` (`reissom`, `boekingskosten`, `sgr`, `korting`, `annulering`), `amount_cents`, `due_date` | index `booking_id` |
| `payments` | `booking_id`, `amount_cents`, `method` (`bank`, `ideal`, `handmatig`), `received_on`, `provider_ref`, `user_id` | index `booking_id`; uniek `provider_ref` |
| `invoices` (later) | `number` (uniek, doorlopend), `booking_id`, `issued_on`, `total_cents`, `pdf_name`, `exported_at` | index `booking_id` |
| `emails` (later) | `booking_id`/`person_id`, `template`, `status`, `sent_at`, `error` (geen inhoud met bijzondere gegevens) | index `person_id` |
| `audit_log` | `user_id`, `action`, `entity`, `entity_id`, `created_at`, `ip_prefix` (geen persoonsgegevens in `detail`) | index `(entity, entity_id)`, `created_at`, `(user_id, id)`, `(action, id)`, `(entity_id, id)` (M31) |
| `consents` | `person_id`, `booking_id`, `kind` (`voorwaarden`, `art9_religie`, `art9_gezondheid`), `text_version`, `given_at`, `withdrawn_at` | index `person_id` |

### Wijzigingen aan bestaande tabellen
| Tabel | Wijziging |
|---|---|
| `trips` | `capacity INTEGER`, `min_participants INTEGER`, `booking_open BOOLEAN`, `managed_in_crm BOOLEAN` (import slaat die over); `deposit_cents` bestaat al. `status_label`/`fully_booked` worden berekend uit capaciteit en bezetting |
| `trip_guides` (nieuw, koppel) | `trip_id`, `guide_id`, `role` (`reisleider`, `chauffeur`); vervangt op termijn `trips.guide_id` (meer leiders per vertrek) |
| `bookings` | `person_id` → `persons`, `waitlist_position`, `cancelled_at`, `cancel_reason`, `confirmed_at`; boekingsspecifieke velden blijven (`travel_with`, chauffeur, `payment_choice`, prijs op moment van boeken) |

### Van `bookings` naar `persons` + `bookings`
1. Migratie maakt `persons` en `bookings.person_id` (nullable).
2. Eenmalig script (geen SQL, want ontsleutelen nodig): per aanmelding `sensitive_data` openen, `match_key` berekenen,
   bestaande persoon zoeken of aanmaken, persoonsvelden + versleutelde blokken naar `persons`, `person_id` zetten.
3. Nieuwe aanmeldingen doen hetzelfde in de transactie van het formulier. Twijfelgeval (e-mail gelijk, geboortedatum
   anders) → nieuwe persoon + markering *mogelijk dubbel*; kantoor voegt samen.
4. Volgende migratie: `person_id NOT NULL`; persoonskolommen en `sensitive_data` uit `bookings` verwijderen zodra het
   script overal gedraaid heeft.

**Ontdubbelen zonder geboortedatum leesbaar op te slaan**: `match_key` = HMAC (sleutel afgeleid van de hoofdsleutel) over
genormaliseerd e-mailadres + geboortedatum. Zoeken kan, de geboortedatum blijft versleuteld.

**Versleuteling per categorie** (nu één blok `sensitive_data`), zodat rechten per categorie kunnen:
| Blok | Velden | Wie |
|---|---|---|
| `identity_data` | geboortedatum, nationaliteit, documenttype, -nummer, geldig tot | kantoor; reisleider alleen bij vliegreis/grens |
| `special_data` | kerkgenootschap (art. 9, religie) | alleen beheerder (of vervalt, zie open vragen) |
| `health_data` | bijzonderheden/medisch (art. 9, gezondheid) | kantoor; reisleider van dat vertrek |
| `emergency_data` | noodnummer | kantoor; reisleider van dat vertrek |

## 4. Rollen en rechten
Patroon: rechten als losse sleutels, rollen als vaste bundels; de server controleert elk verzoek met `requireRight(recht)`,
de HTML verbergt alleen. Reisleider-rechten gelden altijd alleen voor vertrekken waar hij/zij via `trip_guides` aan hangt.

| Recht | Beheerder | Kantoor | Reisleider | Boekhouding |
|---|---|---|---|---|
| `gebruikers` (accounts, rollen, auditlog) | ✔ | – | – | – |
| `reizen` (aanmaken, wijzigen, publiceren) | ✔ | ✔ | – | – |
| `aanmeldingen` (inzien, status wijzigen) | ✔ | ✔ | eigen vertrek, alleen lezen | – |
| `berichten` (contactformulier lezen en afhandelen) | ✔ | ✔ | – | – |
| `deelnemers` (NAW, contact, samenvoegen) | ✔ | ✔ | eigen vertrek: naam, mobiel, e-mail | naam + adres |
| `gegevens.identiteit` | ✔ | ✔ | eigen vertrek, binnen het venster (standaard 14 dagen vóór vertrek t/m terugkomst, instelbaar in Beheer > CRM > Reisleider) | – |
| `gegevens.gezondheid` + noodnummer | ✔ | ✔ | eigen vertrek, idem venster | – |
| `gegevens.religie` | ✔ | – | – | – |
| `betalingen` (afboeken) | ✔ | ✔ | – | ✔ |
| `facturen`, export boekhouding | ✔ | – | – | ✔ |
| `export.deelnemers` (.xlsx) | ✔ | ✔ (volledig) | eigen vertrek (beperkt) | – |
| `kpis` | ✔ | ✔ | – | ✔ (financieel) |

- 2FA is optioneel (besluit Daniël 21-11-2026): ieder zet het zelf aan; in Beheer kan het verplicht worden voor rollen
  met een `gegevens.*`-recht of voor iedereen. Een gelekt wachtwoord mag nooit genoeg zijn om 2FA te koppelen: daarvoor
  is altijd een activatiecode van de beheerder nodig.
- Bijzondere gegevens worden nooit in lijsten getoond, alleen op de detailpagina na een klik *Toon* (dat is het
  auditmoment). Exports met bijzondere gegevens worden gelogd.

## 5. AVG
**Grondslag**
| Gegevens | Grondslag |
|---|---|
| NAW, contact, reisgegevens, betalingen | uitvoering overeenkomst (art. 6.1b) |
| Paspoort/ID, nationaliteit, geboortedatum | overeenkomst (vliegtickets, grens, verzekering) |
| Facturen en betalingen | wettelijke plicht (art. 6.1c, fiscale bewaarplicht) |
| Medisch/bijzonderheden | **uitdrukkelijke toestemming** (art. 9.2a), los vinkje, vrijwillig veld |
| Kerkgenootschap | **uitdrukkelijke toestemming** (art. 9.2a), los vinkje, niet verplicht; of schrappen |

- Toestemming apart van "akkoord voorwaarden", met versie van de tekst in `consents`; intrekken kan (wist het blok).

**Bewaartermijnen en opschonen** (dagelijkse taak, in het CRM zichtbaar wat er gewist is, aantallen in het log)
| Gegevenstype | Termijn (voorstel) | Actie |
|---|---|---|
| Medisch, noodnummer | 1 maand na terugkomst | blok `health_data`/`emergency_data` wissen |
| Paspoort/ID | 1 maand na terugkomst (tenzij nieuwe reis geboekt) | blok `identity_data` wissen behalve geboortedatum |
| Kerkgenootschap | 1 maand na terugkomst | blok `special_data` wissen |
| Persoon + contact | 2 jaar na laatste reis/activiteit | persoon anonimiseren |
| Aanmelding, betalingen, facturen | 7 jaar (fiscaal) | bewaren, persoonsvelden geanonimiseerd na 2 jaar |
| Geannuleerd vóór betaling / wachtlijst zonder plaats | 6 maanden | aanmelding wissen |
| Auditlog | 2 jaar | wissen |
| Sessies | na verlopen | wissen |

**Rechten van betrokkenen**
- Inzage: knop *Gegevens exporteren* per persoon (Excel, alle velden incl. ontsleutelde blokken), gelogd.
- Verwijderen: *Persoon wissen* = anonimiseren (naam → "verwijderd", blokken leeg); financiële regels blijven.
- Correctie: gewoon wijzigen, gelogd in de statushistorie.

**Auditlog**: elke `Toon` van een bijzonder blok, elke export, elke wijziging van status, rechten of betaling, elke
login (ook mislukt). Opgeslagen: wie, wat, welk record, wanneer; nooit de waarde zelf.

**Versleuteling**: bestaat (`vault.js`, AES-256-GCM). Uitbreiden met AAD `<tabel>:<blok>:<id>` zodat een blok niet naar
een ander record te kopiëren is, en `derive()` voor de HMAC-sleutel van `match_key`. Hoofdsleutel apart van de
database in de back-up.

## 6. Techniek
- **Plaats**: zelfde Express-app, router onder `/app/`, eigen layout (zelfde huisstijl, compacter), `noindex` en
  `Cache-Control: no-store` op alles onder `/app/`. Dezelfde HTML-aanpak (`html\`…\``, server-gerenderd, formulieren
  met POST, hooguit een klein `app.js` voor filters).
- **Inloggen**: e-mail + wachtwoord; hash met scrypt (Node `crypto`, geen extra pakket), minimaal 12 tekens, rehash bij
  inloggen. Sessie in tabel `sessions` (alleen SHA-256 van het token), cookie `HttpOnly`, `Secure`, `SameSite=Strict`,
  verloop na inactiviteit (bijv. 8 uur) en maximaal 7 dagen.
- **2FA**: TOTP (authenticator-app), eigen implementatie op `crypto`; herstelcodes eenmalig getoond. Standaard
  optioneel; verplicht te maken per instelling `mfaRequiredFor` (niemand / rollen met `gegevens.*` / iedereen). Wie 2FA
  aan heeft of moet hebben: zonder `mfa_ok` alleen de codestap of de 2FA-pagina bereikbaar (halve sessie, 15 minuten).
  Aanzetten vraagt altijd een activatiecode van de beheerder (eerste beheerder: de installatiecode). Gebouwd in M9 (`crm/totp.js`, `crm/two-factor.js`).
- **Eerste beheerder**: eenmalige installatiecode in het serverlog.
- **Rechten op de server**: middleware `requireRight(recht)` per route; vertrek-scope voor reisleider in de query zelf
  (`JOIN trip_guides … WHERE guide_id = $1`). Onbekend of niet-eigen record → 404, ontbrekend recht → 403.
- **CSRF**: token per sessie in elk formulier + herkomstcontrole (bestaat al voor het openbare formulier).
- **Limieten**: `createRateLimiter` op inloggen (per IP en per account), 2FA, wachtwoord-reset en exports.
- **Excel**: één klein `.xlsx`-schrijfmodule zonder CDN; pakketkeuze in de PR (geen CSV-alternatief).
- **Tests**: per route andere eigenaar/vertrek → 404, geen recht → 403, zonder 2FA → doorgestuurd; zelfde PostgreSQL.

## 7. Fasering in kleine PR's
Migratie-PR's (M) draaien na elkaar, nooit parallel; de rest kan parallel zodra de basis er is.

Let op: de nummers in de tabel zijn die van het oorspronkelijke voorstel. Migratie 3 is gebruikt door het
contactformulier (CRM-PR 1 werd M4), en het technische beheer (`/app/beheer/`, goedgekeurd 20-11-2026) gaat vóór de
rest van het CRM: M5 instellingen, M6 doorverwijzingen en 404-lijst, M7 logboek, M8 bewaking. **Geldende nummering
van de CRM-migraties: 2FA M9 (gebouwd), persons M10, aanmeldingen M11, betalingen en opruimen later.** Reizen
beheren (PR 5) vervalt hier: dat valt onder het CMS-pakket G (zie `/mnt/project-files/cms/voorstel-cms-reizen-boekingen.md`),
met eigen migraties na de CRM-kern.

| # | PR | Migratie |
|---|---|---|
| 1 | Gebruikers, sessies, inloggen, rollen/rechten-module, `requireRight`, auditlog, eerste beheerder | **M3** |
| 2 | 2FA (TOTP + herstelcodes) | **M4** (kolommen op `users`); gebouwd als **M9** |
| 3 | `persons` + `consents` + versleuteling per blok + `match_key`; formulier schrijft naar persoon; bestaande aanmeldingen omzetten (bij het starten) | **M5**; gebouwd als **M10** |
| 3b | Deelnemers in het CRM: lijst, zoeken, detail met *Toon* per blok, wijzigen; mogelijke dubbelen samenvoegen (gebouwd) | – |
| 4 | Aanmeldingen: lijst, detail, statusovergangen, `booking_events` (wachtlijst nu niet, zie §8) | **M6**; gebouwd als **M11** |
| 5 | ~~Reizen beheren: CRUD, `capacity`, berekende plaatsen-teller op de site, `trip_guides`, `managed_in_crm` in de import~~ vervalt: CMS-pakket G | ~~M7~~ |
| 6 | Deelnemerslijst per vertrek als .xlsx (kantoor + reisleider-variant) | – |
| 7 | Betalingen handmatig: `booking_charges`, `payments`, saldo (gebouwd) | **M8**; gebouwd als **M26** |
| 8 | AVG: dagelijkse opschoning (**M25**), inzage-export en persoon wissen (recht `avg`), gebouwd | **M25** |
| 9 | Opruimen: persoonskolommen + `sensitive_data` uit `bookings` | **M9** |
| 10+ | later: reisleider-toegang, e-mails, facturen + export, betaalprovider, KPI's-dashboard, content-beheer | per PR |

## Aanbevolen MVP
- Inloggen met rollen en 2FA (optioneel, in Beheer verplicht te maken) (PR 1–2).
- Personen ontdubbeld, met versleuteling per categorie en apart vastgelegde art. 9-toestemming (PR 3).
- Aanmeldingen met status en wachtlijst, plus reizen beheren met capaciteit en een berekende plaatsen-teller (PR 4–5).
- Deelnemerslijst per vertrek als .xlsx en handmatig afboeken van betalingen (PR 6–7).
- Automatisch opschonen, inzage en wissen vóór de eerste echte aanmelding in productie (PR 8).

## 8. Open vragen voor Daniël
Al open (zie `docs/OPZET-WEBSITE.md`): betaalprovider, hosting, regel voor de aanbetaling, mailverzending.

**Beantwoord (Daniël, 21-11-2026)**
- **Kerkgenootschap**: blijft erin. Vrijwillig veld met een eigen toestemmingsvinkje (art. 9.2a), versleuteld in
  `special_data`, alleen zichtbaar met `gegevens.religie` (beheerder).
- **Bestaand klantenbestand / WordPress-import (vraag 8)**: niet importeren; het CRM begint blanco. Aanmeldingen die
  het nieuwe formulier al in `bookings` heeft gezet, zet de app bij het starten om naar personen. Kerkgenootschap en
  bijzonderheden uit die oude aanmeldingen gaan daarbij **niet** mee: het oude formulier vroeg geen losse toestemming,
  dus er is geen grondslag (art. 9.2a; audit A10, vervolgplan P3.2, 23-11-2026; dit vervangt het besluit van 21-11-2026
  om ze wel over te nemen). De voorwaarden krijgen tekstversie `oud-formulier`. Wat eerder wel is overgenomen (regel
  `oud-formulier, geen losse art. 9-toestemming`), wist de app bij het starten (`purgeLegacyArt9`); die regels blijven
  ingetrokken staan als bewijs.
- **Wachtlijst (vraag 6)**: nu niet bouwen. Komt hij later, dan schuift hij automatisch door bij een vrijgekomen plaats.
- **2FA**: optioneel, aanzetten altijd met een activatiecode van de beheerder (gebouwd, M9).

**Nog open**
1. Welk boekhoudpakket (Exact, Moneybird, e-Boekhouden, …) en is een export genoeg of moet het een koppeling zijn?
2. Wie werken er in het CRM en in welke rol (aantal kantoormedewerkers, krijgen reisleiders een eigen account)?
3. Mogen reisleiders medische gegevens en paspoortgegevens van hun groep zien, en vanaf hoeveel dagen vóór vertrek?
4. Akkoord met de voorgestelde bewaartermijnen (§5), in het bijzonder 2 jaar voor klantgegevens na de laatste reis?
5. Annuleringsregels: welke annuleringskosten per periode vóór vertrek, en moet het CRM die berekenen?
6. Reizen beheren: valt onder CMS-pakket G (zie `/mnt/project-files/cms/voorstel-cms-reizen-boekingen.md`).
