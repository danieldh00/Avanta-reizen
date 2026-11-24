# Changelog

## 0.30.3 — 2026-11-24 — Auditlog filteren en exporteren naar Excel

- Het auditlog in Beheer heeft nu filters: op gebruiker (ook systeem of onbekend), actie, soort record, recordnummer en
- Met **Excel (.xlsx)** exporteer je dezelfde selectie, met een tweede blad dat vermeldt welke filters zijn gebruikt,

Pakket P4.4 (bevinding F06).
- `crm/audit-log.js` (filters, `auditWhere` met parameters en hele dagen in Europe/Amsterdam, pagina's op id, export met
  maximum van 50.000 regels, werkboek) en `crm/audit-routes.js` (`/app/auditlog/` en `/app/auditlog/export.xlsx`,
  recht `gebruikers`, 10 exports per 10 minuten per gebruiker, 422 boven het maximum); de oude route uit `crm/users.js`
  is vervallen.
- Migratie 31: indexen `audit_log (user_id, id)`, `(action, id)` en `(entity_id, id)`; de keuzelijst *Soort record* komt uit `ENTITIES` in plaats van uit het log.
- Opmaak `.crm-audit-filter` in `crm.css`; design-controle koppelt `crm/audit-*` aan `/app/auditlog/`.

## 0.30.2 — 2026-11-24 — Zoeken over het hele CRM vanuit de kopbalk

- Bovenin het CRM staat nu een zoekveld (op de telefoon een zoekknop). Je zoekt in één keer in aanmeldingen,

Pakket P4.3 (bevinding B03).
- `crm/search.js` (`SEARCH_SOURCES`: per bron het recht, vaste SQL, link en toelichting; `searchCrm` met
  `searchPatterns`) en `crm/search-routes.js` (`/app/zoeken/`, 403 zonder doorzoekbare bron).
- Kopbalk (`crm/layout.js`): zoekveld met de zoekterm, op ≤ 800 px een knop naar de zoekpagina; opmaak in `crm.css`.
- Design-controle: `crm/search*` koppelt aan `/app/zoeken/?q=test`.

## 0.30.1 — 2026-11-24 — Aanmelding handmatig invoeren in het CRM

- Kantoor kan een aanmelding die per telefoon, mail of op papier binnenkomt zelf invoeren: knop **Aanmelding
- Je kiest hoe de aanmelding binnenkwam; dat staat daarna in de historie. De bevestiging aan de deelnemer gaat alleen

Pakket P4.2 (bevinding F02).
- `booking/manual-routes.js`: `/app/aanmeldingen/nieuw/` (recht `aanmeldingen` plus `deelnemers.wijzigen`,
  `gegevens.identiteit`, `gegevens.gezondheid`); velden uit `FIELD_GROUPS` met `validateBooking`, kerkgenootschap alleen
  met `gegevens.religie` (anders genegeerd), bron en toelichting naar `booking_events`, audit `aanmelding.handmatig`,
  bevestiging naar keuze; een bestaande aanmelding voor dezelfde reis, e-mail, achternaam en voornamen houdt het opslaan tegen
  (409, onder het slot op de reis) tot *Toch opslaan* is aangevinkt. Formuliergrootte voor dit pad in `crm/routes.js` gelijk aan `/aanmelden/`.
- `booking/save-booking.js`: het opslaan (slot op de reis, persoon, aanmelding, bedragen, toestemmingen, nieuwe
  referentie bij een botsing) uit `booking/routes.js` gehaald en gedeeld; gedrag van het formulier ongewijzigd.
- `server.js` geeft `notifications` door aan het CRM.

## 0.30.0 — 2026-11-24 — Berichten van het contactformulier afhandelen in het CRM

- Nieuw in het CRM onder Boekingen: **Berichten**. Hier staan de vragen die via het contactformulier binnenkomen, met
- Per bericht zie je de tekst, de afzender (met knop om te mailen of te bellen) en de reis waar de vraag over gaat.

Pakket P4.1 (bevinding F01).
- Migratie 30: `contact_messages` krijgt `handled_at`, `handled_by` (gebruiker, `ON DELETE SET NULL`), `note` en een
  controle op de status (`nieuw`, `afgehandeld`).
- Nieuw recht `berichten` (beheerder, kantoor) en schermen `/app/berichten/` in `contact/messages.js` en
  `contact/message-routes.js` (ingang `contact/index.js`): lijst met filter en zoeken, afhandelen met notitie,
  weer openen en verwijderen met bevestiging, met audit (`bericht.afgehandeld`, `bericht.heropend`,
  `bericht.verwijderd`) en 409 bij een verouderde stand.
- `crm/menu-counters.js`: tellers naast menu-items (`counter` in `CRM_MENU`), alleen bij een GET en met het recht.

## 0.29.9 — 2026-11-24 — HSTS-preload als instelling voor na de livegang

- Beheer > Toegang en beveiliging heeft een schakelaar *HSTS-preload*. Zet hem pas aan na een stabiele periode na de livegang; de controle voor de livegang toont hem als stap voor later.

- `server.js`: `hstsValue()` stuurt `max-age=63072000; includeSubDomains; preload` alleen als `hstsPreload` aan staat, de site live is (`seoIndexing`) en het verzoek op de host van het basisadres (`siteUrl`) binnenkomt; anders blijft het `max-age=31536000`. De testomgeving (altijd noindex, eigen host) krijgt nooit `preload`. De kop wordt pas gezet na `settings.ready()`, dus ook het eerste verzoek na een start volgt Beheer; de instelling heeft geen omgevingsvariabele.
- Nieuwe instelling `hstsPreload` (sectie *HSTS-preload* in Toegang en beveiliging, bevestiging bij aanzetten) en een regel in de controle voor de livegang (`later` tot hij aan staat).
- Tests voor alle voorwaarden, de livegangregel en een integratietest via de echte app (`test/hsts-preload.test.js`); `docs/GO-LIVE.md` §4.5 beschrijft de stappen (subdomeinen, kale domein, hstspreload.org).

## 0.29.8 — 2026-11-24 — Art. 9-gegevens van het oude formulier opruimen

- Kerkgenootschap en medische bijzonderheden uit aanmeldingen van het oude formulier worden niet meer overgenomen en, waar dat eerder wel gebeurde, gewist: het oude formulier vroeg daar geen losse toestemming voor.

- `persons/persons.js`: `backfillPersons` neemt `church` en `particulars` niet meer over en legt geen regel `oud-formulier, geen losse art. 9-toestemming` meer vast; nieuwe `purgeLegacyArt9` wist bij het starten de blokken met zo'n regel (behalve bij een latere echte toestemming van dezelfde soort) en trekt die regels in (bevinding A10). `backfillPersons` geeft nu ook `purged` en `purgeFailed` terug, alleen als aantallen in het log; een fout bij één persoon houdt de opschoning van de anderen niet tegen; per opgeschoonde persoon een auditregel `deelnemer.art9-oud-formulier.gewist` (door het systeem, zonder gegevens).
- `persons/participant-lists.js`: een toestemming uit het oude formulier telt ook in de deelnemerslijst nooit als toestemming.

## 0.29.7 — 2026-11-24 — Toestemming van ouder of voogd bij deelnemers onder de 16

- Is een deelnemer op de dag van aanmelden jonger dan 16, dan vraagt het aanmeldformulier de gegevens en de toestemming van een ouder of voogd. De ouder krijgt een eigen bevestiging per mail.
- In het CRM staat bij de deelnemer een blok *Ouder of voogd* en bij elke toestemming wie hem gaf. De deelnemerslijst neemt de ouder mee bij de categorie gezondheid.

- Migratie 29: `persons.guardian_data` (versleuteld blok, AAD `persons:guardian_data:<id>`), `consents.given_by` (`deelnemer` of `ouder_voogd`) en soort `ouder_voogd` (A02 uit de audit).
- `booking/fields.js`: groep *Ouder of voogd* (`guardian: true`), `ageOn`, `needsGuardian`, `GUARDIAN_AGE = 16`; boven de grens worden de velden leeggemaakt. Tekstversie toestemmingen naar `2026-11-23`.
- `persons/persons.js`: blok `guardian_data` (recht `gegevens.gezondheid`), `recordConsents` legt vast wie de toestemming gaf. De toestemming `ouder_voogd` is niet los in te trekken in het CRM.
- `mail/notifications.js`: `guardianConfirmation` (soort `bevestiging-ouder`, nooit bijzondere gegevens, vaste aanhef zonder vrije tekst in de lopende tekst, hoogstens 10 per ontvangend adres per etmaal, overslaan zichtbaar in het logboek zonder persoonsgegevens), onder dezelfde instelling als de bevestiging aan de reiziger.
- AVG-opschoning, anonimiseren, samenvoegen, inzage-export en deelnemerslijst nemen het nieuwe blok mee. Testdata: deelnemers onder de 16 krijgen een verzonnen ouder.

## 0.29.6 — 2026-11-24 — Design-controle in CI op de gewijzigde schermen

- Nieuwe CI-job `design` (`ci.yml`): draait de design-controle met Playwright alleen op de schermen die een PR raakt, op
  1440 en 375 px, en faalt bij bevindingen met ernst hoog. Een PR zonder geraakt scherm (docs, migraties, beveiliging,
  tests) slaat de job over; op `main` draait hij niet.
- `tools/design-check/changed-screens.js`: koppelt gewijzigde bestanden aan schermen (`SCREEN_RULES`); gedeelde opmaak
  (`site.css`, `crm.css`, `crm/ui.js`, layout) geeft een vaste set kernschermen van dat deel.
- `tools/design-check/ci-summary.js`: korte samenvatting bij de job; het rapport (.xlsx met uitsneden) staat in het
  artefact `design-controle` (7 dagen).
- `check.js`: een pad met `*` volgt in de gerichte run ook op de publieke site links onder dat pad (maximaal twee per
  soort scherm), bijvoorbeeld `/reis/*` voor de reislijst en twee reispagina's.
- `seed.js`: maakt de testbeheerder ook aan als er al gebruikers zijn (bijvoorbeeld na de testdata uit `src/dev/seed/`).
- `page-checks.js`: "afgekapt" telt geen tekst meer mee die in een eigen scroll- of afknipvak ligt (schuifbalk met
  reizen) of verborgen is (inactieve dia's); dat gaf op de homepage een valse melding met ernst hoog.
- Documentatie (`.md`) in een map met schermen start de job niet; mislukt het ophalen van de gewijzigde bestanden, dan
  draait de job op een kleine vaste set (`/` en `/app/`).

## 0.29.5 — 2026-11-24 — Design-controle met Playwright

- Nieuw hulpmiddel `app/tools/design-check/`: Playwright-controle van alle schermen (site, reizigersaccount, CRM,
  Beheer) op 1440 en 375 px op overloop, afgekapte tekst, overlap, ongelijke knophoogtes, scheve randen, tekst tegen de
  schermrand, kapotte afbeeldingen, kleine tekst en kleine klikdoelen; volledige run (`--full`) of alleen opgegeven
  schermen (`--paths=`), uitsneden per bevinding en een Excel-rapport via de eigen .xlsx-schrijver. Geen wijziging aan
  de app zelf; Playwright blijft een ontwikkelhulpmiddel.
- Het wachtwoord van de lokale testaccounts staat niet in de repository: het komt uit `DESIGN_WACHTWOORD` of uit
  `~/.cache/avanta-design-check/wachtwoord`, dat alleen `seed.js` exclusief aanmaakt. Alle scripts weigeren een
  niet-lokale app; `seed.js` ook een database die geen lokale test- of ontwerpdatabase is.

## 0.29.4 — 2026-11-24 — Controle voor de livegang in Beheer

- Nieuw in Beheer > Systeem: **Livegang**. Eén pagina die laat zien wat er nog moet gebeuren voor de overstap naar de

- `beheer/go-live-check.js` (alleen lezen, één query met aantallen) en `beheer/go-live-routes.js`
  (`/app/beheer/livegang/`, recht `systeem`, limiet 60 per minuut); sectie `livegang` in `beheer/instellingen/systeem.js`.
- Plan P6.3/P6.5, bevinding F09: homepage, reisleiders, blogtags en uitgelicht bericht: *Klaar* als ze in het CRM
  staan, anders *Open*; koppen van lijstpagina's, volgorde/galerij van reisleiders en fotogalerijen: *Later* (nog geen
  plek in het CRM, opruimen in P7).
- Tests: `test/beheer-livegang.test.js` (beoordeling zonder database, route: 303 zonder sessie, 403 zonder recht,
  standen, geen e-mailadressen op de pagina).

## 0.29.3 — 2026-11-23 — Afbeeldingen uit de import in de back-up

- De afbeeldingen die van de oude website zijn overgenomen zitten nu ook in elke back-up en worden na het terugzetten

- Bevinding A14 (plan PR 6.2): `backfillImportFiles` in `media/library.js` zet elk importbestand (JPEG, PNG, WebP,
  GIF, tot 15 MB, alleen namen zoals de import ze maakt) byte voor byte in `media_files`, één tegelijk, bij het starten
  en daarna dagelijks. `restoreMissingFiles` zet ook importbestanden ongewijzigd terug (SHA-256-controle).
- Nieuw in `media/images.js`: `importImageWidth` (breedte lezen zonder omzetten). Geen migratie.
- Logboek (bron *fotobibliotheek*): aantal importfoto's in de database gezet en aantal zonder bruikbaar bestand.
- De back-up groeit met de grootte van de import (circa 250 MB). README en draaiboek bijgewerkt.

## 0.29.2 — 2026-11-23 — Publieke CSS en JavaScript verkleind uitgeleverd

- De website laadt sneller: de opmaak en scripts worden verkleind uitgeleverd (samen ongeveer 30% kleiner, de scripts

- Nieuwe bouwstap `minify` in `app/Dockerfile`: `app/tools/minify-public.js` verkleint `public/css/*.css` en
  `public/js/*.js` met esbuild (alleen een ontwikkelafhankelijkheid, vastgepind op 0.28.2) en het image krijgt die
  bestanden over de bron heen. Geen bundelen of omzetten: `url()`-verwijzingen, volgorde en syntaxis blijven gelijk,
  commentaar verdwijnt. Een fout in een bestand laat het bouwen mislukken.
- De bron in `app/public/` blijft leesbaar; lokaal en in de tests draait de app op de bron.
- Meting: 144,7 KB naar 102,4 KB (-29%); site.css -17%, crm.css -20%, scripts -57 tot -65%.
- Tests: `test/minify-public.test.js` (geldige uitkomst, zelfde verwijzingen en CSS-variabelen, bron nooit overschreven).

## 0.29.1 — 2026-11-23 — Inloggen op het reizigersaccount werkt weer in Chrome

- Inloggen, registreren en wachtwoord herstellen op het reizigersaccount werken weer in Chrome, net als de knop

- `/account/` en de betaalpagina `/betalen/` sturen `Referrer-Policy: same-origin` in plaats van `no-referrer`. Bij
  `no-referrer` stuurt Chrome bij een formulier `Origin: null`, waardoor de herkomstcontrole elke POST weigerde (403).
  Links met een token lekken nog steeds niet als Referer naar een andere site.
- `isCrossSite` (`security/form-guard.js`) accepteert `Origin: null` alleen als de browser `Sec-Fetch-Site: same-origin`
  meldt; zonder die kop blijft het een verzoek van een andere site.
- Tests bootsen het verzoek van Chrome na (`Origin: null` met en zonder `Sec-Fetch-Site`).

## 0.29.0 — 2026-11-23 — Eigen overzicht voor de reisleider en instelbaar venster

- De reisleider ziet op het overzicht van het CRM zijn eigen vertrekken: datums, aantal deelnemers, of het venster
- Het venster waarin de reisleider identiteits- en gezondheidsgegevens mag exporteren is instelbaar in

- Nieuw `crm/guide-dashboard.js`: overzicht `/app/` voor rollen in `TRIP_SCOPED_ROLES`, alleen reizen van het
  gekoppelde reisleidersprofiel, alleen aantallen (geen persoonsgegevens); vertrekken verdwijnen als het venster na
  de terugkomst dicht is. `crm/dashboard-routes.js` kiest per rol.
- Nieuw `trips/guide-window.js`: venster uit de instellingen `guideWindowDaysBefore` en `guideWindowDaysAfter`
  (groep CRM, sectie Reisleider, 0 tot 60) en de gedeelde SQL voor venster en eigen vertrekken, met gebonden
  parameters. De vaste `GUIDE_WINDOW_DAYS` in de deelnemerslijsten is vervangen.
- Tests: `test/guide-dashboard.test.js` (eigen reizen, andere reisleider, aantallen, venster uit Beheer in overzicht
  en export, 403 buiten het venster).

## 0.28.5 — 2026-11-23 — Geen verwijzingen naar andere projecten

- Alle verwijzingen naar een ander project zijn uit code, commentaar en documentatie gehaald; de app zelf
  doet hetzelfde als voorheen (alleen commentaar gewijzigd).
- `deploy/apps01/install.sh` heeft geen vaste naam meer voor de cloudflared-container: de naam komt uit
  `TUNNEL_CONTAINER`, anders uit de `.env` van een eerdere installatie, anders is het de enige draaiende container
  waarvan de naam op `cloudflared` eindigt (bij geen of meerdere stopt het script met een melding). Een bestaande
  installatie verandert niet: daar staat de naam al in `.env`. `update.sh` en `pve-setup.sh` volgen dezelfde regel.
- Vier oude regels in `app/CHANGELOG.md` noemen het andere project nog: een PR mag dat bestand niet wijzigen.
- Nieuwe harde regel in `CLAUDE.md`, bewaakt door `tests/geen-andere-projecten.test.js`.

## 0.28.4 — 2026-11-23 — Diensten en achtergrondtaken in services.js

Modulestructuur, stap 4 (geen gedragswijziging). Herstel: de testdata (`src/dev/seed/seed.js` en `test/seed.test.js`)
verwees nog naar `crm/persons` en `crm/payments`, die in de vorige stap zijn verplaatst; de test faalde daardoor op
`main`. Verder: het aanmaken van alle gedeelde diensten (instellingen, logboek,
captcha, menu's, mail, back-ups, Google Drive, hersteltest, bewaking, AVG-opschoning, betalingen, reizigersaccounts)
is van `app/src/server.js` naar `app/src/services.js` verhuisd (`createServices`), gegroepeerd per module; de timers
en planners starten in `startBackgroundTasks`. `server.js` (408 → 299 regels) bevat alleen nog de beveiligingskoppen,
de volgorde van de middleware en de routes. De diensten staan onder dezelfde namen op `app.locals`; volgorde van
middleware en routes is ongewijzigd.

## 0.28.3 — 2026-11-23 — Personen en betalingen in een eigen map

Modulestructuur, stap 2b (geen gedragswijziging, alleen bestanden verplaatst): uit `app/src/crm/` zijn de personen
(`persons.js`, `person-*.js`, `participant-list*.js`, `retention.js`) naar `app/src/persons/` gegaan, de betalingen
(`payments.js`, `payment-*.js`, `mollie.js`, `online-payment*.js`) naar `app/src/payments/` en de aanmeldingen in het
CRM naar `app/src/booking/crm-routes.js`. Elke module koppelt haar routes via een eigen ingang `index.js`.
`crm/` bevat nu alleen de schil van het CRM: toegang, gebruikers, rechten, opmaak en het overzicht. Adressen,
rechten en gedrag zijn ongewijzigd; alleen de `require`-paden en verwijzingen in commentaar en documentatie zijn
aangepast.

## 0.28.2 — 2026-11-23 — Testdata voor de testomgeving

- De testomgeving kan gevuld worden met verzonnen, realistische testdata (reizen, reisleiders, deelnemers,

- Nieuw: `app/src/dev/seed/` (`data.js`, `seed.js`, `cli.js`) met de opdrachten `vullen`, `opnieuw` en `verwijderen`
  (`--testomgeving` verplicht). Weigert op `avantareizen.nl` en als zoekmachines mogen indexeren; één transactie;
  personen via `crm/persons.js` (versleutelde blokken, toestemmingen), bedragen via `crm/payments.js`; statussen
  passen bij de betalingen; auditregel `testdata.<opdracht>`. Herkenbaar aan `test-`-slugs en `@example.com`-adressen.
- `deploy/apps01/servertaken.sh testdata [vullen|opnieuw|verwijderen]` met bevestigingsvraag.
- `crm/cli.js` exporteert `connectionString` voor hergebruik.
- Tests: `test/seed.test.js` (blokkade, samenhang van statussen en betalingen, echte gegevens blijven staan, site).

## 0.28.1 — 2026-11-23 — Instellingen per groep van Beheer in een eigen bestand

Modulestructuur, stap 3 (geen gedragswijziging): de 91 instellingen en de secties van Beheer staan niet meer in twee
grote lijsten (`beheer/settings.js` en `beheer/indeling.js`) maar per groep in `app/src/beheer/instellingen/<groep>.js`
(Systeem, Organisatie, E-mail, CRM, Toegang en beveiliging, Back-ups en herstel, Vindbaarheid), elk met `FIELDS` en
`GROUP`. `settings.js` voegt ze samen tot `SETTING_FIELDS` en weigert een dubbele naam; `indeling.js` leest `GROUPS`
uit dezelfde bestanden. Alle instellingen, standaardwaarden, controles, secties en hun volgorde zijn identiek
(vooraf en achteraf geserialiseerd en vergeleken). Een nieuwe instelling raakt alleen het bestand van haar groep.

## 0.28.0 — 2026-11-23 — Routes van het CRM per module

Modulestructuur, stap 2 (geen gedragswijziging): `app/src/crm/routes.js` is alleen nog de schil van `/app/` (limiet,
formuliergrootte, sessie laden, 404). Inloggen, uitloggen, installatie en wachtwoord wijzigen staan in
`crm/login-routes.js`, het overzicht in `crm/dashboard-routes.js`, de invoerhulpjes in `crm/input.js`. De modules
Reisaanbod, Website-inhoud en Foto's koppelen hun eigen routes via een ingang `trips/index.js`, `cms/index.js` en
`media/index.js`; een nieuw scherm in zo'n module raakt `crm/routes.js` niet meer. Alle adressen, de volgorde van de
routes en de limieten zijn ongewijzigd. `docs/ARCHITECTUUR.md` beschrijft de ingang per module.

## 0.27.9 — 2026-11-23 — Migraties in één bestand per migratie

Modulestructuur, stap 1 (geen gedragswijziging): de 28 databasemigraties staan niet meer in één groot
`app/src/database/migrations.js` maar elk in een eigen bestand `app/src/database/migrations/NNN-korte-naam.js`.
`migrations.js` is de lader: hij leest de map op volgorde en weigert te starten bij een gat, een dubbel nummer, een
afwijkend `id` of een verkeerde bestandsnaam. De inhoud van elke migratie (nummer, naam en SQL) is byte voor byte
gelijk gebleven. Een nieuwe migratie is voortaan een nieuw bestand, zodat twee takken niet meer in hetzelfde bestand
werken. `migrations/laatste-migratie.txt` bevat de bestandsnaam van de laatste migratie, zodat twee takken met hetzelfde nummer een
git-conflict krijgen in plaats van een app die na de merge niet start. Nieuw: `docs/ARCHITECTUUR.md` met de indeling in modules, de gedeelde kernbestanden en de regels voor
parallel werken.

## 0.27.8 — 2026-11-23 — Weer toegang als beheerder via de server

- Komt een beheerder er niet meer in en is er geen tweede beheerder, dan herstelt het vaste servercommando de toegang

- Nieuw `app/src/crm/cli.js` met `beheerder-herstel <e-mailadres>` (bevinding F07): alleen voor een actieve beheerder;
  in één transactie een tijdelijk wachtwoord (24 tekens, alleen in de terminal), 2FA uit en een nieuwe activatiecode,
  alle sessies van die beheerder weg en auditregel `gebruiker.hersteld-server` (zonder IP). Onbekend adres: gemaskeerde
  lijst met actieve beheerders, niets veranderd.
- `deploy/apps01/servertaken.sh beheerder-herstel <e-mailadres>` (met bevestiging) roept de opdracht in de container aan.
- `docs/DRAAIBOEK-VPS-VERHUIZING.md` §7: weer toegang als beheerder en het advies om twee beheerders aan te houden.

## 0.27.7 — 2026-11-23 — Kortere CRM-sessie en waarschuwingen over toegang in Beheer

- Het CRM logt standaard uit na een uur zonder activiteit en uiterlijk na een dag (was 8 uur en 7 dagen); instelbaar in
- De startpagina van Beheer meldt het als tweestapsverificatie nog optioneel is of als er maar één actieve beheerder is.

- Standaard sessieduur CRM: `IDLE_HOURS` 1 en `MAX_DAYS` 1 (`crm/auth.js`), standaard van `sessionIdleHours` en
  `sessionMaxDays` mee (audit A07). Een in Beheer opgeslagen waarde blijft gelden. Het reizigersaccount verandert niet.
- Startpagina Beheer: tegels *Tweestapsverificatie* (open zolang `mfaRequiredFor` op `niemand` staat; audit A05, besluit
  23-11-2026: verplicht maken bij de livegang) en *Actieve beheerders* (open bij minder dan twee; bevinding F07), met een
  melding bovenaan. Zes tegels in drie kolommen (`crm-tiles--three`), op mobiel twee.

## 0.27.6 — 2026-11-23 — Controle op gelekte en veelgebruikte wachtwoorden

- Een nieuw wachtwoord in het CRM of het reizigersaccount mag geen veelgebruikt woord of reeks meer zijn en wordt

- Nieuw `app/src/security/password-check.js` (audit A09, ASVS 2.1.7): vaste regels uit `crm/passwords.js`, lokale
  controle (veelgebruikte woorden, samenstellingen en herhalingen daarvan, toetsenbord- en telreeksen, met hoogstens
  een jaartal of tekens eromheen) en de range-API van Have I Been Pwned (k-anonimiteit: 5 tekens van de SHA-1,
  `Add-Padding`, 3 s tijdslimiet, antwoord hoogstens 1 MB, ook zonder `Content-Length`). Onbereikbaar: alleen lokaal, logboekregel (bron
  `wachtwoordcontrole`) hoogstens eens per kwartier.
- Gebruikt bij installatie, eigen wachtwoord wijzigen, nieuwe gebruiker en wachtwoord instellen door de beheerder
  (CRM), en bij registreren, wachtwoord wijzigen en wachtwoord herstellen (reizigersaccount).
- Instelling `passwordBreachCheck` (standaard aan, startwaarde via `PASSWORD_BREACH_CHECK`) in de nieuwe sectie
  Beheer > Toegang en beveiliging > Wachtwoorden, met een paneel met de stand en de laatste uitkomsten (zonder
  wachtwoord, hash of gebruiker; `beheer/password-check-panel.js`).
- `npm test` draait met `PASSWORD_BREACH_CHECK=false`.

## 0.27.5 — 2026-11-23 — HSTS, /api/health zonder versie en security.txt

- De site stuurt via https een HSTS-kop mee, zodat browsers alleen nog https gebruiken.
- Beveiligingsproblemen kunnen gemeld worden via `/.well-known/security.txt` (meldadres uit Beheer > Organisatie > Contact).

- Beveiligingskoppen: `Strict-Transport-Security: max-age=31536000` als het verzoek via https binnenkomt (`req.secure`,
  achter de vertrouwde proxy), zonder `includeSubDomains` (audit A06).
- `/api/health` (nieuw `app/src/system/health.js`) geeft publiek alleen `{"ok":true}`; het versienummer alleen voor
  verzoeken van binnen de server: directe verbinding van loopback of een privénetwerk, niet van de vertrouwde proxy en
  zonder doorstuurkop. `update.sh` en `servertaken.sh` werken daardoor ongewijzigd (audit A23). Ook `Cache-Control: no-store`.
- Nieuw `/.well-known/security.txt` (RFC 9116) met `Contact`, `Expires` (180 dagen vooruit), `Preferred-Languages` en
  `Canonical` (bevinding V01).
- `docker-compose.yml`: de poort standaard alleen op `127.0.0.1` (`APP_BIND`), net als op apps01.

## 0.27.4 — 2026-11-23 — Startpagina van Beheer en een strengere Content-Security-Policy

- Beheer opent met een startpagina: de stand van de bewaking, de laatste back-up, de versie en open servertaken, en
- De lange tabel met alle instellingen staat nu op een eigen pagina: *Alle instellingen en hun bron*. Het

`/app/beheer/` toont `renderStart` (vervolgplan P1.5, bevinding B04); `/app/beheer/overzicht/` het systeemoverzicht en
de nieuwe sectie `/app/beheer/instellingen/` de instellingen met hun bron. De Content-Security-Policy heeft
`style-src 'self'` zonder `'unsafe-inline'` en staat alleen nog het `style`-attribuut toe via `style-src-attr`
(achtergrondfoto's op de publieke site); op de formulierpagina's met reCAPTCHA komt `style-src-elem 'unsafe-inline'`
erbij (bevinding A22, deels: het attribuut blijft tot de achtergrondfoto's zijn omgebouwd). Geen migratie.

## 0.27.3 — 2026-11-23 — Bewerkschermen in het CRM met tabbladen en een vaste opslaanbalk

- Het scherm van een reis is opgedeeld in tabbladen: Algemeen, Prijs, Tekst en programma, Foto's en Aanmeldingen.
- Pagina's, blogberichten en reisleiders hebben dezelfde opzet met tabbladen.
- Zit er een fout in een veld, dan opent het tabblad waar dat veld staat.
- *Bekijk op de site* en *Voorbeeld* staan als knop naast de titel.

Tabbladen en opslaanbalk als bouwstenen in `app/src/crm/ui.js` (`renderTabNav`, `renderTabPanel`, `renderSaveBar`) met
het bijbehorende script in `app/public/js/crm.js` (vervolgplan P1.4, bevinding B05). Toegepast op `trips/trip-routes.js`,
`cms/page-routes.js`, `cms/post-routes.js` en `trips/guide-routes.js`. Routes, veldnamen, ankers en validatie zijn
ongewijzigd; zonder JavaScript staan alle panelen onder elkaar. Geen migratie.

## 0.27.2 — 2026-11-23 — Overzicht in het CRM met Te doen en komende vertrekken

- De startpagina van het CRM laat nu zien wat aandacht vraagt: nieuwe aanmeldingen, te late betalingen, mogelijk
- Daaronder staan de komende vertrekken met het aantal bezette plaatsen en het openstaande bedrag, en de laatste
- Iedereen ziet alleen de onderdelen die bij de eigen rol horen.
- De lijst *Jouw rechten* en de losse knoppen staan niet meer op de startpagina; wachtwoord en tweestapsverificatie

Nieuw `app/src/crm/dashboard.js` (`loadDashboard`, `renderDashboard`, `dashboardAccess`) voor `/app/` (vervolgplan
P1.3, bevinding B01); de tijdelijke tekst en de lijst met rechten zijn weg. Per recht één query, parallel; een onderdeel
zonder recht wordt niet opgehaald. *Te late betalingen* gebruikt `loadOverview` (hoogstens 500 aanmeldingen, daarboven
`500+`); openstaand per vertrek komt uit `outstandingByTrip` in het betaaloverzicht en is gelijk aan *openstaand* op
`/app/betalingen/?reis=<id>`. Elke tegel telt hetzelfde als de lijst waar hij naartoe linkt. Mislukt één onderdeel, dan
toont alleen dat onderdeel een melding en komt de fout (zonder inhoud) in het logboek. Geen migratie.

## 0.27.1 — 2026-11-23 — Lijsten in het CRM in één opzet

- De lijsten Aanmeldingen, Deelnemers, Betalingen en Reizen zien er nu hetzelfde uit: filterknoppen bovenaan (bij
- Knoppen als *Nieuwe reis* en *Excel (.xlsx)* staan rechts naast de titel van de pagina.

Gedeelde bouwstenen voor lijsten in `app/src/crm/ui.js` (`renderActions`, `renderFilterTabs`, `renderSearch`,
`renderTable`, `renderStatus`, `renderPager`, `listUrl`), toegepast op Aanmeldingen, Deelnemers, Betalingen en Reizen
(vervolgplan P1.2, bevinding B05). `renderCrmPage` kent `actions` voor de knoppen naast de titel. Aanmeldingen en
Deelnemers tellen per filter binnen de gekozen reis en zoektekst (één extra query per lijst, zelfde voorwaarden en
gebonden parameters). Adressen, filters en rechten zijn ongewijzigd; geen migratie.

## 0.27.0 — 2026-11-23 — CRM met kopbalk, menu in vier groepen en eigen opmaak

- Het menu van het CRM is opnieuw ingedeeld in vier groepen: Boekingen, Reisaanbod, Website en Beheer. Reizen, reistypes en reisleiders staan nu onder Reisaanbod.
- Bovenaan elke pagina staat een kopbalk met het kruimelpad, een link naar de site en een gebruikersmenu met wachtwoord, tweestapsverificatie en uitloggen.
- Het CRM is rustiger en compacter opgemaakt, met beter leesbare knoppen en links.

Eerste stap van het nieuwe backend-ontwerp (vervolgplan P1, bevindingen B02, B03, B05 en B06).
- `crm/layout.js`: `CRM_MENU` in de groepen Boekingen, Reisaanbod en Website, als vaste groepen (`renderMainGroup`) in
  plaats van inklapbare; de tweede zijbalk van Beheer houdt haar inklapbare groepen. Nieuwe kopbalk (`renderHeader`) met
  het kruimelpad (`breadcrumbsFor`: groep, onderdeel en paginatitel uit het menu en de rechten van de gebruiker),
  *Bekijk de site* en het gebruikersmenu (`details.crm-user`); die drie regels zijn uit de zijbalk.
- `public/css/crm.css`: alle opmaak van het CRM en Beheer is uit `site.css` gehaald (site.css 95 → 72 kB) en wordt
  alleen in het CRM geladen, na `site.css`. Nieuwe maten (15 px, koppen in Open Sans, velden 40 px, op een telefoon
  44 px en 16 px) en binnen `.crm` een donkerdere accentkleur `#a8503f` (contrast met wit 5,4:1 in plaats van 3,5:1).
- `public/js/crm.js`: het gebruikersmenu sluit bij een klik ernaast of Esc.
- URL's, rechten en routes zijn ongewijzigd.

## 0.26.5 — 2026-11-23 — Eén reisleider per reis

- Een reis heeft voortaan één reisleider. Het bewerkscherm van een reis toont één keuzeveld *Reisleider* in plaats van drie.

Een reis heeft hoogstens één reisleider (besluit 23-11-2026). `validateTrip` leest het veld `reisleider` en bewaart
hoogstens één id; de drie velden `reisleider_1` t/m `reisleider_3` en `MAX_GUIDES` vervallen. De koppeltabel
`trip_guides` blijft ongewijzigd (geen migratie): een reis die nog meer dan één reisleider heeft, houdt die tot hij
opnieuw wordt opgeslagen; daarna blijft alleen de gekozen reisleider over.

## 0.26.4 — 2026-11-21 — Beheer als eigen omgeving met een tweede zijbalk

- Beheer staat nu in een eigen omgeving, zoals in AquaTech: in de hoofdzijbalk staat één knop *Beheer*, en daarin

- `crm/layout.js`: de groepen van Beheer en het zoekveld zijn uit de hoofdzijbalk; daar staat één ingang *Beheer*
  (`/app/beheer/` met recht `systeem`, anders `/app/gebruikers/` met recht `gebruikers`). Op paden onder
  `/app/beheer/`, `/app/gebruikers/` en `/app/auditlog/` (`isBeheerPath`) tekent `renderCrmPage` een tweede zijbalk
  (`aside.crm-sub`) met *Terug naar het CRM*, het zoekveld en de groepen; Gebruikers en Auditlog zijn daarheen
  verhuisd en tellen mee bij het zoeken.
- `public/js/crm.js`: inklapbare groepen gedeeld door beide zijbalken; knop `data-sub-toggle` voor de tweede zijbalk op
  een smal scherm.
- `site.css`: stijl `.crm-beheer`/`.crm-sub` (licht, terracotta markering, sticky); regels van de ingeklapte
  hoofdzijbalk gelden alleen nog binnen `.crm-nav`.

## 0.26.3 — 2026-11-21 — Online betalen via Mollie (iDEAL)

- Reizigers kunnen het openstaande bedrag online betalen met iDEAL via een persoonlijke betaallink in de

- Migratie 28: `online_payments` (Mollie-id, termijn, bedrag, stand, betaald op).
- `crm/mollie.js`: koppeling met de Mollie-API (vast adres, sleutel nooit in fouten of logboek), instellingen
  `mollieEnabled` en `mollieApiKey` (geheim).
- `crm/online-payments.js` en `crm/online-payment-routes.js`: betaallink `/betalen/<id>-<token>/` (HMAC), betaling
  starten met herkomstcontrole en limiet, terugkeerpagina, webhook `/betalen/webhook/` die de betaling zelf opvraagt en
  een geslaagde betaling één keer registreert (status schuift door).
- Betaalherinnering: knop *online betalen* (mail-opmaak kreeg een optionele knop, alleen https). Betaalpagina in het
  CRM: betaallink en lijst met online betalingen.
- Betaalherinneringen: een poging die door een herstart bleef hangen krijgt bij de volgende ronde de melding *afgebroken, niet zeker verstuurd*.

## 0.26.2 — 2026-11-21 — Betaalherinneringen aan de reiziger

- Op de betaalpagina van een aanmelding stuur je met één knop een herinnering met het openstaande bedrag en de

- Migratie 27: `payment_reminders` (termijn, handmatig/automatisch, gelukt of foutmelding zonder adres, wie, wanneer).
- `crm/payment-reminders.js`: herinnering voor de aanbetaling of het restant (te laat of de eerstvolgende), adres van
  de persoon of anders van het formulier, poging eerst vastgelegd onder slot van de aanmelding; dagelijkse ronde met
  `paymentReminderAuto` (standaard uit), `paymentReminderEveryDays` en `paymentReminderMax`.
- Betaalpagina: knop *Herinnering sturen* en lijst met herinneringen; geen mailserver 503, dubbel 409, geannuleerd of
  niets open 422, mislukt 502; audit `betaling.herinnering`; limiet 30 per medewerker per 10 minuten.
- Betaaloverzicht en Excel-export: kolom *Laatste herinnering*.

## 0.26.1 — 2026-11-21 — Overzicht openstaande betalingen met Excel-export

- Onder Reizigers > Betalingen zie je in één lijst wie nog moet betalen, wie te laat is en waar te veel is betaald,

- `/app/betalingen/` (recht `betalingen`, `crm/payment-overview-routes.js`): weergaven nog te betalen, te laat, te veel
  betaald en alles; filter op reis; totaal openstaand. Totalen per aanmelding in één query, berekening via
  `payments.summarize`.
- `/app/betalingen/overzicht.xlsx`: zelfde lijst als .xlsx met blad *Over deze export*; audit `export.betalingen`,
  limiet 30 per 10 minuten per gebruiker.
- Menu-item *Betalingen* onder Reizigers met een eigen euro-icoon.

## 0.26.0 — 2026-11-21 — Betalingen per aanmelding registreren

- Per aanmelding zie je in het CRM wat er verwacht wordt (reissom, SGR-garantie, boekingskosten, kortingen) en wat er

- Migratie 26: `booking_charges` (verwachte bedragen), `payments` (ontvangen betalingen, nooit wijzigen of
  verwijderen; correctie met toelichting) en `bookings.deposit_cents`. Bestaande aanmeldingen krijgen reissom, SGR en
  boekingskosten zoals het formulier ze toonde.
- `crm/payments.js`: bedragen lezen, saldo, aanbetaling, vervaldatums, betaalstatus en achterstand berekenen.
- `/app/betalingen/<aanmelding>/` (recht `betalingen`): betaling registreren, korting/annuleringskosten/overig
  toevoegen of weghalen (gemarkeerd met `removed_at`, blijft zichtbaar), controle op dubbel of verouderd formulier (409),
  automatische statusovergang alleen vooruit met historie, waarschuwing als de status voorloopt op de betaalstand,
  audit zonder bedragen. Betaalstand op de pagina van de aanmelding.
- Instellingen `paymentDepositDays` en `paymentBalanceDaysBefore` (Beheer > CRM > Betalingen).
- Aanmeldformulier zet de verwachte bedragen en de aanbetaling van de reis bij de aanmelding.
- AVG: anonimiseren wist toelichtingen bij betalingen en bedragen; geannuleerde aanmeldingen met een betaling worden
  niet meer verwijderd; inzage-export krijgt een blad *Betalingen*.

## 0.25.1 — 2026-11-21 — Inzage-export en persoon wissen bij AVG-verzoeken

- Bij een deelnemer staan nu de AVG-verzoeken: *Gegevens exporteren* geeft een Excel-bestand met alles wat het CRM van die persoon bewaart, en *Persoon wissen* anonimiseert de persoon direct (ook het reizigersaccount). *Nu opschonen* in Beheer vraagt nu een bevestiging.

- Nieuw recht `avg` (beheerder, kantoor) en `crm/person-privacy-routes.js`: POST `/app/deelnemers/:id/inzage/` (.xlsx met bladen Persoon, Aanmeldingen, Historie, Toestemmingen en Over deze export; blokken alleen met het recht van dat blok; audit `deelnemer.inzage` + per blok; limiet 20 per 10 min) en POST `/app/deelnemers/:id/wissen/` (bevestiging WISSEN, `anonymizePerson`, reizigersaccount met hetzelfde e-mailadres verwijderd, audit `deelnemer.gewist`).
- *Nu opschonen* vraagt een bevestigingsvinkje (422 zonder); de auditregel `avg.opschonen` verwijst nu naar de ronde in `retention_runs` (`run.runId`).

## 0.25.0 — 2026-11-21 — AVG-opschoning met instelbare bewaartermijnen

- Het CRM schoont elke dag zelf persoonsgegevens op volgens de bewaartermijnen: bijzondere en paspoortgegevens een maand na terugkomst, personen twee jaar na de laatste reis (geanonimiseerd), geannuleerde aanmeldingen zonder betaling na zes maanden en oude contactberichten na een jaar. De termijnen, een voorbeeld en *Nu opschonen* staan in Beheer > AVG en bewaartermijnen.

- Migratie 25: `persons.blocks_purged_at`, `persons.anonymized_at`, `bookings.anonymized_at`, tabel `retention_runs` en indexen voor de opschoning.
- `crm/retention.js`: dagelijkse ronde (eerste na vijf minuten) met regels voor blokken (geboortedatum blijft), anonimiseren van personen en hun aanmeldingen (ook notities in `booking_events`), losse aanmeldingen, geannuleerd zonder (aan)betaling, aanmeldingen na de fiscale termijn, anonieme personen zonder aanmeldingen, ongebruikte reizigersaccounts en contactberichten. Per record een eigen transactie met rijvergrendeling en hercontrole van de termijn; alleen aantallen in `retention_runs` en het logboek.
- Instellingen `retentionEnabled`, `retentionSpecialMonths`, `retentionPersonMonths`, `retentionCancelledMonths`, `retentionBookingYears`, `retentionContactMonths` in een nieuwe sectie *AVG en bewaartermijnen*, met paneel (`beheer/retention-routes.js`): laatste rondes, *Voorbeeld berekenen*, *Nu opschonen* (audit `avg.opschonen`, limiet 10 per tien minuten).
- Deelnemers: badge *geanonimiseerd*, melding op de detailpagina en een geanonimiseerde persoon is niet meer te wijzigen (409).

## 0.24.1 — 2026-11-21 — Deelnemerslijst voor de reisleider

- Reisleiders zien nu in het CRM *Deelnemerslijsten* van hun eigen vertrekken, met naam, mobiel en e-mail.
- In *Gebruikers* koppel je een reisleider-account aan een reisleidersprofiel.

- `users.guide_id` in te stellen bij Gebruikers (alleen rol reisleider; onbekend profiel geeft 422; audit
  `gebruiker.reisleidersprofiel`).
- `/app/deelnemerslijsten/` nu met `requireRight`: de reisleider (`TRIP_SCOPED_ROLES`) ziet alleen reizen via
  `users.guide_id` naar `trip_guides`; andere reis geeft 404. Beperkte kolommen (Nr., naam, mobiel, e-mail).
- Venster voor `identiteit`/`gezondheid` in SQL (Europe/Amsterdam): vertrek - 14 dagen t/m vertrek + duur - 1;
  daarbuiten niet aangeboden en 403. Kerkgenootschap nooit (geen recht).
- Een lijst heeft hoogstens 1000 deelnemers (`MAX_ROWS`; meer geeft 422 zonder bestand of auditregel, met test).
  De melding bij de exportlimiet (429) is een CRM-pagina met een link terug.

## 0.24.0 — 2026-11-21 — Deelnemerslijst per vertrek als Excel-bestand

- Nieuw in het CRM: *Deelnemerslijsten*. Per vertrek download je een Excel-bestand met alle deelnemers. Bijzondere

- `/app/deelnemerslijsten/` (recht `export.deelnemers`, nog niet voor de reisleider): overzicht van reizen met
  aanmeldingen en per reis een POST-export (.xlsx via `export/xlsx.js`) met blad *Deelnemers* en *Over deze lijst*.
- Geannuleerde aanmeldingen vallen weg; NAW uit `persons`, anders de momentopname van de aanmelding.
- Categorieën per vinkje, server-side op recht gecontroleerd (403); art. 9-blokken alleen met een niet ingetrokken
  toestemming, anders "(geen toestemming)". Audit `export.deelnemers` en `export.deelnemers.<categorie>` per reis.
- Limiet 30 exports per gebruiker per 10 minuten; `Cache-Control: no-store`. Link vanuit de aanmeldingenlijst per reis.

## 0.23.2 — 2026-11-21 — Opnieuw boeken met je gegevens alvast ingevuld

- Ben je ingelogd met je reizigersaccount en meld je je aan voor een reis, dan staan je naam, adres en telefoon van je vorige aanmelding (ingelogd gedaan) al ingevuld. Bijzondere gegevens en je paspoort vragen we elke keer opnieuw.

- Migratie 24 `aanmelding-bij-account`: kolom `bookings.customer_account_id` (met index). Een aanmelding van een ingelogde reiziger met het e-mailadres van het account krijgt het account-id.
- `booking/routes.js`: opties `prefill` en `customerFor`; bij een ingelogde reiziger vult GET `/aanmelden/` de gewone velden in uit de laatste eigen aanmelding (`account/routes.js` → `prefillFor`, velden `PREFILL_FIELDS`), met een melding boven het formulier. Op e-mailadres alleen nooit: het formulier bevestigt dat adres niet.
- Cookie `avanta_reiziger` staat nu op pad `/` (de oude cookie op `/account` wordt bij inloggen en uitloggen gewist).

## 0.23.1 — 2026-11-21 — Mijn reizen en Mijn gegevens in het reizigersaccount

- In je account onder /account/ zie je je komende en eerdere reizen met status en betaalstand. Onder Mijn gegevens download je je gegevens als Excel en wijzig je je wachtwoord; daarvoor vragen we eerst een code per e-mail.

- `account/my-trips.js`: Mijn reizen (aanmeldingen op het bevestigde e-mailadres, komend/eerder, link naar de reis als die online staat) en Mijn gegevens (alleen accountgegevens: naam, adres en telefoon uit aanmeldingen niet, omdat het aanmeldformulier het e-mailadres niet bevestigt; nooit bijzondere gegevens).
- Code per e-mail (`customer_tokens` met soort `code`: zes cijfers, 10 minuten, 5 pogingen, 3 per uur) zet `customer_sessions.step_up_until` op een kwartier; vereist voor `/account/gegevens/export.xlsx` en `/account/wachtwoord/`.
- `export/xlsx.js`: .xlsx-schrijver zonder extra pakket (inline strings, getallen, vette kop, formule-injectie onschadelijk).
- Auditacties `reiziger.code-*`, `reiziger.export`, `reiziger.wachtwoord-gewijzigd`.

## 0.23.0 — 2026-11-21 — Reizigersaccount: registreren, bevestigen, inloggen en wachtwoord herstellen

- Reizigers kunnen op de website een account aanmaken onder /account/: registreren met e-mailadres en wachtwoord, bevestigen via de mail, inloggen en een vergeten wachtwoord opnieuw instellen. In een volgende versie zie je daar je komende en eerdere reizen.

- Migratie 23: `customer_accounts`, `customer_sessions` (met `step_up_until` voor de code per e-mail in J3) en `customer_tokens` (bevestigen, herstellen, code, melding).
- `app/src/account/`: `accounts.js` (opslag, sessies, eenmalige links met hash, max. 3 per soort per uur, opruimen van onbevestigde accounts na 7 dagen), `routes.js` (`/account/`, `/account/inloggen/`, `/account/uitloggen/`, `/account/registreren/`, `/account/bevestigen/`, `/account/wachtwoord-vergeten/`, `/account/wachtwoord-herstellen/`), `mails.js`, `views.js`.
- Bevestigen vraagt link én wachtwoord; opnieuw registreren verandert een bestaand account nooit (alleen een nieuwe bevestigingslink, of bij een bevestigd account een mail zonder link). Limiet per account en soort onder een slot op het account; mails zonder link tellen apart (soort `melding`).
- Inloglimieten gelijk aan het CRM; cookie `avanta_reiziger` (HttpOnly, SameSite=Strict, Secure, pad `/account`), eigen CSRF-sleutel; `Referrer-Policy: no-referrer` en `no-store` op alle accountpagina's.
- Captcha-acties `registreren` en `wachtwoord`; auditacties `reiziger.*` met omschrijving in het CRM-auditlog.

## 0.22.1 — 2026-11-21 — Bevestiging aan de reiziger na een aanmelding

- Wie zich aanmeldt voor een reis krijgt meteen een bevestiging per mail: referentie, reisgegevens, bedragen en de betaalinstructie. De tekst van de betaalinstructie pas je aan in Beheer > E-mail > Bevestiging aan de reiziger.

- `mail/notifications.js`: `bookingConfirmation` stuurt na een aanmelding een mail aan de reiziger (soort `bevestiging-aanmelding`) met referentie, reis, vertrek, betaalkeuze, bedragen (reissom, SGR, boekingskosten alleen bij de aanbetaling, totaal, aanbetaling van de reis, bijkomende kosten) en de betaalinstructie; nooit bijzondere gegevens. Gooit nooit en wacht niet op de mailserver.
- Instellingen `bookingConfirmEnabled` en `bookingPaymentText` in de nieuwe sectie *E-mail > Bevestiging aan de reiziger*.
- `SGR_CENTS` en `BOOKING_FEE_CENTS` staan nu in `booking/fields.js` (ook nog geëxporteerd door `booking/routes.js`); bij het opslaan van een aanmelding komt de aanbetaling van de vergrendelde reis mee.

## 0.22.0 — 2026-11-21 — Reisleiders beheren

- Onder *Website > Reisleiders* beheer je de reisleiders: naam, adres, woonplaats, sinds wanneer bij Avanta, citaat, tekst, portret en tweede foto uit de fotobibliotheek, en online of offline. Je kunt ook een nieuwe reisleider aanmaken.
- Tot je een reisleider voor het eerst opslaat, toont de site de gegevens van de huidige site; die staan al in het formulier en gaan bij opslaan mee.

- Migratie 22: bij `guides` de kolommen `surname`, `city`, `since`, `quote`, `image_url`, `managed_in_crm`, `updated_at` en `updated_by`.
- `trips/guides.js` en `trips/guide-routes.js` (`/app/reisleiders/`, recht `reizen`, audit `reisleider.*`); een ander adres geeft een 301, verwijderen kan alleen offline, zonder reizen en niet uit de import.
- Site: `guideExtra` (`site/site-content.js`) kiest de gegevens uit de database als het CRM de reisleider beheert, anders uit `site-content.json`; de galerij komt nog uit het bestand.
- De WordPress-import laat een reisleider uit het CRM staan en koppelt reizen aan hem, ook na een nieuw adres. De fotobibliotheek ziet de tweede foto als gebruik.

## 0.21.0 — 2026-11-21 — Veelgestelde vragen beheren

- Onder *Website > Veelgestelde vragen* beheer je de FAQ: vragen toevoegen, wijzigen (vraag, categorie, antwoord met opmaak, volgorde) en verwijderen, en categorieën toevoegen, hernoemen en ordenen. Wijzigingen staan meteen op de FAQ-pagina.

- Migratie 21: `faq_categories` (naam uniek zonder hoofdlettergevoeligheid, volgorde) en bij `faqs` de kolommen `category_id`, `managed_in_crm`, `updated_at` en `updated_by`. Bestaande categorieën worden alfabetisch overgenomen; een vraag zonder categorie komt in *Algemeen*.
- `cms/faqs.js` en `cms/faq-routes.js` (`/app/faq/`, recht `content`, audit `faq.*`); antwoorden gaan door `sanitizeHtml`. `faqs.category` blijft als afgeleide kopie van de categorienaam voor de site en het FAQ-blok.
- De FAQ-pagina toont de categorieën op hun volgorde (vragen zonder categorie achteraan). De WordPress-import laat vragen uit het CRM staan (telt ze als `faqUitCrm`, en maakt hun oude categorie niet opnieuw aan) en zet categorieën in `faq_categories`.

## 0.20.0 — 2026-11-21 — Categorieën en tags van het blog beheren

- Onder *Blog > Categorieën en tags* beheer je de categorieën en tags van het blog: toevoegen, naam en adres wijzigen (het oude adres verwijst automatisch door), een inleiding geven en verwijderen. Met één knop neem je de tags van de huidige site over, met hun berichten en het uitgelichte bericht.
- Bij een bericht vink je de categorieën en tags aan en kies je of het het uitgelichte bericht is (groot op het blog en de homepage). Uitlichten kan alleen bij een gepubliceerd bericht.
- Categoriepagina's (`/category/…`) zijn terug op de site en tagpagina's tonen de berichten uit het CRM.

- Migratie 20: `post_terms` (soort `categorie`/`tag`, slug uniek per soort, naam, inleiding, foto, volgorde), `post_term_links` en `posts.featured` (unieke index, hoogstens één). Categorieën uit `posts.categories` worden overgenomen met koppelingen.
- `cms/post-terms.js` en `cms/post-term-routes.js` (`/app/blog/categorieen-en-tags/`, recht `content`, audit `blog-indeling.*`); op het bewerkscherm van een bericht het blok *Categorieën, tags en uitgelicht* (`/app/blog/<id>/indeling/`, audit `blog.indeling`).
- Site: `content.blogHighlights` levert tagbalk en uitgelicht bericht uit de database, tot de overname nog uit `site-content.json`; `/category/<slug>/` en `/tag/<slug>/` tonen de zichtbare berichten; sitemap met categorieën en tags die een zichtbaar bericht hebben.
- Verwijderen van een bericht haalt doorverwijzingen naar dat bericht weg. Het blogoverzicht toont het uitgelichte bericht ook als het het enige bericht is.
- Uitlichten en adreswijzigingen van categorieën en tags lopen met een advisory lock na elkaar, zodat gelijktijdig werken geen foutpagina geeft.
- Een bericht offline zetten haalt ook het uitgelicht-vinkje weg. Een ingepland bericht blijft bewust uitgelicht: het wordt op de geplande datum vanzelf zichtbaar als uitgelicht bericht (tot dan toont de site geen uitgelicht bericht).

## 0.19.0 — 2026-11-21 — Blog bekijken en plaatsen in het CRM

- Onder *Website > Blog* in het CRM staan nu alle blogberichten. Je kunt een bericht bekijken, wijzigen in blokken (dezelfde blokken als bij pagina's), een uitgelichte afbeelding uit de fotobibliotheek kiezen, een voorbeeld bekijken en publiceren. Elke publicatie wordt bewaard als versie die je kunt terugzetten.
- Nieuwe berichten plaats je met *Nieuw bericht*. Met een publicatiedatum in de toekomst plan je een bericht in: het verschijnt dan vanzelf op de site.
- Een bericht kan een ander adres krijgen (het oude adres verwijst automatisch door), offline gehaald en, als het nieuw is, verwijderd worden.

- Migratie 19: `posts` krijgt `blocks`, `draft`, `draft_version`, `managed_in_crm`, `seo_title`, `seo_description`, `created_at`, `updated_at`, `updated_by`; nieuwe tabel `post_revisions`.
- `cms/posts.js` en `cms/post-routes.js` (`/app/blog/`, recht `content`): lijst met zoeken en statusfilter, nieuw bericht, concept, publiceren of inplannen (datum in Europe/Amsterdam), versies, adres wijzigen met 301 (`recordMove`, menu-items gaan mee), offline/online, verwijderen; audit `blog.*`.
- De blokeditor (velden, sectie *Blokken*, fotokiezer en de blok- en kopfotoroutes) staat nu in `cms/block-editor.js` en wordt gedeeld door pagina's en blogberichten.
- Site: een bericht toont zijn blokken (`renderPageArticle`); `VISIBLE_POST_SQL` (gepubliceerd en datum bereikt) in elke query op `posts`, zodat een ingepland bericht nergens verschijnt (blog, homepage, zoeken, sitemap). SEO-titel en -omschrijving per bericht.
- De WordPress-import laat een bericht met `managed_in_crm` of een open concept staan en zet een bericht met een gewijzigd adres niet terug op het oude adres. "Gebruikt in" van de fotobibliotheek kijkt ook naar de blokken en het concept van berichten.

## 0.18.0 — 2026-11-21 — Homepage als blokpagina

- De homepage is nu ook in het CRM te wijzigen. Met *Homepage als blokpagina opzetten* (bij Pagina's) komt de huidige homepage als blokken klaar te staan: slider, zoekbalk, last-minutes, reistypes, inspiratie, bestemmingen, blog en "Over Avanta". Teksten, knoppen, foto's en de volgorde kun je zelf aanpassen. Tot je publiceert blijft de huidige homepage staan.

- Nieuwe bloktypes `home-slider`, `home-zoekbalk`, `home-lastminutes`, `home-reistypes`, `home-inspiratie`, `home-bestemmingen`, `home-blog` en `home-over` (`homeOnly`), weergegeven met de functies uit `site/home-view.js`; `loadBlockData` haalt alleen de homepagegegevens op die nodig zijn.
- `pages.createHomepage` zet `homepage.json` om in blokken (foto's met hun bibliotheek-id); de route `/` toont de gepubliceerde blokpagina en valt anders terug op de vaste homepage.
- De homepage staat niet dubbel in sitemap en zoekresultaten; adres wijzigen geldt niet voor de homepage.

## 0.17.0 — 2026-11-21 — Nieuwe pagina's, adres wijzigen, SEO per pagina en menu's beheren

- In het CRM kun je nu zelf nieuwe pagina's maken (onder een bestaande pagina of op het hoofdniveau). Een nieuwe pagina staat offline tot je hem publiceert.
- Het adres van een pagina wijzigen kan ook: het oude adres verwijst automatisch door, ook voor de pagina's eronder, en het menu gaat mee.
- Pagina's kun je offline halen en weer online zetten; een zelfgemaakte pagina kun je verwijderen.
- Per pagina een titel en omschrijving voor zoekmachines.
- Nieuw scherm *Menu's*: het hoofdmenu (met submenu) en het menu in de voettekst zelf indelen.

- Migratie 18: `pages.seo_title`/`seo_description` (ook in `page_revisions`), tabel `menu_items` met de vaste menu's als beginvulling.
- `cms/pages.js`: `create`, `move` (met `recordMove` per pad, menu-items mee, slot op het pad), `setOnline`, `remove`, `parentOptions`, `buildPagePath` met gereserveerde adressen en controle op blogberichten; publiceren zet `published = true`.
- `cms/menus.js` en `cms/menu-routes.js` (`/app/menus/`, recht `content`, audit `menu.*`); `site/layout.js` toont `res.locals.site.menus` met het vaste menu als terugval.
- Site gebruikt `seo_title`/`seo_description` voor `<title>` en de meta-omschrijving.
- WordPress-import maakt een verplaatste pagina niet opnieuw aan op het oude adres.

## 0.16.1 — 2026-11-21 — Meer bloktypes voor pagina's, YouTube-video met cookiekeuze en opmaakknoppen

- Nieuwe blokken voor pagina's: tekst met foto, fotogalerij, kolommen, banner, video (YouTube), veelgestelde vragen,
- Een video laadt pas als de bezoeker op *Video afspelen* klikt; tot dan maakt de browser geen verbinding met YouTube.
- Boven tekstvakken staan knoppen voor vet, cursief, kopjes, alinea, lijst en link.

- `cms/blocks.js`: bloktypes `tekst-afbeelding`, `galerij` (veldsoort `images`), `kolommen`, `banner`, `video`
  (veldsoort `youtube`, alleen het id wordt opgeslagen), `faq`, `reizen`, `reistypes`, `bestemmingen` (veldsoort
  `source` met keuzes uit de database); standaardopmaak per type (`styleDefaults`); `loadBlockData` haalt alleen de
  gegevens op die de blokken nodig hebben.
- Fotoscherm van een blok: meer foto's tegelijk voor een galerij (vergrendeld met `lockMediaForUse`), weghalen en
  volgorde in het blokformulier.
- `public/js/site.js`: video pas laden na toestemming (onthouden in localStorage); `public/js/crm.js`: opmaakknoppen.
- CSS `cms-media-text`, `cms-columns`, `cms-banner`, `cms-video`, `cms-embed`.

## 0.16.0 — 2026-11-21 — Pagina's bewerken in blokken, met concept, voorbeeld en versies

- Nieuw in het CRM onder *Website*: **Pagina's**. Wijzig de titel, bovenkop, inleiding en kopfoto van elke pagina en
- Wijzigingen komen eerst in een concept. Bekijk het voorbeeld, publiceer als het klaar is, en zet zo nodig een eerdere
- De rol *Redacteur* en *Kantoor* kunnen pagina's bewerken (nieuw recht `content`).

- Migratie 17: `pages.blocks`, `draft`, `draft_version`, `managed_in_crm`, `created_at`, `updated_at`, `updated_by`;
  tabel `page_revisions`. Bestaande `body_html` is één tekstblok geworden; de site toont alleen nog blokken.
- `app/src/cms/`: blokken-motor (`blocks.js`), concept/publiceren/versies (`pages.js`), routes `/app/paginas/`
  (`page-routes.js`) en weergave voor site en voorbeeld (`page-render.js`). Optimistische vergrendeling via
  `draft_version` (409 bij een verouderd formulier); foto's vergrendeld met `lockMediaForUse` en opnieuw bij publiceren.
- Recht `content` (beheerder, kantoor, redacteur); auditacties `pagina.*`; fotobibliotheek ziet gebruik in blokken en
  concepten.
- Import: een in het CRM gepubliceerde pagina wordt niet meer overschreven; nieuwe tekst uit de import wordt één tekstblok.
- Video's in een tekstblok blijven video's na opnieuw opschonen (volgorde van `target`/`rel`).

## 0.15.2 — 2026-11-21 — Plaatsen van een reis en Kopiëren naar nieuw vertrek

- Bij een reis in het CRM zie je hoeveel plaatsen bezet en vrij zijn. Zijn alle plaatsen bezet, dan staat de reis
- Met *Kopiëren naar nieuw vertrek* maak je in één klik een nieuwe reis (als concept) met dezelfde teksten, prijs,

- `app/src/trips/seats.js`: `bookedSeatsSql` (aanmeldingen met status ≠ `geannuleerd`), `fullyBookedSql` (vinkje of
  bezet ≥ `capacity`) en `seatSummary`; gebruikt in de lijsten en reispagina's (`site/content.js`), het aanmeldformulier
  en het CRM.
- Aanmelden: de reis wordt bij het opslaan `FOR UPDATE` vergrendeld en opnieuw geteld; vol → 409.
- `POST /app/reizen/<id>/kopieren/` (recht `reizen`, CSRF, audit `reis.gekopieerd`): concept met teksten, prijs,
  `trip_category_links`, `trip_guides`, `trip_media` en de afgeleide fotokolommen; zonder vertrekdatum, aanbieding,
  statustekst, gegarandeerd, volgeboekt en aanmeldingen; vrije slug `<slug>-kopie[-n]` (ook niet als oud adres in
  `redirects`).
- Foto's bij een reis: het herkennen van foto's uit de import zonder rij in de bibliotheek doet nu één lookup op
  `media.local_name` (plus één variantcontrole voor de rest) in plaats van een scan per adres; de galerijlimiet van 60
  telt die foto's mee.

## 0.15.1 — 2026-11-21 — Foto's bij een reis uit de fotobibliotheek

- Bij een reis in het CRM kies je nu de kopfoto, de kaartfoto en de fotogalerij (met titel en volgorde) uit de

- Migratie 16: tabel `trip_media` (reis, foto, rol `kop`/`kaart`/`galerij`, volgorde; hoogstens één kop- en kaartfoto;
  `ON DELETE RESTRICT` op de foto), gevuld uit de bestaande `hero_image_url`, `card_image_url` en `gallery`.
- `app/src/trips/trip-media.js` en routes onder `/app/reizen/<id>/fotos/` en `/galerij/` (recht `reizen`, audit
  `reis.fotos`); de afgeleide fotokolommen van de reis worden bij elke wijziging opnieuw geschreven.
- Fotobibliotheek: *gebruikt in* kijkt ook naar `trip_media`; uploaden met `terug` stuurt terug naar de reis (alleen
  `/app/reizen/<id>/`).
- Foto's uit de import die niet in de bibliotheek staan blijven bij een fotowijziging staan (kop/kaart tot je ze
  vervangt, galerij-items achteraan) tot je ze weghaalt met *Foto's uit de import weghalen*
  (`/app/reizen/<id>/fotos/import-weghalen/`).
- Alleen de galerijtekst wijzigen herschrijft de galerij niet, maar zet wel `managed_in_crm` (de import slaat de reis
  daarna over, net als bij elke andere wijziging in het CRM).
- Reizen: een gewijzigde slug geeft altijd een 301 van het oude naar het nieuwe adres, ook bij een concept.

## 0.15.0 — 2026-11-21 — Reizen aanmaken en wijzigen in het CRM

- In het CRM staat onder *Website* het scherm **Reizen**: reizen zoeken en filteren, een nieuwe reis aanmaken en een

- Migratie 15: tabel `trip_guides` (reisleiders per reis op volgorde, gevuld uit `trips.guide_id`); `trips.guide_id`
  en `trips.destinations` vervallen (landen uit `trip_category_links`); `trips` krijgt `capacity`, `managed_in_crm`,
  `created_at`, `updated_at`, `updated_by` en een index op `lower(trip_code)`.
- Nieuw `app/src/trips/trips.js` en `trip-routes.js` onder `/app/reizen/` (recht `reizen`), auditacties `reis.*`;
  slugwijziging → 301 via `recordMove`.
- Site: reisdetail toont alle reisleiders; zoeken op land via de koppeltabel; reisleiderpagina via `trip_guides`.
- Import (`tools/import-wordpress.js`): schrijft reisleiders naar `trip_guides` en slaat reizen met `managed_in_crm` over.
- Fotobibliotheek: de controle op landen (`validCountryIds`) neemt `FOR SHARE`, zodat een foto niet aan een categorie
  komt te hangen waarvan de soort tegelijk verandert. Tekst bij samenvoegen verbeterd.

## 0.14.0 — 2026-11-21 — Reistypes en landen beheren

- In het CRM staat onder *Website* het scherm **Reistypes en landen**: reistypes en landen toevoegen en wijzigen

- Migratie 14: `trip_categories` krijgt `icon`, `sort_order`, `show_on_home` en `updated_at` (index op soort en volgorde).
- Nieuw `app/src/trips/`: `slugs.js` (slug maken en controleren, `recordMove`: 301 zonder lus of keten),
  `categories.js` en `category-routes.js` onder `/app/reistypes-en-landen/` (recht `reizen`), met auditacties
  `categorie.*`. Tekst opgeschoond met `sanitizeHtml`.
- Nieuw `app/src/media/picker.js`: foto kiezen uit de bibliotheek op een bewerkscherm; `lockMediaForUse` in
  `media/library.js` vergrendelt de foto (`FOR SHARE`) bij het opslaan van een verwijzing.
- Site: categorieën op volgorde, gekozen icoon (`categoryIconName`), homepage toont de reistypes en bestemmingen met
  *tonen op de homepage* (anders zoals voorheen).

## 0.13.1 — 2026-11-21 — Geüploade foto's in de back-up

- Foto's die je in de fotobibliotheek uploadt, zitten nu in elke back-up en in de kopie op Google Drive. Na het

- Migratie 13: tabel `media_files` (grootste WebP-variant per upload, breedte, SHA-256; `STORAGE EXTERNAL`), met
  `ON DELETE CASCADE` op `media`.
- Upload schrijft de grootste variant in dezelfde transactie naar `media_files`.
- `media/library.js`: `backfillFiles()` (uploads van vóór M13), `restoreMissingFiles()` (ontbrekende bestanden terug,
  kleinere varianten via `resizeWebp`, hash gecontroleerd); bij het starten en dagelijks, met meldingen in het logboek.
- `docs/DRAAIBOEK-VPS-VERHUIZING.md` bijgewerkt.

## 0.13.0 — 2026-11-21 — Zijbalk voor CRM en Beheer zoals in AquaTech

- Het CRM en Beheer hebben een vaste zijbalk links, zoals in AquaTech: alle onderdelen in groepen, de huidige pagina

- `crm/layout.js`: de menubalk bovenin is vervangen door een vaste zijbalk met logo, zoekveld voor Beheer (recht
  `systeem`), groepen Reizigers, Website, Gebruikers en de groepen van Beheer (`beheer/indeling.js`), en een voet met
  wachtwoord, tweestapsverificatie en uitloggen. Items volgens de rechten; het item met het langste passende pad is
  actief, zijn groep staat open.
- `public/js/crm.js` (nieuw): inklappen tot iconenbalk (localStorage), accordeon van de groepen, lade op een smal
  scherm (menuknop, achtergrond, Esc). Zonder JavaScript staan alle groepen open.
- `beheer/routes.js`: de eigen zijbalk van Beheer is vervallen; de gefilterde groepen en zoekterm gaan naar de
  zijbalk van het CRM. Wachtwoord, tweestapsverificatie en Google Drive geven hun eigen pad door voor de markering.
- `site/icons.js`: iconen voor de zijbalk. `site.css`: stijl van de zijbalk (breekpunt 800 px).
- Tests: `test/crm-sidebar.test.js`.

## 0.12.2 — 2026-11-21 — Fotobibliotheek: foto's uit de import automatisch aan landen koppelen

- Foto's van de huidige site krijgen automatisch de landen van de reizen waarin ze staan. Bij *Zonder land* staat een

- `media/library.js`: `linkImportedMedia()` (één INSERT … SELECT: landen via `trip_category_links` van reizen die
  naar de foto verwijzen, plus landpagina's; alleen importfoto's zonder land; LIKE-patroon met escapes).
- Route `POST /app/fotobibliotheek/koppelen/` (recht `media`, CSRF, audit `media.gekoppeld`); de WordPress-import
  koppelt na het downloaden van de afbeeldingen automatisch.

## 0.12.1 — 2026-11-21 — Fotobibliotheek: mappen per land, gebruikt in en verwijderen

- De fotobibliotheek toont de landen als mappen met het aantal foto's, en een map *Zonder land*.
- Bij elke foto zie je waar hij gebruikt wordt. Een geüploade foto die nergens gebruikt wordt kun je verwijderen.

- `media/library.js`: `folders()` (aantal per land en zonder land), `usage()` (reizen, berichten, pagina's,
  reisleiders, reiscategorieën en de vaste-inhoudbestanden), `remove()` (alleen uploads die nergens gebruikt worden,
  rij onder slot in een transactie, daarna de eigen `bib-*`-bestanden), `cleanupOrphans()` + dagelijkse timer.
- Route `POST /app/fotobibliotheek/:id/verwijderen/` (recht `media`, CSRF, 409 bij gebruik of importfoto, audit
  `media.verwijderd`).

## 0.12.0 — 2026-11-21 — Fotobibliotheek per land (uploaden en beschrijven)

- Nieuw in het CRM: de **Fotobibliotheek**. Upload meerdere foto's tegelijk, koppel ze aan een of meer landen en geef
- Nieuwe rol **Redacteur**: alleen de website (nu de fotobibliotheek, later pagina's en blog).

- Migratie 12: `media` krijgt `source`, `title`, `alt_text`, `caption`, `photographer`, `width`, `height`, `variants`,
  `uploaded_by`, `created_at`, `updated_at` (`original_url` mag leeg); koppeltabel `media_countries` naar
  `trip_categories`; rol `redacteur` toegestaan in `users`.
- Recht `media` (beheerder, kantoor, redacteur); menu-item *Fotobibliotheek*.
- `app/src/media/`: soort bestand op inhoud (magic bytes + `sharp`-formaat), rechtzetten, EXIF/GPS/XMP weg, WebP in
  400/800/1600/2400 px; uploads via `busboy` met grenzen (10 bestanden, 15 MB, 60 MP, 200 per uur per gebruiker,
  2 tegelijk), CSRF- en herkomstcontrole, audit `media.geupload` en `media.gewijzigd`.
- Nieuwe afhankelijkheden: `sharp`, `busboy`.

## 0.11.5 — 2026-11-21 — Blog, pagina's, FAQ, contact en aanmelden gelijk aan de huidige site (CMS-pakket E4)

- Het weblog, de tagpagina's, berichten, pagina's, de FAQ, de contactpagina en het aanmeldformulier zien er nu uit
- Nieuw in Beheer > Organisatie > Contact: het KvK-nummer voor de contactpagina.

- Nieuw `src/site/page-view.js` (vervangt `views.js`): weblog met tagbalk en uitgelicht bericht, `/tag/<slug>/`,
  inhoud in blokken (tekst, afbeelding, galerij, youtube-nocookie-video met CSP alleen op die pagina), FAQ als
  `details` per categorie, contactlayout met adresblok.
- Samenvatting als op de huidige site (`postSummary`: 197 bytes + " ..."), berekend uit de berichttekst.
- `site-content.json` versie 2: `blogTags`, `blogArchiveLink`, `featuredPost`, `galleries` en de kop van `/aanmelden/`;
  de import leest ze van de huidige site, `install.sh` importeert opnieuw bij een oudere versie.
- Aanmelden zonder reis geeft een melding (200) in plaats van een doorverwijzing.
- Instelling `orgKvk`.
- `tools/layout-compare.js` met opgeslagen live-meting en test (`LAYOUT_BASE_URL`).

## 0.11.4 — 2026-11-21 — Reizen en reisleiders gelijk aan de huidige site; video in de homepage-slider

- Het reisoverzicht, de categoriepagina's en de reispagina zien eruit als op www.avantareizen.nl: liggende reisboxen
- De reisleiders staan in een raster met staande foto's; de pagina van een reisleider toont het citaat, de woonplaats,
- De homepage-slider speelt de YouTube-video weer af, zoals nu (stil, via youtube-nocookie.com).

CMS-pakket E3 (geen migratie). Nieuw `src/site/trip-view.js` (reisbox liggend met prijsvak, reisdetail met
`trip__single`/`trip__meta`, kenmerken als compacte icoontegels, galerijstrook, reisleiderlijst en -detail) en de CSS
uit het thema, gemeten tegen de huidige site op 1440 en 375 px. Prijzen als op de huidige site (`€1849,-`). De koppen
van de lijstpagina's (reizen, reisleiders, blog, FAQ) en de extra reisleidergegevens (achternaam, woonplaats, sinds,
citaat, portret, tweede foto, galerij, volgorde) staan tot CMS-pakket G/H in `DATA_DIR/site-content.json`
(`src/site/site-content.js`, alles gecontroleerd); de import schrijft het, los met `--alleen-vaste-inhoud`
(`--alleen-homepage` blijft werken) en `install.sh` haalt het op als het ontbreekt. Gedeelde lezer
`src/site/json-store.js`. Videodia's: `videoId` gecontroleerd (11 tekens), iframe via youtube-nocookie.com zonder
geluid en knoppen, CSP `frame-src` alleen op `/` met een videodia (`src/security/csp.js`), uit bij
`prefers-reduced-motion`. "Nieuwe reizen (n)" telt alle komende nieuwe reizen (`newTripCount`). De oude kaarten,
zoeker en reisdetail-opmaak zijn weg; zoekresultaten tonen reizen als liggende boxen.

## 0.11.3 — 2026-11-21 — Homepage gelijk aan de huidige site

- De homepage ziet eruit als die van www.avantareizen.nl: de grote slider met foto's, de filterbalk "Vind jouw reis",
- In het reisoverzicht zet "Nieuwe reizen" (`/reis/?nieuw=1`) de nieuwe reizen bovenaan.

CMS-pakket E2 (homepage, geen migratie). Nieuwe `src/site/home-view.js` (slider, filterbalk, reisbox, reistypes,
inspiratie, bestemmingen, blog, over Avanta) met de klassen en maten van het thema; gemeten tegen de huidige site op
1440 en 375 px. De vaste inhoud (dia's, inspiratie, sectietitels, "over Avanta", volgorde van de reistypes) staat tot
CMS-pakket H in `DATA_DIR/homepage.json` (`src/site/homepage.js`: alleen tekst met maximumlengte, links naar een eigen
pad of https, foto's onder `/media/`; zonder bestand de teksten van de huidige site). De import leest de huidige
homepage (`parseHome`) en schrijft dat bestand, ook los met `--alleen-homepage`; `install.sh` doet dat zelf als het
bestand ontbreekt. Een YouTube-dia wordt een foto (stilstaande afbeelding van de video), zonder iframe of extern
script. Sliders en de bestemmingsstrook in `public/js/site.js` (automatisch wisselen pauzeert bij muis of focus en
staat uit bij `prefers-reduced-motion`; zonder JavaScript staat de eerste dia er). `upcomingTrips` kent `newFirst`
(`/reis/?nieuw=1`). Mobiel schuift de homepage niet meer onder de witte kop.

## 0.11.2 — 2026-11-21 — Ontwerp gelijk aan de huidige site: basis, kop en voettekst

- De website lijkt nu op www.avantareizen.nl: dezelfde kleuren, lettertypes en knoppen, een vaste witte kop met

CMS-pakket E1 (ontwerp, geen migratie). `site.css` opnieuw opgebouwd vanuit het thema van de huidige site: achtergrond
`#f7f7f7`, tekst `#6b6b6b`, koppen Playfair Display 900 (nu lokaal), container 1280 px, breekpunten 1024 en 768 px,
secties 90/75/45 px, sectietitel 44/30 px, subtitels en knoppen in hoofdletters met letterafstand 1pt, knoppen
terracotta met korrel (20 × 40 px). Nieuwe kop (`header-main`): sticky, 92 px, papierrand, submenu bij aanwijzen,
zoekvenster als laag (`/zoeken/`), op de homepage doorzichtig met wit logo tot je scrolt; mobiel een balk van 60 px
met uitschuifmenu en uitklapbare submenu's (werkt ook zonder JavaScript). Nieuwe paginakop (titel 90/70/40 px,
cursieve pretitel, reis met landen links en "Naar overzicht") en voettekst (`footer-main`). Eigen SVG-iconen in
`src/site/icons.js`. Afbeeldingsadressen in style-attributen gaan door `cssImageUrl` (alleen eigen pad of https,
geen tekens die de CSS openbreken). Social-media-adressen uit Beheer staan nu ook in `res.locals.site.social`.
Het CRM houdt zijn rustige knoppen en koppen.

## 0.11.1 — 2026-11-21 — Oude aanmeldingen: kerkgenootschap en gezondheid gaan mee

- Bij het omzetten van aanmeldingen van vóór de personen-tabel gaan kerkgenootschap en medische bijzonderheden nu mee

- `persons.backfillPersons`: art. 9-blokken worden overgenomen; per ingevuld art. 9-veld een `consents`-regel met
  `LEGACY_ART9_TEXT_VERSION` ('oud-formulier, geen losse art. 9-toestemming') en de oorspronkelijke `consent_at`.
  Lege velden geven geen art. 9-toestemming. Al omgezette aanmeldingen veranderen niet.
- Zo'n regel telt in het CRM niet als gegeven toestemming: nieuwe art. 9-gegevens opslaan kan er niet op (422), en de
  deelnemerspagina toont "niet los gegeven". Intrekken (en daarmee wissen) kan wel.

## 0.11.0 — 2026-11-21 — Aanmeldingen in het CRM (migratie 11)

- In het CRM staat nu het scherm *Aanmeldingen*: alle aanmeldingen met filter op status en reis. Per aanmelding zet

- Migratie 11: `bookings.confirmed_at`, `cancelled_at`, `cancel_reason`, `status_changed_at`, CHECK op de status en
  index `(status, created_at)`; tabel `booking_events` (van/naar-status, gebruiker, notitie).
- `crm/booking-routes.js`: `GET /app/aanmeldingen/` (filters status, reis, zoeken; 50 per pagina), `GET …/:id/`,
  `POST …/:id/status/` (vaste overgangen, rij `FOR UPDATE`, verouderd formulier → 409, annuleren alleen met reden),
  `POST …/:id/notitie/`; recht `aanmeldingen`, reisleider tot de eigen-vertrekbeperking 403. Audit
  `aanmelding.status` en `aanmelding.notitie`, zonder de notitie zelf.
- Menu en overzicht: *Aanmeldingen*; op de deelnemerspagina linkt de referentie naar de aanmelding.
- CSS: statuslabel, historie; `.crm-facts` met vaste kolomverhouding (lange labels lopen niet meer buiten beeld op 375 px).

## 0.10.3 — 2026-11-21 — Mogelijke dubbelen samenvoegen

- Een deelnemer die als *mogelijk dubbel* is gemarkeerd, kan kantoor nu samenvoegen met de oorspronkelijke persoon:

- `crm/person-merge-routes.js`: `GET/POST /app/deelnemers/:id/samenvoegen/` (alleen voor een persoon met
  `duplicate_of`, nooit naar zichzelf; beide rijen in één query op id-volgorde `FOR UPDATE`, zodat er geen deadlock is; formulier gebonden aan het paar via `met`, anders 409) en `POST
  …/niet-dubbel/`; recht `deelnemers.wijzigen`, blokkeuze alleen met het `gegevens.*`-recht van dat blok (anders
  aanvullen). Audit `deelnemer.samengevoegd` (plus per blok met gegevens op het dubbel de keuze, nooit waarden) en `deelnemer.geen-dubbel`. Toestemmingen gaan altijd mee: ze zijn het bewijs van wat de persoon heeft gegeven.
- `persons.mergePersons`: NAW per keuze, blokken `fill`/`keep`/`remove` (opnieuw versleuteld met de AAD van de
  blijvende persoon), `bookings`, `consents` en andere dubbels verhuizen mee, dubbel verwijderd, `match_key` opnieuw.
  `persons.findPerson` voor beide routebestanden.

## 0.10.2 — 2026-11-21 — Deelnemers in het CRM

- In het CRM staat nu het scherm *Deelnemers*: zoeken, per persoon de gegevens, aanmeldingen en toestemmingen.
- Een toestemming voor kerkgenootschap of gezondheid kan worden ingetrokken; de bijbehorende gegevens worden dan gewist.

- `crm/person-routes.js`: `GET /app/deelnemers/` (zoeken per woord met LIKE-escaping, filter `dubbel=1`, pagina's van
  50), `GET /app/deelnemers/:id/`, `POST …/toon/` (blok openen, audit `deelnemer.toon.<blok>`), `POST …/` (NAW,
  `match_key` opnieuw), `POST …/blok/` (blok wijzigen; art. 9 alleen met geldige toestemming), `POST
  …/toestemming/:id/intrekken/` (alleen samen met de persoon opgezocht; wist het blok).
- Nieuw recht `deelnemers.wijzigen` (beheerder, kantoor). `TRIP_SCOPED_ROLES`, `roleHasGlobalRight` en
  `auth.requireGlobalRight`: de reisleider krijgt schermen over álle records pas met de eigen-vertrekbeperking.
- `validateFields` in `booking/fields.js` (deel van de velden controleren); `persons.writeBlock` en `refreshMatchKey`.
- CSS: zoekbalk, twee kolommen, blokken, feitenlijst; `.crm-table-wrap` met `position: relative` (geen horizontale
  scroll van de pagina door verborgen kolomkoppen).

## 0.10.1 — 2026-11-21 — Balk "Deze website is in ontwikkeling"

- Bovenaan de website staat nu een balk die bezoekers laat weten dat de site nog in ontwikkeling is. Zet hem aan of uit

- Instellingen `devBannerEnabled` (standaard aan) en `devBannerText` (één regel, verplicht, max. 200 tekens) in
  `SETTING_FIELDS`, met de sectie `ontwikkeling` in de groep Organisatie van Beheer. Geen migratie: de waarden staan in
  de bestaande tabel `settings`, wijzigen met audit zoals elke instelling.
- `site-settings.js` geeft `devBanner` (de tekst, of leeg als de balk uit staat); `renderPage` toont die ge-escaped
  boven de kop van elke publieke pagina, ook op 404, 500 en de onderhoudspagina. Het CRM gebruikt zijn eigen layout en
  toont de balk niet.
- CSS `.dev-banner` in `--av-accent-dark` met witte tekst (contrast 4,9:1), compacter onder 640 px.
- Tests: `test/dev-banner.test.js` (validatie, escaping, plek, standaard aan, wijzigen en uitzetten met audit, niet in
  het CRM, 403 zonder recht `systeem`).

## 0.10.0 — 2026-11-21 — Personen en toestemmingen in het CRM (migratie 10)

- Een aanmelding komt nu ook bij een persoon in het CRM: één persoon, meerdere reizen. Dezelfde persoon wordt herkend
- Kerkgenootschap en bijzonderheden (gezondheid) zijn vrijwillig en worden alleen bewaard met een eigen

- Migratie 10: tabellen `persons` (NAW leesbaar; `identity_data`, `special_data`, `health_data`, `emergency_data`
  apart versleuteld met AAD `persons:<blok>:<id>`; `match_key` = HMAC-SHA256 over e-mail + geboortedatum met een via
  HKDF afgeleide sleutel; `duplicate_of`) en `consents` (`voorwaarden`, `art9_religie`, `art9_gezondheid`, met
  `text_version`); `bookings.person_id`, `bookings.sensitive_data` mag leeg.
- `crm/persons.js`: zoeken of aanmaken in de transactie van de aanmelding (advisory lock per e-mailadres), alleen lege
  velden aanvullen, anders eerst een bestaand dubbel met dezelfde `match_key` hergebruiken en pas dan een nieuwe
  persoon met `duplicate_of`; een niet te openen blok geeft geen 500 maar een mogelijk dubbel; toestemmingen
  vastleggen; `backfillPersons` zet bij het starten oude aanmeldingen om (per aanmelding een transactie, een fout per
  rij telt als mislukt en houdt de rest niet tegen; art. 9-gegevens zonder losse toestemming gaan niet mee).
- `vault.deriveKey(doel)` (HKDF-SHA256) voor afgeleide sleutels.
- Aanmeldformulier: kerkgenootschap niet meer verplicht; vinkjes `consent_religion` en `consent_health` (`consentFor`),
  verplicht zodra het bijbehorende veld is ingevuld.

## 0.9.1 — 2026-11-21 — Time-out op de databaseverbinding

- Als de database even niet bereikbaar is, blijft de site niet meer eindeloos laden: na enkele seconden verschijnt een

- `database/db.js`: `connectionTimeoutMillis` (standaard 5000 ms, `DATABASE_CONNECT_TIMEOUT_MS`) en
  `idleTimeoutMillis` (30 s) op de pool; ongeldige waarden in `DATABASE_POOL_SIZE` vallen terug op 10.
- `pool.on('error')`: een verbinding die in rust wegvalt laat het proces niet meer crashen (alleen de foutcode gelogd).

## 0.9.0 — 2026-11-21 — Tweestapsverificatie voor het CRM

- Tweestapsverificatie in het CRM: na het wachtwoord een code uit een authenticator-app (bijv. Microsoft of Google
- Aanzetten kan alleen met een activatiecode van de beheerder (Gebruikers > gebruiker > Activatiecode maken), zodat een
- Een beheerder kan de tweestapsverificatie van een collega uitzetten als die zijn toestel kwijt is.
- Na deze update logt iedereen opnieuw in.

- Migratie 9: `users.totp_secret` (versleuteld, AAD `users:totp:<id>`), `totp_enabled_at`, `totp_last_step`,
  `totp_recovery` (SHA-256), `totp_activation_hash`/`totp_activation_expires_at`; `sessions.mfa_setup_ok`; bestaande
  sessies vervallen. Verkeerde codes per account in `users.totp_failures` (5 per kwartier, overleeft een herstart).
- Activatiecode (eenmalig, 7 dagen, SHA-256) nodig voor elk aanzetten van 2FA; bij gebruik meteen gewist, daarna mag alleen die sessie instellen
  (`POST /app/tweestaps/activeren/`, `POST /app/gebruikers/:id/activatiecode/`).
- `crm/totp.js` (TOTP volgens RFC 6238, herstelcodes) en `crm/qr-code.js` overgenomen uit AquaTech; `crm/two-factor.js`
  met de opslag, de codestap `/app/inloggen/code/` en het scherm `/app/tweestaps/` (instellen, nieuwe herstelcodes,
  uitzetten als het niet verplicht is).
- Halve sessie na het wachtwoord (`mfa_ok` onwaar, 15 minuten, alleen de tweede stap bereikbaar); na de code een nieuwe
  sessie met een nieuw token. Verkeerde codes tellen per account in de database (5 per kwartier), los van het IP-adres.
- Instelling `mfaRequiredFor` (Beheer > Toegang en beveiliging > Tweestapsverificatie): niemand (standaard, optioneel),
  rollen met `gegevens.*`-rechten of iedereen. Gebruikerslijst toont de 2FA-stand; beheerder kan 2FA uitzetten
  (`POST /app/gebruikers/:id/tweestaps/`). Nieuwe auditacties voor alle stappen.
- `vault.seal`/`open` met optionele context (AAD).

## 0.8.0 — 2026-11-21 — Bewaking en meldingen

- Beheer > Systeem > Bewaking en meldingen: de app controleert elke vijf minuten de back-up, de kopie op Google Drive, de hersteltest, het versturen van mail, de schijfruimte, het aantal fouten en de laatste update. Een probleem wordt een incident met een melding per mail en eventueel webhook (Teams, Slack, Discord, ntfy); is het opgelost, dan volgt ook een melding.
- Optioneel een heartbeat-URL (bijvoorbeeld Healthchecks.io of Uptime Kuma), zodat je ook gewaarschuwd wordt als de hele server plat ligt.

- Migratie 8 (`beheer: bewaking`): tabel `monitor_incidents` met een unieke gedeeltelijke index (hoogstens één open incident per controle) en een index op `opened_at`.
- `app/src/system/monitor.js`: controles, incidenten openen/bijwerken/sluiten, één gebundelde melding per ronde (nieuw, ernstiger, herinnering na `monitorRepeatHours`, opgelost), heartbeat zolang er geen ernstig incident open staat, gesloten incidenten een jaar bewaard. Meldingen bevatten geen persoonsgegevens, adressen of URL's.
- `app/src/security/safe-request.js`: kort https-verzoek alleen naar een openbaar adres (via `netguard`), verbinding naar het gecontroleerde IP, geen omleidingen, tijdslimiet.
- `app/src/beheer/monitor-routes.js`: stand per controle, open en gesloten incidenten, laatste meldingen, *Nu controleren* (12 per tien minuten) en *Testmelding versturen* (5 per tien minuten, in het auditlog).
- Instellingen `monitorEnabled`, `monitorEmail`, `monitorWebhookUrl` en `monitorHeartbeatUrl` (versleuteld), `monitorRepeatHours`, `monitorBackupMaxHours`, `monitorDiskMinPercent`, `monitorErrorsPerHour`. Het overzicht van Beheer toont open incidenten.

## 0.7.0 — 2026-11-21 — Logboek met foutcodes en debugmodus

- Bij een fout ziet de bezoeker een korte foutcode; onder Beheer > Systeem > Logboek staat die fout met de details, samen met trage verzoeken en waarschuwingen van achtergrondtaken.
- Beheer > Systeem > Foutopsporing: een debugmodus die beheerders de details meteen op de foutpagina toont, de drempel voor trage verzoeken en de bewaartermijn van het logboek.

- Migratie 7 (`beheer: logboek`): tabel `app_logs` met indexen op tijd, niveau, bron, foutcode en request-id, plus de gedeeltelijke index `audit_log_ip_idx` op `audit_log (created_at) WHERE ip_prefix IS NOT NULL` voor het opschonen van IP-adressen.
- `app/src/system/app-log.js`: gebufferd logboek (batch-insert, gelijke meldingen samengevoegd met teller, grens per minuut, terugval naar de console), privacyfilter (geheimen, e-mailadressen, IBAN's), genormaliseerde paden, foutcodes (8 hex) en request-id's (12 hex), opschonen op `logRetentionDays` en maximaal 100.000 regels; `console.warn`/`console.error` komen ook in het logboek.
- Elk verzoek krijgt `X-Request-Id`; trage verzoeken (`logSlowMs`) komen in het logboek. Nieuwe foutafhandeling: foutcode op de 500-pagina, details alleen in debugmodus (`debugMode`) en alleen voor gebruikers met recht `systeem`.
- `app/src/beheer/log-routes.js`: `/app/beheer/logboek/` met filters op niveau en bron, zoeken op foutcode, request-id of tekst, 50 per pagina op id (limiet 120 per minuut).

## 0.6.0 — 2026-11-21 — Updates vanuit de app, onderhoudsmodus en servertaken

- Beheer > Systeem > Updates en onderhoud: zie welke versie klaarstaat met de releasenotes, start de update zelf met
- Onderhoudsmodus: tijdens een update en met de hand kan niemand iets versturen of opslaan; elke pagina toont een
- Beheer > Systeem > Servertaken: een afvinklijst voor taken op de server, met één vast commando voor de Proxmox-host.

- `app/src/system/system-update.js`: koppeling met `deploy/apps01/update.sh` via `/update/status` (alleen-lezen:
  `status.json`, `run.json`, `changelog.md`, `maintenance.json`) en `/update/request` (`request.json` met de commit of
  `check: true`, `policy.json`); alles gesaneerd, schrijven via tijdelijk bestand + rename, een te oude uitrol of
  onderhoudsbestand verloopt; afgeronde uitrollen één keer in het auditlog.
- `app/src/system/maintenance.js` + `request-context.js`: 503 met Retry-After op elk schrijfverzoek tijdens onderhoud
  (behalve inloggen/uitloggen, en bij handmatig onderhoud het uitzetten), balk in de site- en CRM-layout via
  AsyncLocalStorage. Instellingen `updateAuto`, `maintenanceMode`, `maintenanceMessage`, `hostTasksDone`.
- `app/src/system/host-tasks.js` + `deploy/apps01/servertaken.sh`: `HOST_TASKS` met één vast commando (script op de
  exacte commit van main), acties `status`, `logs`, `update`, `openstaand`; gedane taken in `update/status/host-tasks.json`.
- `update.sh`: aanvraag eerst lezen en weghalen, bouwen vóór de onderhoudsmodus (`INSTALL_PHASE=build` in
  `install.sh`), back-up, wisselen, versiecontrole op `/api/health`, terugval en `.failed-commit`; alles in `main()`.
  `install.sh` maakt `update/status` (root) en `update/request` (uid 1000), de path-unit `avanta-update-now.path` en
  vervangt het updatescript via rename. Compose koppelt beide mappen.
- Tests: `app/test/system-update.test.js`, `tests/deploy-update.test.js` (update.sh met echte git-repo en nep-docker).

## 0.5.0 — 2026-11-20 — Wekelijkse hersteltest van de back-ups

- Beheer > Back-ups en herstel > Hersteltest: elke week controleert de server dat de nieuwste back-up echt terug te

- `deploy/apps01/restore-test.sh` + systemd (`avanta-restore-test.timer`, zondag 04:30; `avanta-restore-test-now.path`
  voor *Nu testen*), geïnstalleerd door `install.sh`: ontsleutelen als stroom (`cli.js decrypt <naam> -`), terugzetten
  in een wegwerp-PostgreSQL 17 op een intern netwerk, het huidige app-image daarop starten (health + homepage) en rijen
  per tabel vergelijken; altijd opruimen.
- `app/src/backup/restore-test.js`: uitslag bepalen en begrensd bewaren (`restore-test.json`, 12 runs; waarschuwing bij
  meer dan 25% en meer dan 20 rijen verschil), test van de Drive-kopie (download, volledig ontsleutelen, vergelijken met
  de lokale back-up; wekelijks en op verzoek, `drive-restore-test.json`).
- `cli.js`: `decrypt <back-up> -` (naar stdout) en `restore-test-result` (JSON op stdin).
- Beheer: pagina *Hersteltest* met uitslagen en *Nu testen* (server en Drive, 3 per uur, in het auditlog).

## 0.4.9 — 2026-11-20 — Kopie van de back-ups op Google Drive

- Beheer > Back-ups en herstel > Google Drive: elke back-up gaat (versleuteld) ook naar een map op Google Drive,

- `app/src/backup/drive.js`: OAuth 2.0 (scope `drive.file`, eenmalige state van 15 minuten gebonden aan de beheerder),
  refresh-token versleuteld in de instellingen (`driveRefreshToken`, in geen formulier), map zoeken/maken, hervatbare
  upload als stroom, bewaartermijn op Drive (alleen eigen back-upnamen), stand en gebeurtenissen in `drive-state.json`
  (nooit tokens), synchroniseren na elke back-up en elk uur (na een fout een kwartier wachten, na een ingetrokken token
  pas na opnieuw koppelen), downloaden voor de hersteltest.
- Beheer: sectie *Google Drive* (instellingen `driveEnabled`, `driveClientId`, `driveClientSecret`, `driveFolderName`,
  `driveKeepCount`), terugkeeradres, koppelen, ontkoppelen (token ingetrokken bij Google; lukt dat niet, dan meldt Beheer dat met de
  stappen om het zelf in te trekken), Nu synchroniseren (6 per
  tien minuten); koppelen en ontkoppelen in het auditlog. De terugkeer van Google werkt zonder sessie en
  controleert opnieuw of de beheerder nog actief is met het recht `systeem`.
- `docs/GOOGLE-DRIVE.md`: Google Cloud-project, toestemmingsscherm en OAuth-client instellen.

## 0.4.8 — 2026-11-20 — Versleutelde dagelijkse back-ups

- Beheer > Back-ups en herstel: de app maakt elke nacht een versleutelde back-up van de database, met een overzicht,

- `app/src/backup/backups.js`: `pg_dump -Fc` als stroom door AES-256-GCM (sleutel via HKDF van de hoofdsleutel,
  sleutel-id in de kop), controle na het maken, bewaartermijn (nieuwste drie blijven), statusbestand en planner (elk
  kwartier; dagelijks op het ingestelde uur in Europe/Amsterdam, na een fout een uur wachten). Het wachtwoord gaat via
  `PGPASSWORD`, nooit in de argumenten.
- `app/src/backup/cli.js`: `create [--update]`, `list`, `decrypt <back-up> <doel>`; maakt nooit een nieuwe hoofdsleutel.
- Beheer: sectie *Back-ups* (instellingen `backupEnabled`, `backupHour`, `backupKeepDays`), *Nu maken* (op de
  achtergrond, 6 per uur), downloaden (10 per uur),
  lijst; maken en downloaden in het auditlog.
- Image: `postgresql17-client`; `deploy/apps01/update.sh` maakt vóór elke update een back-up; CI installeert de
  PostgreSQL 17-client voor de tests en controleert `pg_dump` in het image.
- Eerste versie van `docs/DRAAIBOEK-VPS-VERHUIZING.md` (terugzetten van een back-up).

## 0.4.7 — 2026-11-20 — Onzichtbare captcha op het contact- en aanmeldformulier

- Het contact- en aanmeldformulier kunnen een onzichtbare captcha (Google reCAPTCHA v3) krijgen tegen spam, naast de

- `security/captcha.js`: controle van het token bij Google (vast adres), met minimale score, juiste actie per
  formulier en een keuze bij een onbereikbaar Google (doorlaten of blokkeren met 503). Alleen actief met schakelaar,
  geldige sitesleutel en geheim; anders niets van Google in de pagina en de CSP ongewijzigd.
- De CSP krijgt de reCAPTCHA-adressen alleen op `/contact/` en `/aanmelden/`, nooit in het CRM. `public/js/captcha.js`
  laadt Google pas als iemand het formulier invult en zet vlak voor het verzenden een vers token in het formulier.
- De controle komt na honeypot, tijdstempel en veldcontrole: een ongeldig formulier kost geen verzoek aan Google.
- Beheer: instellingen `captchaEnabled`, `captchaSiteKey`, `captchaSecret` (versleuteld), `captchaMinScore`,
  `captchaOnUnreachable`; status, controle van de geheime sleutel (10 per tien minuten) en de laatste 20 uitkomsten
  (zonder tokens of IP-adressen).

## 0.4.6 — 2026-11-20 — Sessieduur en bewaartermijnen instelbaar

- In Beheer > Toegang en beveiliging > Sessies en bewaartermijnen stel je in na hoeveel uur zonder activiteit iemand

- Instellingen `sessionIdleHours` (1–24, standaard 8), `sessionMaxDays` (1–30, standaard 7), `auditRetentionMonths`
  (6–120, standaard 24), `auditIpRetentionDays` (7–730, standaard 90) en `notFoundRetentionDays` (7–365, standaard 90).
- `crm/auth.js`: de sessieduur komt uit de instellingen; korter geldt meteen, ook voor bestaande sessies (een sessie
  ouder dan de maximale duur telt als verlopen), een langere maximale duur alleen voor nieuwe sessies; de cookie krijgt de ingestelde levensduur.
- Dagelijks onderhoud (`purgeExpired`): auditregels na de bewaartermijn weg, IP-voorvoegsels in het auditlog na hun
  termijn gewist (de regel blijft), sessies ouder dan de maximale duur weg; de 404-lijst volgt de eigen termijn.

## 0.4.5 — 2026-11-20 — Meldingen aan kantoor en mail-opmaak

- Kantoor krijgt een mail bij een nieuw bericht via het contactformulier en bij een nieuwe aanmelding (instelbaar in
- Alle mails van de app hebben nu de huisstijl: logo, een gekleurde titelbalk en een voettekst (Beheer > E-mail >

- `mail/layout.js`: e-mailveilige HTML (tabellen, inline stijlen, alle waarden ge-escaped) met platte-tekstversie en
  het logo als ingebedde bijlage (`cid:`); kleur van de titelbalk met contrastcontrole (minimaal 4,5 tegen wit).
- `mail/notifications.js`: melding na het opslaan van een contactbericht of aanmelding, zonder dat de bezoeker wacht;
  een mislukte melding verandert niets aan de inzending en staat in het overzicht van de mailserver. Een aanmelding gaat
  zonder bijzondere gegevens (geboortedatum, kerk, paspoort, noodnummer, bijzonderheden) de deur uit.
- Instellingen `notifyEmail`, `notifyContact`, `notifyBooking`, `mailHeaderColor`, `mailFooterText`; de testmail
  gebruikt de nieuwe opmaak. Voorbeeld op `/app/beheer/mail-opmaak/voorbeeld/` (recht `systeem`).
- Naar aanleiding van de review van B1: Teredo (`2001::/32`) en 6to4 (`2002::/16`) gelden niet als openbaar adres,
  de limietstatus (429) volgt uit een eigen veld in plaats van de meldingstekst, en de ongebruikte `mailer.verify` is weg.

## 0.4.4 — 2026-11-20 — E-mail versturen via een eigen mailserver

- In Beheer staat een nieuw onderdeel *E-mail > Mailserver*: stel een SMTP-server of een Exchange Online-connector in,

- `mail/mailer.js` (nodemailer): SMTP met inloggen of Exchange Online-connector (poort 25, zonder inlog). Verbinden
  alleen met een openbaar adres (`security/netguard.js`, tegen SSRF), STARTTLS verplicht zonder SSL/TLS, certificaat
  gecontroleerd op de servernaam, TLS 1.2 of hoger, geen kop-injectie via onderwerp of afzender. Leesbare meldingen bij
  fouten (inloggen, TLS, time-out, geweigerde verbinding of afzender) zonder adressen of wachtwoord.
- `mail/wan-ip.js`: WAN-IP (IPv4) van de server via vaste opzoekdiensten, een uur bewaard, voor de connector.
- Instellingen `mailMode`, `mailHost`, `mailPort`, `mailSecure`, `mailUser`, `mailPassword` (versleuteld),
  `mailFromName`, `mailFromAddress`, `mailReplyTo` in de nieuwe groep *E-mail* van Beheer.
- Testmail (5 per tien minuten per beheerder, in het auditlog als `mail.test` zonder adres) en een overzicht van de
  laatste 20 verzendingen in het geheugen, zonder adressen of inhoud.

## 0.4.3 — 2026-11-20 — Google Analytics met cookiekeuze

- In Beheer > Vindbaarheid kun je Google Analytics (GA4) aanzetten met je meet-ID. Bezoekers kiezen eerst zelf of ze

- Instellingen `analyticsEnabled` en `analyticsMeasurementId` (alleen een geldig `G-…`-ID), sectie *Google Analytics en
  cookies*; `site/analytics.js` (`activeMeasurementId`, `cspWith`).
- Zonder actief meet-ID: niets in de pagina en de Content-Security-Policy ongewijzigd. Met meet-ID (alleen de publieke
  site, nooit `/app/`): `data-analytics` op `<body>`, extern script `public/js/analytics.js`, knop *Cookie-instellingen*
  in de voettekst; `script-src` krijgt `https://www.googletagmanager.com`, `connect-src` ook `*.google-analytics.com` en
  `*.analytics.google.com`, `img-src` `*.google-analytics.com` en `*.googletagmanager.com` (beacon). Geen inline scripts.
- Consent Mode v2: standaard alles geweigerd; Accepteren zet alleen `analytics_storage` aan en laadt dan pas gtag
  (`allow_google_signals: false`); keuze met versie en datum in localStorage; weigeren of intrekken zet `ga-disable-<id>`
  en wist de `_ga`-cookies, ook bij een eerder bewaarde weigering.

## 0.4.2 — 2026-11-20 — Doorverwijzingen en 404-lijst in Beheer

- In Beheer > Vindbaarheid kun je oude adressen doorverwijzen naar de nieuwe pagina (301 of 302).
- *Niet gevonden (404)* toont welke adressen bezoekers en zoekmachines vragen die niet bestaan, met een knop om ze

- Migratie 6: tabellen `redirects` (uniek `from_path`, status 301/302, notitie, teller) en `not_found_log` (pad, aantal,
  eerste/laatste keer, host van de verwijzer; indexen op `last_seen_at` en `hits`).
- `site/redirects.js`: genormaliseerde paden, doorverwijzingen in het geheugen (middleware vóór statische bestanden en
  site; alleen GET/HEAD, querystring gaat mee, pad zonder slash telt ook met slash), 404's en gebruik geteld in het
  geheugen en per minuut weggeschreven, hoogstens 5000 regels (de vaakst gevraagde nieuwe eerst), opruimen na 90 dagen;
  is de lijst vol, dan wijken eenmalige regels na 7 dagen. Ruis van scanners (verborgen bestanden, `.php`/`.env` e.d.,
  `/wp-admin`) telt niet mee; paden die al in de lijst staan tellen door, ook als het geheugen vol is.
  Nooit querystring, volledige verwijzer of IP-adres (AVG); `/app/` en `/api/` (ook in hoofdletters) vallen erbuiten.
- `beheer/redirect-routes.js`: secties *Doorverwijzingen* (toevoegen met controle op dubbel, ketens, lussen, homepage en
  CRM; filteren; verwijderen) en *Niet gevonden (404)* (doorverwijzen, regel verwijderen, lijst leegmaken). Auditacties
  `doorverwijzing.aangemaakt`, `doorverwijzing.verwijderd`, `niet-gevonden.verwijderd` en `niet-gevonden.geleegd` (nooit
  een pad uit de 404-lijst in het auditlog).

## 0.4.1 — 2026-11-20 — Vindbaarheid instellen in Beheer

- In Beheer staat nu de groep **Vindbaarheid**: zoekmachines toelaten (met wachtwoord), het basisadres, de titels en
- Bij *Contact en organisatie* kun je ook het adres en de social-media-pagina's invullen voor zoekmachines.

- Nieuwe instellingen in `SETTING_FIELDS`: `seoIndexing` (startwaarde `SITE_INDEXABLE`, `confirmOn`: aanzetten vraagt het
  wachtwoord, 5 pogingen per kwartier, ook bij terugzetten naar een startwaarde die aan staat), `siteUrl` (startwaarde `SITE_URL`), `siteName`, `homeTitle`, `defaultDescription`,
  `socialImage`, `googleVerification`, `bingVerification`, `robotsExtra`, `sitemapExclude`, `llmsEnabled`, `llmsIntro`,
  `orgStreet`, `orgPostalCode`, `orgCity` en `social*`; eigen controle per instelling met `validate`.
- `site/site-settings.js`: `res.locals.site` per verzoek; site-, aanmeld- en foutpagina's, robots.txt, sitemap en JSON-LD
  lezen basisadres, naam, titels, omschrijving, afbeelding en contact daaruit (zonder herstart).
- `X-Robots-Tag: noindex` staat standaard op elk antwoord en verdwijnt alleen als indexeren aan staat (nooit onder `/app/`, ook niet in hoofdletters, en nooit op een 404 of 500).
- `/llms.txt` (alleen bij indexeren en `llmsEnabled`), verificatie-metatags, `PostalAddress` en `sameAs` in `TravelAgency`.
- Sitemap-cache per basisadres en uitsluitingen; uitsluiten op pad of met `*` op alles eronder.
- Beheer-formulier: een ontbrekend tekstveld laat de instelling ongewijzigd (een dubbel veld blijft ongeldig).
- Extra robots.txt-regels sluiten aan op de groep `User-agent: *`, zodat een losse `Disallow:` voor alle crawlers geldt.

## 0.4.0 — 2026-11-20 — Beheer met instellingen

- Nieuw onderdeel **Beheer** in het CRM (alleen voor de beheerder): een zijbalk met zoekveld, een systeemoverzicht en
- De contactgegevens in de voettekst van de site (telefoon en e-mail) zijn nu aan te passen in Beheer.

- Migratie 5: tabel `settings` (sleutel, waarde, gewijzigd op/door).
- `src/beheer/settings.js`: register `SETTING_FIELDS` (tekst, e-mail, URL, tekstvak, ja/nee, getal, keuze, geheim) met
  controle op de server; volgorde database → omgevingsvariabele → standaard; geheimen versleuteld met de hoofdsleutel en
  gebonden aan de naam van de instelling, in het scherm alleen "ingesteld" met de laatste 4 tekens; terugzetten naar de
  startwaarde; opslaan en auditlog in één transactie.
- `src/beheer/indeling.js` + `routes.js`: `/app/beheer/` met groepen, zoeken (ook zonder JavaScript), systeemoverzicht en
  generieke instellingenformulieren; nieuw recht `systeem` (rol beheerder), menu-item *Beheer*.
- Contactgegevens uit Beheer in de voettekst en de JSON-LD van de homepage (`res.locals.contact`).
- Auditacties `instelling.gewijzigd` en `instelling.teruggezet` (alleen de naam van de instelling, nooit de waarde).

## 0.3.0 — 2026-11-20 — CRM - inloggen, rollen en auditlog

- Het CRM heeft een eigen beveiligde omgeving op `/app/`: inloggen, gebruikers met een rol (beheerder, kantoor,

- Migratie 4: tabellen `users` (uniek e-mailadres, rol, scrypt-hash), `sessions`
  (alleen SHA-256 van het token, inactiviteit 8 uur, maximaal 7 dagen) en `audit_log` (zonder persoonsgegevens,
  ingekort IP-adres).
- `app/src/crm/`: rechten als sleutels en rollen als bundels (`rights.js`), `requireRight` en CSRF-controle per route
  (`auth.js`), scrypt-wachtwoorden met rehash (`passwords.js`), inloggen/uitloggen/installatie/eigen wachtwoord
  (`routes.js`), gebruikersbeheer en auditlog (`users.js`).
- `/app/` krijgt `Cache-Control: no-store` en `noindex`; algemene limiet per IP, plus limieten op inloggen, installatie
  en wachtwoord wijzigen. Hoogstens 5 mislukte pogingen per kwartier per account en IP-reeks, pogingen vanuit 30 verschillende IP-reeksen
  binnen een uur zetten het account tot het einde van dat uur dicht (één reeks telt hoogstens eens per uur). Auditlog: bewaartermijn 2 jaar, dagelijks opgeruimd.
- `form-guard.js`: herkomstcontrole los beschikbaar als `isCrossSite`.

## 0.2.2 — 2026-11-20 — Contactformulier op /contact/ en SEO-restpunten

- Bezoekers kunnen via de contactpagina een bericht sturen; het bericht wordt bewaard voor het CRM.
- Vanaf een reis (`/contact/?reis=<slug>`) staat het onderwerp al ingevuld en wordt de reis bij het bericht bewaard.

- Migratie 3: tabel `contact_messages` (naam, e-mail, telefoon, onderwerp, bericht, `trip_slug`, status `nieuw`,
  `consent_at`) met index op `(status, created_at)`.
- Nieuw `app/src/contact/` (`fields.js` met validatie, `routes.js` met formulier en verwerking); `site/routes.js` toont
  het formulier onder de geïmporteerde inhoud van `/contact/`. Fouten geven 422 met Nederlandse meldingen, succes een
  303 naar `/contact/?verzonden=1`. Geen mailverzending.
- Nieuw `app/src/security/form-guard.js`: herkomstcontrole (403), limiet per bezoeker (429), honeypot en ondertekend
  tijdstempel per formulier, voor `/contact/` en `/aanmelden/`. Alleen een ingevulde honeypot wordt nog stil
  genegeerd; een ongeldig, verlopen of te snel token geeft 422 met de ingevulde waarden, een melding en een nieuw
  token, zodat een bezoeker het formulier opnieuw kan versturen.
- Contact- en aanmeldformulier verwijderen stuurtekens (zoals NUL) uit de invoer; die gaven eerder een 500 bij het opslaan.
- Het akkoord-vakje telt alleen bij precies de waarde `ja`; een andere waarde geeft de foutmelding (contact en aanmelden).
- `robots.txt` noemt bij indexeren de absolute sitemap-URL (`${SITE_URL}/sitemap.xml`).
- Canonical op de aanmeldpagina (`/aanmelden/?id=…`) en de 404-pagina; beide blijven noindex.
- CSS: `.container.section` houdt de zijmarge (16 px op mobiel); selectievakjes en keuzerondjes in `.form` niet meer
  op volle breedte.
- `SITE_URL` in `.env.example` en `docker-compose.yml`.

## 0.2.1 — 2026-11-20 — SEO-klaar voor de go-live (canonical, Open Graph, JSON-LD en sitemap)

- Elke pagina vertelt zoekmachines en social media nu het juiste adres, de titel, beschrijving en afbeelding.
- Nieuwe sitemap op `/sitemap.xml` met alle reizen (ook vertrokken), categorieën, reisleiders, blog en pagina's.

- Nieuw `app/src/site/seo.js`: canonical-URL, Open Graph- en Twitter-tags, JSON-LD (`TravelAgency` op de homepage,
  `Trip` met `offers` op reispagina's, `BlogPosting` op blogberichten, `BreadcrumbList` op reis-, categorie- en
  blogpagina's) en de opbouw van de sitemap. JSON-LD gaat via `JSON.stringify` met `<`, `>` en `&` als unicode-escape.
- Basisadres uit de omgevingsvariabele `SITE_URL` (standaard `https://www.avantareizen.nl`); de canonical gebruikt
  het echte pad van de pagina, niet het menupad.
- Route `/sitemap.xml` (10 minuten in het geheugen, `lastmod` voor blogberichten); query `sitemapEntries` in
  `content.js`. `robots.txt` verwijst er alleen naar bij `SITE_INDEXABLE=true`, met een absolute URL op `SITE_URL`.
- Tests in `app/test/seo.test.js` (eigen databaseschema, zodat ze naast `server.test.js` draaien).

## 0.2.0 — 2026-11-20 — Nieuwe website: reizen, reisleiders, blog, FAQ en aanmelden

- De website van Avanta Reizen is nagebouwd: reisaanbod met zoeker, reispagina's, reisleiders, weblog, veelgestelde vragen en alle informatiepagina's.
- Aanmelden voor een reis gaat via een eigen formulier; bijzondere gegevens worden versleuteld bewaard.

- App-skelet: Node 22 + Express, server-gerenderde HTML, PostgreSQL 17 met migraties, Dockerfile en docker-compose.
- Huisstijl (Playfair Display, Open Sans, lokaal), menu, paginakop, kaarten; responsive op 1440 en 375 px.
- Routes gelijk aan de huidige site, met 301 voor oude adressen; noindex tot go-live; CSP en beveiligingskoppen.
- Importscript `tools/import-wordpress.js`: reizen, reisleiders, categorieën, blog, pagina's, FAQ en afbeeldingen uit de huidige site; HTML opgeschoond met een allowlist.
- Aanmeldformulier `/aanmelden/` → tabel `bookings` met versleutelde gevoelige velden (AES-256-GCM), limiet, herkomstcontrole, honeypot en ondertekend tijdstempel.
- CI: app-tests tegen PostgreSQL, npm audit en een smoketest van het image.

## 0.1.0

Startpunt van de repository: werkwijze, reviews en releaseautomatisering.
