---
titel: Reistypes en landen beheren
bump: minor
---

## Nieuws
- In het CRM staat onder *Website* het scherm **Reistypes en landen**: reistypes en landen toevoegen en wijzigen
  (naam, adres, icoon, inleiding, tekst, volgorde), een foto kiezen uit de fotobibliotheek, kiezen welke op de homepage
  staan en dubbelingen samenvoegen. Een gewijzigd adres verwijst automatisch door.

## Changelog
- Migratie 14: `trip_categories` krijgt `icon`, `sort_order`, `show_on_home` en `updated_at` (index op soort en volgorde).
- Nieuw `app/src/trips/`: `slugs.js` (slug maken en controleren, `recordMove`: 301 zonder lus of keten),
  `categories.js` en `category-routes.js` onder `/app/reistypes-en-landen/` (recht `reizen`), met auditacties
  `categorie.*`. Tekst opgeschoond met `sanitizeHtml`.
- Nieuw `app/src/media/picker.js`: foto kiezen uit de bibliotheek op een bewerkscherm; `lockMediaForUse` in
  `media/library.js` vergrendelt de foto (`FOR SHARE`) bij het opslaan van een verwijzing.
- Site: categorieën op volgorde, gekozen icoon (`categoryIconName`), homepage toont de reistypes en bestemmingen met
  *tonen op de homepage* (anders zoals voorheen).
