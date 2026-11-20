---
titel: Onzichtbare captcha op het contact- en aanmeldformulier
---

## Nieuws
- Het contact- en aanmeldformulier kunnen een onzichtbare captcha (Google reCAPTCHA v3) krijgen tegen spam, naast de
  bestaande beveiliging. Instellen in Beheer > Toegang en beveiliging > Captcha op formulieren; standaard uit.

## Changelog
- `security/captcha.js`: controle van het token bij Google (vast adres), met minimale score, juiste actie per
  formulier en een keuze bij een onbereikbaar Google (doorlaten of blokkeren met 503). Alleen actief met schakelaar,
  geldige sitesleutel en geheim; anders niets van Google in de pagina en de CSP ongewijzigd.
- De CSP krijgt de reCAPTCHA-adressen alleen op `/contact/` en `/aanmelden/`, nooit in het CRM. `public/js/captcha.js`
  laadt Google pas als iemand het formulier invult en zet vlak voor het verzenden een vers token in het formulier.
- De controle komt na honeypot, tijdstempel en veldcontrole: een ongeldig formulier kost geen verzoek aan Google.
- Beheer: instellingen `captchaEnabled`, `captchaSiteKey`, `captchaSecret` (versleuteld), `captchaMinScore`,
  `captchaOnUnreachable`; status, controle van de geheime sleutel (10 per tien minuten) en de laatste 20 uitkomsten
  (zonder tokens of IP-adressen).
