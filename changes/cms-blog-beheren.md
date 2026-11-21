---
titel: Blog bekijken en plaatsen in het CRM
bump: minor
---

## Nieuws
- Onder *Website > Blog* in het CRM staan nu alle blogberichten. Je kunt een bericht bekijken, wijzigen in blokken (dezelfde blokken als bij pagina's), een uitgelichte afbeelding uit de fotobibliotheek kiezen, een voorbeeld bekijken en publiceren. Elke publicatie wordt bewaard als versie die je kunt terugzetten.
- Nieuwe berichten plaats je met *Nieuw bericht*. Met een publicatiedatum in de toekomst plan je een bericht in: het verschijnt dan vanzelf op de site.
- Een bericht kan een ander adres krijgen (het oude adres verwijst automatisch door), offline gehaald en, als het nieuw is, verwijderd worden.

## Changelog
- Migratie 19: `posts` krijgt `blocks`, `draft`, `draft_version`, `managed_in_crm`, `seo_title`, `seo_description`, `created_at`, `updated_at`, `updated_by`; nieuwe tabel `post_revisions`.
- `cms/posts.js` en `cms/post-routes.js` (`/app/blog/`, recht `content`): lijst met zoeken en statusfilter, nieuw bericht, concept, publiceren of inplannen (datum in Europe/Amsterdam), versies, adres wijzigen met 301 (`recordMove`, menu-items gaan mee), offline/online, verwijderen; audit `blog.*`.
- De blokeditor (velden, sectie *Blokken*, fotokiezer en de blok- en kopfotoroutes) staat nu in `cms/block-editor.js` en wordt gedeeld door pagina's en blogberichten.
- Site: een bericht toont zijn blokken (`renderPageArticle`); `VISIBLE_POST_SQL` (gepubliceerd en datum bereikt) in elke query op `posts`, zodat een ingepland bericht nergens verschijnt (blog, homepage, zoeken, sitemap). SEO-titel en -omschrijving per bericht.
- De WordPress-import laat een bericht met `managed_in_crm` of een open concept staan en zet een bericht met een gewijzigd adres niet terug op het oude adres. "Gebruikt in" van de fotobibliotheek kijkt ook naar de blokken en het concept van berichten.
