---
titel: Lichtere foto's op de homepage, het blog en in blokken
---

## Nieuws
- Ook de homepage, het blog en pagina's in blokken laden nu kleinere versies van de foto's.

## Changelog
- Homepage: slider en inspiratie als achtergrond in de versie van 1600 px, bestemmingen 800 px; reiskaarten, blogberichten
  en "over ons" met `srcset`/`sizes` (`media/formats.js`).
- Blokken: afbeelding en media-met-tekst met `srcset`, banner (1600 px) en bestemmingen (800 px) als lichtere
  achtergrond.
- Losse foto's in opgeschoonde teksten worden opnieuw opgebouwd met `srcset` en `loading="lazy"` (alleen `src`, `alt` en
  numerieke `width`/`height` uit de opgeschoonde HTML).
