# Ombouw naar Vue: besluiten, opbouw en werkwijze

Besluiten van Daniël op 25-11-2026. Dit bestand bevat de regels waar code en PR's zich aan houden; het volledige plan
met alle PR's, risico's en de inschatting staat in de projectbestanden (`plan/plan-vue-ombouw.md` en
`plan/plan-vue-ombouw.xlsx`). Wie de werkwijze of de opbouw verandert, werkt dit bestand bij in dezelfde PR.

Stand: fase V1 (fundament) op `develop`. V1.1: het Vite-project `app/web/` (zie §7). V1.2: het API-fundament (§8). V1.3: het
koppelpunt in de schil en het eerste scherm in Vue (§9). V1.4: de bouwstenen voor lijsten, formulieren en meldingen
(`app/web/CLAUDE.md`). V1.5: teksteditor, fotokiezer en uploadveld; daarmee is het fundament klaar en kan een module
worden omgebouwd (V2: FAQ als proef). V2.1: de JSON-API van de FAQ (`cms/faq-api.js`). V2.2: de schermen van de FAQ in
Vue (`app/web/src/modules/faq/`). V2.3: goedgekeurd op staging en naar `main` (#150); daarna zijn de oude FAQ-schermen
van de server weggehaald. Dit patroon geldt voor de volgende modules (V3).

## 1. Besluiten

| Nr | Onderwerp | Besluit |
|---|---|---|
| 1 | Bereik | CRM en Beheer (`/app/`), daarna ook de publieke site en het reizigersaccount |
| 2 | Moment | nu starten, los van de livegang; werk voor de livegang gaat voor en gaat naar `main` |
| 3 | Staging | een tweede opstelling naast de testomgeving op dezelfde server, met een eigen database; een eigen machine vanaf de livegang |
| 4 | Invoer van de nieuwe API-routes | één schemabibliotheek, alleen in de nieuwe API-routes |
| 5 | Reizigersaccount `/account/` | gaat mee, samen met de publieke site |
| 6 | Inloggen, installatie, wachtwoord en de 2FA-code van het CRM | blijven server-gerenderd |

## 2. Opbouw

- **Vue 3 + TypeScript + Vite**, module voor module. Geen herschrijving in één keer: elke fase laat de app werkend
  achter. De server blijft Node met Express.
- **Bron** in `app/web/` (eigen `package.json`): `src/api/` (getypte client), `src/components/` (bouwstenen),
  `src/modules/<module>/` (ingang, routes en schermen; zelfde namen als `app/src/<module>/`, met een eigen
  `CLAUDE.md`). Vite krijgt een ingang per omgebouwde module; de uitvoer wordt bij het bouwen van het image gemaakt en
  staat niet in git. Niets van een CDN.
- **API**: Avanta heeft nu geen JSON-API. Per module komt er een `<onderwerp>-api.js` naast het bestaande routebestand,
  onder `/app/api/…`, op de bestaande logica (geen dubbele queries). Elke route dwingt het recht af en zoekt een id
  samen met zijn eigenaar op; tests per route: andere eigenaar 404, ontbrekend recht 403, invoer, limiet.
- **De schil blijft tot het eind**: de server levert elke pagina van het CRM met de bestaande opmaak
  (`crm/layout.js`); bij een omgebouwde module staat in het midden een koppelpunt en laadt de pagina de bundel van die
  module. Menu en rechten staan zo op één plek. De schil zelf gaat als laatste van het CRM over, in een fase die
  alleen draait.
- **Adressen blijven gelijk**: vue-router per module in history-modus onder het pad van die module.
- **Toestand** in het scherm (`ref`/`reactive`); een gedeelde store alleen als twee schermen iets moeten delen.
- **Beveiliging blijft op de server**: sessie, 2FA, rechten en limieten veranderen niet. Schrijvende API-routes eisen
  dezelfde herkomst, de juiste inhoudssoort en een vaste eigen kop; antwoorden krijgen `Cache-Control: no-store`; er
  komt niets met persoonsgegevens in de opslag van de browser. De CSP wordt niet verruimd. `v-html` is verboden met een
  lintregel; de enige uitzondering is één component voor inhoud die al door de opschoning is gegaan, met de reden erbij.
- **Publieke site en account**: rendering op de server. Dezelfde componenten worden op de server tot volledige HTML
  gerenderd en in de browser alleen tot leven gewekt. Routes, 301's, koppen, `sitemap.xml` en `robots.txt` blijven op
  de server; wisselen tussen pagina's blijft een gewone paginalading; formulieren werken ook zonder script, met
  dezelfde limieten, honeypot, tijdstempel en captcha. De tests op de HTML van de site en de vergelijking met de live
  site blijven de maatstaf. Indexeren blijft uit tot de livegang.

## 3. Branches: `main` en `develop`

- `main` blijft de branch waar de testomgeving (en later productie) uit draait. Bugfixes en gewone features gaan
  direct naar `main`, zoals altijd.
- `develop` is de integratiebranch van de ombouw. Alleen de migratiethread werkt erin, met een eigen branch vers vanaf
  `origin/develop` en een PR naar `develop`.
- Een PR naar `develop` krijgt dezelfde controles als een PR naar `main`: CI, `version-must-increase`, de
  design-controle en de Claude code review en security review. De harde regel "nooit mergen zonder beide reviews"
  geldt ook hier.
- `develop-sync.yml` voegt `main` elke nacht en na elke geslaagde release samen in `develop`. Bij een conflict faalt de
  run en komt er één issue met het label `develop-sync`; de migratiethread lost dat op in een PR naar `develop`.
- Per geaccepteerde module één PR van `develop` naar `main`, met de volledige controles opnieuw. Die PR bevat alles
  wat op dat moment op `develop` staat; open hem dus alleen als `develop` als geheel goedgekeurd is.
- **Releasenotes**: een PR naar `develop` die `app/` wijzigt voegt gewoon zijn fragment `changes/<naam>.md` toe. De
  fragmenten reizen mee naar `main` en worden daar een versie; op `develop` verandert het versienummer alleen door de
  sync.
- **Bevriezen**: een module die op `develop` wordt omgebouwd krijgt tot de overschakeling geen nieuwe features op
  `main`. Een bugfix in een module die nog niet aan de beurt is gaat gewoon in de bestaande code.
- De fasen V1 (fundament) en V8 (schil) en de eerste twee PR's van V10 (site) draaien alleen: ze raken de gedeelde
  kernbestanden uit `docs/ARCHITECTUUR.md` §2.

Eenmalig in GitHub (zie ook `README.md`, *Eenmalige instellingen in GitHub*): de ruleset van `main` dupliceren met
`develop` als doel (zelfde verplichte controles, zelfde bypass voor de release-token), daarna de branch `develop`
aanmaken vanaf `main`.

## 4. Staging

Staging is een tweede opstelling naast de testomgeving op dezelfde server (`deploy/staging/`): eigen map
(`/opt/apps/avanta-staging`), eigen Docker-project `avanta-staging`, eigen database, eigen geheimen en alleen
verzonnen testdata. Ze wordt op de server gebouwd uit de branch `develop` (zolang die niet bestaat uit `main`) onder
een eigen imagenaam, en werkt zich elke 15 minuten bij; een commit die niet start wordt teruggedraaid en overgeslagen.
Het updatescript van de testomgeving volgt `main` in een andere map en kan staging dus nooit installeren, en omgekeerd.

- Geen koppelingen: geen betaalprovider, geen externe opslag van back-ups, geen mailserver (de app eist een openbaar
  adres voor de mailserver, dus er is geen mailvanger; mail wordt op staging niet verstuurd).
- Niet vindbaar (`SITE_INDEXABLE` staat vast op `false`) en achter een toegangsbeleid van Cloudflare.
- Geen updaten vanuit de app en geen hersteltest: dat blijft bij de testomgeving. Beheer > Systeem > Updates en
  onderhoud toont op staging de gevolgde branch, de draaiende en de nieuwste commit en de laatste controle. Het
  versienummer verandert op staging niet per wijziging; de commit en het tijdstip zeggen of iets er staat.
- Inrichten: servertaak `002-staging-inrichten` in Beheer > Systeem > Servertaken. Daarna één keer met de hand het
  stagingadres toevoegen in Cloudflare; de uitvoer van de taak zegt precies wat. Zie `deploy/apps01/README.md`,
  *Staging*.
- Vanaf de livegang verhuist staging naar een eigen machine, los van de server met echte gegevens.

## 5. Per module

1. API-routes met tests, met een leesfunctie (`create<Onderwerp>Reads`) die de GET-route van het scherm gebruikt om de
   eerste gegevens mee te sturen (§ 9).
2. Schermen in Vue met tests, op de bouwstenen.
3. Design-controle en axe op 1440 en 375 px tegen de baseline van het oude scherm.
4. Op staging bekijken en goedkeuren.
5. PR van `develop` naar `main`; daarna de oude schermen van die module verwijderen.

## 6. Fasen

| Fase | Inhoud | Doel |
|---|---|---|
| V0 | voorbereiding: deze regels, `develop` en sync, staging, baseline van alle CRM-schermen | `main` |
| V1 | fundament: Vite, TypeScript, tests, API-fundament, koppelpunt in de schil, bouwstenen (alleen) | `develop` |
| V2 | proef: FAQ. Besluitmoment: patroon goedkeuren | `develop` |
| V3 | kleine modules: menu's, lijstpagina's, blogcategorieën en tags, reistypes en landen | `develop` |
| V4 | reisaanbod: reisleiders, reizen. Stopmoment: meten of het loont | `develop` |
| V5 | foto's, pagina's en blog | `develop` |
| V6 | boekingen: berichten, aanmeldingen, deelnemers, betalingen, infobrief | `develop` |
| V7 | Beheer | `develop` |
| V8 | schil en overzicht (alleen) | `develop` |
| V9 | afronden CRM: oude weergave weg, volledige herbeoordeling | `develop` en `main` |
| V10 | publieke site en reizigersaccount, met rendering op de server | `develop` |

## 7. Bouwen, testen en ontwikkelen

- **Project**: `app/web/` met een eigen `package.json` (vaste versies), `vite.config.ts`, `tsconfig.json` (strikt) en
  `eslint.config.js`. Details per bestand: `app/web/CLAUDE.md`.
- **Ingangen**: elke map `app/web/src/modules/<module>/` met een `main.ts` wordt vanzelf een eigen bundel; er is geen
  lijst om bij te houden.
- **Uitvoer**: `app/web/dist/` met het manifest van Vite (`dist/.vite/manifest.json`), alleen gemaakt bij het bouwen
  van het image (Dockerfile, stap `web`) en niet in git. Het image krijgt alleen die uitvoer, niet de bron of de
  afhankelijkheden van de frontend. De server biedt de bestanden aan onder `/bundel/`.
- **CSP**: de runtime van Vue zonder compiler (sjablonen vooraf gecompileerd, geen `eval`), geen inline scripts (ook
  geen polyfill voor modulepreload) en opmaak van componenten in losse CSS-bestanden. De policy blijft gelijk.
- **CI** (job `test`): `npm ci`, lint, `vue-tsc`, Vitest met een eigen dekkingsdrempel (95/85/93, zoals de server),
  een proefbouw en `npm audit --omit=dev` voor de afhankelijkheden van de frontend. Dat dekt bewust alleen wat in de
  bundel komt (Vue en de router); het bouwgereedschap (Vite, Vitest, ESLint) draait alleen in CI en in de bouwstap en
  komt niet in het image. Renovate houdt ook die versies bij. De job `image` bouwt het image met de stap
  `web` en doet de rooktest.
- **Lint**: `v-html` is verboden (`vue/no-v-html`), net als `innerHTML`, `outerHTML`, `document.write` en `eval`.
- **Ontwikkelen**: `npm run dev` in `app/web/` bouwt bij elke wijziging opnieuw naar `dist/`; de app op poort 3400
  serveert die uitvoer, dus een scherm is te zien door de pagina te herladen. Bewust geen dev-server van Vite met
  doorsturen: die zet opmaak als inline `<style>` in de pagina en dat laat de CSP (terecht) niet toe.
- **Teksteditor**: de opschoner `app/public/js/rich-text-clean.js` (gedeeld met de server) is in de frontend te
  importeren; de teksteditor in Vue (V1.5) gebruikt dus dezelfde regels.

## 8. API-fundament

- **Server** (`app/src/api/`, regels in `app/src/api/CLAUDE.md`): de router onder `/app/api/` hangt in de schil van
  het CRM ná het laden van de sessie, dus de algemene limiet (300 per minuut), de sessie en 2FA gelden ongewijzigd.
  Zonder sessie volgt 401 (met het pad naar inloggen of de tweede stap), zonder recht 403, beide in JSON.
- **CSRF**: vaste kop `X-Avanta-Api: 1` op elk verzoek (een andere site kan die niet zonder CORS-voorcontrole
  meesturen, en die beantwoordt de server niet), herkomstcontrole en `application/json` bij schrijven. Uploads alleen
  als `multipart/form-data` op de paden die daarvoor zijn opgegeven.
- **Antwoorden**: `Cache-Control: no-store`, dezelfde CSP als de rest. Fouten altijd als
  `{ fout: { code, melding, velden?, foutcode?, naar? } }`; ook onderhoud (503), de limiet (429), een onbekend pad (404)
  en een onverwachte fout (500, foutcode in het logboek).
- **Invoer**: zod (besluit 4), alleen in de API-routes, met `.strict()` en een melding per veld.
- **Client** (`app/web/src/api/client.ts`): de enige weg naar de server; `ApiError` met een nette melding per status.
- `GET /app/api/sessie/` geeft naam, rol en rechten om knoppen te verbergen; de server controleert elk verzoek zelf.

## 9. Koppelpunt in de schil

- **Pagina**: de server levert de pagina met de bestaande opmaak (`crm/layout.js`) en zet in het midden het koppelpunt
  `<div id="crm-app" data-module="<module>" data-base="/app/<pad>/">` (`crm/web-bundle.js`, `renderMountPoint`). In de
  `<head>` staan de opmaak, de voorladers en het script van die module uit het manifest van Vite (`renderBundleHead`),
  alleen als bestanden met `src`/`href`; de CSP blijft `BASE_CSP`. Ontbreekt de bundel, dan toont de pagina een
  melding in plaats van een leeg scherm.
- **Eerste gegevens mee in de pagina** (25-11-2026, na Daniëls opmerking dat de schermen trager aanvoelden): de
  GET-route van een scherm zet de antwoorden van de GET-verzoeken van het eerste scherm in het koppelpunt
  (`data-voorgeladen`, JSON per pad binnen `/app/api`, ge-escapet door `html`; `renderMountPoint` met `preload`). De
  route en de API delen één leesfunctie per module (`create<Onderwerp>Reads` in het `*-api.js`-bestand), met hetzelfde
  recht. De client (`web/src/api/preload.ts`) gebruikt elk antwoord één keer en laat de rest vallen na de eerste wissel
  binnen de module. Zo wacht het eerste scherm niet op een extra verzoek nadat de JavaScript geladen is. Meting lokaal
  met 60 ms vertraging (mediaan): oud ~95 ms, Vue eerst ~150 ms, met voorladen ~100 ms; zonder vertraging gelijk. Elke
  nieuwe module doet dit ook; de servertests controleren met `checkPreload` (`test/helpers/api-app.js`) dat het
  voorgeladen antwoord gelijk is aan dat van de API.
- **Bestanden**: `server.js` serveert alleen `web/dist/assets/` onder `/bundel/assets/`, een jaar in de cache (namen
  met een hash). Het manifest wordt nooit uitgeleverd.
- **Eerste scherm**: Beheer > Systeem > Bouwstenen (`/app/beheer/bouwstenen/`, recht `systeem`) in de module
  `beheer`; het toont elke bouwsteen met een voorbeeld en is zo het vaste scherm voor de design-controle en axe van de
  bouwstenen.
- **CSP-controle**: `npm run check:bundle` (CI) weigert `eval`, `new Function`, HTML en vreemde bestanden in de
  uitvoer; de servertests controleren dat een pagina met een bundel geen inline script of opmaak heeft.
- **Design-controle**: de job `design` bouwt eerst de frontend; `check.js` wacht tot het koppelpunt `data-klaar`
  heeft. `changed-screens.js`: fundament en bouwstenen (`app/web/src/{components,shell,api}/`) wijzen naar het
  overzicht van de bouwstenen en `/app/`; een module in `app/web/src/modules/<module>/` zonder eigen regel raakt dezelfde
  schermen als `app/src/<module>/`.
- **Een module overzetten** (vanaf V2): de route van het oude scherm geeft dezelfde pagina met `bundle` en
  `renderMountPoint` in plaats van de HTML van de server; de API-routes staan er dan al.
