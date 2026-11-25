---
titel: Staging toont zelf of ze is bijgewerkt
---

## Nieuws
- Op de stagingomgeving toont Beheer > Systeem > Updates en onderhoud nu welke branch ze volgt, welke commit er draait, wanneer ze is bijgewerkt en wanneer er voor het laatst is gecontroleerd. Eerder stond daar de tekst van een server zonder updates.

## Changelog
- `system/system-update.js`: leest `staging.json` uit `STAGING_STATUS_DIR` (gesaneerd: branch, commits, tijdstippen); `beheer/update-routes.js` toont die stand in plaats van het updateblok.
- `deploy/staging/install-staging.sh` schrijft `status/staging.json` bij elke run (ook als er niets te doen is) en na elke uitrol; `compose.yml` koppelt de map alleen-lezen in de app.
- De slottekst van het script noemt de testgebruikers en het inlogadres in plaats van een installatiecode (staging heeft na de testdata al gebruikers).
- Tests: `test/system-update.test.js` en `tests/deploy-staging.test.js`.
