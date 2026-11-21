---
titel: Pagina's bewerken in blokken, met concept, voorbeeld en versies
bump: minor
---

## Nieuws
- Nieuw in het CRM onder *Website*: **Pagina's**. Wijzig de titel, bovenkop, inleiding en kopfoto van elke pagina en
  deel de inhoud in met blokken (tekst, kop met subtitel, afbeelding uit de fotobibliotheek, knoppen, citaat), elk met
  vaste opmaak uit de huisstijl: achtergrond, breedte, uitlijning en ruimte.
- Wijzigingen komen eerst in een concept. Bekijk het voorbeeld, publiceer als het klaar is, en zet zo nodig een eerdere
  versie terug.
- De rol *Redacteur* en *Kantoor* kunnen pagina's bewerken (nieuw recht `content`).

## Changelog
- Migratie 17: `pages.blocks`, `draft`, `draft_version`, `managed_in_crm`, `created_at`, `updated_at`, `updated_by`;
  tabel `page_revisions`. Bestaande `body_html` is één tekstblok geworden; de site toont alleen nog blokken.
- `app/src/cms/`: blokken-motor (`blocks.js`), concept/publiceren/versies (`pages.js`), routes `/app/paginas/`
  (`page-routes.js`) en weergave voor site en voorbeeld (`page-render.js`). Optimistische vergrendeling via
  `draft_version` (409 bij een verouderd formulier); foto's vergrendeld met `lockMediaForUse` en opnieuw bij publiceren.
- Recht `content` (beheerder, kantoor, redacteur); auditacties `pagina.*`; fotobibliotheek ziet gebruik in blokken en
  concepten.
- Import: een in het CRM gepubliceerde pagina wordt niet meer overschreven; nieuwe tekst uit de import wordt één tekstblok.
- Video's in een tekstblok blijven video's na opnieuw opschonen (volgorde van `target`/`rel`).
