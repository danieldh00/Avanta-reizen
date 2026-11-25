---
titel: JSON-API voor de veelgestelde vragen
---

## Changelog
- Nieuw: `app/src/cms/faq-api.js`, de eerste module op de JSON-API (fase V2 van de ombouw naar Vue): onder
  `/app/api/faq/` het overzicht, vragen en categorieën lezen, toevoegen, wijzigen en verwijderen (categorie alleen
  leeg) en de volgorde van categorieën en van de vragen in een categorie (`PUT /faq/volgorde/`,
  `PUT /faq/categorieen/:id/volgorde/`). Recht `content`, dezelfde veldcontrole, opschoning en audit als de oude
  schermen, invoer eerst via een schema met `.strict()`, en een limiet van 60 wijzigingen per minuut per gebruiker.
- `faqs.js`: `reorderCategories` en `reorderQuestions` (alleen een volledige lijst zonder dubbele of vreemde id's;
  volgorde 10, 20, 30, …). Nieuwe auditactie `faq.volgorde-gewijzigd`.
- `createApiRouter` krijgt de database en de klok mee voor de modules.
