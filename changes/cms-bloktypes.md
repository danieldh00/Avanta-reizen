---
titel: Meer bloktypes voor pagina's, YouTube-video met cookiekeuze en opmaakknoppen
---

## Nieuws
- Nieuwe blokken voor pagina's: tekst met foto, fotogalerij, kolommen, banner, video (YouTube), veelgestelde vragen,
  reizen (op reistype en/of land), reistypes en bestemmingen.
- Een video laadt pas als de bezoeker op *Video afspelen* klikt; tot dan maakt de browser geen verbinding met YouTube.
- Boven tekstvakken staan knoppen voor vet, cursief, kopjes, alinea, lijst en link.

## Changelog
- `cms/blocks.js`: bloktypes `tekst-afbeelding`, `galerij` (veldsoort `images`), `kolommen`, `banner`, `video`
  (veldsoort `youtube`, alleen het id wordt opgeslagen), `faq`, `reizen`, `reistypes`, `bestemmingen` (veldsoort
  `source` met keuzes uit de database); standaardopmaak per type (`styleDefaults`); `loadBlockData` haalt alleen de
  gegevens op die de blokken nodig hebben.
- Fotoscherm van een blok: meer foto's tegelijk voor een galerij (vergrendeld met `lockMediaForUse`), weghalen en
  volgorde in het blokformulier.
- `public/js/site.js`: video pas laden na toestemming (onthouden in localStorage); `public/js/crm.js`: opmaakknoppen.
- CSS `cms-media-text`, `cms-columns`, `cms-banner`, `cms-video`, `cms-embed`.
