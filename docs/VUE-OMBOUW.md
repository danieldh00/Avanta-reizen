# Ombouw naar Vue: besluiten, opbouw en werkwijze

Besluiten van Daniël op 25-11-2026. Dit bestand bevat de regels waar code en PR's zich aan houden; het volledige plan
met alle PR's, risico's en de inschatting staat in de projectbestanden (`plan/plan-vue-ombouw.md` en
`plan/plan-vue-ombouw.xlsx`). Wie de werkwijze of de opbouw verandert, werkt dit bestand bij in dezelfde PR.

Stand: fase V1 (fundament) op `develop`. V1.1: het Vite-project `app/web/` (zie §7).

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
- Geen updaten vanuit de app en geen hersteltest: dat blijft bij de testomgeving.
- Inrichten: servertaak `002-staging-inrichten` in Beheer > Systeem > Servertaken. Daarna één keer met de hand het
  stagingadres toevoegen in Cloudflare; de uitvoer van de taak zegt precies wat. Zie `deploy/apps01/README.md`,
  *Staging*.
- Vanaf de livegang verhuist staging naar een eigen machine, los van de server met echte gegevens.

## 5. Per module

1. API-routes met tests.
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
  een proefbouw en `npm audit` voor de afhankelijkheden van de frontend. De job `image` bouwt het image met de stap
  `web` en doet de rooktest.
- **Lint**: `v-html` is verboden (`vue/no-v-html`), net als `innerHTML`, `outerHTML`, `document.write` en `eval`.
- **Ontwikkelen**: `npm run dev` in `app/web/` bouwt bij elke wijziging opnieuw naar `dist/`; de app op poort 3400
  serveert die uitvoer, dus een scherm is te zien door de pagina te herladen. Bewust geen dev-server van Vite met
  doorsturen: die zet opmaak als inline `<style>` in de pagina en dat laat de CSP (terecht) niet toe.
- **Teksteditor**: de opschoner `app/public/js/rich-text-clean.js` (gedeeld met de server) is in de frontend te
  importeren; de teksteditor in Vue (V1.5) gebruikt dus dezelfde regels.
