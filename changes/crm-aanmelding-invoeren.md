---
titel: Aanmelding handmatig invoeren in het CRM
---

## Nieuws
- Kantoor kan een aanmelding die per telefoon, mail of op papier binnenkomt zelf invoeren: knop **Aanmelding
  invoeren** bij Aanmeldingen. Eerst kies je de reis, daarna vul je dezelfde gegevens in als op het aanmeldformulier van
  de site, met dezelfde controles (ook de toestemming van een ouder of voogd onder de 16).
- Je kiest hoe de aanmelding binnenkwam; dat staat daarna in de historie. De bevestiging aan de deelnemer gaat alleen
  als je dat aanvinkt.

## Changelog
Pakket P4.2 (bevinding F02).
- `booking/manual-routes.js`: `/app/aanmeldingen/nieuw/` (recht `aanmeldingen` plus `deelnemers.wijzigen`,
  `gegevens.identiteit`, `gegevens.gezondheid`); velden uit `FIELD_GROUPS` met `validateBooking`, kerkgenootschap alleen
  met `gegevens.religie` (anders genegeerd), bron en toelichting naar `booking_events`, audit `aanmelding.handmatig`,
  bevestiging naar keuze; een bestaande aanmelding voor dezelfde reis, e-mail en achternaam houdt het opslaan tegen
  (409, onder het slot op de reis) tot *Toch opslaan* is aangevinkt. Formuliergrootte voor dit pad in `crm/routes.js` gelijk aan `/aanmelden/`.
- `booking/save-booking.js`: het opslaan (slot op de reis, persoon, aanmelding, bedragen, toestemmingen, nieuwe
  referentie bij een botsing) uit `booking/routes.js` gehaald en gedeeld; gedrag van het formulier ongewijzigd.
- `server.js` geeft `notifications` door aan het CRM.
