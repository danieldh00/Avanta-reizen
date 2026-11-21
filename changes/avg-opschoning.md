---
titel: AVG-opschoning met instelbare bewaartermijnen
bump: minor
---

## Nieuws
- Het CRM schoont elke dag zelf persoonsgegevens op volgens de bewaartermijnen: bijzondere en paspoortgegevens een maand na terugkomst, personen twee jaar na de laatste reis (geanonimiseerd), geannuleerde aanmeldingen zonder betaling na zes maanden en oude contactberichten na een jaar. De termijnen, een voorbeeld en *Nu opschonen* staan in Beheer > AVG en bewaartermijnen.

## Changelog
- Migratie 25: `persons.blocks_purged_at`, `persons.anonymized_at`, `bookings.anonymized_at`, tabel `retention_runs` en indexen voor de opschoning.
- `crm/retention.js`: dagelijkse ronde (eerste na vijf minuten) met regels voor blokken (geboortedatum blijft), anonimiseren van personen en hun aanmeldingen (ook notities in `booking_events`), losse aanmeldingen, geannuleerd zonder (aan)betaling, aanmeldingen na de fiscale termijn, anonieme personen zonder aanmeldingen, ongebruikte reizigersaccounts en contactberichten. Per record een eigen transactie met rijvergrendeling en hercontrole van de termijn; alleen aantallen in `retention_runs` en het logboek.
- Instellingen `retentionEnabled`, `retentionSpecialMonths`, `retentionPersonMonths`, `retentionCancelledMonths`, `retentionBookingYears`, `retentionContactMonths` in een nieuwe sectie *AVG en bewaartermijnen*, met paneel (`beheer/retention-routes.js`): laatste rondes, *Voorbeeld berekenen*, *Nu opschonen* (audit `avg.opschonen`, limiet 10 per tien minuten).
- Deelnemers: badge *geanonimiseerd*, melding op de detailpagina en een geanonimiseerde persoon is niet meer te wijzigen (409).
