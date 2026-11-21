---
titel: Veelgestelde vragen beheren
bump: minor
---

## Nieuws
- Onder *Website > Veelgestelde vragen* beheer je de FAQ: vragen toevoegen, wijzigen (vraag, categorie, antwoord met opmaak, volgorde) en verwijderen, en categorieën toevoegen, hernoemen en ordenen. Wijzigingen staan meteen op de FAQ-pagina.

## Changelog
- Migratie 21: `faq_categories` (naam uniek zonder hoofdlettergevoeligheid, volgorde) en bij `faqs` de kolommen `category_id`, `managed_in_crm`, `updated_at` en `updated_by`. Bestaande categorieën worden alfabetisch overgenomen; een vraag zonder categorie komt in *Algemeen*.
- `cms/faqs.js` en `cms/faq-routes.js` (`/app/faq/`, recht `content`, audit `faq.*`); antwoorden gaan door `sanitizeHtml`. `faqs.category` blijft als afgeleide kopie van de categorienaam voor de site en het FAQ-blok.
- De FAQ-pagina toont de categorieën op hun volgorde (vragen zonder categorie achteraan). De WordPress-import laat vragen uit het CRM staan (telt ze als `faqUitCrm`, en maakt hun oude categorie niet opnieuw aan) en zet categorieën in `faq_categories`.
