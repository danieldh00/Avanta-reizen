# Website-inhoud (`app/src/cms/`)

Alleen wat voor deze map geldt; de algemene regels staan in de root-`CLAUDE.md` en gaan bij tegenspraak voor.
Indeling in modules en parallel werken: `docs/ARCHITECTUUR.md`. Wie in deze map een bestand toevoegt of de rol van
een bestand verandert, werkt dit bestand bij in dezelfde PR (niet de tabel in de root).

## Bestanden
- pagina's in blokken (recht `content`): `blocks.js` (`BLOCK_TYPES` met vaste velden, `STYLE_OPTIONS` uit de huisstijl, `validateBlockForm`, samenvatting per blok in `BLOCK_SUMMARIES`)
- `block-render.js` (blokken tekenen voor site en voorbeeld: `BLOCK_RENDERERS` per type, `renderBlocks`, `loadBlockData`; nieuw bloktype = velden in `blocks.js` + renderer hier + CSS `cms-*`)
- `pages.js` (concept in `pages.draft` met `draft_version` tegen overschrijven, `publish` → `page_revisions`, terugzetten)
- `page-routes.js` (`/app/paginas/`: ook nieuw, adres wijzigen met `recordMove`, offline, verwijderen, SEO-velden)
- `page-render.js` (site en voorbeeld)
- `menus.js` + `menu-routes.js` (`/app/menus/`: hoofd- en voetmenu in `menu_items`, site via `res.locals.site.menus`, vast menu als terugval)
- `block-editor.js` (blokeditor: velden, sectie *Blokken*, fotokiezer en blokroutes, gedeeld door pagina's en blog; `RICHTEXT_HELP`; ook de gedeelde zijkolom: `renderDraftStatus`, `renderRevisions`, `renderVisibilityActions`)
- opgemaakte tekst = `textarea.cms-richtext` + `RICHTEXT_HELP`: de teksteditor (`public/js/rich-editor.js`) zet zich daar vanzelf op; de server schoont altijd op met `sanitizeHtml`
- `posts.js` + `post-routes.js` (`/app/blog/`: blog in blokken zoals pagina's, inplannen via `published_at` in de toekomst; elke query op `posts` voor de site met `VISIBLE_POST_SQL` uit `site/content.js`)
- `post-terms.js` + `post-term-routes.js` (`/app/blog/categorieen-en-tags/`: categorieën en tags in `post_terms`, uitgelicht = `posts.featured`; site via `content.blogHighlights`, tot de overname nog uit `site-content.json`)
- `faqs.js` + `faq-routes.js` (`/app/faq/`: categorieën in `faq_categories` met volgorde, `faqs.category` is een afgeleide kopie van de naam, `managed_in_crm` → import slaat over)
- `list-headers.js` + `list-header-routes.js` (`/app/lijstpaginas/`: koppen van Reizen, Reisleiders, Blog, FAQ en het aanmeldformulier in `list_headers`, migratie 34; site en aanmelden synchroon via `listHeaders.get(key)` uit een kopie in het geheugen, geladen door de middleware in `server.js`)
- homepage = pagina `/` met `home-*`-blokken (`homeOnly`, opmaak uit `site/home-view.js`)
- offline of ontbrekend → vaste homepage uit `homepage.json`
