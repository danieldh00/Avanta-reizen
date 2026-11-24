---
titel: Publieke site netjes uitgelijnd en import zonder restcategorieën
---

## Nieuws
- Reizen met een actieprijs: 'Bijkomende kosten' en '* Bij boeking voor …' staan niet meer over elkaar.
- Reisleiderpagina: label en waarde ('Bij Avanta sinds 2026') staan los van elkaar en de naam raakt de lijn niet meer; op de telefoon steekt de pagina niet meer buiten het scherm.
- Homepage: in het zoekfilter staat 'Maak jouw keuze' weer helemaal in beeld; op de telefoon hebben de keuzevakken een binnenmarge.
- Reisdetail: terug-link en tekst beginnen op dezelfde lijn als de titel; bij de kenmerken staat de naam naast elk icoon.
- Op de telefoon zijn links in de reisgegevens en het telefoonnummer op Contact beter te raken.
- Een nieuwe import van de huidige site neemt restcategorieën ('Bestemming', 'Type', 'NaN', 'nederland', dubbel 'Saudi Arabië') niet meer over.

## Changelog
Designbevindingen W18–W21, het site-deel van W22 en W25 uit de designcontrole van 23-11-2026.
- `site.css`: prijsblok (`trip__additional-costs`/`trip__offer-date` volle breedte, regelhoogte 1,5), reisleider
  (`guide__year` zonder negatieve marge, ruimte boven `guide__stats`, `.page-content` in een flex-kolom met
  `min-width: 0`, stempel binnen het scherm), zoekfilter (breedtes per vak vanaf 1025 px, binnenmarge op mobiel),
  reisdetail (terug-link en tekstkolom op de rand van de titel), kenmerken als raster met icoon en naam, klikdoelen
  ≥ 24 px (reisgegevens) en 44 px (telefoonnummer) op mobiel.
- `site/trip-view.js`: `compactTripTypes` toont de naam zichtbaar (`trip-type__label`) in plaats van alleen voor
  schermlezers.
- `tools/import-wordpress.js`: `withoutLeftoverCategories` slaat ongebruikte plaatshouders, namen zonder hoofdletter en
  dubbelen van een gebruikte categorie over; bestaande rijen ruimt kantoor op in Reistypes en landen.
