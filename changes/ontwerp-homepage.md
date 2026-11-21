---
titel: Homepage gelijk aan de huidige site
---

## Nieuws
- De homepage ziet eruit als die van www.avantareizen.nl: de grote slider met foto's, de filterbalk "Vind jouw reis",
  de last-minutes met het label Nieuw of Volgeboekt, de reistypes met eigen iconen, de inspiratie-slider, de
  bestemmingen, het blog en "Voor Avanta Reizen is geen bestemming te ver".
- In het reisoverzicht zet "Nieuwe reizen" (`/reis/?nieuw=1`) de nieuwe reizen bovenaan.

## Changelog
CMS-pakket E2 (homepage, geen migratie). Nieuwe `src/site/home-view.js` (slider, filterbalk, reisbox, reistypes,
inspiratie, bestemmingen, blog, over Avanta) met de klassen en maten van het thema; gemeten tegen de huidige site op
1440 en 375 px. De vaste inhoud (dia's, inspiratie, sectietitels, "over Avanta", volgorde van de reistypes) staat tot
CMS-pakket H in `DATA_DIR/homepage.json` (`src/site/homepage.js`: alleen tekst met maximumlengte, links naar een eigen
pad of https, foto's onder `/media/`; zonder bestand de teksten van de huidige site). De import leest de huidige
homepage (`parseHome`) en schrijft dat bestand, ook los met `--alleen-homepage`; `install.sh` doet dat zelf als het
bestand ontbreekt. Een YouTube-dia wordt een foto (stilstaande afbeelding van de video), zonder iframe of extern
script. Sliders en de bestemmingsstrook in `public/js/site.js` (automatisch wisselen pauzeert bij muis of focus en
staat uit bij `prefers-reduced-motion`; zonder JavaScript staat de eerste dia er). `upcomingTrips` kent `newFirst`
(`/reis/?nieuw=1`). Mobiel schuift de homepage niet meer onder de witte kop.
