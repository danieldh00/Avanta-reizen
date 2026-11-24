---
titel: Hersteltest zet ook een grote back-up terug
---

## Nieuws
- De hersteltest van de back-ups slaagt weer nu de foto's in de database staan.

## Changelog
- `deploy/apps01/restore-test.sh`: de wegwerpdatabase staat in een eigen Docker-volume op schijf in plaats van tmpfs.
  tmpfs telt mee in de geheugenlimiet van de container (768 MB). Met de foto's in de database (enkele honderden MB)
  stopte de kernel PostgreSQL midden in het terugzetten ("server closed the connection unexpectedly").
- Containers, volume en netwerk van de test krijgen een label; het volume verdwijnt bij het opruimen, en resten van een
  afgebroken run (stroomuitval, kill) ruimt de volgende run eerst op, zodat er geen onversleutelde kopie achterblijft.
- `docs/avg/VERWERKINGSREGISTER.md`: de tijdelijke kopie tijdens de hersteltest beschreven.
- Test bewaakt dat de data niet weer in tmpfs komt en dat resten worden opgeruimd.
