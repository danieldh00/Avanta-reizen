---
titel: Ontwerp gelijk aan de huidige site: basis, kop en voettekst
---

## Nieuws
- De website lijkt nu op www.avantareizen.nl: dezelfde kleuren, lettertypes en knoppen, een vaste witte kop met
  "gescheurd papier"-rand, op mobiel een terracotta menu dat van links inschuift, een zoekvenster en de donkere
  voettekst met achtergrondfoto, wit logo, social media en het SGR-logo.

## Changelog
CMS-pakket E1 (ontwerp, geen migratie). `site.css` opnieuw opgebouwd vanuit het thema van de huidige site: achtergrond
`#f7f7f7`, tekst `#6b6b6b`, koppen Playfair Display 900 (nu lokaal), container 1280 px, breekpunten 1024 en 768 px,
secties 90/75/45 px, sectietitel 44/30 px, subtitels en knoppen in hoofdletters met letterafstand 1pt, knoppen
terracotta met korrel (20 × 40 px). Nieuwe kop (`header-main`): sticky, 92 px, papierrand, submenu bij aanwijzen,
zoekvenster als laag (`/zoeken/`), op de homepage doorzichtig met wit logo tot je scrolt; mobiel een balk van 60 px
met uitschuifmenu en uitklapbare submenu's (werkt ook zonder JavaScript). Nieuwe paginakop (titel 90/70/40 px,
cursieve pretitel, reis met landen links en "Naar overzicht") en voettekst (`footer-main`). Eigen SVG-iconen in
`src/site/icons.js`. Afbeeldingsadressen in style-attributen gaan door `cssImageUrl` (alleen eigen pad of https,
geen tekens die de CSS openbreken). Social-media-adressen uit Beheer staan nu ook in `res.locals.site.social`.
Het CRM houdt zijn rustige knoppen en koppen.
