---
titel: Leesbare code in cms/, trips/, media/ en tools/ (P6a.5)
---

## Changelog
- `cms/block-render.js` (nieuw): het tekenen van blokken staat nu los van `cms/blocks.js`, met één renderer per bloktype
  in `BLOCK_RENDERERS`; `blocks.js` houdt de velden, de controle en de samenvatting per blok (`BLOCK_SUMMARIES`).
- `cms/block-editor.js`: de zijkolom van pagina's en blog (concept, versies, zichtbaarheid) is gedeeld in
  `renderDraftStatus`, `renderRevisions` en `renderVisibilityActions`; `page-routes.js` en `post-routes.js` gebruiken
  die en tekenen hun tabbladen in eigen functies.
- `trips/trip-routes.js` en `trips/guide-routes.js`: veldbouwers, categoriegroepen, reisleiderkeuze en statusblok in
  eigen functies; `media/routes.js`: het opslaan van uploads in `storeFiles`.
- `services.js`: de back-updiensten in `createBackupServices`.
- Hulpmiddelen: `tools/import/parse.js` (`readTripFacts`, `readTripPrices`, `readTripGallery`),
  `tools/import/sanitize.js` (controle per attribuut in `cleanAttributeValue`, afbeelding en video-link apart) en
  `tools/layout-compare.js` (`compareElement`).
- ESLint bewaakt nu complexiteit (20) en bestandslengte (600) in alle app-code en hulpmiddelen; de lijst met nog na te
  lopen mappen is weg. De metingen van de design-controle blijven met een gemotiveerde uitzondering één functie, omdat
  Playwright ze als tekst naar de browser stuurt.
- Geen verandering in gedrag.
