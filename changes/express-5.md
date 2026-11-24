---
titel: Overstap naar Express 5
---

## Changelog
- De app draait op Express 5 (was 4). Routes met een patroon per parameter (`:id(\d{1,9})`), die Express 5 niet meer
  kent, lopen via de nieuwe hulpfunctie `routePath` (`src/route-path.js`): een reguliere expressie met benoemde groepen,
  hoofdletterongevoelig en met een optionele `/` aan het eind, zodat elke URL zich gedraagt als voorheen.
- `req.body` begint per verzoek als leeg object; Express 5 laat het anders leeg als er geen formulier is ingelezen.
- Downloads van back-ups hebben de bestandsnaam nu zonder aanhalingstekens in `Content-Disposition` (geldig volgens
  RFC 6266).
- Tests voor `routePath`, het doorvallen naar een volgende route, afgewezen promises naar de foutafhandelaar en een
  POST zonder inhoud.
