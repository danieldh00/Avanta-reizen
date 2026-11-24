---
titel: Koppen van de lijstpagina's en galerij en volgorde van reisleiders in het CRM
bump: minor
---

## Nieuws
- Nieuw scherm **Website > Lijstpagina's**: pas de kop (pretitel, titel, inleiding en foto) aan van Reizen, Reisleiders, Blog, Veelgestelde vragen en het aanmeldformulier.
- Bij een reisleider stel je nu zelf de **volgorde** in de lijst op de site in (Profiel > Volgorde) en beheer je de **galerij** onderaan zijn pagina (tabblad Foto's: foto's toevoegen uit de fotobibliotheek, volgorde wijzigen, weghalen, titel en subtitel).
- De bestaande koppen, volgorde en galerijen van de huidige site worden bij de update automatisch overgenomen; voor bezoekers verandert er niets.

## Changelog
- Migratie 34: tabel `list_headers` (beginwaarden = de teksten van de huidige site, `source` standaard/bestand/crm), `guides.gallery`/`gallery_title`/`gallery_subtitle` en `content_transfers`.
- `cms/list-headers.js` en `list-header-routes.js` (`/app/lijstpaginas/`, recht `content`, audit `lijstkop.gewijzigd`/`lijstkop.foto`); site en aanmeldformulier lezen de kop synchroon via `listHeaders.get(key)` (kopie in het geheugen, ververst bij elke wijziging en hooguit elke minuut).
- Reisleiders: `sort_order` in het profiel, lijst op de site en in het CRM op volgorde; galerij met toevoegen (meerdere foto's tegelijk), volgnummers/weghalen met vingerafdruk tegen een oude stand (409) en tekst; audit `reisleider.galerij`. `guideExtra` neemt de galerij uit de database.
- `site/content-transfer.js`: zet `site-content.json` per deel één keer over (koppen die nog standaard zijn; reisleiders: gegevens, galerij en volgorde van de huidige site); draait bij de start van de app en na de import.
- "Gebruikt in" van de fotobibliotheek kent de lijstkoppen en de galerij van reisleiders; Livegang toont koppen en reisleiders als klaar zodra ze in het CRM staan.
