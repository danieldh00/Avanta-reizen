---
titel: Opslaan en Verwijderen in één balk bij de FAQ
---

## Nieuws
- Bij een vraag of categorie in de nieuwe FAQ-schermen staan Opslaan en Verwijderen nu samen in de balk onder het
  formulier: Verwijderen links, Opslaan rechts.

## Changelog
- `save-bar.vue` krijgt een slot `links` voor een tweede actie (`.crm-savebar-actions` in `crm.css`); de schermen
  `faq-question-screen.vue` en `faq-category-screen.vue` gebruiken het in plaats van een los blok Verwijderen, en de
  balk staat niet meer binnen het kader van de velden.
