---
titel: Diensten en achtergrondtaken in services.js
---

## Changelog
Modulestructuur, stap 4 (geen gedragswijziging). Herstel: de testdata (`src/dev/seed/seed.js` en `test/seed.test.js`)
verwees nog naar `crm/persons` en `crm/payments`, die in de vorige stap zijn verplaatst; de test faalde daardoor op
`main`. Verder: het aanmaken van alle gedeelde diensten (instellingen, logboek,
captcha, menu's, mail, back-ups, Google Drive, hersteltest, bewaking, AVG-opschoning, betalingen, reizigersaccounts)
is van `app/src/server.js` naar `app/src/services.js` verhuisd (`createServices`), gegroepeerd per module; de timers
en planners starten in `startBackgroundTasks`. `server.js` (408 → 299 regels) bevat alleen nog de beveiligingskoppen,
de volgorde van de middleware en de routes. De diensten staan onder dezelfde namen op `app.locals`; volgorde van
middleware en routes is ongewijzigd.
