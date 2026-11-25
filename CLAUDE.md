# Avanta Reizen — werkgeheugen

> Korte ingang voor agents: `AGENTS.md` (kaart, commando's, kernregels). Dit bestand is het volledige werkgeheugen; bij
> tegenspraak geldt dit bestand. Vaste werkwijze om verbruik te besparen: sectie *Zuinig werken* in `AGENTS.md`.

> **Werkwijze en context:** de algemene werkwijze (projectonafhankelijk) staat in
> `docs/WERKWIJZE.md`; de Avanta-specifieke context (product, bedrijfsregels, omgeving) in `docs/AVANTA-CONTEXT.md`;
> de indeling in modules, de gedeelde kernbestanden en de regels voor parallel werken in `docs/ARCHITECTUUR.md`;
> de ombouw naar Vue (besluiten, opbouw, `develop` en staging) in `docs/VUE-OMBOUW.md`.

## Product
Avanta Reizen: christelijke, avontuurlijke groepsreizen (kamperen, verre reizen, jeugd/jongeren/plus). Fase 1: de
publieke website nabouwen (zelfde URL's, huisstijl en content als www.avantareizen.nl). Fase 2: CRM achter de site.
Details en open vragen: `docs/AVANTA-CONTEXT.md` en `docs/OPZET-WEBSITE.md`.

## Branchmodel
- **`main`** is de productie- en defaultbranch; `release.yml` verwerkt daar de releasenotes.
- **Nooit rechtstreeks op `main` werken.** Elke taak in een eigen branch `feature/<naam>` of `claude/<naam>` (de door
  de sessie toegewezen `claude/...`-branch telt als zodanig), altijd vers vanaf `main`:
  ```sh
  git fetch origin main
  git checkout -B claude/<naam> origin/main
  ```
- Werkwijze per taak: wijzigen → geraakte tests → releasenotes-bestand `changes/<naam>.md` (als `app/` is gewijzigd;
  **geen** versie-bump, geen `CHANGELOG.md`) → `README.md` bijwerken (bij features/setup) → `git push -u origin <branch>`
  → **draft-PR** naar `main` → klaar: *ready for review* → CI groen (`ci.yml` + `version.yml`) → **Claude-review**
  (`claude-review.yml`: jobs *Claude code review* en *Claude security review*, de verplichte controles; opmerkingen
  oplossen of met reden beantwoorden) → auto-merge. Na het mergen de branch verwijderen.
- **Harde regel: nooit mergen zonder geslaagde Claude code review én security review** op de huidige head. Geen
  admin-merge, geen bypass van de ruleset. Wat de workflow zelf bewust overslaat (docs/tests-only) valt erbuiten.
- **`develop`** was de integratiebranch van de ombouw naar Vue; die ombouw is op 25-11-2026 gestopt en teruggedraaid
  (`docs/VUE-OMBOUW.md`, *Stand*). `develop` is weer gelijk aan `main`; werk niet meer naar `develop`. Oude regels: alleen de migratiethread werkte
  erin (branch vers vanaf `origin/develop`, PR naar `develop`, zelfde controles en dezelfde harde reviewregel).
  `develop-sync.yml` voegt `main` elke nacht en na elke release samen in `develop`; per geaccepteerde module gaat één PR
  van `develop` naar `main`. Al het andere werk blijft direct naar `main` gaan.
- Loopt `main` voor op je branch: `git fetch origin main && git rebase origin/main` vlak voor de merge.
- **Versie en releasenotes zijn automatisch**: een PR verandert `version` in `app/package.json` en `app/CHANGELOG.md`
  **niet**. Elke PR die `app/` wijzigt voegt één bestand `changes/<korte-naam>.md` toe (formaat: `changes/README.md`).
  Na de merge geeft `release.yml` (`tools/release-notes.js`) elk fragment het volgende versienummer (patch + 1, na x.y.9
  de volgende minor; `bump: minor` kan; major alleen op Daniëls woord), werkt beide bestanden bij, verwijdert het
  fragment en commit naar `main` met `[skip ci]`. De PR-check `version-must-increase` bewaakt dat; alleen docs/CI zonder
  effect: label `geen-releasenotes`. Voor de push naar de beschermde `main` is het secret `RELEASE_PUSH_TOKEN` nodig
  (beheerder-PAT) met *Repository admin* als bypass in de ruleset.
- **Kosten van de Claude-review** zijn begrensd: docs/tests-only wordt overgeslagen, concept-PR's worden niet
  gereviewd, een volgende push wordt alleen op het nieuwe deel beoordeeld; het model komt uit de repository-variabelen
  `CLAUDE_REVIEW_MODEL` (eerste review) en `CLAUDE_REVIEW_MODEL_PUSH` (per push). De reviews draaien op het
  Claude-abonnement (secret `CLAUDE_CODE_OAUTH_TOKEN`, aanmaken met `claude setup-token`).

## Stack en mappen
Node 22 + Express 5 (routes met een patroon per parameter via `routePath`, `app/src/route-path.js`), server-gerenderde HTML, PostgreSQL 17 (enige database), geen CDN's. Eén bouwstap, alleen in het image: `app/tools/minify-public.js`
(esbuild, ontwikkelafhankelijkheid) verkleint de publieke CSS en JS; de bron in `app/public/` blijft leesbaar en lokaal
en in de tests draait de app op die bron.
Per map onder `app/src/` staat een eigen `CLAUDE.md` met de bestanden van die map; een feature-PR werkt dát bestand bij,
niet deze tabel (alleen een nieuwe map krijgt hier een regel).
| Pad | Inhoud |
|---|---|
| `app/src/server.js` | Express-app, beveiligingskoppen (CSP zonder inline `<style>`, noindex tot go-live), statische bestanden, `/media` |
| `app/src/services.js` | `createServices` (alle gedeelde diensten per module: instellingen, logboek, mail, back-ups, bewaking, betalingen, …; ook op `app.locals`) en `startBackgroundTasks` (timers en planners; een nieuwe achtergrondtaak komt hier) |
| `app/src/database/` | pool, transacties en migraties (één bestand per migratie); details per bestand: `app/src/database/CLAUDE.md` |
| `app/src/site/` | publieke website: routes, queries, weergave, SEO, doorverwijzingen; details per bestand: `app/src/site/CLAUDE.md` |
| `app/src/contact/` | contactformulier op `/contact/` en de berichten in het CRM (`/app/berichten/`); details per bestand: `app/src/contact/CLAUDE.md` |
| `app/src/booking/` | aanmeldformulier en de aanmeldingen in het CRM; details per bestand: `app/src/booking/CLAUDE.md` |
| `app/src/account/` | `/account/`: registreren, inloggen, Mijn reizen; details per bestand: `app/src/account/CLAUDE.md` |
| `app/src/export/` | eigen .xlsx-schrijver; gebruik hem voor elke Excel-export; details per bestand: `app/src/export/CLAUDE.md` |
| `app/src/infobrief/` | infobrief aan de deelnemers van een vertrek: opstellen, voorbeeld, testmail, versturen in de achtergrond, verzendoverzicht (recht `infobrief`); details per bestand: `app/src/infobrief/CLAUDE.md` |
| `app/src/crm/` | schil van `/app/`: toegang, gebruikers, rechten, 2FA, opmaak, overzicht; details per bestand: `app/src/crm/CLAUDE.md` |
| `app/src/persons/` | deelnemers, samenvoegen, inzage en wissen, deelnemerslijsten, AVG-opschoning; details per bestand: `app/src/persons/CLAUDE.md` |
| `app/src/payments/` | betalingen, overzicht, herinneringen, online betalen; details per bestand: `app/src/payments/CLAUDE.md` |
| `app/src/beheer/` | `/app/beheer/` (recht `systeem`): instellingen per groep en systeemschermen; details per bestand: `app/src/beheer/CLAUDE.md` |
| `app/src/system/` | updates, onderhoudsmodus, servertaken, logboek, bewaking; details per bestand: `app/src/system/CLAUDE.md` |
| `app/src/backup/` | versleutelde back-ups, Google Drive, hersteltest; details per bestand: `app/src/backup/CLAUDE.md` |
| `app/src/media/` | fotobibliotheek (recht `media`); details per bestand: `app/src/media/CLAUDE.md` |
| `app/src/trips/` | reizen, reistypes en landen, reisleiders (recht `reizen`); details per bestand: `app/src/trips/CLAUDE.md` |
| `app/src/cms/` | pagina's in blokken, menu's, blog, FAQ (recht `content`); details per bestand: `app/src/cms/CLAUDE.md` |
| `app/src/mail/` | mailer, opmaak en meldingen aan kantoor; details per bestand: `app/src/mail/CLAUDE.md` |
| `app/src/security/` | kluis, limieten, netguard, captcha, CSP; details per bestand: `app/src/security/CLAUDE.md` |
| `app/src/dev/seed/` | testdata voor de testomgeving (alleen via `servertaken.sh testdata`); details per bestand: `app/src/dev/seed/CLAUDE.md` |
| `app/public/` | `css/site.css` (huisstijl van de huidige site via `--av-*`-variabelen, breekpunten 1024/768), `css/crm.css` (opmaak van het CRM en Beheer, bouwstenen voor lijsten uit `crm/ui.js`, alleen daar geladen na `site.css`; breekpunt 800), `js/site.js` (kop, mobiel menu, zoekvenster), `js/rich-editor.js` + `js/rich-text-clean.js` (teksteditor van het CRM op elk `textarea.cms-richtext`), `images/theme/` (texturen uit het oude thema), fonts en logo lokaal |
| `app/tools/import-wordpress.js` | import van de huidige site (`tools/import/parse.js`, `sanitize.js`) |
| `app/tools/design-check/` | design-controle met Playwright op 1440/375: `seed.js` (testgegevens), `check.js` (`--full` of `--paths=`), `changed-screens.js` (gewijzigde bestanden → schermen voor de CI-job `design`; nieuwe module met schermen = regel in `SCREEN_RULES`), `ci-summary.js` (samenvatting bij de job), `page-checks.js` (metingen in de browser), `accessibility.js` (axe, `--axe`), `report.js` (.xlsx), `overview.js` (schermafbeeldingen per soort scherm), `login.js`, `credentials.js` (alleen lokaal), `guards.js` (alleen lokale database en app) |
| `app/tools/minify-public.js` | verkleint `public/css` en `public/js` bij het bouwen van het image (Dockerfile, stap `minify`); niet in de draaiende app |
| `app/tools/layout-compare.js` | DOM-meting nieuw tegen live op 1440/375 (referentie `test/fixtures/layout-live.json`, test met `LAYOUT_BASE_URL`) |
| `app/test/` | `units.test.js` (zonder database), `server.test.js` (PostgreSQL, `TEST_DATABASE_URL`) |
| `changes/`, `tools/`, `tests/` | releasenotes-fragmenten en het releasescript (root) |

Regels:
- **HTML altijd via `html\`…\``** (escapet alles); `raw()` alleen voor HTML die bij de import door `sanitizeHtml` is gegaan.
- **SQL altijd met `$1`-parameters**, nooit tekst plakken; geen `SELECT *`.
- **Gevoelige velden** (`sensitive: true` in `booking/fields.js`: kerkgenootschap, medische bijzonderheden, geboortedatum,
  paspoort) alleen versleuteld opslaan via `vault.seal`, per blok bij de persoon (`persons/persons.js`, AAD
  `persons:<blok>:<id>`); art. 9-velden alleen met eigen toestemmingsvinkje (`consentFor`, tabel `consents`). Hoofdsleutel: `AVANTA_MASTER_KEY` of `DATA_DIR/master-key`.
- Openbare formulieren: limiet (`createRateLimiter`), herkomstcontrole, honeypot en ondertekend tijdstempel; plus
  `captchaField`/`captcha.check` (`security/captcha.js`, actie per formulier) als laatste controle.
- Nieuwe migratie: een nieuw bestand `app/src/database/migrations/NNN-korte-naam.js` met het eerstvolgende nummer, en de bestandsnaam ervan in `migrations/laatste-migratie.txt` (geeft met opzet een git-conflict als twee takken hetzelfde nummer nemen; dan rebasen en je eigen bestand hernummeren; `migrations.js` zelf niet wijzigen); een migratie op `main` verandert nooit meer.
  Volgorde (besluit 20-11-2026): M5 instellingen, M6 doorverwijzingen/404, M7 logboek, M8 bewaking, 2FA M9 (alle gebouwd),
  persons M10, aanmeldingen M11, fotobibliotheek M12, foto's in de back-up M13, reistypes en landen M14, reizen M15, foto's bij reizen M16 (CMS-pakket G, gebouwd), pagina's in blokken M17 (H1), nieuwe pagina's/SEO/menu's M18 (H3), blog M19 (I1), categorieën en tags M20 (I2), FAQ M21 (I3), reisleiders M22 (I4), reizigersaccounts M23 (J2), aanmelding bij account M24 (J4), AVG-opschoning M25, betalingen M26, betaalherinneringen M27, online betalen M28, ouder of voogd M29 (P3), berichten M30 (P4); auditlog filteren M31 (P4.4); infobrief M32 (W03); alle landen van de wereld M33; vaste inhoud in het CRM M34 (W28); volgende vrije migratie M35. Eén migratie-PR tegelijk.
- **Instellingen** altijd in `FIELDS` van hun groep (`beheer/instellingen/<groep>.js`, samen `SETTING_FIELDS`) met een sectie in `GROUP` van hetzelfde bestand, nooit een
  eigen tabel of losse env-variabele; geheimen als `type: 'secret'`. Waarden synchroon via `settings.get(key)` (geladen
  door de middleware in `server.js`); wijzigen alleen via `settings.update` met audit in dezelfde transactie.
- URL's gelijk houden aan de oude site (`/reis/<slug>/`, `/reisleider/<slug>/`, `/reis-categorie/<slug>/`, `/<blog-slug>/`,
  pagina's op hun volledige pad); oude varianten krijgen een 301.
- **Noindex tot go-live**: indexeren staat uit (Beheer > Vindbaarheid > Zoekmachines, `seoIndexing`; `SITE_INDEXABLE`
  is alleen de startwaarde); pas op Daniëls woord aan. Site-instellingen per verzoek uit `res.locals.site`
  (`site/site-settings.js`): basisadres, naam, titels, contact; nooit `req.headers.host` of een vaste `SITE_URL` in code.
- Afbeeldingen staan in `DATA_DIR/media` (niet in git); de import zet ze daar neer.

## Checklist voor elke nieuwe feature (zonder dat Daniël erom vraagt)
- **Documentatie**: `README.md` bijwerken bij features, instellingen, installatie of reviewproces; fragment
  `changes/<naam>.md` bij elke wijziging in `app/`.
- **Tests** verplicht, ook voor randgevallen; dezelfde database als productie in de tests.
- **Beveiliging** (ASVS L2 + AVG): rechten op de server afdwingen (frontend verbergt alleen), id's uit de URL altijd
  samen met eigenaar/tenant opzoeken, parameters in SQL altijd gebonden, invoer server-side saneren, elk openbaar of
  duur endpoint een limiet, uploads op inhoud controleren. Tests per nieuwe route: andere eigenaar → 404, ontbrekend
  recht → 403. Nooit tokens of persoonsgegevens in logs, audit of frontend.
- **AVG-documenten**: verandert een PR iets aan persoonsgegevens (veld, koppeling, bewaartermijn), werk dan ook
  `docs/avg/` bij (verwerkingsregister, verwerkers, DPIA, tekstvoorstel privacyverklaring).
- **Queries**: geen `SELECT *`, geen N+1, index op nieuwe filters van groeiende tabellen.
- **UI**: netjes uitgelijnd op 1440 en 375 px. CI controleert dat met Playwright op de schermen die de PR raakt (job
  `design`, faalt bij ernst hoog; uitsneden en .xlsx in het artefact `design-controle`), met toegankelijkheid via axe
  (WCAG 2.1 AA, `--axe`). Lokaal: `tools/design-check/` met `--paths=` (en `--axe`) voor de geraakte schermen;
  schermafbeeldingen alleen als uitsnede van een bevinding.
- **Externe koppeling**: instelling in de app, status en logboek zichtbaar, nooit tokens in de uitvoer.
- Noem in de PR-beschrijving kort hoe aan de checklist is voldaan.

## Codestijl
- Beschrijvende namen (geen namen van één letter behalve `i`/`j`/`x`/`y`, geen cryptische afkortingen). Maatstaf voor
  namen, lengte van functies en bestanden, opbouw van een routebestand en commentaar: `docs/WERKWIJZE.md`, *Leesbare
  code*; ESLint bewaakt namen, diepte, parameters en callbacks overal, en complexiteit (20) en bestandslengte (600)
  in `app/src/` en `app/tools/` (sinds P6a voor alle code).
- Elke functie een `/** … */`-blok in het Nederlands (wat, `@param`, `@returns`); elk bestand een kopcommentaar.
- **Lint en typecontrole**: `npm run lint` (ESLint, `app/eslint.config.js`) moet schoon zijn. Elk bestand onder
  `app/src/` en `app/tools/` begint met `// @ts-check` (B08; de test `test/ts-check.test.js` bewaakt het, `@ts-nocheck`
  mag niet); `npm run typecheck` controleert ze op hun JSDoc. Typ in JSDoc met `any` of een echte vorm, niet met
  `object` (daar kun je geen velden van lezen). Uitzondering op een regel alleen met
  `// eslint-disable-next-line <regel>` en de reden erboven.
- **Dekking**: CI draait `npm run test:coverage` met een drempel (regels 95%, takken 85%, functies 93%); nieuwe code
  krijgt tests zodat de dekking niet zakt.
- Bestandsnamen in kebab-case. Geen losse bestanden (screenshots, exports) in de root; die horen in de projectbestanden.

## Harde regels
- UI-teksten, commentaar, changelog en docs in het **Nederlands**; tijden in Europe/Amsterdam.
- Exports: **Excel (.xlsx), geen CSV**, tenzij expliciet anders gevraagd.
- **Geen verwijzingen naar andere projecten** (namen, repository's, bestandspaden, containernamen) in code,
  commentaar, docs, changelog, commits of PR-teksten; ook niet als bron van een aanpak. De test
  `tests/geen-andere-projecten.test.js` bewaakt de bestanden.
- Geen modelnamen/-ID's in commits, PR's, code of docs. Nooit secrets, wachtwoorden of persoonsgegevens in repo,
  chat of geheugen.
- **Servertaken**: geef Daniël nooit losse servercommando's in de chat; zie `docs/WERKWIJZE.md`, *Servertaken en scripts*.
  Heeft een PR iets op de server nodig dat `install.sh` (draait bij elke update) niet zelf doet: één regel in
  `HOST_TASKS` (`app/src/system/host-tasks.js`) én een functie `hosttask_<id>` + id in `deploy/apps01/servertaken.sh`;
  Daniël draait dan het vaste commando uit Beheer > Servertaken.
- Ruwe bestanden van GitHub altijd op een vaste commit-SHA, nooit op een branch.
- **Nooit `pkill -f`** in de cloud-sandbox; stop een testserver op poortnummer (`kill $(lsof -ti tcp:<poort>)`).

## Lokaal draaien en testen
```sh
cd app && npm install
DATABASE_URL=postgres://… DATA_DIR=/tmp/avanta node tools/import-wordpress.js   # content + afbeeldingen van de huidige site
DATABASE_URL=postgres://… DATA_DIR=/tmp/avanta PORT=3400 node src/server.js     # http://localhost:3400/
TEST_DATABASE_URL=postgres://…/avanta_test npm test                              # tests (wist de testdatabase!)
npm run lint && npm run typecheck                                                # ESLint en JSDoc-typecontrole
TEST_DATABASE_URL=postgres://…/avanta_test npm run test:coverage                 # tests met dekkingsdrempel (zoals CI)
cd .. && node --test "tests/*.test.js"                                           # releasescript
kill $(lsof -ti tcp:3400)                                                        # testserver stoppen (nooit pkill -f)
```
In de cloud-sandbox: lokale PostgreSQL 16 in `/usr/lib/postgresql/16/bin` (poort 5433); Node's `fetch` door de proxy met
`NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`. Docker is daar niet beschikbaar; CI bouwt en
smoketest het image. Layout controleren met `tools/design-check/check.js --paths=…` op 1440 en 375 px (zie README, design-controle).
