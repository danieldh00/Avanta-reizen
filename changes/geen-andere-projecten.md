---
titel: Geen verwijzingen naar andere projecten
---

## Changelog
- Alle verwijzingen naar een ander project zijn uit code, commentaar en documentatie gehaald; de app zelf
  doet hetzelfde als voorheen (alleen commentaar gewijzigd).
- `deploy/apps01/install.sh` heeft geen vaste naam meer voor de cloudflared-container: de naam komt uit
  `TUNNEL_CONTAINER`, anders uit de `.env` van een eerdere installatie, anders is het de enige draaiende container
  waarvan de naam op `cloudflared` eindigt (bij geen of meerdere stopt het script met een melding). Een bestaande
  installatie verandert niet: daar staat de naam al in `.env`. `update.sh` en `pve-setup.sh` volgen dezelfde regel.
- Vier oude regels in `app/CHANGELOG.md` noemen het andere project nog: een PR mag dat bestand niet wijzigen.
- Nieuwe harde regel in `CLAUDE.md`, bewaakt door `tests/geen-andere-projecten.test.js`.
