---
titel: Toegankelijkheidscontrole met axe in de design-controle
---

## Changelog
- `tools/design-check/accessibility.js`: axe-core (WCAG 2.1 A en AA) per pagina en breedte, aan te zetten met
  `check.js --axe`. Impact critical/serious is ernst hoog en laat de CI-job `design` falen; moderate/minor staat als
  laag in het rapport. axe wordt via `page.evaluate` geladen, de CSP van de app blijft streng.
- CI (job `design`) draait de controle altijd met `--axe` op de gewijzigde schermen; axe-core wordt daar naast
  Playwright geïnstalleerd, geen dependency van de app.
- Nulmeting 24-11-2026 op 70 schermen (site, account, CRM, Beheer): alleen kleurcontrast van de huisstijl en links in
  lopende tekst in het CRM; die tellen tot de oplossing (wachtlijst W26) als midden (A20).
