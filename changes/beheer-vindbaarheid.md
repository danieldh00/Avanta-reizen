---
titel: Vindbaarheid instellen in Beheer
---

## Nieuws
- In Beheer staat nu de groep **Vindbaarheid**: zoekmachines toelaten (met wachtwoord), het basisadres, de titels en
  omschrijving, de afbeelding voor social media, verificatie voor Google Search Console en Bing, extra regels voor
  robots.txt, pagina's buiten de sitemap en een llms.txt voor AI-zoekmachines.
- Bij *Contact en organisatie* kun je ook het adres en de social-media-pagina's invullen voor zoekmachines.

## Changelog
- Nieuwe instellingen in `SETTING_FIELDS`: `seoIndexing` (startwaarde `SITE_INDEXABLE`, `confirmOn`: aanzetten vraagt het
  wachtwoord, 5 pogingen per kwartier, ook bij terugzetten naar een startwaarde die aan staat), `siteUrl` (startwaarde `SITE_URL`), `siteName`, `homeTitle`, `defaultDescription`,
  `socialImage`, `googleVerification`, `bingVerification`, `robotsExtra`, `sitemapExclude`, `llmsEnabled`, `llmsIntro`,
  `orgStreet`, `orgPostalCode`, `orgCity` en `social*`; eigen controle per instelling met `validate`.
- `site/site-settings.js`: `res.locals.site` per verzoek; site-, aanmeld- en foutpagina's, robots.txt, sitemap en JSON-LD
  lezen basisadres, naam, titels, omschrijving, afbeelding en contact daaruit (zonder herstart).
- `X-Robots-Tag: noindex` staat standaard op elk antwoord en verdwijnt alleen als indexeren aan staat (nooit onder `/app/`, ook niet in hoofdletters, en nooit op een 404 of 500).
- `/llms.txt` (alleen bij indexeren en `llmsEnabled`), verificatie-metatags, `PostalAddress` en `sameAs` in `TravelAgency`.
- Sitemap-cache per basisadres en uitsluitingen; uitsluiten op pad of met `*` op alles eronder.
- Beheer-formulier: een ontbrekend tekstveld laat de instelling ongewijzigd (een dubbel veld blijft ongeldig).
- Extra robots.txt-regels sluiten aan op de groep `User-agent: *`, zodat een losse `Disallow:` voor alle crawlers geldt.
