---
titel: Design-controle met Playwright
---

## Changelog
- Nieuw hulpmiddel `app/tools/design-check/`: Playwright-controle van alle schermen (site, reizigersaccount, CRM,
  Beheer) op 1440 en 375 px op overloop, afgekapte tekst, overlap, ongelijke knophoogtes, scheve randen, tekst tegen de
  schermrand, kapotte afbeeldingen, kleine tekst en kleine klikdoelen; volledige run (`--full`) of alleen opgegeven
  schermen (`--paths=`), uitsneden per bevinding en een Excel-rapport via de eigen .xlsx-schrijver. Geen wijziging aan
  de app zelf; Playwright blijft een ontwikkelhulpmiddel.
- Het wachtwoord van de lokale testaccounts staat niet in de repository: het komt uit `DESIGN_WACHTWOORD` of uit
  `~/.cache/avanta-design-check/wachtwoord`, dat alleen `seed.js` exclusief aanmaakt. Alle scripts weigeren een
  niet-lokale app; `seed.js` ook een database die geen lokale test- of ontwerpdatabase is.
