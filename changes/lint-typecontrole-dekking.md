---
titel: ESLint, typecontrole op de JSDoc en een dekkingsdrempel in CI
---

## Changelog
- ESLint (aanbevolen regels plus `eslint-plugin-security`) in `app/eslint.config.js`; `npm run lint` draait in CI. Alle
  meldingen opgelost: ongebruikte variabelen en toewijzingen weg, foutoorzaak (`cause`) doorgegeven bij opnieuw gegooide
  fouten, uitzonderingen alleen per regel met reden.
- Typecontrole op de JSDoc met TypeScript (`npm run typecheck`, `app/tsconfig.json`): bestanden met `// @ts-check`
  bovenaan worden gecontroleerd; 40 bestanden doen al mee (o.a. kluis, netguard, limieten, database, Excel-schrijver).
  Nieuwe bestanden krijgen de regel altijd.
- CI draait de tests met dekkingsmeting en een drempel (`npm run test:coverage`: regels 95%, takken 85%, functies 93%).
- Geen gedragswijziging in de app (A19).
