---
titel: Vaste inhoud helemaal in het CRM, JSON-terugval weg
---

## Nieuws
- De fotogalerijen onder berichten en pagina's, de tags, het uitgelichte bericht, de link naar het oude blogarchief en
  de homepage staan nu in het CRM; de site gebruikt de losse bestanden van de import niet meer. Voor bezoekers
  verandert er niets.
- Een galerijblok kan nu ook als strook op volle breedte (zoals de galerij onder een reis).
- De link naar het oude blogarchief stel je in bij Beheer > Organisatie > Weblog.

## Changelog
- `site/content-transfer.js`: nieuwe delen `galerijen` (galerijblok met `weergave: strook` achteraan de blokken en het
  open concept; het bericht of de pagina krijgt `managed_in_crm`), `blog` (`copySiteTags`, instellingen
  `blogArchiveLabel`/`blogArchiveUrl` als ze afwijken van de standaard) en `homepage` (gepubliceerde blokpagina `/` met
  eerste versie, alleen als die nog niet bestaat). `start()` leest `site-content.json` en `homepage.json` eenmalig
  (`readSiteContentFile`, `readHomepageFile`) en laadt daarna de instellingen opnieuw.
- JSON-terugval verwijderd: geen `siteContent`/`homepage`-lezers meer in diensten, site, CRM en Beheer; reisleiders,
  tags, uitgelicht en galerijen alleen uit de database; offline homepage = `normalizeHomepage(null)`; onbekende tag 301
  naar `/blog/`. `json-store.js` leest alleen nog eenmalig (`readJsonFile`).
- Galerijblok: veld `weergave` (`tekst`/`strook`); `renderBlocks` zet een strook buiten `page-content`.
- Instellingen `blogArchiveLabel` en `blogArchiveUrl` (Organisatie, sectie Weblog), op de site via
  `res.locals.site.blogArchiveLink`.
- Fotobibliotheek *gebruikt in*: categorieën en tags van het blog erbij, JSON-bestanden eraf.
- Blog > Categorieën en tags: route `overnemen/` weg. Livegang: twee regels (homepage, alle delen overgezet).
