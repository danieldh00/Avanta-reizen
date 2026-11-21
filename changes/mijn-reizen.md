---
titel: Mijn reizen en Mijn gegevens in het reizigersaccount
---

## Nieuws
- In je account onder /account/ zie je je komende en eerdere reizen met status en betaalstand. Onder Mijn gegevens download je je gegevens als Excel en wijzig je je wachtwoord; daarvoor vragen we eerst een code per e-mail.

## Changelog
- `account/my-trips.js`: Mijn reizen (aanmeldingen op het bevestigde e-mailadres, komend/eerder, link naar de reis als die online staat) en Mijn gegevens (gewone gegevens van de laatste aanmelding; nooit bijzondere gegevens).
- Code per e-mail (`customer_tokens` met soort `code`: zes cijfers, 10 minuten, 5 pogingen, 3 per uur) zet `customer_sessions.step_up_until` op een kwartier; vereist voor `/account/gegevens/export.xlsx` en `/account/wachtwoord/`.
- `export/xlsx.js`: .xlsx-schrijver zonder extra pakket (inline strings, getallen, vette kop, formule-injectie onschadelijk).
- Auditacties `reiziger.code-*`, `reiziger.export`, `reiziger.wachtwoord-gewijzigd`.
