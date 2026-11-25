# Module Menu's in de frontend (`app/web/src/modules/menus/`)

Hoort bij `app/src/cms/` (`menus.js`, `menu-routes.js`, `menu-api.js`). Basispad `/app/menus/`, recht `content`. Fase V3
van de ombouw (`docs/VUE-OMBOUW.md`).

## Bestanden
- `main.ts`: ingang; start de module op het koppelpunt (`mountModule`).
- `routes.ts`: `/` en `/<id>/`, gelijk aan de oude adressen.
- `menu-api.ts`: getypte functies op `/app/api/menus/…` (`createMenuApi`, `menuApi`) en de vaste meldingen (`NOTICES`).
- `menu-form.ts`: de velden van het formulier (`MenuItemForm`, tekst) en het omzetten van en naar de API
  (`emptyMenuForm`, `menuFormOf`, `menuInputOf`; een bovenliggend item telt alleen in het hoofdmenu).
- `menu-item-fields.vue`: de velden van een item (menu, bovenliggend item, tekst, adres met suggesties, volgorde),
  gedeeld door overzicht en bewerkscherm.
- `menu-overview-screen.vue`: beide menu's (submenu ingesprongen), per item verwijderen na bevestigen, item toevoegen.
- `menu-item-screen.vue`: een item wijzigen; verwijderen na bevestigen (met het aantal items van het submenu).
- `menu-screens.spec.ts`: tests van de schermen met een nagebootste API.

## Regels
- De server blijft de maatstaf: controle van adres, plaats en aantal en de meldingen per veld komen van `menu-api.js`.
- Een scherm zet zijn titel met `setPageTitle` (`shell/page-title.ts`); de server zet dezelfde titel bij het laden.
