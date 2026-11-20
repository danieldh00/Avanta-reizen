# Changelog

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
