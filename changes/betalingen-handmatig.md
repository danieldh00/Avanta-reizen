---
titel: Betalingen per aanmelding registreren
bump: minor
---

## Nieuws
- Per aanmelding zie je in het CRM wat er verwacht wordt (reissom, SGR-garantie, boekingskosten, kortingen) en wat er
  is betaald, met het openstaande saldo, de aanbetaling en de vervaldatums. Kantoor en boekhouding registreren een
  betaling met één formulier; een bevestigde aanmelding gaat dan vanzelf naar aanbetaald of betaald.

## Changelog
- Migratie 26: `booking_charges` (verwachte bedragen), `payments` (ontvangen betalingen, nooit wijzigen of
  verwijderen; correctie met toelichting) en `bookings.deposit_cents`. Bestaande aanmeldingen krijgen reissom, SGR en
  boekingskosten zoals het formulier ze toonde.
- `crm/payments.js`: bedragen lezen, saldo, aanbetaling, vervaldatums, betaalstatus en achterstand berekenen.
- `/app/betalingen/<aanmelding>/` (recht `betalingen`): betaling registreren, korting/annuleringskosten/overig
  toevoegen of weghalen, controle op dubbel of verouderd formulier (409), automatische statusovergang met historie,
  audit zonder bedragen. Betaalstand op de pagina van de aanmelding.
- Instellingen `paymentDepositDays` en `paymentBalanceDaysBefore` (Beheer > CRM > Betalingen).
- Aanmeldformulier zet de verwachte bedragen en de aanbetaling van de reis bij de aanmelding.
- AVG: anonimiseren wist toelichtingen bij betalingen en bedragen; geannuleerde aanmeldingen met een betaling worden
  niet meer verwijderd; inzage-export krijgt een blad *Betalingen*.
