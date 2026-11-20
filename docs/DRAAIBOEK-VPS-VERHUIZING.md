# Draaiboek: back-up terugzetten en verhuizen naar een andere server

Stand: 20-11-2026 (pakket C). Dit draaiboek groeit mee met pakket C: de verhuisstappen volgen in C4.

## Wat je nodig hebt
| Onderdeel | Waar | Waarom |
|---|---|---|
| Een back-up `avanta-JJJJMMDD-UUMMSS.dump.enc` | Beheer > Back-ups en herstel > Back-ups (downloaden) of `/data/backups` in volume `avanta_app-data` | de hele database (pg_dump), versleuteld |
| De hoofdsleutel `AVANTA_MASTER_KEY` | `.env` naast `docker-compose.yml` op de server, en een kopie in de wachtwoordkluis | zonder sleutel zijn de back-up én de versleutelde aanmeldvelden onleesbaar |
| Het sleutel-id | Beheer > Back-ups (bijv. `3fa1…`) | controle dat je de juiste hoofdsleutel hebt |

Afbeeldingen (`/data/media`) zitten niet in de back-up; die komen opnieuw uit de import van de huidige site.

## Een back-up terugzetten (zelfde server)

Op apps01, in `/opt/apps/avanta/repo/deploy/apps01`, met de naam van de back-up uit Beheer:

```sh
NAAM=avanta-JJJJMMDD-UUMMSS.dump.enc
# 1. Ontsleutelen in het volume (de tag wordt gecontroleerd; bij een verkeerde sleutel of beschadiging stopt dit).
docker compose exec -T app node src/backup/cli.js decrypt "$NAAM" /data/backups/herstel.dump
# 2. App stoppen, database terugzetten in één transactie (mislukt er iets, dan blijft alles zoals het was), dump weg.
docker compose stop app
docker compose run --rm --no-deps --entrypoint sh app -c \
  'pg_restore --clean --if-exists --no-owner --no-acl --single-transaction -d "$DATABASE_URL" /data/backups/herstel.dump; status=$?; rm -f /data/backups/herstel.dump; exit $status'
# 3. App weer starten; migraties van een nieuwere versie lopen daarbij vanzelf.
docker compose start app
```

Een back-up van buiten de server (download): eerst in het volume zetten met
`docker compose cp ./avanta-….dump.enc app:/data/backups/` en dan stap 1 tot en met 3.

Let op: een back-up van een **nieuwere** versie van de app terugzetten in een oudere versie kan niet (migraties lopen
alleen vooruit); werk eerst de app bij.
