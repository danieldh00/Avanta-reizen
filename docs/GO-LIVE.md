# Go-live-draaiboek

Checklist voor de overstap van de huidige website (www.avantareizen.nl) naar de nieuwe site met het CRM. Elke stap
heeft een eigenaar en een controle die zegt wanneer hij klaar is. Werk de tabellen van boven naar beneden af; vink een
stap pas af als de controle klopt. Audit-nummers (A…) en bevindingen (F…) verwijzen naar de controle van 21 en 23
november 2026.

**Eigenaren**

| Eigenaar | Wie | Doet |
|---|---|---|
| Daniël | beheerder van de server en het domein | hosting, DNS, Cloudflare, sleutels, instellingen in Beheer |
| Avanta | kantoor van Avanta Reizen | inhoud, juridische keuzes, afspraken met verwerkers en reisleiders |
| Code | een PR in deze repository | wat in de app of de scripts moet veranderen |

**Beheer > Systeem > Livegang** (`/app/beheer/livegang/`) toont van de stappen die de app zelf kan nagaan de actuele
stand (instellingen, tweestapsverificatie per gebruiker, vaste inhoud in het CRM). Gebruik die pagina naast dit
draaiboek; stappen buiten de app staan alleen hier.

Servercommando's staan niet in dit draaiboek: wat op de server moet gebeuren, is een vaste servertaak (Beheer >
Servertaken) of staat in `docs/DRAAIBOEK-VPS-VERHUIZING.md`.

## 1. Vooraf (uiterlijk een week vóór de overstap)

### 1a. Productieomgeving

| # | Stap | Eigenaar | Klaar als |
|---|---|---|---|
| 1.1 | Hosting voor productie kiezen (A01) | Daniël | keuze vastgelegd in het projectgeheugen |
| 1.2 | Productiestack: eigen server of container, eigen Cloudflare-tunnel en eigen netwerk, geharde containers (A01, A15) | Code (plan PR 6.1), na 1.1 | stack draait op een tijdelijk adres, `/api/health` geeft `ok` |
| 1.3 | Bijwerken op releaseversie in plaats van `main`, met onderhoudsvenster (A18) | Code (plan PR 6.1) | Beheer > Updates toont de gevolgde versie, niet `main` |
| 1.4 | Hoofdsleutel in de wachtwoordkluis, kopie buiten de server (A04) | Daniël | sleutel-id in de kluis gelijk aan Beheer > Back-ups |
| 1.5 | Google Drive koppelen voor de kopie van de back-ups (`docs/GOOGLE-DRIVE.md`) | Daniël | Beheer > Back-ups > Google Drive: laatste upload van vandaag |
| 1.6 | Hersteltest groen op de productieserver | Daniël | Beheer > Back-ups > Hersteltest: laatste uitslag geslaagd |
| 1.7 | Afbeeldingen uit de import in de back-up (A14) | Code (gebouwd) | Beheer > Logboek, bron *fotobibliotheek*: geen melding *importfoto('s) zonder bruikbaar bestand* |

### 1b. E-mail en bewaking

| # | Stap | Eigenaar | Klaar als |
|---|---|---|---|
| 1.8 | Mailserver ingesteld (Beheer > E-mail > Mailserver), testmail verstuurd | Daniël | testmail komt aan, niet in de spam |
| 1.9 | SPF, DKIM en DMARC van het domein (A29), zie §6 | Daniël | mail-tester.com geeft minimaal 9/10, DMARC minimaal `p=quarantine` |
| 1.10 | Meldadres voor de bewaking (Beheer > Systeem > Bewaking en meldingen, `monitorEmail`) (A11) | Daniël | testmelding komt aan |
| 1.11 | Externe uptime-check op `/api/health` en heartbeat-URL (`monitorHeartbeatUrl`) (A11), zie §7 | Daniël | de externe dienst meldt een storing als de app een paar minuten uit staat |

### 1c. Beveiliging

| # | Stap | Eigenaar | Klaar als |
|---|---|---|---|
| 1.12 | Cloudflare-regels (A24), zie §5 | Daniël | regels actief op het productiedomein |
| 1.13 | Beveiligingsscan (ZAP) en opvolging van de bevindingen (A21): Actions > Beveiligingsscan (ZAP) > Run workflow, eventueel met het adres van de testomgeving | Daniël start, Code volgt op | laatste run groen; geen open bevindingen van niveau Hoog of Middel zonder reden in `.github/zap/regels.tsv` |
| 1.14 | Captcha met echte sleutels (Beheer > Toegang en beveiliging), CSP-uitzondering nagelopen (W08) | Daniël, daarna Code | formulieren werken met captcha aan; geen CSP-fouten in de browserconsole |
| 1.15 | Alle CRM-gebruikers hebben tweestapsverificatie aangezet, zodat de verplichting in 2.4 niemand buitensluit | Daniël | Gebruikers: bij elke gebruiker met rol beheerder, kantoor of reisleider staat 2FA aan |

### 1d. Inhoud en juridisch

| # | Stap | Eigenaar | Klaar als |
|---|---|---|---|
| 1.16 | Vaste inhoud staat in het CRM, niet meer in de terugvalbestanden (F09) | Avanta, met Daniël | Beheer > Systeem > Livegang, blok *Vaste inhoud in het CRM*: niets meer *Open* |
| 1.17 | Adres, KvK-nummer en social media (Beheer > Organisatie > Contact en organisatie) | Avanta | voettekst en contactpagina kloppen |
| 1.18 | Privacyverklaring bijgewerkt: captcha, Analytics (als aan), verwerkers, bewaartermijnen (A03) | Avanta | pagina gepubliceerd in het CRM |
| 1.19 | Verwerkersovereenkomsten (hosting, mail, Google, Mollie) en bewaartermijnen vastgesteld (A03, A16) | Avanta | getekend; termijnen in Beheer > Toegang en beveiliging > AVG en bewaartermijnen |
| 1.20 | Venster voor de reisleider afgesproken met Avanta | Avanta | aantal dagen vóór vertrek en na terugkomst vastgelegd (zie 2.6) |
| 1.21 | Online betalen: proefbetaling met de testsleutel van Mollie geslaagd (als online betalen aan gaat) | Daniël | betaling staat geregistreerd bij de aanmelding |
| 1.22 | Rooktest op het tijdelijke adres van de productiestack (§3) | Daniël | alle stappen van §3 goed |

## 2. De dag van de overstap

Voer de stappen in deze volgorde uit. Plan de overstap op een rustig moment (geen lopende inschrijvingsactie).

| # | Stap | Eigenaar | Klaar als |
|---|---|---|---|
| 2.1 | Laatste import van de huidige site (inhoud en afbeeldingen), daarna niets meer wijzigen op de oude site | Daniël | import zonder fouten; Avanta weet dat de oude site bevroren is |
| 2.2 | Back-up maken (Beheer > Back-ups > Nu een back-up maken) | Daniël | nieuwe back-up in de lijst en op Google Drive |
| 2.3 | Basisadres van de site op het productiedomein (Beheer > Vindbaarheid > Zoekmachines, `siteUrl`) | Daniël | canonical-links en sitemap tonen `https://www.avantareizen.nl` |
| 2.4 | **Tweestapsverificatie verplicht** voor rollen met bijzondere gegevens: Beheer > Toegang en beveiliging > Tweestapsverificatie, `mfaRequiredFor` op *Rollen met toegang tot bijzondere gegevens* (`gegevens`) (A05, besluit 23-11-2026) | Daniël | de waarschuwing over 2FA in Beheer is weg; inloggen als kantoor vraagt een code |
| 2.5 | **Balk "in ontwikkeling" uit**: Beheer > Organisatie > Balk "in ontwikkeling", `devBannerEnabled` uit | Daniël | de balk staat niet meer bovenaan de publieke site |
| 2.6 | **Venster voor de reisleider definitief**: Beheer > CRM > Reisleider, `guideWindowDaysBefore` en `guideWindowDaysAfter` op de waarden uit 1.20 | Daniël | de waarden zijn gelijk aan de afspraak met Avanta |
| 2.7 | Mollie op de live-sleutel (als online betalen aan gaat): Beheer > CRM > Online betalen | Daniël | betaalpagina toont iDEAL in live-modus |
| 2.8 | DNS van `www.avantareizen.nl` (en het kale domein) naar de Cloudflare-tunnel van de productiestack | Daniël | de site op het domein toont de nieuwe versie (versie onderaan Beheer > Systeemoverzicht) |
| 2.9 | **Zoekmachines toelaten**: Beheer > Vindbaarheid > Zoekmachines, `seoIndexing` aan (vraagt je wachtwoord) | Daniël | geen `noindex` meer in de bron van de homepage; `robots.txt` noemt de sitemap |
| 2.10 | Rooktest op het productiedomein (§3) | Daniël | alle stappen van §3 goed |
| 2.11 | Sitemap indienen bij Google Search Console en Bing (verificatiecodes in Beheer > Vindbaarheid > Zoekmachines) | Daniël | sitemap geaccepteerd |

Zet 2.9 pas aan als 2.8 en de rooktest goed zijn: zolang de site nog op een tijdelijk adres staat, mag Google hem niet
opnemen.

## 3. Rooktest

Op het adres dat getest wordt (tijdelijk adres in stap 1.22, het domein in stap 2.10). Een privévenster voorkomt dat
een oude sessie de uitkomst kleurt.

1. Homepage, een reis (`/reis/<slug>/`), een reisleider, een blogbericht, de FAQ en een pagina openen: inhoud en foto's
   kloppen, geen fouten in de browserconsole.
2. Oude adressen: een paar adressen uit de sitemap van de oude site openen (een reis, een categorie, een blogbericht):
   elk geeft de pagina of een 301 naar de nieuwe plek.
3. Contactformulier versturen: bericht staat in het CRM, kantoor krijgt de melding.
4. Aanmelding voor een testreis versturen: bevestiging aan de reiziger komt aan, aanmelding staat in het CRM. Daarna de
   testaanmelding annuleren en verwijderen.
5. Reizigersaccount: registreren, inloggen, Mijn reizen openen.
6. CRM: inloggen met tweestapsverificatie, overzicht, een aanmelding openen (versleutelde velden leesbaar), een
   deelnemerslijst als Excel exporteren.
7. Beheer > Systeemoverzicht: juiste versie, laatste migratie; Beheer > Logboek: geen nieuwe fouten.
8. `https://<adres>/api/health` geeft `ok`; de externe uptime-check staat op groen.
9. In de koppen van een pagina: `Strict-Transport-Security` aanwezig (alleen over https), `Content-Security-Policy`
   aanwezig.

## 4. Na de overstap

| # | Stap | Eigenaar | Wanneer |
|---|---|---|---|
| 4.1 | Beheer > Vindbaarheid > Niet gevonden (404): adressen die veel gevraagd worden een doorverwijzing geven (Doorverwijzingen) | Daniël of Avanta | dag 1, 2, 7 en daarna wekelijks een maand lang |
| 4.2 | Google Search Console: dekking en crawlfouten nalopen | Daniël | na een week |
| 4.3 | Back-ups en hersteltest blijven groen, bewaking meldt niets | Daniël | dagelijks de eerste week |
| 4.4 | Oude hosting pas opzeggen na een stabiele periode van minstens vier weken (nodig voor het terugvalplan) | Daniël | na vier weken |
| 4.5 | HSTS-preload (W10): eerst controleren dat alle subdomeinen via https werken en het kale domein (`avantareizen.nl`) naar https doorverwijst met dezelfde kop (Cloudflare); dan Beheer > Toegang en beveiliging > HSTS-preload aanzetten en het domein aanmelden op hstspreload.org. De app stuurt `preload` alleen als de site live is (zoekmachines toegelaten) en alleen op de host van het basisadres, dus nooit op de testomgeving. Terugdraaien kost maanden: alleen doen als alles stabiel is | Daniël | na een stabiele periode van enkele weken met HSTS in productie |

## 5. Cloudflare-regels (A24)

De app heeft zelf limieten per proces (in het geheugen). Cloudflare is de tweede laag, vóór de app.

- **SSL/TLS**: modus *Full (strict)*, *Always Use HTTPS* aan, minimale TLS-versie 1.2.
- **Rate limiting** (Security > WAF > Rate limiting rules), per IP-adres, actie *Block* of *Managed Challenge*:

  | Pad | Methode | Grens (voorstel) |
  |---|---|---|
  | `/app/inloggen/` | POST | 10 per minuut |
  | `/account/inloggen/` | POST | 10 per minuut |
  | `/account/registreren/` | POST | 5 per minuut |
  | `/account/wachtwoord-vergeten/` | POST | 5 per minuut |
  | `/aanmelden/` | POST | 5 per minuut |
  | `/contact/` | POST | 5 per minuut |

- **Cache**: niets cachen onder `/app/`, `/account/`, `/aanmelden/` en `/api/` (regel *Bypass cache*). Statische
  bestanden (`/css/`, `/js/`, `/fonts/`, `/images/`, `/media/`) mogen gecachet worden; de app zet zelf `?v=<versie>`
  achter CSS en JavaScript, zodat een update meteen doorkomt.
- **Bots**: *Bot Fight Mode* aan; controleer daarna dat de Mollie-terugmelding (webhook) en de externe uptime-check niet
  worden tegengehouden.
- De app vertrouwt alleen de koppen van de tunnelcontainer (`TRUST_PROXY`, exact IP-adres); dat zet de installatie.

## 6. Mailauthenticatie (A29)

- **SPF**: één TXT-record op het domein dat de gebruikte mailserver toestaat (bijv. `include:` van de mailprovider),
  eindigend op `-all` of `~all`.
- **DKIM**: ondertekening aan bij de mailprovider; de CNAME- of TXT-records van de provider in de DNS.
- **DMARC**: TXT-record `_dmarc` met minimaal `p=quarantine` en een `rua`-adres voor de rapporten.
- Controle: een testmail uit Beheer > E-mail naar het adres van mail-tester.com sturen; doel minimaal 9/10.

## 7. Externe bewaking (A11)

De bewaking in de app (Beheer > Systeem > Bewaking en meldingen) ziet niet dat de hele server uit staat. Daarom:

- **Uptime-check** bij een externe dienst op `https://www.avantareizen.nl/api/health`, elke vijf minuten, melding
  naar Daniël.
- **Heartbeat** (dead man's switch): de URL van de externe dienst in `monitorHeartbeatUrl`; de app roept hem elke ronde
  aan, en blijft dat uit, dan meldt de dienst het.
- **Meldadres** (`monitorEmail`) en eventueel een webhook (`monitorWebhookUrl`) voor meldingen uit de app zelf.

## 8. Terugvalplan

Gaat er na de overstap iets mis dat niet binnen een uur te herstellen is:

1. **Beslissen**: Daniël besluit tot terugvallen (bij twijfel: aanmeldingen of betalingen werken niet, of er lekken
   gegevens).
2. **DNS terug** naar de oude hosting (de oude site staat nog, zie 4.4). Door de korte TTL van Cloudflare is dat binnen
   minuten actief.
3. **Indexeren uit** (Beheer > Vindbaarheid > Zoekmachines, `seoIndexing` uit) en de balk "in ontwikkeling" weer aan,
   zodat de nieuwe site op zijn tijdelijke adres niet wordt opgenomen.
4. **Gegevens veiligstellen**: aanmeldingen, contactberichten en betalingen die in de tussentijd op de nieuwe site zijn
   binnengekomen, staan in het CRM en in de back-ups; kantoor neemt ze over (Excel-export van de aanmeldingen).
5. **Oorzaak** vastleggen in het projectgeheugen en oplossen in een PR; daarna het draaiboek opnieuw vanaf §2.

Na een terugval blijven de instellingen uit §2 (2FA verplicht, venster reisleider) gewoon staan; alleen 2.5 en 2.9 gaan
terug.
