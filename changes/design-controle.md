---
titel: Design-controle met Playwright
---

## Changelog
- Nieuw hulpmiddel `app/tools/design-check/`: Playwright-controle van alle schermen (site, reizigersaccount, CRM,
  Beheer) op 1440 en 375 px op overloop, afgekapte tekst, overlap, ongelijke knophoogtes, scheve randen, tekst tegen de
  schermrand, kapotte afbeeldingen, kleine tekst en kleine klikdoelen; volledige run (`--full`) of alleen opgegeven
  schermen (`--paths=`), uitsneden per bevinding en een Excel-rapport via de eigen .xlsx-schrijver. Geen wijziging aan
  de app zelf; Playwright blijft een ontwikkelhulpmiddel.
