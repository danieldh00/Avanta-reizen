---
titel: Homepage als blokpagina
bump: minor
---

## Nieuws
- De homepage is nu ook in het CRM te wijzigen. Met *Homepage als blokpagina opzetten* (bij Pagina's) komt de huidige homepage als blokken klaar te staan: slider, zoekbalk, last-minutes, reistypes, inspiratie, bestemmingen, blog en "Over Avanta". Teksten, knoppen, foto's en de volgorde kun je zelf aanpassen. Tot je publiceert blijft de huidige homepage staan.

## Changelog
- Nieuwe bloktypes `home-slider`, `home-zoekbalk`, `home-lastminutes`, `home-reistypes`, `home-inspiratie`, `home-bestemmingen`, `home-blog` en `home-over` (`homeOnly`), weergegeven met de functies uit `site/home-view.js`; `loadBlockData` haalt alleen de homepagegegevens op die nodig zijn.
- `pages.createHomepage` zet `homepage.json` om in blokken (foto's met hun bibliotheek-id); de route `/` toont de gepubliceerde blokpagina en valt anders terug op de vaste homepage.
- De homepage staat niet dubbel in sitemap en zoekresultaten; adres wijzigen geldt niet voor de homepage.
