# AGENTS.md — Avanta Reizen

Korte ingang voor AI-agents. Details: `CLAUDE.md` (volledig werkgeheugen), `README.md` (overzicht).
**Eén bron voor de regels:** staat iets in beide, dan geldt `CLAUDE.md`; dit bestand is de snelle kaart.

## Kaart van de codebase
| Pad | Inhoud |
|---|---|
| `app/src/server.js` | Express-app, beveiligingskoppen, statisch, `/media` |
| `app/src/site/` | publieke routes, queries, HTML-weergave (escaping via `html\`…\``) |
| `app/src/booking/` | aanmeldformulier → tabel `bookings`; aanmeldingen in het CRM (`crm-routes.js`) |
| `app/src/crm/` | schil van `/app/` (`routes.js`), toegang, gebruikers, rechten, opmaak; modules koppelen via `<module>/index.js` |
| `app/src/persons/`, `app/src/payments/` | personen/deelnemers/AVG-opschoning en betalingen in het CRM |
| `app/src/database/` | `db.js`, `migrations.js` (lader), `migrations/NNN-korte-naam.js` (één bestand per migratie, positioneel) |
| `app/src/security/` | versleuteling gevoelige velden, rate limit |
| `app/src/beheer/` | Beheer `/app/beheer/`: instellingen en secties per groep (`instellingen/<groep>.js`), opslag (`settings.js`), zoeken (`indeling.js`), routes |
| `app/tools/import-wordpress.js` | import van www.avantareizen.nl |
| `app/test/` | `node --test`; DB-tests met `TEST_DATABASE_URL` |
| `app/package.json`, `app/CHANGELOG.md` | versie en changelog (beide automatisch, nooit zelf) |
| `changes/` | releasenotes-fragmenten (zie `changes/README.md`) |
| `tools/release-notes.js` | verwerkt fragmenten na de merge; controleert PR's (`--pull-request`) |
| `tests/` | `node --test` voor de hulpmiddelen |
| `docs/` | `WERKWIJZE.md` (projectonafhankelijk), `AVANTA-CONTEXT.md` (product), `ARCHITECTUUR.md` (modules, kernbestanden, parallel werken), `CLAUDE-sjabloon.md` |
| `.claude/agents/` | verkenners `map`, `callers`, `tests` |
| `.github/workflows/` | `ci.yml`, `version.yml`, `release.yml`, `claude-review.yml`, `security.yml` |

## Commando's
```sh
cd app && TEST_DATABASE_URL=postgres://…/avanta_test npm test   # app-tests (wist de testdatabase)
DATABASE_URL=postgres://… PORT=3400 node src/server.js           # site op http://localhost:3400/
node --test "tests/*.test.js"                                    # releasescript (root)
node tools/release-notes.js --check                              # fragmenten controleren
```

## Werkwijze en PR
- Algemene werkwijze: `docs/WERKWIJZE.md`; Avanta-context: `docs/AVANTA-CONTEXT.md`. **Wie de werkwijze verandert,
  werkt `docs/WERKWIJZE.md` bij in dezelfde PR.**
- Nooit rechtstreeks op `main`. Branch vers vanaf `origin/main` (`feature/<naam>` of `claude/<naam>`), kleine PR's,
  één onderwerp per PR.
- Volgorde: wijzigen → geraakte tests → `changes/<naam>.md` (als `app/` wijzigt) → `README.md` bij features/setup →
  push → draft-PR → *ready for review* → CI groen + verplichte **Claude code review** en **Claude security review** →
  bevindingen oplossen vóór auto-merge.
- **Versie en `app/CHANGELOG.md` nooit zelf aanraken**; `release.yml` doet dat na de merge. Alleen docs/CI zonder
  effect: PR-label `geen-releasenotes`.
- Geen modelnamen/-ID's in commits, PR's, code of docs. Geen secrets in repo of chat.

## Zuinig werken (vaste werkwijze)
1. **Gerichte opdracht**: lees alleen de genoemde bestanden en hun directe afhankelijkheden; geen brede greps.
2. **Reviews alleen waar het telt**: `claude-review.yml` slaat docs/tests-only over; concept-PR's worden niet
   gereviewd. Werk in een **draft-PR** tot het werk klaar is. Een nieuwe push annuleert een lopende review.
3. **Lokaal eerst alleen de geraakte tests**, pas daarna pushen.
4. **Kleine PR's**: één afgebakend onderdeel per PR.
5. **Na de merge direct stoppen**: geen extra samenvattingen of verificatierondes, tenzij Daniël erom vraagt.
6. **Simpele klussen** (tekst, releasenotes, kleine fixes) mogen op een lichter model.
7. Projectgeheugen compact houden: geen lijsten met afgeronde PR-nummers.
8. **Verkenners** (`.claude/agents/`): breed zoeken (`map`), aanroepen vinden (`callers`) en tests draaien (`tests`)
   via deze subagents; de hoofdsessie schrijft de code en beslist.
