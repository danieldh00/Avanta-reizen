# Avanta Reizen

Nieuwe website van Avanta Reizen (fase 1: nabouw van www.avantareizen.nl) met daarachter straks een CRM (fase 2).
Node 22 + Express + PostgreSQL 17, server-gerenderde HTML, geen externe scripts of fonts. Zie `docs/OPZET-WEBSITE.md`.

## Starten
```sh
cp .env.example .env            # vul POSTGRES_PASSWORD in
docker compose up -d --build    # site op http://localhost:3400/
docker compose exec app node tools/import-wordpress.js   # content + afbeeldingen van de huidige site overnemen
```
Testomgeving op apps01 (`avanta.den-hollander.com`, losse binding op de bestaande Cloudflare-tunnel): zie `deploy/apps01/README.md`.
Zonder Docker: `cd app && npm install`, dan `DATABASE_URL=… node tools/import-wordpress.js` en `DATABASE_URL=… node src/server.js`.

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
- Aanmeldingen komen in de tabel `bookings`; kerkgenootschap, medische bijzonderheden, geboortedatum en
  paspoortgegevens staan versleuteld. **Bewaar de hoofdsleutel** (`AVANTA_MASTER_KEY` of `/data/master-key`) apart van
  de database-back-up: zonder sleutel zijn die gegevens niet te lezen.
- Afbeeldingen staan in het volume `/data/media` (circa 250 MB na de import).

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
