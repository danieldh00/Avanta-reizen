---
titel: Servertaak schijf
---

## Nieuws
- Nieuwe servertaak `schijf`: laat zien waar de schijfruimte op de server zit en ruimt na bevestiging de oude
  Docker-buildcache en oude images op. Te vinden onder Beheer > Systeem > Servertaken.

## Changelog
- `deploy/apps01/servertaken.sh schijf`: ruimte per onderdeel (schijf, Docker per soort, volumes van de eigen
  containers, back-ups, foto's, journal, `/var/log`); na bevestiging `docker builder prune --filter until=168h` en
  `docker image prune` op het label van de stack. Uitleg in Beheer > Servertaken en README.
