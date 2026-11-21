---
titel: Balk "Deze website is in ontwikkeling"
---

## Nieuws
- Bovenaan de website staat nu een balk die bezoekers laat weten dat de site nog in ontwikkeling is. Zet hem aan of uit
  en pas de tekst aan onder Beheer > Organisatie > Balk "in ontwikkeling".

## Changelog
- Instellingen `devBannerEnabled` (standaard aan) en `devBannerText` (één regel, verplicht, max. 200 tekens) in
  `SETTING_FIELDS`, met de sectie `ontwikkeling` in de groep Organisatie van Beheer. Geen migratie: de waarden staan in
  de bestaande tabel `settings`, wijzigen met audit zoals elke instelling.
- `site-settings.js` geeft `devBanner` (de tekst, of leeg als de balk uit staat); `renderPage` toont die ge-escaped
  boven de kop van elke publieke pagina, ook op 404, 500 en de onderhoudspagina. Het CRM gebruikt zijn eigen layout en
  toont de balk niet.
- CSS `.dev-banner` in `--av-accent-dark` met witte tekst (contrast 4,9:1), compacter onder 640 px.
- Tests: `test/dev-banner.test.js` (validatie, escaping, plek, standaard aan, wijzigen en uitzetten met audit, niet in
  het CRM, 403 zonder recht `systeem`).
