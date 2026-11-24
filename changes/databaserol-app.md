---
titel: Eigen databaserol voor de app
---

## Changelog
- apps01 en nieuwe servers: de app verbindt als `avanta_app` in plaats van als de superuser `avanta`. De rol is
  eigenaar van de database en het schema (migraties blijven werken), maar mag geen rollen of databases maken en geen
  bestanden of programma's op de databaseserver gebruiken (A08).
- `install.sh` maakt `APP_DB_PASSWORD` aan in `.env` en richt de rol bij elke installatie en update in met
  `deploy/apps01/app-rol.sql` (herhaalbaar; bestaande tabellen, reeksen, typen en functies gaan over naar de rol).
  Er is geen handmatige stap op de server nodig. Back-ups en herstellen werken als `avanta_app`, ook met oude back-ups.
