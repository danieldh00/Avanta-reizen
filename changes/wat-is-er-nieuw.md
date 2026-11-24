---
titel: Wat is er nieuw: de wijzigingen per versie in het CRM
---

## Nieuws
- In het CRM staat in het menu onder je naam (rechtsboven) nu *Wat is er nieuw*: per versie, de nieuwste bovenaan, wat er in de app is veranderd. Beheerders kunnen per versie ook de technische details openklappen.
- Lange nieuwspunten in de releasenotes worden niet meer halverwege afgekapt; de afgekapte punten van eerdere versies zijn aangevuld.

## Changelog
- Nieuw `crm/whats-new.js` (leest `app/CHANGELOG.md` met cache op wijzigtijd: per versie titel, datum, nieuws en technische punten; weergave met `code`, vet en cursief, alles ge-escapet) en `crm/whats-new-routes.js` (`/app/wat-is-er-nieuw/`, `requireLogin`, technische details alleen met recht `systeem`). Link in het gebruikersmenu (`crm/layout.js`).
- `Dockerfile`: `CHANGELOG.md` gaat mee in het image.
- `tools/release-notes.js`: een ingesprongen vervolgregel van een nieuwspunt hoort bij dat punt (viel eerder weg). Afgekapte nieuwspunten in `app/CHANGELOG.md` aangevuld uit de oorspronkelijke fragmenten (correctie, evenveel regels).
- Design-controle: `crm/whats-new*` → scherm `/app/wat-is-er-nieuw/`.
