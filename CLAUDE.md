# Avanta Reizen — werkgeheugen

> Korte ingang voor agents: `AGENTS.md` (kaart, commando's, kernregels). Dit bestand is het volledige werkgeheugen; bij
> tegenspraak geldt dit bestand. Vaste werkwijze om verbruik te besparen: sectie *Zuinig werken* in `AGENTS.md`.

> **Werkwijze en context:** de algemene werkwijze (projectonafhankelijk, gelijk aan die van AquaTech) staat in
> `docs/WERKWIJZE.md`; de Avanta-specifieke context (product, bedrijfsregels, omgeving) in `docs/AVANTA-CONTEXT.md`.

## Product
Nog in te vullen in `docs/AVANTA-CONTEXT.md` (product, doelgroep, wat nooit gebouwd wordt). Tot die context er is:
geen aannames over het product doen, eerst vragen.

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
Nog te kiezen. Vastgelegd tot nu toe:
- `app/` — de applicatie (versie in `app/package.json`, changelog in `app/CHANGELOG.md`).
- `changes/` — releasenotes-fragmenten.
- `tools/` — repo-hulpmiddelen (`release-notes.js`), tests in `tests/` (`node --test`).
- `docs/` — werkwijze, context, sjabloon.
- `.claude/agents/` — verkenners `map`, `callers`, `tests`.

Bij de stackkeuze: dit bestand, `AGENTS.md`, de padfilters in `.github/workflows/*.yml` en de agents bijwerken.

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
- Ruwe bestanden van GitHub altijd op een vaste commit-SHA, nooit op een branch.
- **Nooit `pkill -f`** in de cloud-sandbox; stop een testserver op poortnummer (`kill $(lsof -ti tcp:<poort>)`).

## Lokaal draaien en testen
```sh
node --test                              # alle tests (vindt tests/*.test.js)
node tools/release-notes.js --check      # fragmenten in changes/ controleren
```
Applicatiecommando's volgen zodra de stack gekozen is. Docker is niet beschikbaar in de cloud-sandbox.
