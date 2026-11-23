---
titel: Inloggen op het reizigersaccount werkt weer in Chrome
---

## Nieuws
- Inloggen, registreren en wachtwoord herstellen op het reizigersaccount werken weer in Chrome, net als de knop
  *Betalen met iDEAL* op de betaalpagina.

## Changelog
- `/account/` en de betaalpagina `/betalen/` sturen `Referrer-Policy: same-origin` in plaats van `no-referrer`. Bij
  `no-referrer` stuurt Chrome bij een formulier `Origin: null`, waardoor de herkomstcontrole elke POST weigerde (403).
  Links met een token lekken nog steeds niet als Referer naar een andere site.
- `isCrossSite` (`security/form-guard.js`) accepteert `Origin: null` alleen als de browser `Sec-Fetch-Site: same-origin`
  meldt; zonder die kop blijft het een verzoek van een andere site.
- Tests bootsen het verzoek van Chrome na (`Origin: null` met en zonder `Sec-Fetch-Site`).
