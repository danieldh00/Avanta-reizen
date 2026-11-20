---
titel: Versleutelde dagelijkse back-ups
---

## Nieuws
- Beheer > Back-ups en herstel: de app maakt elke nacht een versleutelde back-up van de database, met een overzicht,
  een knop *Nu een back-up maken* en downloaden. Ook vóór elke update komt er automatisch een back-up.

## Changelog
- `app/src/backup/backups.js`: `pg_dump -Fc` als stroom door AES-256-GCM (sleutel via HKDF van de hoofdsleutel,
  sleutel-id in de kop), controle na het maken, bewaartermijn (nieuwste drie blijven), statusbestand en planner (elk
  kwartier; dagelijks op het ingestelde uur in Europe/Amsterdam, na een fout een uur wachten). Het wachtwoord gaat via
  `PGPASSWORD`, nooit in de argumenten.
- `app/src/backup/cli.js`: `create [--update]`, `list`, `decrypt <back-up> <doel>`; maakt nooit een nieuwe hoofdsleutel.
- Beheer: sectie *Back-ups* (instellingen `backupEnabled`, `backupHour`, `backupKeepDays`), *Nu maken* (op de
  achtergrond, 6 per uur), downloaden (10 per uur),
  lijst; maken en downloaden in het auditlog.
- Image: `postgresql17-client`; `deploy/apps01/update.sh` maakt vóór elke update een back-up; CI installeert de
  PostgreSQL 17-client voor de tests en controleert `pg_dump` in het image.
- Eerste versie van `docs/DRAAIBOEK-VPS-VERHUIZING.md` (terugzetten van een back-up).
