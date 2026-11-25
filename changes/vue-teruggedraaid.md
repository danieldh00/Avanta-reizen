---
titel: Ombouw naar Vue teruggedraaid
---

## Nieuws
- De veelgestelde vragen in het CRM hebben weer de vertrouwde schermen, die meteen geladen zijn. De proef met de
  nieuwe schermen is gestopt.

## Changelog
- Ombouw naar Vue gestopt (besluit 25-11-2026): de merges van #150 (fase V1 en V2) en #151 zijn teruggedraaid. Weg:
  `app/web/` met de bouwstap `web` in het image en de CI-stappen van de frontend, het API-fundament onder `/app/api/`
  (`app/src/api/`, `faq-api.js`), het koppelpunt (`crm/web-bundle.js`, `/bundel/`), het scherm Beheer > Systeem >
  Bouwstenen en `zod`. De FAQ in het CRM heeft weer de schermen van de server (`faq-routes.js`). Staging, servertaak
  002, de stand van staging bij Updates en onderhoud en `develop-sync.yml` blijven.
