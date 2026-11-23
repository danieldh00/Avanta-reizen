---
titel: Testdata voor de testomgeving
---

## Nieuws
- De testomgeving kan gevuld worden met verzonnen, realistische testdata (reizen, reisleiders, deelnemers,
  aanmeldingen, betalingen, blog, FAQ, pagina's en een testgebruiker per rol), en die ook weer verwijderen.

## Changelog
- Nieuw: `app/src/dev/seed/` (`data.js`, `seed.js`, `cli.js`) met de opdrachten `vullen`, `opnieuw` en `verwijderen`
  (`--testomgeving` verplicht). Weigert op `avantareizen.nl` en als zoekmachines mogen indexeren; één transactie;
  personen via `crm/persons.js` (versleutelde blokken, toestemmingen), bedragen via `crm/payments.js`; statussen
  passen bij de betalingen; auditregel `testdata.<opdracht>`. Herkenbaar aan `test-`-slugs en `@example.com`-adressen.
- `deploy/apps01/servertaken.sh testdata [vullen|opnieuw|verwijderen]` met bevestigingsvraag.
- `crm/cli.js` exporteert `connectionString` voor hergebruik.
- Tests: `test/seed.test.js` (blokkade, samenhang van statussen en betalingen, echte gegevens blijven staan, site).
