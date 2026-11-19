# <Projectnaam> — werkgeheugen

> Sjabloon voor `CLAUDE.md` in een nieuw project (zie `docs/WERKWIJZE.md`, *Zo start je een nieuw project*).
> Kopieer naar `CLAUDE.md` in de root, vervang alles tussen `<…>` en verwijder deze regel.

> Korte ingang voor agents: `AGENTS.md` (kaart, commando's, kernregels). Algemene werkwijze: `docs/WERKWIJZE.md`;
> projectcontext (product, bedrijfsregels, omgeving): `docs/<PROJECT>-CONTEXT.md`. Bij tegenspraak geldt dit bestand.

## Product
<Eén alinea: wat het is, voor wie, wat nooit gebouwd wordt.>

## Branchmodel
- `<main>` is de productiebranch. Nooit rechtstreeks op `<main>`; elke taak in een eigen branch `feature/<naam>` of
  `claude/<naam>`, vers vanaf `origin/<main>`.
- Volgorde per taak: wijzigen → geraakte tests → `changes/<naam>.md` (als `<app>/` wijzigt) → README bij features/setup
  → push → draft-PR → klaar: *ready for review* → CI groen + *Claude code review* + *Claude security review* →
  bevindingen verwerken → auto-merge.
- Versie en `CHANGELOG.md` nooit met de hand; `release.yml` doet dat na de merge.

## Stack en mappen
<Taal, framework, database, mappenstructuur.>

## Checklist voor elke nieuwe feature
- Tests voor randgevallen; dezelfde database als productie.
- Rechten op de server afdwingen; de frontend verbergt alleen.
- Elk openbaar of duur endpoint krijgt een limiet.
- UI netjes op 1440 en 375 px (controle via DOM/CSS).
- Documentatie en releasenotes-fragment bijgewerkt.

## Codestijl
<Naamgeving, commentaarblokken, bestandsnamen.>

## Harde regels
- UI-teksten, commentaar en docs in het <Nederlands>.
- Exports als Excel (.xlsx), geen CSV, tenzij expliciet gevraagd.
- Geen modelnamen/-ID's in commits, PR's, code of docs. Geen secrets in repo of chat.

## Lokaal draaien en testen
```sh
<commando's>
```
