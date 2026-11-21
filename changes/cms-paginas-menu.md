---
titel: Nieuwe pagina's, adres wijzigen, SEO per pagina en menu's beheren
bump: minor
---

## Nieuws
- In het CRM kun je nu zelf nieuwe pagina's maken (onder een bestaande pagina of op het hoofdniveau). Een nieuwe pagina staat offline tot je hem publiceert.
- Het adres van een pagina wijzigen kan ook: het oude adres verwijst automatisch door, ook voor de pagina's eronder, en het menu gaat mee.
- Pagina's kun je offline halen en weer online zetten; een zelfgemaakte pagina kun je verwijderen.
- Per pagina een titel en omschrijving voor zoekmachines.
- Nieuw scherm *Menu's*: het hoofdmenu (met submenu) en het menu in de voettekst zelf indelen.

## Changelog
- Migratie 18: `pages.seo_title`/`seo_description` (ook in `page_revisions`), tabel `menu_items` met de vaste menu's als beginvulling.
- `cms/pages.js`: `create`, `move` (met `recordMove` per pad, menu-items mee, slot op het pad), `setOnline`, `remove`, `parentOptions`, `buildPagePath` met gereserveerde adressen en controle op blogberichten; publiceren zet `published = true`.
- `cms/menus.js` en `cms/menu-routes.js` (`/app/menus/`, recht `content`, audit `menu.*`); `site/layout.js` toont `res.locals.site.menus` met het vaste menu als terugval.
- Site gebruikt `seo_title`/`seo_description` voor `<title>` en de meta-omschrijving.
- WordPress-import maakt een verplaatste pagina niet opnieuw aan op het oude adres.
