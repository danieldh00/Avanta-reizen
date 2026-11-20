---
titel: SEO-klaar voor de go-live (canonical, Open Graph, JSON-LD en sitemap)
---

## Nieuws
- Elke pagina vertelt zoekmachines en social media nu het juiste adres, de titel, beschrijving en afbeelding.
- Nieuwe sitemap op `/sitemap.xml` met alle reizen (ook vertrokken), categorieën, reisleiders, blog en pagina's.

## Changelog
- Nieuw `app/src/site/seo.js`: canonical-URL, Open Graph- en Twitter-tags, JSON-LD (`TravelAgency` op de homepage,
  `Trip` met `offers` op reispagina's, `BlogPosting` op blogberichten, `BreadcrumbList` op reis-, categorie- en
  blogpagina's) en de opbouw van de sitemap. JSON-LD gaat via `JSON.stringify` met `<`, `>` en `&` als unicode-escape.
- Basisadres uit de omgevingsvariabele `SITE_URL` (standaard `https://www.avantareizen.nl`); de canonical gebruikt
  het echte pad van de pagina, niet het menupad.
- Route `/sitemap.xml` (10 minuten in het geheugen, `lastmod` voor blogberichten); query `sitemapEntries` in
  `content.js`. `robots.txt` verwijst er alleen naar bij `SITE_INDEXABLE=true`, met een absolute URL op `SITE_URL`.
- Tests in `app/test/seo.test.js` (eigen databaseschema, zodat ze naast `server.test.js` draaien).
