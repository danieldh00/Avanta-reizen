---
titel: Bevestiging aan de reiziger na een aanmelding
---

## Nieuws
- Wie zich aanmeldt voor een reis krijgt meteen een bevestiging per mail: referentie, reisgegevens, bedragen en de betaalinstructie. De tekst van de betaalinstructie pas je aan in Beheer > E-mail > Bevestiging aan de reiziger.

## Changelog
- `mail/notifications.js`: `bookingConfirmation` stuurt na een aanmelding een mail aan de reiziger (soort `bevestiging-aanmelding`) met referentie, reis, vertrek, betaalkeuze, bedragen (reissom, SGR, boekingskosten alleen bij de aanbetaling, totaal, aanbetaling van de reis, bijkomende kosten) en de betaalinstructie; nooit bijzondere gegevens. Gooit nooit en wacht niet op de mailserver.
- Instellingen `bookingConfirmEnabled` en `bookingPaymentText` in de nieuwe sectie *E-mail > Bevestiging aan de reiziger*.
- `SGR_CENTS` en `BOOKING_FEE_CENTS` staan nu in `booking/fields.js` (ook nog geëxporteerd door `booking/routes.js`); bij het opslaan van een aanmelding komt de aanbetaling van de vergrendelde reis mee.
