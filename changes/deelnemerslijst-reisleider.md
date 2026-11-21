---
titel: Deelnemerslijst voor de reisleider
---

## Nieuws
- Reisleiders zien nu in het CRM *Deelnemerslijsten* van hun eigen vertrekken, met naam, mobiel en e-mail.
  Identiteit en gezondheid kunnen ze alleen kiezen van 14 dagen vóór vertrek tot en met de terugkomst.
- In *Gebruikers* koppel je een reisleider-account aan een reisleidersprofiel.

## Changelog
- `users.guide_id` in te stellen bij Gebruikers (alleen rol reisleider; onbekend profiel geeft 422; audit
  `gebruiker.reisleidersprofiel`).
- `/app/deelnemerslijsten/` nu met `requireRight`: de reisleider (`TRIP_SCOPED_ROLES`) ziet alleen reizen via
  `users.guide_id` naar `trip_guides`; andere reis geeft 404. Beperkte kolommen (Nr., naam, mobiel, e-mail).
- Venster voor `identiteit`/`gezondheid` in SQL (Europe/Amsterdam): vertrek - 14 dagen t/m vertrek + duur - 1;
  daarbuiten niet aangeboden en 403. Kerkgenootschap nooit (geen recht).
- Een lijst heeft hoogstens 1000 deelnemers (`MAX_ROWS`; meer geeft 422 zonder bestand of auditregel, met test).
  De melding bij de exportlimiet (429) is een CRM-pagina met een link terug.
