# Avanta Reizen

Nieuwe website van Avanta Reizen (fase 1: nabouw van www.avantareizen.nl) met daarachter een CRM (fase 2, in opbouw).
Node 22 + Express + PostgreSQL 17, server-gerenderde HTML, geen externe scripts of fonts. Zie `docs/OPZET-WEBSITE.md`.

## Starten
```sh
cp .env.example .env            # vul POSTGRES_PASSWORD in
docker compose up -d --build    # site op http://localhost:3400/
docker compose exec app node tools/import-wordpress.js   # content + afbeeldingen van de huidige site overnemen
```
Testomgeving op apps01 (`avanta.den-hollander.com`, losse binding op de bestaande Cloudflare-tunnel): zie `deploy/apps01/README.md`.
Zonder Docker: `cd app && npm install`, dan `DATABASE_URL=… node tools/import-wordpress.js` en `DATABASE_URL=… node src/server.js`.

- **Databasepool**: `DATABASE_POOL_SIZE` (standaard 10) en `DATABASE_CONNECT_TIMEOUT_MS` (standaard 5000). Is de
  database weg of de pool vol, dan faalt een verzoek na die tijd met een foutpagina in plaats van eindeloos te wachten.
- De site staat op **noindex** tot go-live (`SITE_INDEXABLE=true` pas bij de overstap).
- `SITE_URL` is het openbare basisadres (standaard `https://www.avantareizen.nl`, zonder slash aan het eind) voor de
  canonical-URL's, Open Graph-tags, de sitemap en de `Sitemap:`-regel in `robots.txt`.
- Berichten via het **contactformulier** op `/contact/` komen in de tabel `contact_messages` (status `nieuw`, met de
  reis als de bezoeker via `/contact/?reis=<slug>` komt). Er wordt nog geen mail verstuurd. Het formulier heeft dezelfde
  bescherming als aanmelden (`app/src/security/form-guard.js`): herkomstcontrole, 5 per 10 minuten per bezoeker,
  honeypot en ondertekend tijdstempel. Een ingevulde honeypot wordt stil genegeerd; een ongeldig, verlopen (na 3 uur)
  of te snel (binnen 3 seconden) verstuurd formulier komt terug (422) met de ingevulde waarden en een nieuw token.
- `TRUST_PROXY`: welke reverse proxy Express vertrouwt voor het bezoekersadres (standaard `loopback`). **Leeg laten als
  er geen proxy voor de app staat.** Staat er een proxy in een andere container voor, zet dan het **exacte** adres
  daarvan (bijv. `TRUST_PROXY=172.18.0.5`), nooit een heel subnet: verkeer van buiten kan via het Docker-bridgeadres
  binnenkomen en zou dan met een zelfgekozen `X-Forwarded-For` de limiet op de formulieren kunnen omzeilen.
- Aanmeldingen komen in de tabel `bookings`, de persoon in `persons` (`app/src/crm/persons.js`, migratie 10): één
  persoon, meerdere aanmeldingen, ontdubbeld op e-mailadres + geboortedatum via `match_key` (HMAC met een van de
  hoofdsleutel afgeleide sleutel, de geboortedatum zelf blijft versleuteld). Bijzondere gegevens staan per categorie
  versleuteld bij de persoon (`identity_data`, `special_data`, `health_data`, `emergency_data`, AES-256-GCM, gebonden
  aan dat record), zodat rechten per categorie kunnen. Het formulier overschrijft nooit een bestaande persoon: bij
  dezelfde persoon worden alleen lege velden aangevuld; wijkt iets af (of klopt alleen het e-mailadres), dan komt er
  een nieuwe persoon met de markering *mogelijk dubbel* (`duplicate_of`) en beslist kantoor. Een volgende aanmelding
  met dezelfde afwijking komt bij dat dubbel uit, niet bij weer een nieuwe persoon. Kerkgenootschap en
  bijzonderheden (AVG art. 9) zijn vrijwillig en worden alleen opgeslagen met een eigen toestemmingsvinkje; elke
  toestemming staat met de versie van de tekst in `consents`. Aanmeldingen van vóór migratie 10 zet de app bij het
  starten zelf om (alleen aantallen in het logboek); hun art. 9-gegevens gaan niet mee, want daarvoor was geen losse
  toestemming. **Bewaar de hoofdsleutel** (`AVANTA_MASTER_KEY` of `/data/master-key`) apart van
  de database-back-up: zonder sleutel zijn die gegevens niet te lezen.
- Afbeeldingen staan in het volume `/data/media` (circa 250 MB na de import).
- **CRM** op `/app/` (in opbouw, zie `docs/OPZET-CRM.md`): inloggen met e-mail en wachtwoord (scrypt, minimaal 12
  tekens), rollen `beheerder`, `kantoor`, `reisleider` en `boekhouding` met vaste rechten (`app/src/crm/rights.js`,
  per route gecontroleerd met `requireRight`), gebruikersbeheer en een auditlog op `/app/auditlog/`.
  - **Eerste beheerder**: zolang er geen CRM-gebruiker is, zet de server bij elke start een eenmalige installatiecode in
    het log (`CRM: nog geen gebruikers … installatiecode XXXXX-…`). Open `/app/installatie/`, vul die code in en maak
    het account aan; daarna is de installatiepagina weg (404).
  - Sessie: cookie `avanta_sessie` (`HttpOnly`, `Secure`, `SameSite=Strict`, pad `/app`), in de database alleen de
    SHA-256 van het token; verloopt standaard na 8 uur zonder activiteit en uiterlijk na 7 dagen (instelbaar in Beheer). Het CRM werkt daardoor alleen
    via https (of `http://localhost`).
  - Beveiliging: CSRF-token in elk formulier plus herkomstcontrole, 300 verzoeken per minuut per IP op `/app/`,
    10 inlogpogingen per kwartier per IP, en hoogstens 5 mislukte pogingen per kwartier op één account vanuit één
    IP-reeks (daarna is die combinatie dicht tot het kwartier om is). Dat laatste bewust niet voor het hele account, zodat niemand de beheerder kan buitensluiten;
    vanaf een ander netwerk of na het kwartier lukt inloggen gewoon (een herstart wist de tellers ook). Tegen raden
    vanuit veel netwerken tegelijk gaat een account dicht tot het einde van het uur als er binnen een uur pogingen
    komen vanuit 30 verschillende IP-reeksen; elke reeks telt daarvoor hoogstens één keer per uur mee, zodat één
    netwerk (of een handvol) het account nooit kan dichtzetten. De laatste
    actieve beheerder kan niet worden gedegradeerd of uitgeschakeld. Het auditlog bewaart wie, wat, welk record, wanneer
    en een ingekort IP-adres (/24 of /48), nooit e-mailadressen, wachtwoorden of andere waarden; regels ouder dan de
    bewaartermijn (standaard 2 jaar) en IP-voorvoegsels ouder dan hun termijn (standaard 90 dagen) worden bij het starten
    en daarna dagelijks opgeruimd, net als verlopen sessies (instelbaar in Beheer).
  - **Deelnemers** op `/app/deelnemers/` (recht `deelnemers`; `app/src/crm/person-routes.js`): lijst met zoeken op
    naam, e-mailadres of woonplaats (elk woord moet voorkomen) en een filter *mogelijk dubbel*; per persoon NAW,
    aanmeldingen, toestemmingen en de bijzondere gegevens per blok. Een blok staat nooit in de lijst en op de pagina pas
    na **Toon** (een POST, vastgelegd in het auditlog); elk blok vraagt zijn eigen recht (`gegevens.identiteit`,
    `gegevens.gezondheid`, `gegevens.religie`). Wijzigen, blokken bewerken en een art. 9-toestemming intrekken (dat
    wist het blok) vragen `deelnemers.wijzigen` (beheerder, kantoor); art. 9-gegevens opslaan kan alleen met een
    geldige toestemming. **Mogelijke dubbelen** (`app/src/crm/person-merge-routes.js`): *Samenvoegen* met de
    oorspronkelijke persoon (per afwijkend NAW-veld kiezen; per bijzonder blok aanvullen, houden of overnemen, alleen
    met het recht op dat blok, de waarden zelf staan niet op dat scherm); aanmeldingen en toestemmingen gaan mee en
    het dubbel wordt verwijderd. Of *Geen dubbel* om de markering weg te halen. Boekhouding ziet NAW alleen-lezen. De reisleider krijgt dit scherm pas als zijn toegang tot de
    eigen vertrekken is gebouwd (tot dan 403).
  - **Tweestapsverificatie (2FA)** met een authenticator-app (TOTP, RFC 6238; eigen code op `crypto`, zoals AquaTech).
    Na het juiste wachtwoord krijgt wie 2FA heeft of moet hebben eerst een *halve sessie* (15 minuten): daarmee is
    alleen de codestap (`/app/inloggen/code/`) of het instellen (`/app/tweestaps/`) bereikbaar; pas na de code volgt
    een volledige sessie met een nieuw token. Standaard optioneel (ieder zet het zelf aan onder *Tweestapsverificatie*);
    in Beheer > Toegang en beveiliging > Tweestapsverificatie verplicht te maken voor rollen met toegang tot bijzondere
    gegevens of voor iedereen. Instellen met QR-code of sleutel, altijd pas na een **activatiecode** die een beheerder
    onder *Gebruikers* maakt (eenmalig, 7 dagen geldig, alleen als SHA-256 bewaard, bij gebruik meteen gewist,
    daarna mag alleen die sessie instellen). Een gelekt of tijdelijk wachtwoord is dus nooit genoeg om een eigen app te koppelen; de eerste beheerder
    gebruikt de installatiecode als activatiecode (30 dagen). Daarna tien herstelcodes (één keer getoond, alleen als SHA-256 bewaard). Elke code werkt één
    keer; na 5 verkeerde codes binnen een kwartier is de codestap voor dat account dicht, ongeacht vanaf hoeveel
    IP-adressen. Zo levert wachtwoorden raden vanuit veel netwerken tegelijk hoogstens een halve sessie op. Het geheim
    staat versleuteld in `users.totp_secret` (AES-256-GCM, gebonden aan de gebruiker). Een beheerder zet de 2FA van een
    collega uit onder *Gebruikers* (toestel kwijt) en maakt een nieuwe activatiecode; die stelt het bij de volgende keer
    inloggen opnieuw in. De sessie na
    de installatie (installatiecode) is volledig; de eerste beheerder stelt 2FA daarna in. Na de update naar deze
    versie logt iedereen opnieuw in.
- **Beheer** op `/app/beheer/` (alleen de rol beheerder, recht `systeem`; opzet zoals in AquaTech): zijbalk met groepen
  en een zoekveld, een systeemoverzicht (versie, Node.js, PostgreSQL, laatste migratie, looptijd en de bron van elke
  instelling) en instellingenformulieren. Instellingen staan in de tabel `settings` (`app/src/beheer/settings.js`):
  wat in Beheer is opgeslagen gaat voor een omgevingsvariabele (startwaarde), die weer voor de standaard; per instelling
  kan het terug naar de startwaarde. Geheimen staan versleuteld (hoofdsleutel) en gaan nooit volledig naar de browser.
  Elke wijziging komt in het auditlog (welke instelling, nooit de waarde). Secties:
  - *Systeem > Updates en onderhoud*: draaiende en beschikbare versie (nieuwste commit van `main`), de releasenotes
    daartussen, *Nu controleren*, *Nu updaten* (vraagt het wachtwoord, 5 pogingen per kwartier), een aanvraag intrekken
    en *automatisch bijwerken* aan/uit (instelling `updateAuto`). De app rolt zelf niets uit: ze praat met
    `deploy/apps01/update.sh` via `/update/status` (alleen-lezen) en `/update/request` (`app/src/system/system-update.js`);
    de host bouwt eerst, zet dan de onderhoudsmodus aan, maakt een back-up, wisselt de container, controleert de versie
    en valt bij een fout terug. Onderhoudsmodus (`app/src/system/maintenance.js`): tijdens een update of met de hand
    (instellingen `maintenanceMode`, `maintenanceMessage`) geeft elk schrijfverzoek 503 met een melding en staat er een
    balk op elke pagina; inloggen en uitloggen (en bij handmatig onderhoud het uitzetten) blijven werken. Alles in het
    auditlog, ook afgeronde uitrollen.
  - *Systeem > Logboek* en *Foutopsporing*: fouten (met foutcode), trage verzoeken (`logSlowMs`) en waarschuwingen van
    achtergrondtaken in `app_logs` (`app/src/system/app-log.js`), zonder geheimen of persoonsgegevens (privacyfilter),
    te filteren op niveau en bron en te zoeken op foutcode, request-id of tekst (`app/src/beheer/log-routes.js`). Een
    bezoeker ziet bij een fout alleen de foutcode; met de debugmodus (`debugMode`) zien beheerders de details op de
    foutpagina. Elk antwoord heeft een `X-Request-Id`. Bewaartermijn `logRetentionDays` (standaard 30 dagen).
  - *Systeem > Bewaking en meldingen*: elke vijf minuten controles op back-up (ouder dan `monitorBackupMaxHours`,
    laatste poging mislukt), Google Drive, hersteltest, mail, schijfruimte (`monitorDiskMinPercent`), fouten per uur
    (`monitorErrorsPerHour`) en de laatste update (`app/src/system/monitor.js`). Een probleem opent een incident in
    `monitor_incidents`; nieuwe, ernstiger en opgeloste incidenten gaan in één melding naar het meldadres
    (`monitorEmail`, anders het kantooradres) en de webhook (`monitorWebhookUrl`, JSON met `text`/`content`), met een
    herinnering na `monitorRepeatHours`. De heartbeat-URL (`monitorHeartbeatUrl`) wordt aangeroepen zolang er geen
    ernstig incident open staat. Uitgaande verzoeken alleen via https naar openbare adressen
    (`app/src/security/safe-request.js`); URL's staan versleuteld en komen nooit in logboek of uitvoer. Met *Nu
    controleren* en *Testmelding versturen*.
  - *Systeem > Servertaken*: afvinklijst met taken voor de server (`app/src/system/host-tasks.js`) en het ene vaste
    commando voor de Proxmox-host dat alle openstaande taken uitvoert (`deploy/apps01/servertaken.sh`, op een vaste
    commit van `main`); de server vinkt gelukte taken zelf af, met de hand afvinken kan ook (auditlog).
  - *Organisatie > Contact en organisatie*: telefoon en e-mail (voettekst), adres en social media (JSON-LD).
  - *Organisatie > Balk "in ontwikkeling"*: een balk bovenaan elke pagina van de publieke site (niet in het CRM) met
    een eigen tekst; standaard aan, uitzetten bij go-live.
  - *E-mail > Mailserver*: SMTP met gebruikersnaam en wachtwoord (587 met STARTTLS of 465 met SSL/TLS) of een
    Exchange Online-connector op IP-basis (poort 25, zonder inlog), afzender en antwoordadres. De app verbindt alleen
    met een openbaar adres, eist STARTTLS (of SSL/TLS) en een geldig certificaat op de servernaam; zonder server en
    afzender wordt niets verstuurd. Met een testmail (5 per tien minuten, in het auditlog zonder adres), het WAN-IP van
    de server (dat adres moet de connector in Exchange vertrouwen) en de laatste 20 verzendingen (in het geheugen,
    zonder adressen of inhoud).
  - *E-mail > Meldingen aan kantoor*: kantooradres en per soort aan/uit: een mail bij een nieuw contactbericht en bij
    een nieuwe aanmelding (antwoordadres = de afzender). De melding gaat na het opslaan op de achtergrond; mislukt die,
    dan blijft de inzending gewoon bewaard en staat de fout in het overzicht van de mailserver. Een aanmelding gaat
    zonder bijzondere gegevens (geboortedatum, kerk, paspoort, noodnummer, bijzonderheden) de deur uit.
  - *E-mail > Mail-opmaak*: kleur van de titelbalk (contrast met wit minimaal 4,5) en voettekst; het logo van de site
    staat bovenaan elke mail (ingebed). Met een voorbeeld in een nieuw tabblad.
  - *Toegang en beveiliging > Sessies en bewaartermijnen*: uitloggen na inactiviteit (1–24 uur, standaard 8), maximale
    sessieduur (1–30 dagen, standaard 7; korter geldt meteen, ook voor wie al is ingelogd, een langere maximale duur alleen voor nieuwe sessies), bewaartermijn van het
    auditlog (standaard 24 maanden), van de IP-voorvoegsels daarin (standaard 90 dagen, daarna gewist) en van de
    404-lijst (standaard 90 dagen). Opruimen gebeurt bij het starten en daarna dagelijks.
  - *Toegang en beveiliging > Captcha op formulieren*: onzichtbare captcha (Google reCAPTCHA v3) op het contact- en
    aanmeldformulier, naast honeypot, tijdstempel en limiet; standaard uit. Sitesleutel en geheime sleutel (versleuteld)
    uit de reCAPTCHA-console (type v3, met de domeinen van de site), minimale score (0,3/0,5/0,7) en wat er gebeurt als
    Google niet bereikbaar is (doorlaten of blokkeren). Zonder sleutels staat er niets van Google in de site; met
    sleutels krijgen alleen `/contact/` en `/aanmelden/` de Google-adressen in de CSP en wordt Google pas geladen als
    iemand het formulier invult. Met een controle van de geheime sleutel en de laatste 20 uitkomsten.
  - *Back-ups en herstel > Back-ups*: dagelijks (standaard 03:00 uur Nederlandse tijd, instelbaar) een versleutelde
    back-up van de hele database in `/data/backups` (`app/src/backup/backups.js`): `pg_dump -Fc` als stroom door
    AES-256-GCM met een sleutel afgeleid van de hoofdsleutel, na het maken volledig gecontroleerd (tag + dumpformaat),
    bestanden alleen voor de app leesbaar. Bewaartermijn instelbaar (standaard 14 dagen, de nieuwste drie blijven altijd).
    Met status (laatste back-up en poging, volgende automatische, sleutel-id van de hoofdsleutel), *Nu een back-up maken*
    (op de achtergrond, 6 per uur) en downloaden (blijft versleuteld, 10 per uur); maken en downloaden staan in het
    auditlog. Een mislukte automatische
    back-up wordt na een uur opnieuw geprobeerd. Vóór elke update op apps01 maakt `update.sh` ook een back-up. Op de
    opdrachtregel: `node src/backup/cli.js create|list|decrypt`. Terugzetten met `deploy/apps01/restore-backup.sh`,
    verhuizen naar een andere server: `docs/DRAAIBOEK-VPS-VERHUIZING.md`. Afbeeldingen
    zitten (nog) niet in de back-up; die zijn opnieuw te importeren.
  - *Back-ups en herstel > Google Drive*: kopie van elke back-up op Google Drive (`app/src/backup/drive.js`), standaard
    uit. OAuth 2.0 met een eigen Google-app (client-ID en -secret, versleuteld), scope `drive.file`: de app ziet alleen
    de map die ze zelf aanmaakt. Koppelen via *Koppelen met Google*; het terugkeeradres
    (`<basisadres>/app/beheer/google-drive/terug/`) staat in de sectie. De terugkeer werkt zonder sessie (de cookie is
    `SameSite=Strict`) en vertrouwt alleen een eenmalige state van 15 minuten. Het refresh-token staat versleuteld in de
    instellingen, in geen enkel formulier. Na elke back-up en elk uur gaan ontbrekende back-ups (al versleuteld) naar Drive
    (hervatbare upload als stroom); de nieuwste N blijven op Drive (standaard 30). Met status, *Nu synchroniseren* (6 per
    tien minuten), *Ontkoppelen* (token ingetrokken bij Google) en de laatste 20 gebeurtenissen; koppelen en ontkoppelen
    in het auditlog. Een ingetrokken koppeling meldt "koppel opnieuw"; Google instellen: `docs/GOOGLE-DRIVE.md`.
  - *Back-ups en herstel > Hersteltest*: elke zondag rond 04:30 zet apps01 de nieuwste back-up terug in een
    wegwerp-PostgreSQL (eigen container, intern netwerk zonder uitgang, tmpfs), start daarop het huidige app-image en
    vergelijkt de rijen per tabel met de echte database (`deploy/apps01/restore-test.sh`, systemd-timer
    `avanta-restore-test.timer`, door `install.sh` geïnstalleerd). De app bepaalt en toont de uitslag (geslaagd,
    waarschuwing bij meer dan 25% verschil, mislukt) via `cli.js restore-test-result`. *Nu testen op de server* zet een
    verzoek neer dat een path-unit oppikt. Daarnaast test de app wekelijks (en op verzoek) de nieuwste kopie op Google
    Drive: downloaden, volledig ontsleutelen, controleren en vergelijken met de back-up op de server
    (`app/src/backup/restore-test.js`). Aanvragen (3 per uur) staan in het auditlog.
  - *Vindbaarheid > Zoekmachines*: indexeren aan/uit (standaard uit; **aanzetten vraagt het wachtwoord** van de
    beheerder, `SITE_INDEXABLE` is alleen de startwaarde), basisadres (`SITE_URL` als startwaarde; canonical, sitemap
    en JSON-LD gebruiken nooit het adres uit het verzoek) en de verificatiecodes van Google Search Console en Bing.
  - *Vindbaarheid > Titels en omschrijving*: naam van de site, titel van de homepage, standaardomschrijving en
    -afbeelding voor social media.
  - *Vindbaarheid > Robots, sitemap en llms.txt*: extra regels voor robots.txt (alleen `User-agent`/`Allow`/`Disallow`; een losse
    `Disallow:` geldt voor alle crawlers),
    paden die niet in de sitemap horen (`/pad/` of `/pad/*`) en `/llms.txt` voor AI-zoekmachines (alleen als de site
    geïndexeerd mag worden).
  - *Vindbaarheid > Google Analytics en cookies*: GA4 aan/uit met meet-ID (`G-…`). Zonder actief meet-ID staat er
    niets in de pagina en blijft de CSP gelijk. Met meet-ID krijgen bezoekers een cookiebalk; pas na *Accepteren* wordt
    Google geladen (Consent Mode v2, alleen `analytics_storage`, nooit advertentie-opslag of Google Signals). Weigeren of
    intrekken via *Cookie-instellingen* in de voettekst wist de `_ga`-cookies. Het CRM meet nooit.
  - *Vindbaarheid > Doorverwijzingen*: oud pad → nieuw pad op de site of `https://`-adres, 301 (permanent) of 302
    (tijdelijk), met notitie en gebruiksteller (tabel `redirects`, in het geheugen; alleen GET/HEAD, de querystring gaat
    mee, een pad zonder slash telt ook met slash). Geen ketens of lussen, niet voor `/app/`, `/api/` of de homepage.
  - *Vindbaarheid > Niet gevonden (404)*: de vaakst gevraagde adressen die niet bestaan (tabel `not_found_log`: alleen
    pad, aantal, eerste/laatste keer en de host van de verwijzende site; nooit querystring of IP-adres), met een knop om
    door te verwijzen. Tellers worden per minuut weggeschreven; hoogstens 5000 regels, na 90 dagen zonder aanvraag weg.
    Ruis van scanners (`/.env`, `.php`, `/wp-admin` e.d.) telt niet mee.
  Zolang indexeren uit staat, krijgt elke pagina `noindex` (meta én `X-Robots-Tag`) en weert robots.txt alles; het CRM
  en foutpagina's zijn nooit indexeerbaar.

## Werkwijze

Repository opgezet volgens dezelfde werkwijze als AquaTech Hub: Claude Code werkt in kleine PR's op een eigen branch,
elke PR krijgt een verplichte Claude code review en security review, en versie + changelog worden na de merge
automatisch bijgewerkt uit releasenotes-fragmenten.

## Structuur
| Pad | Inhoud |
|---|---|
| `CLAUDE.md` | werkgeheugen voor Claude Code (wordt automatisch gelezen) |
| `AGENTS.md` | korte kaart voor agents, sectie *Zuinig werken* |
| `docs/WERKWIJZE.md` | projectonafhankelijke werkwijze (gelijk aan AquaTech) |
| `docs/AVANTA-CONTEXT.md` | productcontext, bedrijfsregels, AVG en omgeving |
| `docs/CLAUDE-sjabloon.md` | sjabloon voor `CLAUDE.md` in een volgend project |
| `.claude/agents/` | verkenners `map`, `callers`, `tests` |
| `app/` | de applicatie (`src/`, `public/`, `tools/import-wordpress.js`, `test/`); versie in `app/package.json` |
| `app/src/beheer/` | Beheer: `settings.js` (instellingen), `indeling.js` (zijbalk), `routes.js` (`/app/beheer/`), `mail-routes.js` (testmail, WAN-IP), `backup-routes.js` (back-ups), `drive-routes.js` (Google Drive), `restore-test-routes.js` (hersteltest), `update-routes.js` (updates en onderhoud), `host-task-routes.js` (servertaken), `log-routes.js` (logboek), `monitor-routes.js` (bewaking) |
| `app/src/system/` | `system-update.js` (updates vanuit de app), `maintenance.js` (onderhoudsmodus), `host-tasks.js` (servertaken), `request-context.js` (context per verzoek), `app-log.js` (logboek, foutcodes), `monitor.js` (bewaking) |
| `app/src/backup/` | `backups.js` (versleutelde back-ups, planner), `drive.js` (kopie naar Google Drive), `restore-test.js` (hersteltests), `cli.js` (maken, tonen, ontsleutelen op de opdrachtregel) |
| `app/src/mail/` | `mailer.js` (versturen via SMTP of Exchange-connector), `wan-ip.js` (WAN-IP van de server), `layout.js` (opmaak), `notifications.js` (meldingen aan kantoor) |
| `docs/OPZET-WEBSITE.md` | opzet, inventaris van de huidige site, fasering en open vragen |
| `changes/` | releasenotes-fragmenten, zie `changes/README.md` |
| `tools/release-notes.js` | verwerkt fragmenten; controleert PR's |
| `.github/workflows/` | `ci`, `version`, `release`, `claude-review`, `security` |

## Werkwijze per wijziging
1. Branch vers vanaf `origin/main` (`feature/<naam>` of `claude/<naam>`).
2. Wijzigen → geraakte tests → `changes/<naam>.md` als `app/` wijzigt.
3. Push → **draft-PR** → klaar: *ready for review*.
4. CI groen + *Claude code review* + *Claude security review* → bevindingen verwerken → auto-merge.
5. `release.yml` verhoogt de versie, werkt `app/CHANGELOG.md` bij en verwijdert het fragment.

Alleen docs/CI zonder effect op de app: label `geen-releasenotes`.

## Eenmalige instellingen in GitHub
| Waar | Wat |
|---|---|
| Settings > Secrets and variables > Actions > *Secrets* | `CLAUDE_CODE_OAUTH_TOKEN` (aanmaken met `claude setup-token`) |
| idem | `RELEASE_PUSH_TOKEN` (fine-grained PAT van de beheerder, *Contents: read and write* op deze repo) |
| Settings > Secrets and variables > Actions > *Variables* | `CLAUDE_REVIEW_MODEL` (eerste review) en `CLAUDE_REVIEW_MODEL_PUSH` (lichtere review per push); leeg = standaard |
| Settings > Rules > Rulesets (branch `main`) | PR verplicht, geen force-push, bypass: *Repository admin* |
| idem, *Require status checks* | `Claude code review`, `Claude security review`, `version-must-increase`, `test`, `image` |
| Settings > General | *Allow auto-merge* aan, *Automatically delete head branches* aan |
| Settings > Code security | Secret scanning + push protection aan |
| Issues > Labels | label `geen-releasenotes` aanmaken |
| Packages (na de eerste release) | package `avanta-reizen` aan deze repo koppelen (*Connect repository*) en de zichtbaarheid kiezen (privé: de server logt in op GHCR met een token met *read:packages*) |
| GitHub Apps | Claude GitHub App installeren op deze repo (voor de reviews) |
| Renovate (optioneel) | Renovate-app activeren; config staat in `renovate.json` |

## Lokaal testen
```sh
cd app && TEST_DATABASE_URL=postgres://…/avanta_test npm test   # wist de testdatabase
node --test "tests/*.test.js"                                    # releasescript (vanuit de root)
node tools/release-notes.js --check                              # fragmenten controleren
```
