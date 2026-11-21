---
titel: Overzicht openstaande betalingen met Excel-export
---

## Nieuws
- Onder Reizigers > Betalingen zie je in één lijst wie nog moet betalen, wie te laat is en waar te veel is betaald,
  per reis te filteren en als Excel-bestand te downloaden.

## Changelog
- `/app/betalingen/` (recht `betalingen`, `crm/payment-overview-routes.js`): weergaven nog te betalen, te laat, te veel
  betaald en alles; filter op reis; totaal openstaand. Totalen per aanmelding in één query, berekening via
  `payments.summarize`.
- `/app/betalingen/overzicht.xlsx`: zelfde lijst als .xlsx met blad *Over deze export*; audit `export.betalingen`,
  limiet 30 per 10 minuten per gebruiker.
- Menu-item *Betalingen* onder Reizigers met een eigen euro-icoon.
