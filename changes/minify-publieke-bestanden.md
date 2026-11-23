---
titel: Publieke CSS en JavaScript verkleind uitgeleverd
---

## Nieuws
- De website laadt sneller: de opmaak en scripts worden verkleind uitgeleverd (samen ongeveer 30% kleiner, de scripts
  ruim de helft).

## Changelog
- Nieuwe bouwstap `minify` in `app/Dockerfile`: `app/tools/minify-public.js` verkleint `public/css/*.css` en
  `public/js/*.js` met esbuild (alleen een ontwikkelafhankelijkheid, vastgepind op 0.28.2) en het image krijgt die
  bestanden over de bron heen. Geen bundelen of omzetten: `url()`-verwijzingen, volgorde en syntaxis blijven gelijk,
  commentaar verdwijnt. Een fout in een bestand laat het bouwen mislukken.
- De bron in `app/public/` blijft leesbaar; lokaal en in de tests draait de app op de bron.
- Meting: 144,7 KB naar 102,4 KB (-29%); site.css -17%, crm.css -20%, scripts -57 tot -65%.
- Tests: `test/minify-public.test.js` (geldige uitkomst, zelfde verwijzingen en CSS-variabelen, bron nooit overschreven).
