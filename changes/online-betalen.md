---
titel: Online betalen via Mollie (iDEAL)
---

## Nieuws
- Reizigers kunnen het openstaande bedrag online betalen met iDEAL via een persoonlijke betaallink in de
  betaalherinnering. Een geslaagde betaling komt vanzelf bij de betalingen van de aanmelding. Standaard staat dit uit;
  aanzetten in Beheer > CRM > Online betalen met een sleutel uit je Mollie-account (begin met een testsleutel).

## Changelog
- Migratie 28: `online_payments` (Mollie-id, termijn, bedrag, stand, betaald op).
- `crm/mollie.js`: koppeling met de Mollie-API (vast adres, sleutel nooit in fouten of logboek), instellingen
  `mollieEnabled` en `mollieApiKey` (geheim).
- `crm/online-payments.js` en `crm/online-payment-routes.js`: betaallink `/betalen/<id>-<token>/` (HMAC), betaling
  starten met herkomstcontrole en limiet, terugkeerpagina, webhook `/betalen/webhook/` die de betaling zelf opvraagt en
  een geslaagde betaling één keer registreert (status schuift door).
- Betaalherinnering: knop *online betalen* (mail-opmaak kreeg een optionele knop, alleen https). Betaalpagina in het
  CRM: betaallink en lijst met online betalingen.
