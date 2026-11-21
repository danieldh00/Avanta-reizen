---
titel: Blog, pagina's, FAQ, contact en aanmelden gelijk aan de huidige site (CMS-pakket E4)
---

## Nieuws
- Het weblog, de tagpagina's, berichten, pagina's, de FAQ, de contactpagina en het aanmeldformulier zien er nu uit
  zoals op de huidige website, met fotogalerijen en video's waar die nu ook staan.
- Nieuw in Beheer > Organisatie > Contact: het KvK-nummer voor de contactpagina.

## Changelog
- Nieuw `src/site/page-view.js` (vervangt `views.js`): weblog met tagbalk en uitgelicht bericht, `/tag/<slug>/`,
  inhoud in blokken (tekst, afbeelding, galerij, youtube-nocookie-video met CSP alleen op die pagina), FAQ als
  `details` per categorie, contactlayout met adresblok.
- Samenvatting als op de huidige site (`postSummary`: 197 bytes + " ..."), berekend uit de berichttekst.
- `site-content.json` versie 2: `blogTags`, `blogArchiveLink`, `featuredPost`, `galleries` en de kop van `/aanmelden/`;
  de import leest ze van de huidige site, `install.sh` importeert opnieuw bij een oudere versie.
- Aanmelden zonder reis geeft een melding (200) in plaats van een doorverwijzing.
- Instelling `orgKvk`.
- `tools/layout-compare.js` met opgeslagen live-meting en test (`LAYOUT_BASE_URL`).
