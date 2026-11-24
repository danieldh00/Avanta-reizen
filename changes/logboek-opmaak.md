---
titel: Logboek in Beheer leesbaar
---

## Nieuws
- Beheer > Logboek breekt woorden niet meer midden door: tijd, niveau en bron staan op één regel, het niveau als
  gekleurd label, en elke bron heeft een nette naam (ook in het filter). Op de telefoon staat elke regel als blok.

## Changelog
- `system/app-log.js`: `SOURCE_LABELS` en `sourceLabel()` met leesbare namen voor alle bronnen in het logboek
  (onbekende bron: hoofdletter); `beheer/log-routes.js` gebruikt ze voor de kolom Bron en het filter (alle bronnen,
  op naam gesorteerd).
- Niveau als label (`monitor-state--info|warn|error`); kolommen Tijd, Niveau en Bron zonder afbreking
  (`beheer-log__*` in `crm.css`), alleen de melding breekt lange woorden; onder 800 px een blok per regel.
- `backup/cli.js` (`decrypt`): het `.part`-bestand wordt synchroon geopend, zodat het opruimen na een snelle fout
  (verkeerde sleutel) niet meer kan voorlopen op het aanmaken; dat liet soms een `.part` achter (wisselende testfout).
