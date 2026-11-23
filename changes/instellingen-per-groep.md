---
titel: Instellingen per groep van Beheer in een eigen bestand
---

## Changelog
Modulestructuur, stap 3 (geen gedragswijziging): de 91 instellingen en de secties van Beheer staan niet meer in twee
grote lijsten (`beheer/settings.js` en `beheer/indeling.js`) maar per groep in `app/src/beheer/instellingen/<groep>.js`
(Systeem, Organisatie, E-mail, CRM, Toegang en beveiliging, Back-ups en herstel, Vindbaarheid), elk met `FIELDS` en
`GROUP`. `settings.js` voegt ze samen tot `SETTING_FIELDS` en weigert een dubbele naam; `indeling.js` leest `GROUPS`
uit dezelfde bestanden. Alle instellingen, standaardwaarden, controles, secties en hun volgorde zijn identiek
(vooraf en achteraf geserialiseerd en vergeleken). Een nieuwe instelling raakt alleen het bestand van haar groep.
