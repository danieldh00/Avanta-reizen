---
titel: CRM netjes uitgelijnd op desktop en mobiel
---

## Nieuws
- Lijsten in het CRM (aanmeldingen, deelnemers, betalingen, reizen) tonen op de telefoon elke regel als kaart met alle gegevens, in plaats van een tabel waar je zijwaarts door moest scrollen.
- De knop Zoeken staat even hoog en op één lijn met de zoekvelden.
- Vinkjes staan voor hun tekst (Persoon wissen, Deelnemerslijsten en andere formulieren).
- Op het Overzicht past de tabel Komende vertrekken weer in zijn kolom; lange reisnamen lopen door op een tweede regel.
- Op de telefoon wordt de paginatitel niet meer afgekapt in de kopbalk; reiscodes en datums breken niet meer midden in.
- Betalingen: de knop Herinnering sturen staat onder de uitleg en de totaalregel loopt over de hele rij.
- De status van een aanmelding bij een deelnemer staat als gekleurd label, net als in de lijst Aanmeldingen.
- Beheer: gelijke afstanden tussen de secties op de startpagina.

## Changelog
Designbevindingen W13–W17, W22 (CRM-deel), W23 en W24 uit de designcontrole van 23-11-2026.
- `crm/ui.js` `renderTable`: `data-label` per cel, klassen `crm-table--cards` en kolomoptie `wrap` (`crm-wrap`); onder
  800 px in `crm.css` als kaarten.
- `crm.css`: knop in `.crm-search` 40 px (mobiel 44 px), `label.choice` met vinkje links, `tfoot` met doorlopende
  achtergrond, groepstitels zijbalk 12 px, kruimelpad verborgen op mobiel (titel staat als kop op de pagina),
  klikdoelen ≥ 24 px (terug naar het CRM, feitenlijsten, Gebruikt op), vaste sectie-afstand in Beheer, `.crm-nowrap`.
- Overzicht: kolom Reis mag afbreken, reiscode niet; reiskop: code, datum en plaatsen elk zonder afbreken.
- Deelnemer: status als `renderStatus`; nieuwe gebruiker: Annuleren als knop; betaling: knop Herinnering sturen op
  een eigen regel.
