#!/usr/bin/env bash
# Hersteltest van de back-ups op apps01 (Beheer > Back-ups en herstel > Hersteltest). Draait als root, gestart door
# avanta-restore-test.timer (zondag 04:30) of avanta-restore-test-now.path (knop *Nu testen* in de app).
#
# Wat het doet:
#   1. neemt de nieuwste back-up uit de app (`cli.js list`) en ontsleutelt die als stroom (geen ontsleuteld dumpbestand);
#   2. zet die terug in een wegwerp-PostgreSQL 17 (eigen container, intern netwerk zonder uitgang, geheugenlimiet,
#      opslag in een eigen volume dat bij het opruimen verdwijnt; resten van een afgebroken run ruimt de
#      volgende run op);
#   3. start het huidige app-image tegen die database (zelfde intern netwerk: geen mail of andere verbindingen naar
#      buiten) en controleert /api/health en de homepage; migraties van een nieuwere versie lopen daarbij mee;
#   4. telt de rijen per tabel in de teruggezette en de echte database;
#   5. geeft de metingen aan de app (`cli.js restore-test-result`), die de uitslag bepaalt en toont, en ruimt altijd
#      alles op (ook bij een fout).
# Logboek: journalctl -u avanta-restore-test -u avanta-restore-test-now
set -uo pipefail

BASE_DIR="${BASE_DIR:-/opt/apps/avanta}"
STACK_DIR="$BASE_DIR/repo/deploy/apps01"
TRIGGER="${1:-schema}"
[[ "$TRIGGER" == "handmatig" ]] || TRIGGER="schema"
PG_IMAGE="${PG_IMAGE:-postgres:17@sha256:223efeb196329b55b3b9a13db144956411dbc18e727e59f681c3e0aede6475cf}"
DB_MEMORY="${DB_MEMORY:-768m}"
# De wegwerp-app zet bij het starten alle foto's uit de database terug op schijf (kleinere varianten opnieuw gemaakt)
# en maakt na een minuut een back-up; met de foto's in de database is 384 MB daarvoor te krap.
APP_MEMORY="${APP_MEMORY:-768m}"
APP_WAIT_SEC="${APP_WAIT_SEC:-120}"
SUFFIX="$$"
DB_CONTAINER="avanta-hersteltest-db-$SUFFIX"
APP_CONTAINER="avanta-hersteltest-app-$SUFFIX"
NETWORK="avanta-hersteltest-$SUFFIX"
DB_VOLUME="avanta-hersteltest-data-$SUFFIX"
# Label op alles wat de test aanmaakt (containers, netwerk, volume): zo ruimt een volgende run ook resten van een
# afgebroken run op (SIGKILL, stroomuitval), waarin de teruggezette database anders op schijf zou blijven staan.
TEST_LABEL="nl.avantareizen.hersteltest=1"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
BACKUP=""
RESTORE_ERRORS="$(mktemp)"
DECRYPT_ERRORS="$(mktemp)"
APP_OUTPUT="$(mktemp)"

log() { echo "[$(date '+%F %T')] $*"; }

cd "$STACK_DIR" || { echo "Map $STACK_DIR ontbreekt." >&2; exit 1; }
exec 9>/run/avanta-restore-test.lock
flock -n 9 || { log "Er loopt al een hersteltest."; exit 0; }

app_exec() { docker compose exec -T app "$@"; }

cleanup() {
  docker rm -f -v "$APP_CONTAINER" >/dev/null 2>&1 || true
  docker rm -f -v "$DB_CONTAINER" >/dev/null 2>&1 || true
  docker volume rm -f "$DB_VOLUME" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  rm -f "$RESTORE_ERRORS" "$DECRYPT_ERRORS" "$APP_OUTPUT"
}
trap cleanup EXIT

# cleanup_leftovers: containers, volumes en netwerken met het testlabel van een eerdere, afgebroken run weghalen. Veilig
# omdat de flock hierboven garandeert dat er geen andere hersteltest loopt.
cleanup_leftovers() {
  local ids
  ids="$(docker ps -aq --filter "label=$TEST_LABEL")"
  [[ -n "$ids" ]] && docker rm -f -v $ids >/dev/null 2>&1
  ids="$(docker volume ls -q --filter "label=$TEST_LABEL")"
  [[ -n "$ids" ]] && docker volume rm -f $ids >/dev/null 2>&1
  ids="$(docker network ls -q --filter "label=$TEST_LABEL")"
  [[ -n "$ids" ]] && docker network rm $ids >/dev/null 2>&1
  return 0
}
cleanup_leftovers

# record <json-velden>: geeft de uitslag aan de app. Alleen vaste teksten, getallen en door de app gecontroleerde namen.
record() {
  printf '{"trigger":"%s","startedAt":"%s","backup":"%s",%s}' "$TRIGGER" "$STARTED_AT" "$BACKUP" "$1" \
    | app_exec node src/backup/cli.js restore-test-result || log "Uitslag vastleggen mislukt."
}
fail() { log "MISLUKT: $1"; record "\"state\":\"mislukt\",\"message\":\"$1\""; exit 1; }

# restore_lines <bestand>: de fout- en waarschuwingsregels van pg_restore zonder rijgegevens, één per regel. Alleen
# regels "pg_restore: error|warning: …" (DETAIL/CONTEXT/Command kunnen waarden uit de back-up bevatten en vallen weg);
# tekst tussen aanhalingstekens blijft alleen staan als het een naam van een tabel, kolom of schema is, andere waarden
# worden "…". Geen tekens die de JSON van record() kunnen breken.
restore_lines() {
  grep -E '^pg_restore: (error|warning):' "$1" \
    | sed -E 's/^pg_restore: //; s/"([a-z_][a-z0-9_]{0,62})"/\x27\1\x27/g; s/"[^"]*"/…/g' \
    | tr -d '"\\' | sed -E 's/[[:cntrl:]]+/ /g; s/  +/ /g' | cut -c 1-240
}

# restore_error <bestand>: de eerste foutregel uit restore_lines, zonder "error: ", voor de melding in Beheer.
restore_error() {
  restore_lines "$1" | grep -m 1 '^error: ' | sed 's/^error: //; s/ *$//'
}

# decrypt_error <bestand>: de melding van `cli.js decrypt` ("Mislukt: …", eigen tekst van de app zonder gegevens uit de
# back-up) als korte tekst zonder tekens die de JSON van record() kunnen breken.
decrypt_error() {
  grep -m 1 '^Mislukt: ' "$1" | sed -E 's/^Mislukt: //' | tr -d '"\\' | sed -E 's/[[:cntrl:]]+/ /g; s/  +/ /g; s/ *$//' \
    | cut -c 1-240
}

# restore_failure <code ontsleutelen> <code pg_restore> <stderr ontsleutelen> <stderr pg_restore>: de melding voor
# de stap die echt mislukte, of niets als beide slaagden. Stopt pg_restore bij een fout, dan krijgt het ontsleutelen een
# gesloten pijp en eindigt het ook met een fout: in de app als EPIPE, of zonder melding als `docker compose exec` zelf
# door SIGPIPE stopt (code 141). Het ontsleutelen is daarom alleen de oorzaak als cli.js een eigen fout meldt (geen
# EPIPE), of als pg_restore slaagde of alleen een te kort bestand kreeg.
restore_failure() {
  local decrypt_detail restore_detail
  decrypt_detail="$(decrypt_error "$3")"
  restore_detail="$(restore_error "$4")"
  if [[ "$1" != 0 && -n "$decrypt_detail" && "$decrypt_detail" != *EPIPE* ]]; then
    echo "Ontsleutelen mislukt: $decrypt_detail"
  elif [[ "$2" != 0 && ( "$1" == 0 || "$restore_detail" != *'input file is too short'* ) ]]; then
    echo "Terugzetten met pg_restore mislukt${restore_detail:+: $restore_detail}"
  elif [[ "$1" != 0 ]]; then
    echo "Ontsleutelen mislukt (code $1)${decrypt_detail:+: $decrypt_detail}"
  fi
}

# app_error <bestand met de uitvoer van de app>: de eigen foutmelding van de app bij het starten ("Starten mislukt: …" of
# "Onverwerkte fout: …"). De tekst na de soort fout kan waarden bevatten (een melding van PostgreSQL, een pad), dus
# alleen woorden blijven staan: namen tussen aanhalingstekens blijven, andere tekst tussen aanhalingstekens of haakjes en
# elk woord met een cijfer, @, / of = wordt "…". Geen tekens die de JSON van record() kunnen breken.
app_error() {
  grep -m 1 -E '^(Starten mislukt|Onverwerkte fout): ' "$1" \
    | sed -E 's/"([a-z_][a-z0-9_]{0,62})"/\x27\1\x27/g; s/"[^"]*"/…/g; s/\([^)]*\)/(…)/g' \
    | sed -E 's/[^[:space:]]*[0-9@\/=][^[:space:]]*/…/g' \
    | tr -d '"\\' | sed -E 's/[[:cntrl:]]+/ /g; s/  +/ /g; s/ *$//' | cut -c 1-240
}

# app_failure <status> <oom> <exitcode> <health gezien: 0/1> <uitvoer van de app>: waarom de wegwerp-app niet bruikbaar
# was, als korte tekst voor de melding in Beheer.
app_failure() {
  local detail
  detail="$(app_error "$5")"
  if [[ "$2" == true ]]; then
    echo "geheugenlimiet van de wegwerp-app ($APP_MEMORY) bereikt${detail:+; $detail}"
  elif [[ "$1" != running ]]; then
    echo "de app stopte (code $3)${detail:+: $detail}"
  elif [[ "$4" == 1 ]]; then
    echo "/api/health werkt, maar de homepage geeft geen HTML"
  else
    echo "geen antwoord van /api/health binnen $APP_WAIT_SEC s${detail:+; $detail}"
  fi
}

# Eerst "bezig" vastleggen: zo ziet Beheer meteen een lopende test en vraagt een tweede klik geen extra run aan.
record '"state":"bezig"'
# Het verzoek van de knop weghalen (de service doet dat al vóór de start; dit is voor een handmatige run).
app_exec rm -f /data/backups/restore-test-now >/dev/null 2>&1 || true

BACKUP="$(app_exec node src/backup/cli.js list | head -n 1 | cut -f 1)"
[[ "$BACKUP" =~ ^avanta-[0-9]{8}-[0-9]{6}\.dump\.enc$ ]] || { BACKUP=""; fail "Geen back-up gevonden op de server."; }
log "Hersteltest met $BACKUP ($TRIGGER)."

docker network create --internal --label "$TEST_LABEL" "$NETWORK" >/dev/null || fail "Testnetwerk maken mislukt."
# Opslag op schijf in een eigen volume met het testlabel (cleanup en cleanup_leftovers ruimen het op), niet in tmpfs: tmpfs telt mee in de
# geheugenlimiet van de container, en met de foto's in de database (enkele honderden MB) stopte de kernel PostgreSQL
# midden in het terugzetten ("server closed the connection unexpectedly"). De echte database staat ook op schijf.
docker volume create --label "$TEST_LABEL" "$DB_VOLUME" >/dev/null || fail "Testvolume maken mislukt."
docker run -d --name "$DB_CONTAINER" --label "$TEST_LABEL" --network "$NETWORK" --network-alias db --memory "$DB_MEMORY" \
  --mount "type=volume,src=$DB_VOLUME,dst=/var/lib/postgresql/data" -e POSTGRES_PASSWORD=hersteltest "$PG_IMAGE" >/dev/null \
  || fail "Wegwerpdatabase starten mislukt."
ready=0
for _ in $(seq 1 60); do
  # Via TCP: de tijdelijke server van het opstartscript van het image luistert alleen op de socket en stopt daarna
  # weer; pas de echte server is via 127.0.0.1 bereikbaar.
  if docker exec "$DB_CONTAINER" pg_isready -h 127.0.0.1 -U postgres -d postgres >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]] || fail "Wegwerpdatabase werd niet gereed."
sleep 2

# Ontsleutelen als stroom en in één transactie terugzetten. Een fout in de tag komt pas aan het eind (code van cli.js).
# Dezelfde opties als bij een echt herstel (restore-backup.sh): de dump is van één schema (`pg_dump --schema=public`)
# en bevat daardoor `CREATE SCHEMA public`; zonder --clean --if-exists botst dat met het lege schema public van een
# nieuwe database ("schema public already exists") en breekt de hele transactie af.
app_exec node src/backup/cli.js decrypt "$BACKUP" - 2>"$DECRYPT_ERRORS" \
  | docker exec -i "$DB_CONTAINER" pg_restore -U postgres -d postgres --clean --if-exists --no-owner --no-acl \
    --single-transaction 2>"$RESTORE_ERRORS"
statuses=("${PIPESTATUS[@]}")
failure="$(restore_failure "${statuses[0]}" "${statuses[1]}" "$DECRYPT_ERRORS" "$RESTORE_ERRORS")"
if [[ -n "$failure" ]]; then
  # Alle fout- en waarschuwingsregels van pg_restore in het hostlog (journalctl), net als de melding zonder rijgegevens.
  restore_lines "$RESTORE_ERRORS" >&2
  # De stderr van het ontsleutelen volledig: alleen meldingen van cli.js en Docker, de dump zelf gaat naar stdout.
  cat "$DECRYPT_ERRORS" >&2
  fail "$failure"
fi

COUNT_SQL="SELECT coalesce(string_agg(format('%s=%s', c.relname, (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', c.relname), false, true, '')))[1]::text), ',' ORDER BY c.relname), '') FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'"
restored="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -Atc "$COUNT_SQL" | tr -cd 'a-z0-9_=,')"
schema="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -Atc 'SELECT coalesce(max(id), 0) FROM schema_migrations' | tr -cd '0-9')"
[[ -n "$restored" ]] || fail "Er staan geen tabellen in de teruggezette database."

# De wegwerp-app: hetzelfde image als de draaiende app, alleen in het interne netwerk.
image="$(docker inspect -f '{{.Config.Image}}' "$(docker compose ps -q app)" 2>/dev/null)"
[[ -n "$image" ]] || fail "Image van de app niet gevonden."
docker run -d --name "$APP_CONTAINER" --label "$TEST_LABEL" --network "$NETWORK" --memory "$APP_MEMORY" \
  -e DATABASE_URL="postgres://postgres:hersteltest@db:5432/postgres" -e SITE_URL="https://hersteltest.invalid" \
  -e TRUST_PROXY= "$image" >/dev/null || fail "Wegwerp-app starten mislukt."
app_ok=false
health_seen=0
for _ in $(seq 1 "$APP_WAIT_SEC"); do
  if docker exec "$APP_CONTAINER" wget -qO- http://127.0.0.1:3400/api/health 2>/dev/null | grep -q '"ok":true'; then
    health_seen=1
    docker exec "$APP_CONTAINER" wget -qO- http://127.0.0.1:3400/ 2>/dev/null | grep -qi '<html' && app_ok=true
    break
  fi
  # Gestopt (fout bij het starten, geheugenlimiet): niet de hele wachttijd blijven proberen.
  [[ "$(docker inspect -f '{{.State.Running}}' "$APP_CONTAINER" 2>/dev/null)" == true ]] || break
  sleep 1
done
app_message=""
if [[ "$app_ok" != true ]]; then
  docker logs "$APP_CONTAINER" >"$APP_OUTPUT" 2>&1 || true
  read -r app_status app_oom app_exit < <(docker inspect -f '{{.State.Status}} {{.State.OOMKilled}} {{.State.ExitCode}}' "$APP_CONTAINER" 2>/dev/null || echo "onbekend false 0")
  app_message="$(app_failure "$app_status" "$app_oom" "$app_exit" "$health_seen" "$APP_OUTPUT")"
  log "Wegwerp-app niet bruikbaar: $app_message"
fi

live="$(docker compose exec -T db psql -U avanta -d avanta -Atc "$COUNT_SQL" | tr -cd 'a-z0-9_=,')"
record "\"restored\":\"$restored\",\"live\":\"$live\",\"schemaVersion\":${schema:-0},\"appOk\":$app_ok,\"message\":\"$app_message\""
log "Klaar: app gestart=$app_ok; teruggezet: $restored"
