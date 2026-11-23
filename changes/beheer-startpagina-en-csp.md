---
titel: Startpagina van Beheer en een strengere Content-Security-Policy
---

## Nieuws
- Beheer opent met een startpagina: de stand van de bewaking, de laatste back-up, de versie en open servertaken, en
  daaronder elk onderwerp als kaart met zijn onderdelen. Zoeken beperkt ook de kaarten.
- De lange tabel met alle instellingen staat nu op een eigen pagina: *Alle instellingen en hun bron*. Het
  systeemoverzicht (versie, database, laatste migratie) blijft onder Systeem.

## Changelog
`/app/beheer/` toont `renderStart` (vervolgplan P1.5, bevinding B04); `/app/beheer/overzicht/` het systeemoverzicht en
de nieuwe sectie `/app/beheer/instellingen/` de instellingen met hun bron. De Content-Security-Policy heeft
`style-src 'self'` zonder `'unsafe-inline'` en staat alleen nog het `style`-attribuut toe via `style-src-attr`
(achtergrondfoto's op de publieke site); op de formulierpagina's met reCAPTCHA komt `style-src-elem 'unsafe-inline'`
erbij (bevinding A22, deels: het attribuut blijft tot de achtergrondfoto's zijn omgebouwd). Geen migratie.
