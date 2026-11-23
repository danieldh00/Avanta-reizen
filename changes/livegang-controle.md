---
titel: Controle voor de livegang in Beheer
---

## Nieuws
- Nieuw in Beheer > Systeem: **Livegang**. Eén pagina die laat zien wat er nog moet gebeuren voor de overstap naar de
  nieuwe site (tweestapsverificatie, balk "in ontwikkeling", basisadres, indexeren, bewaking, mail, captcha) en welke
  vaste inhoud nog niet in het CRM staat.

## Changelog
- `beheer/go-live-check.js` (alleen lezen, één query met aantallen) en `beheer/go-live-routes.js`
  (`/app/beheer/livegang/`, recht `systeem`, limiet 60 per minuut); sectie `livegang` in `beheer/instellingen/systeem.js`.
- Plan P6.3/P6.5, bevinding F09: homepage, reisleiders, blogtags en uitgelicht bericht: *Klaar* als ze in het CRM
  staan, anders *Open*; koppen van lijstpagina's, volgorde/galerij van reisleiders en fotogalerijen: *Later* (nog geen
  plek in het CRM, opruimen in P7).
- Tests: `test/beheer-livegang.test.js` (beoordeling zonder database, route: 303 zonder sessie, 403 zonder recht,
  standen, geen e-mailadressen op de pagina).
