---
titel: Reizen en reisleiders gelijk aan de huidige site; video in de homepage-slider
---

## Nieuws
- Het reisoverzicht, de categoriepagina's en de reispagina zien eruit als op www.avantareizen.nl: liggende reisboxen
  met het donkere prijsvak, de filterbalk boven het overzicht, en op de reis de reisleider, de kenmerken als iconen,
  het vak met prijs, gegevens, "Gegarandeerd vertrek" en "Ik meld me aan!", en de fotostrook met titel.
- De reisleiders staan in een raster met staande foto's; de pagina van een reisleider toont het citaat, de woonplaats,
  een tweede foto en de foto's van onderweg.
- De homepage-slider speelt de YouTube-video weer af, zoals nu (stil, via youtube-nocookie.com).

## Changelog
CMS-pakket E3 (geen migratie). Nieuw `src/site/trip-view.js` (reisbox liggend met prijsvak, reisdetail met
`trip__single`/`trip__meta`, kenmerken als compacte icoontegels, galerijstrook, reisleiderlijst en -detail) en de CSS
uit het thema, gemeten tegen de huidige site op 1440 en 375 px. Prijzen als op de huidige site (`€1849,-`). De koppen
van de lijstpagina's (reizen, reisleiders, blog, FAQ) en de extra reisleidergegevens (achternaam, woonplaats, sinds,
citaat, portret, tweede foto, galerij, volgorde) staan tot CMS-pakket G/H in `DATA_DIR/site-content.json`
(`src/site/site-content.js`, alles gecontroleerd); de import schrijft het, los met `--alleen-vaste-inhoud`
(`--alleen-homepage` blijft werken) en `install.sh` haalt het op als het ontbreekt. Gedeelde lezer
`src/site/json-store.js`. Videodia's: `videoId` gecontroleerd (11 tekens), iframe via youtube-nocookie.com zonder
geluid en knoppen, CSP `frame-src` alleen op `/` met een videodia (`src/security/csp.js`), uit bij
`prefers-reduced-motion`. "Nieuwe reizen (n)" telt alle komende nieuwe reizen (`newTripCount`). De oude kaarten,
zoeker en reisdetail-opmaak zijn weg; zoekresultaten tonen reizen als liggende boxen.
