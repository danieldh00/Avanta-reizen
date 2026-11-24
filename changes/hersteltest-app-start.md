---
titel: Hersteltest zegt waarom de app niet start
---

## Nieuws
- Start de app niet op de teruggezette back-up, dan noemt de hersteltest nu de reden.

## Changelog
- `deploy/apps01/restore-test.sh`: start de wegwerp-app niet, dan geeft het script de reden door aan Beheer: de
  geheugenlimiet is bereikt (OOM), de app stopte met een eigen foutmelding (alleen een soort fout uit een vaste lijst, zoals "Starten mislukt: ECONNREFUSED"; andere tekst uit de melding nooit), of `/api/health` gaf binnen de wachttijd geen antwoord. Een gestopte app wordt niet
  meer de hele wachttijd geprobeerd.
- Geheugenlimiet van de wegwerp-app van 384 naar 768 MB: bij het starten zet de app alle foto's uit de database terug
  en na een minuut maakt hij een back-up, wat met de foto's in de database te krap was.
- `backup/restore-test.js`: de melding "De app start niet op de teruggezette database" krijgt de reden erachter.
- Tests voor de reden en de maskering van waarden.
