---
titel: Hersteltest zet ook een grote back-up terug
---

## Nieuws
- De hersteltest van de back-ups slaagt weer nu de foto's in de database staan.

## Changelog
- `deploy/apps01/restore-test.sh`: de wegwerpdatabase gebruikt een anoniem volume op schijf in plaats van tmpfs. tmpfs
  telt mee in de geheugenlimiet van de container (768 MB). Met de foto's in de database (enkele honderden MB) stopte
  de kernel PostgreSQL midden in het terugzetten ("server closed the connection unexpectedly"). Het volume verdwijnt
  bij het opruimen met de container (`docker rm -v`).
- Test bewaakt dat de data niet weer in tmpfs komt.
