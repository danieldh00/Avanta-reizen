---
titel: Berichten van het contactformulier afhandelen in het CRM
bump: minor
---

## Nieuws
- Nieuw in het CRM onder Boekingen: **Berichten**. Hier staan de vragen die via het contactformulier binnenkomen, met
  een teller in het menu voor het aantal nieuwe berichten.
- Per bericht zie je de tekst, de afzender (met knop om te mailen of te bellen) en de reis waar de vraag over gaat.
  Met *Afhandelen* leg je vast dat het beantwoord is, eventueel met een korte notitie; een afgehandeld bericht kan weer
  op nieuw, en spam kun je verwijderen.

## Changelog
Pakket P4.1 (bevinding F01).
- Migratie 30: `contact_messages` krijgt `handled_at`, `handled_by` (gebruiker, `ON DELETE SET NULL`), `note` en een
  controle op de status (`nieuw`, `afgehandeld`).
- Nieuw recht `berichten` (beheerder, kantoor) en schermen `/app/berichten/` in `contact/messages.js` en
  `contact/message-routes.js` (ingang `contact/index.js`): lijst met filter en zoeken, afhandelen met notitie,
  weer openen en verwijderen met bevestiging, met audit (`bericht.afgehandeld`, `bericht.heropend`,
  `bericht.verwijderd`) en 409 bij een verouderde stand.
- `crm/menu-counters.js`: tellers naast menu-items (`counter` in `CRM_MENU`), alleen bij een GET en met het recht.
