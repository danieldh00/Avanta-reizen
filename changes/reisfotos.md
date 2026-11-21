---
titel: Foto's bij een reis uit de fotobibliotheek
---

## Nieuws
- Bij een reis in het CRM kies je nu de kopfoto, de kaartfoto en de fotogalerij (met titel en volgorde) uit de
  fotobibliotheek, standaard met de foto's van het land van de reis. Je kunt ook meteen nieuwe foto's uploaden.

## Changelog
- Migratie 16: tabel `trip_media` (reis, foto, rol `kop`/`kaart`/`galerij`, volgorde; hoogstens één kop- en kaartfoto;
  `ON DELETE RESTRICT` op de foto), gevuld uit de bestaande `hero_image_url`, `card_image_url` en `gallery`.
- `app/src/trips/trip-media.js` en routes onder `/app/reizen/<id>/fotos/` en `/galerij/` (recht `reizen`, audit
  `reis.fotos`); de afgeleide fotokolommen van de reis worden bij elke wijziging opnieuw geschreven.
- Fotobibliotheek: *gebruikt in* kijkt ook naar `trip_media`; uploaden met `terug` stuurt terug naar de reis (alleen
  `/app/reizen/<id>/`).
