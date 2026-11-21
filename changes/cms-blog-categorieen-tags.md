---
titel: Categorieën en tags van het blog beheren
bump: minor
---

## Nieuws
- Onder *Blog > Categorieën en tags* beheer je de categorieën en tags van het blog: toevoegen, naam en adres wijzigen (het oude adres verwijst automatisch door), een inleiding geven en verwijderen. Met één knop neem je de tags van de huidige site over, met hun berichten en het uitgelichte bericht.
- Bij een bericht vink je de categorieën en tags aan en kies je of het het uitgelichte bericht is (groot op het blog en de homepage). Uitlichten kan alleen bij een gepubliceerd bericht.
- Categoriepagina's (`/category/…`) zijn terug op de site en tagpagina's tonen de berichten uit het CRM.

## Changelog
- Migratie 20: `post_terms` (soort `categorie`/`tag`, slug uniek per soort, naam, inleiding, foto, volgorde), `post_term_links` en `posts.featured` (unieke index, hoogstens één). Categorieën uit `posts.categories` worden overgenomen met koppelingen.
- `cms/post-terms.js` en `cms/post-term-routes.js` (`/app/blog/categorieen-en-tags/`, recht `content`, audit `blog-indeling.*`); op het bewerkscherm van een bericht het blok *Categorieën, tags en uitgelicht* (`/app/blog/<id>/indeling/`, audit `blog.indeling`).
- Site: `content.blogHighlights` levert tagbalk en uitgelicht bericht uit de database, tot de overname nog uit `site-content.json`; `/category/<slug>/` en `/tag/<slug>/` tonen de zichtbare berichten; sitemap met categorieën en tags die een zichtbaar bericht hebben.
- Verwijderen van een bericht haalt doorverwijzingen naar dat bericht weg. Het blogoverzicht toont het uitgelichte bericht ook als het het enige bericht is.
- Uitlichten en adreswijzigingen van categorieën en tags lopen met een advisory lock na elkaar, zodat gelijktijdig werken geen foutpagina geeft.
