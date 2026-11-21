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
| `app/src/site/` | `routes.js` (alle publieke URL's), `content.js` (queries), `layout.js` (kop/voet), `page-view.js` (blog, tags, pagina's, FAQ, contact), `html.js` (escaping), `format.js`, `seo.js` (JSON-LD, sitemap, robots.txt, llms.txt), `site-settings.js` (`res.locals.site`), `redirects.js` (doorverwijzingen + 404-tellers), `analytics.js` (GA4-meet-ID, CSP), `icons.js` (eigen SVG-iconen, inline), `homepage.js` (vaste homepage-inhoud uit `DATA_DIR/homepage.json`, gecontroleerd) en `home-view.js` (HTML van de homepage), `trip-view.js` (reizen en reisleiders), `site-content.js` (lijstkoppen en reisleidergegevens uit `DATA_DIR/site-content.json`), `json-store.js` (lezer voor die JSON-bestanden) |
| `app/src/booking/` | aanmeldformulier: `fields.js` (velden + validatie), `routes.js` (`/aanmelden/`) |
| `app/src/account/` | reizigersaccount onder `/account/` (CMS-pakket J): `accounts.js` (tabellen `customer_accounts`, `customer_sessions`, `customer_tokens`; eenmalige links, max. 3 per soort per uur), `routes.js` (registreren, bevestigen met link + wachtwoord, inloggen met dezelfde limieten als het CRM, wachtwoord vergeten/herstellen, code per e-mail vóór export en wachtwoord wijzigen; cookie `avanta_reiziger` op pad `/account`, eigen CSRF), `my-trips.js` (Mijn reizen/gegevens op het bevestigde e-mailadres, nooit bijzondere gegevens), `mails.js`, `views.js`; los van `users`/`sessions` van het CRM |
| `app/src/export/` | `xlsx.js`: eigen .xlsx-schrijver (zip via `node:zlib`, formule-injectie onschadelijk); gebruik hem voor elke Excel-export |
| `app/src/crm/` | CRM onder `/app/`: `routes.js` (inloggen, installatie), `users.js` (gebruikers, auditlog, 2FA uitzetten), `auth.js` (sessies, halve sessie tot de tweede stap, CSRF, `requireRight`, audit), `two-factor.js` (2FA: opslag, codestap `/app/inloggen/code/`, scherm `/app/tweestaps/`), `totp.js` (TOTP + herstelcodes), `qr-code.js`, `rights.js`, `passwords.js`, `layout.js`, `persons.js` (personen: ontdubbelen via `match_key`, blokken per categorie versleuteld, `consents`, omzetten oude aanmeldingen), `person-routes.js` (`/app/deelnemers/`: lijst, *Toon* per blok met audit, wijzigen, toestemming intrekken; reisleider via `TRIP_SCOPED_ROLES` dicht tot eigen vertrekken bestaan), `person-merge-routes.js` (mogelijke dubbelen samenvoegen of markering weghalen), `person-privacy-routes.js` (recht `avg`: inzage-export .xlsx en persoon wissen), `booking-routes.js` (`/app/aanmeldingen/`: lijst, status met vaste overgangen, notities, `booking_events`), `retention.js` (AVG-opschoning: bewaartermijnen uit Beheer, `anonymizePerson`, rondes in `retention_runs`; een nieuwe tabel met persoonsgegevens hoort hier een regel te krijgen), `payments.js` + `payment-routes.js` (`/app/betalingen/<aanmelding>/`, recht `betalingen`: `booking_charges` verwacht, `payments` ontvangen en nooit wijzigen; saldo, aanbetaling, vervaldatums en betaalstatus altijd berekend met `summarize`, nooit opgeslagen), `payment-overview-routes.js` (`/app/betalingen/` + .xlsx), `payment-reminders.js` (herinneringen, `payment_reminders`, dagelijkse ronde), `mollie.js` + `online-payments.js` + `online-payment-routes.js` (online betalen, optioneel: betaallink `/betalen/<id>-<token>/`, webhook, `online_payments`) |
| `app/src/beheer/` | Beheer onder `/app/beheer/` (recht `systeem`): `settings.js` (`SETTING_FIELDS`, database → env → standaard, geheimen via vault), `indeling.js` (groepen/secties + zoeken), `routes.js`, `redirect-routes.js` (doorverwijzingen, 404-lijst), `mail-routes.js` (testmail, WAN-IP), `captcha-routes.js` (sleutelcontrole), `backup-routes.js` (back-ups: Nu maken, lijst, downloaden), `drive-routes.js` (Google Drive koppelen), `restore-test-routes.js` (hersteltest), `update-routes.js` (updates, onderhoudsmodus), `host-task-routes.js` (servertaken), `log-routes.js` (logboek), `monitor-routes.js` (bewaking: stand, incidenten, testmelding), `retention-routes.js` (AVG-opschoning: rondes, voorbeeld, Nu opschonen) |
| `app/src/system/` | `system-update.js` (koppeling met `deploy/apps01/update.sh` via `/update/status` en `/update/request`), `maintenance.js` (503 op schrijven + balk), `host-tasks.js` (`HOST_TASKS` + vast commando; gelijk houden met `deploy/apps01/servertaken.sh`), `request-context.js` (AsyncLocalStorage per verzoek), `app-log.js` (logboek `app_logs`: privacyfilter, foutcodes, request-id's; nooit persoonsgegevens loggen), `monitor.js` (bewaking: controles, `monitor_incidents`, meldingen mail/webhook/heartbeat) |
| `app/src/backup/` | `backups.js` (pg_dump → AES-256-GCM, `DATA_DIR/backups`, planner, bewaartermijn), `drive.js` (OAuth `drive.file`, upload + bewaartermijn op Drive, stand in `drive-state.json`), `restore-test.js` (uitslag hostscript `deploy/apps01/restore-test.sh`, test van de Drive-kopie), `cli.js` (`create [--update]`, `list`, `decrypt`, `restore-test-result`) |
| `app/src/media/` | fotobibliotheek (recht `media`, rol Redacteur): `images.js` (magic bytes, `sharp`: rechtzetten, EXIF/GPS weg, WebP 400/800/1600/2400), `library.js` (tabel `media` + `media_countries`, landen = `trip_categories` met kind `bestemming`), `routes.js` (`/app/fotobibliotheek/`, multipart via `busboy`), `picker.js` (foto kiezen op een bewerkscherm; bij opslaan altijd `lockMediaForUse`) |
| `app/src/trips/` | reizen beheren (recht `reizen`): `slugs.js` (`slugify`, `recordMove`: 301 bij gewijzigde of samengevoegde slug, zonder lus), `categories.js` + `category-routes.js` (`/app/reistypes-en-landen/`: icoon, volgorde, homepage, foto uit de bibliotheek, samenvoegen), `trips.js` + `trip-routes.js` (`/app/reizen/`: reis = één vertrek, landen/types via `trip_category_links`, reisleiders via `trip_guides`, `managed_in_crm` → import slaat over), `guides.js` + `guide-routes.js` (`/app/reisleiders/`: profiel, foto's, online; `managed_in_crm` → site leest de database via `guideExtra` in `site/site-content.js`, anders `site-content.json`, en de import slaat over), `trip-media.js` (`trip_media`: kop/kaart/galerij; schrijft `hero_image_url`/`card_image_url`/`gallery` als afgeleide kopie), `seats.js` (bezet = aanmeldingen niet geannuleerd; `fullyBookedSql` overal gebruiken voor *volgeboekt*, nooit alleen de kolom `fully_booked`) |
| `app/src/cms/` | pagina's in blokken (recht `content`): `blocks.js` (`BLOCK_TYPES` met vaste velden, `STYLE_OPTIONS` uit de huisstijl, `validateBlockForm`, `renderBlocks`; nieuw bloktype = alleen hier + CSS `cms-*`), `pages.js` (concept in `pages.draft` met `draft_version` tegen overschrijven, `publish` → `page_revisions`, terugzetten), `page-routes.js` (`/app/paginas/`: ook nieuw, adres wijzigen met `recordMove`, offline, verwijderen, SEO-velden), `page-render.js` (site en voorbeeld), `menus.js` + `menu-routes.js` (`/app/menus/`: hoofd- en voetmenu in `menu_items`, site via `res.locals.site.menus`, vast menu als terugval); `block-editor.js` (blokeditor: velden, sectie *Blokken*, fotokiezer en blokroutes, gedeeld door pagina's en blog); `posts.js` + `post-routes.js` (`/app/blog/`: blog in blokken zoals pagina's, inplannen via `published_at` in de toekomst; elke query op `posts` voor de site met `VISIBLE_POST_SQL` uit `site/content.js`); `post-terms.js` + `post-term-routes.js` (`/app/blog/categorieen-en-tags/`: categorieën en tags in `post_terms`, uitgelicht = `posts.featured`; site via `content.blogHighlights`, tot de overname nog uit `site-content.json`); `faqs.js` + `faq-routes.js` (`/app/faq/`: categorieën in `faq_categories` met volgorde, `faqs.category` is een afgeleide kopie van de naam, `managed_in_crm` → import slaat over); homepage = pagina `/` met `home-*`-blokken (`homeOnly`, opmaak uit `site/home-view.js`), offline of ontbrekend → vaste homepage uit `homepage.json` |
| `app/src/mail/` | `mailer.js` (nodemailer: SMTP of Exchange-connector, alleen openbare adressen, STARTTLS verplicht), `wan-ip.js`, `layout.js` (mail-opmaak, alles ge-escaped), `notifications.js` (meldingen aan kantoor, nooit gevoelige velden) |
| `app/src/security/` | `vault.js` (AES-256-GCM voor gevoelige velden), `rate-limit.js`, `netguard.js` (alleen openbare adressen voor uitgaande verbindingen), `captcha.js` (reCAPTCHA v3 op contact/aanmelden), `safe-request.js` (https naar door de beheerder ingevulde adressen, alleen openbaar), `csp.js` (bronnen toevoegen aan de CSP) |
| `app/public/` | `css/site.css` (huisstijl van de huidige site via `--av-*`-variabelen, breekpunten 1024/768), `js/site.js` (kop, mobiel menu, zoekvenster), `images/theme/` (texturen uit het oude thema), fonts en logo lokaal |
| `app/tools/import-wordpress.js` | import van de huidige site (`tools/import/parse.js`, `sanitize.js`) |
| `app/tools/layout-compare.js` | DOM-meting nieuw tegen live op 1440/375 (referentie `test/fixtures/layout-live.json`, test met `LAYOUT_BASE_URL`) |
| `app/test/` | `units.test.js` (zonder database), `server.test.js` (PostgreSQL, `TEST_DATABASE_URL`) |
| `changes/`, `tools/`, `tests/` | releasenotes-fragmenten en het releasescript (root) |

Regels:
- **HTML altijd via `html\`…\``** (escapet alles); `raw()` alleen voor HTML die bij de import door `sanitizeHtml` is gegaan.
- **SQL altijd met `$1`-parameters**, nooit tekst plakken; geen `SELECT *`.
- **Gevoelige velden** (`sensitive: true` in `booking/fields.js`: kerkgenootschap, medische bijzonderheden, geboortedatum,
  paspoort) alleen versleuteld opslaan via `vault.seal`, per blok bij de persoon (`crm/persons.js`, AAD
  `persons:<blok>:<id>`); art. 9-velden alleen met eigen toestemmingsvinkje (`consentFor`, tabel `consents`). Hoofdsleutel: `AVANTA_MASTER_KEY` of `DATA_DIR/master-key`.
- Openbare formulieren: limiet (`createRateLimiter`), herkomstcontrole, honeypot en ondertekend tijdstempel; plus
  `captchaField`/`captcha.check` (`security/captcha.js`, actie per formulier) als laatste controle.
- Nieuwe migratie: achteraan in `MIGRATIONS` met het eerstvolgende nummer; een migratie op `main` verandert nooit meer.
  Volgorde (besluit 20-11-2026): M5 instellingen, M6 doorverwijzingen/404, M7 logboek, M8 bewaking, 2FA M9 (alle gebouwd),
  persons M10, aanmeldingen M11, fotobibliotheek M12, foto's in de back-up M13, reistypes en landen M14, reizen M15, foto's bij reizen M16 (CMS-pakket G, gebouwd), pagina's in blokken M17 (H1), nieuwe pagina's/SEO/menu's M18 (H3), blog M19 (I1), categorieën en tags M20 (I2), FAQ M21 (I3), reisleiders M22 (I4), reizigersaccounts M23 (J2), aanmelding bij account M24 (J4), AVG-opschoning M25, betalingen M26, betaalherinneringen M27, online betalen M28; volgende vrije migratie M29. Eén migratie-PR tegelijk.
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
