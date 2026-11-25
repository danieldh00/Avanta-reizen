# Module Beheer in de frontend (`app/web/src/modules/beheer/`)

Hoort bij `app/src/beheer/` (zelfde thread). Basispad `/app/beheer/`. De schermen van Beheer zelf gaan over in fase
V7; tot dan staat hier alleen het overzicht van de bouwstenen.

## Bestanden
- `main.ts`: ingang; start de module op het koppelpunt (`mountModule`).
- `routes.ts`: schermen met paden ten opzichte van `/app/beheer/`.
- `bouwstenen-screen.vue`: overzicht van de bouwstenen met een voorbeeld van elk (`/app/beheer/bouwstenen/`), voor
  de design-controle en axe; verzonnen gegevens in het bestand, er gaat niets naar de server.
- `routes.spec.ts`: tests van de route en de voorbeelden (filteren, zoeken, bladeren, opslaan, bevestigen).
