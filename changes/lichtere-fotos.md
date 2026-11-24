---
titel: Lichtere foto's op de site (WebP, srcset, lazy loading)
---

## Nieuws
- Pagina's met veel foto's laden veel sneller, vooral de reisleiderspagina: de site laadt nu een passende, kleinere
  versie van elke foto en pas als die in beeld komt. De originele foto's blijven bewaard.

## Changelog
- Nieuw `media/formats.js`: achtergrondtaak die van elke importfoto WebP-versies van 400/800/1600 px maakt in
  `DATA_DIR/media/formaten/` en van een JPEG een opnieuw gecomprimeerde JPEG (maximaal 2000 px, mozjpeg), die onder het
  oude adres wordt uitgeserveerd als hij minstens 15% kleiner is. Eén foto tegelijk, stopt onder 1 GB vrije schijf,
  ruimt afgeleide bestanden van verwijderde foto's op; originelen en back-up ongewijzigd.
- Index in het geheugen met de beschikbare breedtes (ook van bibliotheekvarianten); `imageAttributes` geeft
  `src`/`srcset`/`sizes`, `sizedImageUrl` een passend adres voor een achtergrondfoto.
- Reisleiderslijst: portret als `<img loading="lazy">` met `srcset` in plaats van een achtergrondfoto (de lijst laadde
  alle portretten tegelijk, circa 11 MB). Ook reisleiderdetail, reisleider bij een reis, reiskaarten (zonder dubbele
  achtergrondfoto), galerijen en paginakop (versie van 1600 px) gebruiken de lichtere versies. Minder inline
  style-attributen (A22).
