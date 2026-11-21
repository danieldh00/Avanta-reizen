---
titel: Zijbalk voor CRM en Beheer zoals in AquaTech
bump: minor
---

## Nieuws
- Het CRM en Beheer hebben een vaste zijbalk links, zoals in AquaTech: alle onderdelen in groepen, de huidige pagina
  gemarkeerd, in te klappen tot alleen iconen en op de telefoon een uitschuifmenu.

## Changelog
- `crm/layout.js`: de menubalk bovenin is vervangen door een vaste zijbalk met logo, zoekveld voor Beheer (recht
  `systeem`), groepen Reizigers, Website, Gebruikers en de groepen van Beheer (`beheer/indeling.js`), en een voet met
  wachtwoord, tweestapsverificatie en uitloggen. Items volgens de rechten; het item met het langste passende pad is
  actief, zijn groep staat open.
- `public/js/crm.js` (nieuw): inklappen tot iconenbalk (localStorage), accordeon van de groepen, lade op een smal
  scherm (menuknop, achtergrond, Esc). Zonder JavaScript staan alle groepen open.
- `beheer/routes.js`: de eigen zijbalk van Beheer is vervallen; de gefilterde groepen en zoekterm gaan naar de
  zijbalk van het CRM. Wachtwoord, tweestapsverificatie en Google Drive geven hun eigen pad door voor de markering.
- `site/icons.js`: iconen voor de zijbalk. `site.css`: stijl van de zijbalk (breekpunt 800 px).
- Tests: `test/crm-sidebar.test.js`.
