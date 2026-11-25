# Ombouw naar Vue: besluiten, opbouw en werkwijze

Besluiten van Daniël op 25-11-2026. Dit bestand bevat de regels waar code en PR's zich aan houden; het volledige plan
met alle PR's, risico's en de inschatting staat in de projectbestanden (`plan/plan-vue-ombouw.md` en
`plan/plan-vue-ombouw.xlsx`). Wie de werkwijze of de opbouw verandert, werkt dit bestand bij in dezelfde PR.

Stand: fase V0 (voorbereiding). Er staat nog geen Vue-code in de repository.

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

Uit `develop` wordt een eigen image gebouwd, met een andere naam dan het gewone image, zodat het updatescript van de
testomgeving het nooit kan installeren. Staging draait als tweede opstelling naast de testomgeving, met een eigen
database, alleen testdata, geen koppelingen (geen betaalprovider, geen externe opslag van back-ups) en mail naar een
mailvanger. Inrichten gaat via een servertaak in Beheer > Servertaken, niet via losse commando's.

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
