#!/usr/bin/env bash
# Hersteltest van de back-ups op apps01 (Beheer > Back-ups en herstel > Hersteltest). Draait als root, gestart door
# avanta-restore-test.timer (zondag 04:30) of avanta-restore-test-now.path (knop *Nu testen* in de app).
#
# Wat het doet:
#   1. neemt de nieuwste back-up uit de app (`cli.js list`) en ontsleutelt die als stroom (niets onversleuteld op schijf);
#   2. zet die terug in een wegwerp-PostgreSQL 17 (eigen container, intern netwerk zonder uitgang, geheugenlimiet,
#      opslag in tmpfs);
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
PG_IMAGE="${PG_IMAGE:-postgres:17}"
DB_MEMORY="${DB_MEMORY:-768m}"
APP_MEMORY="${APP_MEMORY:-384m}"
APP_WAIT_SEC="${APP_WAIT_SEC:-120}"
SUFFIX="$$"
DB_CONTAINER="avanta-hersteltest-db-$SUFFIX"
APP_CONTAINER="avanta-hersteltest-app-$SUFFIX"
NETWORK="avanta-hersteltest-$SUFFIX"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
BACKUP=""

log() { echo "[$(date '+%F %T')] $*"; }

cd "$STACK_DIR" || { echo "Map $STACK_DIR ontbreekt." >&2; exit 1; }
exec 9>/run/avanta-restore-test.lock
flock -n 9 || { log "Er loopt al een hersteltest."; exit 0; }

app_exec() { docker compose exec -T app "$@"; }

cleanup() {
  docker rm -f -v "$APP_CONTAINER" >/dev/null 2>&1 || true
  docker rm -f -v "$DB_CONTAINER" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# record <json-velden>: geeft de uitslag aan de app. Alleen vaste teksten, getallen en door de app gecontroleerde namen.
record() {
  printf '{"trigger":"%s","startedAt":"%s","backup":"%s",%s}' "$TRIGGER" "$STARTED_AT" "$BACKUP" "$1" \
    | app_exec node src/backup/cli.js restore-test-result || log "Uitslag vastleggen mislukt."
}
fail() { log "MISLUKT: $1"; record "\"state\":\"mislukt\",\"message\":\"$1\""; exit 1; }

# Eerst "bezig" vastleggen: zo ziet Beheer meteen een lopende test en vraagt een tweede klik geen extra run aan.
record '"state":"bezig"'
# Het verzoek van de knop weghalen (de service doet dat al vóór de start; dit is voor een handmatige run).
app_exec rm -f /data/backups/restore-test-now >/dev/null 2>&1 || true

BACKUP="$(app_exec node src/backup/cli.js list | head -n 1 | cut -f 1)"
[[ "$BACKUP" =~ ^avanta-[0-9]{8}-[0-9]{6}\.dump\.enc$ ]] || { BACKUP=""; fail "Geen back-up gevonden op de server."; }
log "Hersteltest met $BACKUP ($TRIGGER)."

docker network create --internal "$NETWORK" >/dev/null || fail "Testnetwerk maken mislukt."
docker run -d --name "$DB_CONTAINER" --network "$NETWORK" --network-alias db --memory "$DB_MEMORY" \
  --tmpfs /var/lib/postgresql/data:rw,size=2g -e POSTGRES_PASSWORD=hersteltest "$PG_IMAGE" >/dev/null \
  || fail "Wegwerpdatabase starten mislukt."
ready=0
for _ in $(seq 1 60); do
  if docker exec "$DB_CONTAINER" pg_isready -U postgres -d postgres >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]] || fail "Wegwerpdatabase werd niet gereed."
sleep 2

# Ontsleutelen als stroom en in één transactie terugzetten. Een fout in de tag komt pas aan het eind (code van cli.js).
app_exec node src/backup/cli.js decrypt "$BACKUP" - \
  | docker exec -i "$DB_CONTAINER" pg_restore -U postgres -d postgres --no-owner --no-acl --single-transaction
statuses=("${PIPESTATUS[@]}")
[[ "${statuses[0]}" == 0 ]] || fail "Ontsleutelen mislukt (beschadigde back-up of andere hoofdsleutel)."
[[ "${statuses[1]}" == 0 ]] || fail "Terugzetten met pg_restore mislukt."

COUNT_SQL="SELECT coalesce(string_agg(format('%s=%s', c.relname, (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', c.relname), false, true, '')))[1]::text), ',' ORDER BY c.relname), '') FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'"
restored="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -Atc "$COUNT_SQL" | tr -cd 'a-z0-9_=,')"
schema="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -Atc 'SELECT coalesce(max(id), 0) FROM schema_migrations' | tr -cd '0-9')"
[[ -n "$restored" ]] || fail "Er staan geen tabellen in de teruggezette database."

# De wegwerp-app: hetzelfde image als de draaiende app, alleen in het interne netwerk.
image="$(docker inspect -f '{{.Config.Image}}' "$(docker compose ps -q app)" 2>/dev/null)"
[[ -n "$image" ]] || fail "Image van de app niet gevonden."
docker run -d --name "$APP_CONTAINER" --network "$NETWORK" --memory "$APP_MEMORY" \
  -e DATABASE_URL="postgres://postgres:hersteltest@db:5432/postgres" -e SITE_URL="https://hersteltest.invalid" \
  -e TRUST_PROXY= "$image" >/dev/null || fail "Wegwerp-app starten mislukt."
app_ok=false
for _ in $(seq 1 "$APP_WAIT_SEC"); do
  if docker exec "$APP_CONTAINER" wget -qO- http://127.0.0.1:3400/api/health 2>/dev/null | grep -q '"ok":true'; then
    docker exec "$APP_CONTAINER" wget -qO- http://127.0.0.1:3400/ 2>/dev/null | grep -qi '<html' && app_ok=true
    break
  fi
  sleep 1
done

live="$(docker compose exec -T db psql -U avanta -d avanta -Atc "$COUNT_SQL" | tr -cd 'a-z0-9_=,')"
record "\"restored\":\"$restored\",\"live\":\"$live\",\"schemaVersion\":${schema:-0},\"appOk\":$app_ok"
log "Klaar: app gestart=$app_ok; teruggezet: $restored"
