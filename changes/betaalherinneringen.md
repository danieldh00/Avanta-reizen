---
titel: Betaalherinneringen aan de reiziger
---

## Nieuws
- Op de betaalpagina van een aanmelding stuur je met één knop een herinnering met het openstaande bedrag en de
  betaalinstructie. Wil je dat de app dat zelf doet bij een te late betaling, zet dan in Beheer > CRM > Betalingen
  *Automatisch herinneren* aan.

## Changelog
- Migratie 27: `payment_reminders` (termijn, handmatig/automatisch, gelukt of foutmelding zonder adres, wie, wanneer).
- `crm/payment-reminders.js`: herinnering voor de aanbetaling of het restant (te laat of de eerstvolgende), adres van
  de persoon of anders van het formulier, poging eerst vastgelegd onder slot van de aanmelding; dagelijkse ronde met
  `paymentReminderAuto` (standaard uit), `paymentReminderEveryDays` en `paymentReminderMax`.
- Betaalpagina: knop *Herinnering sturen* en lijst met herinneringen; geen mailserver 503, dubbel 409, geannuleerd of
  niets open 422, mislukt 502; audit `betaling.herinnering`; limiet 30 per medewerker per 10 minuten.
- Betaaloverzicht en Excel-export: kolom *Laatste herinnering*.
