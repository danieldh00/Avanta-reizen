# Avanta Reizen — werkgeheugen

> Korte ingang voor agents: `AGENTS.md` (kaart, commando's, kernregels). Dit bestand is het volledige werkgeheugen; bij
> tegenspraak geldt dit bestand. Vaste werkwijze om verbruik te besparen: sectie *Zuinig werken* in `AGENTS.md`.

> **Werkwijze en context:** de algemene werkwijze (projectonafhankelijk, gelijk aan die van AquaTech) staat in
> `docs/WERKWIJZE.md`; de Avanta-specifieke context (product, bedrijfsregels, omgeving) in `docs/AVANTA-CONTEXT.md`.

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
Node 22 + Express, server-gerenderde HTML, PostgreSQL 17 (enige database), geen build-stap, geen CDN's.
| Pad | Inhoud |
|---|---|
| `app/src/server.js` | Express-app, beveiligingskoppen (CSP, noindex tot go-live), statische bestanden, `/media` |
| `app/src/database/` | `db.js` (pool, transactie, migreren), `migrations.js` (`MIGRATIONS`, positioneel) |
| `app/src/site/` | `routes.js` (alle publieke URL's), `content.js` (queries), `views.js`/`layout.js` (HTML), `html.js` (escaping), `format.js`, `seo.js` (JSON-LD, sitemap, robots.txt, llms.txt), `site-settings.js` (`res.locals.site`), `redirects.js` (doorverwijzingen + 404-tellers), `analytics.js` (GA4-meet-ID, CSP) |
| `app/src/booking/` | aanmeldformulier: `fields.js` (velden + validatie), `routes.js` (`/aanmelden/`) |
| `app/src/crm/` | CRM onder `/app/`: `routes.js` (inloggen, installatie), `users.js` (gebruikers, auditlog), `auth.js` (sessies, CSRF, `requireRight`, audit), `rights.js`, `passwords.js`, `layout.js` |
| `app/src/beheer/` | Beheer onder `/app/beheer/` (recht `systeem`): `settings.js` (`SETTING_FIELDS`, database → env → standaard, geheimen via vault), `indeling.js` (groepen/secties + zoeken), `routes.js`, `redirect-routes.js` (doorverwijzingen, 404-lijst), `mail-routes.js` (testmail, WAN-IP), `captcha-routes.js` (sleutelcontrole), `backup-routes.js` (back-ups: Nu maken, lijst, downloaden), `drive-routes.js` (Google Drive koppelen), `restore-test-routes.js` (hersteltest), `update-routes.js` (updates, onderhoudsmodus), `host-task-routes.js` (servertaken), `log-routes.js` (logboek), `monitor-routes.js` (bewaking: stand, incidenten, testmelding) |
| `app/src/system/` | `system-update.js` (koppeling met `deploy/apps01/update.sh` via `/update/status` en `/update/request`), `maintenance.js` (503 op schrijven + balk), `host-tasks.js` (`HOST_TASKS` + vast commando; gelijk houden met `deploy/apps01/servertaken.sh`), `request-context.js` (AsyncLocalStorage per verzoek), `app-log.js` (logboek `app_logs`: privacyfilter, foutcodes, request-id's; nooit persoonsgegevens loggen), `monitor.js` (bewaking: controles, `monitor_incidents`, meldingen mail/webhook/heartbeat) |
| `app/src/backup/` | `backups.js` (pg_dump → AES-256-GCM, `DATA_DIR/backups`, planner, bewaartermijn), `drive.js` (OAuth `drive.file`, upload + bewaartermijn op Drive, stand in `drive-state.json`), `restore-test.js` (uitslag hostscript `deploy/apps01/restore-test.sh`, test van de Drive-kopie), `cli.js` (`create [--update]`, `list`, `decrypt`, `restore-test-result`) |
| `app/src/mail/` | `mailer.js` (nodemailer: SMTP of Exchange-connector, alleen openbare adressen, STARTTLS verplicht), `wan-ip.js`, `layout.js` (mail-opmaak, alles ge-escaped), `notifications.js` (meldingen aan kantoor, nooit gevoelige velden) |
| `app/src/security/` | `vault.js` (AES-256-GCM voor gevoelige velden), `rate-limit.js`, `netguard.js` (alleen openbare adressen voor uitgaande verbindingen), `captcha.js` (reCAPTCHA v3 op contact/aanmelden), `safe-request.js` (https naar door de beheerder ingevulde adressen, alleen openbaar) |
| `app/public/` | `css/site.css` (huisstijl via `--av-*`-variabelen), `js/site.js`, fonts en logo lokaal |
| `app/tools/import-wordpress.js` | import van de huidige site (`tools/import/parse.js`, `sanitize.js`) |
| `app/test/` | `units.test.js` (zonder database), `server.test.js` (PostgreSQL, `TEST_DATABASE_URL`) |
| `changes/`, `tools/`, `tests/` | releasenotes-fragmenten en het releasescript (root) |

Regels:
- **HTML altijd via `html\`…\``** (escapet alles); `raw()` alleen voor HTML die bij de import door `sanitizeHtml` is gegaan.
- **SQL altijd met `$1`-parameters**, nooit tekst plakken; geen `SELECT *`.
- **Gevoelige velden** (`sensitive: true` in `booking/fields.js`: kerkgenootschap, medische bijzonderheden, geboortedatum,
  paspoort) alleen versleuteld opslaan via `vault.seal`. Hoofdsleutel: `AVANTA_MASTER_KEY` of `DATA_DIR/master-key`.
- Openbare formulieren: limiet (`createRateLimiter`), herkomstcontrole, honeypot en ondertekend tijdstempel; plus
  `captchaField`/`captcha.check` (`security/captcha.js`, actie per formulier) als laatste controle.
- Nieuwe migratie: achteraan in `MIGRATIONS` met het eerstvolgende nummer; een migratie op `main` verandert nooit meer.
  Volgorde (besluit 20-11-2026): M5 instellingen, M6 doorverwijzingen/404, M7 logboek, M8 bewaking (alle vier gebouwd), daarna CRM (2FA M9,
  persons M10, aanmeldingen M11, reizen M12). Eén migratie-PR tegelijk.
- **Instellingen** altijd in `SETTING_FIELDS` (`beheer/settings.js`) met een sectie in `beheer/indeling.js`, nooit een
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
- **Queries**: geen `SELECT *`, geen N+1, index op nieuwe filters van groeiende tabellen.
- **UI**: netjes uitgelijnd op 1440 en 375 px; controleer via DOM/CSS-meting, geen schermafbeeldingen.
- **Externe koppeling**: instelling in de app, status en logboek zichtbaar, nooit tokens in de uitvoer.
- Noem in de PR-beschrijving kort hoe aan de checklist is voldaan.

## Codestijl
- Beschrijvende namen (geen namen van één letter behalve `i`/`j`/`x`/`y`, geen cryptische afkortingen).
- Elke functie een `/** … */`-blok in het Nederlands (wat, `@param`, `@returns`); elk bestand een kopcommentaar.
- Bestandsnamen in kebab-case. Geen losse bestanden (screenshots, exports) in de root; die horen in de projectbestanden.

## Harde regels
- UI-teksten, commentaar, changelog en docs in het **Nederlands**; tijden in Europe/Amsterdam.
- Exports: **Excel (.xlsx), geen CSV**, tenzij expliciet anders gevraagd.
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
cd .. && node --test "tests/*.test.js"                                           # releasescript
kill $(lsof -ti tcp:3400)                                                        # testserver stoppen (nooit pkill -f)
```
In de cloud-sandbox: lokale PostgreSQL 16 in `/usr/lib/postgresql/16/bin` (poort 5433); Node's `fetch` door de proxy met
`NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`. Docker is daar niet beschikbaar; CI bouwt en
smoketest het image. Layout controleren met een DOM-meting op 1440 en 375 px (geen screenshots).
