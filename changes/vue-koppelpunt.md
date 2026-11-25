---
titel: Eerste scherm in Vue in de bestaande schil (Bouwstenen)
---

## Nieuws
- Nieuw onder Beheer > Systeem: *Bouwstenen*, het eerste scherm van de nieuwe opbouw van het CRM. Het toont de
  bouwstenen van de nieuwe schermen; verder verandert er niets.

## Changelog
- `crm/web-bundle.js`: leest het manifest van Vite per module (script, opmaak, voorladers) en tekent het koppelpunt
  `#crm-app`; `renderCrmPage` zet de koppen van de bundel in de `<head>` (`page.bundle`). De CSP blijft gelijk.
- `server.js` serveert `web/dist/assets/` onder `/bundel/assets/` (een jaar in de cache, het manifest nooit).
- `beheer/bouwstenen-routes.js`: `/app/beheer/bouwstenen/` (recht `systeem`) met de module `beheer`.
- Frontend: het koppelpunt krijgt `data-klaar` als het eerste scherm er staat; `npm run check:bundle` weigert `eval`,
  `new Function` en HTML in de uitvoer.
- Design-controle: de job `design` bouwt eerst de frontend en `check.js` wacht op `data-klaar`; `changed-screens.js`
  kent `app/web/` (fundament en bouwstenen, en modules via hun map op de server).
