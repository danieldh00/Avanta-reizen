#!/usr/bin/env bash
# Bijwerken van de testomgeving op apps01. Start op twee manieren (dezelfde systemd-service avanta-update.service):
#   - de timer avanta-update.timer, elke 15 minuten: kijkt naar de nieuwste commit van AVANTA_TRACK (standaard main) en
#     installeert die zelf als "automatisch bijwerken" aan staat (Beheer > Systeem > Updates en onderhoud);
#   - de path-unit avanta-update-now.path, meteen zodra de app een aanvraag neerzet (knop "Nu updaten" of "Nu controleren").
#
# Koppeling met de app (zie app/src/system/system-update.js), map $BASE_DIR/update:
#   status/   alleen dit script schrijft hier (root); in de container alleen-lezen.
#     status.json       draaiende en beschikbare versie + commit, laatst gecontroleerd
#     run.json          stand van de laatste uitrol (bezig/geslaagd/mislukt/geweigerd, stap, melding)
#     changelog.md      app/CHANGELOG.md van de beschikbare commit (releasenotes in Beheer)
#     maintenance.json  bestaat zolang de uitrol de container wisselt: de app weigert dan schrijfverzoeken
#   request/  de app (uid 1000) schrijft hier; dit script vertrouwt de inhoud niet.
#     request.json      {"commit":"<40 hex>"}: alleen geldig als dat precies de nieuwste commit is die dit script ophaalde;
#                       {"check":true}: alleen controleren, niets installeren
#     policy.json       {"auto":false} zet automatisch bijwerken uit
#
# Uitrol: nieuwe code ophalen en het image bouwen (site draait gewoon door) → onderhoudsmodus aan → even wachten tot
# lopende verzoeken klaar zijn → versleutelde back-up → container vervangen → gezondheid en versie controleren →
# onderhoudsmodus uit. Lukt dat niet, dan terug naar de vorige commit; de mislukte commit slaat de timer over tot er een
# nieuwere is of iemand hem in de app opnieuw aanvraagt. Migraties lopen alleen vooruit: een terugval zet de code terug,
# niet de database (terugzetten: docs/DRAAIBOEK-VPS-VERHUIZING.md).
# Verandert alleen het IP van de cloudflared-container, dan zet install.sh TRUST_PROXY opnieuw (zelfde commit).
# Logboek: journalctl -u avanta-update.
set -euo pipefail

main() {
BASE_DIR="${BASE_DIR:-/opt/apps/avanta}"
REPO_DIR="$BASE_DIR/repo"
STACK_DIR="$REPO_DIR/deploy/apps01"
ENV_FILE="$STACK_DIR/.env"
STATUS_DIR="$BASE_DIR/update/status"
REQUEST_DIR="$BASE_DIR/update/request"
DRAIN_SECONDS="${DRAIN_SECONDS:-10}"   # DRAIN_SECONDS en LOCK_FILE alleen anders voor de test (tests/deploy-update.test.js)
VERSION_RE='^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$'

log() { echo "[$(date '+%F %T')] $*"; }
now() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }

exec 9>"${LOCK_FILE:-/run/avanta-update.lock}"
flock -n 9 || { log "Er loopt al een update."; exit 0; }
mkdir -p "$STATUS_DIR"

# Schrijft een bestand in de statusmap in één keer (tijdelijk bestand + mv: de app leest nooit een half bestand).
status_put() {
  local tmp
  tmp="$(mktemp "$STATUS_DIR/.tmp.XXXXXX")"
  printf '%s\n' "$2" > "$tmp"
  chmod 644 "$tmp"
  mv -f "$tmp" "$STATUS_DIR/$1"
}
# Leest een klein bestand uit de aanvraagmap van de app: geen symlink, gewoon bestand, hoogstens 4 kB.
request_read() {
  local file="$REQUEST_DIR/$1"
  [[ -f "$file" && ! -L "$file" ]] || return 0
  (( $(stat -c %s "$file") <= 4096 )) || return 0
  head -c 4096 "$file"
}

# Stand van de uitrol naar run.json. Alleen vaste teksten, gecontroleerde versies/commits en een UUID gaan erin.
RUN_STATE=""; RUN_STARTED=""; RUN_VERSION=""; RUN_COMMIT=""; REQ_ID=""; AUTOMATIC=false
run_put() { # <stand> <stap> <melding>
  local finished=""
  RUN_STATE="$1"
  [[ "$1" == "bezig" ]] || finished="$(now)"
  status_put run.json "{\"state\":\"$1\",\"step\":\"$2\",\"version\":\"$RUN_VERSION\",\"commit\":\"$RUN_COMMIT\",\"requestId\":\"$REQ_ID\",\"automatic\":$AUTOMATIC,\"startedAt\":\"$RUN_STARTED\",\"finishedAt\":\"$finished\",\"message\":\"$3\"}"
}
# Altijd bij het stoppen: onderhoudsmodus uit, en een onderbroken uitrol als mislukt melden.
on_exit() {
  rm -f "$STATUS_DIR/maintenance.json"
  if [[ "$RUN_STATE" == "bezig" ]]; then run_put mislukt klaar "De update is onderbroken. Controleer de server."; fi
}
trap on_exit EXIT

# ---------- Aanvraag uit de app: eerst lezen en weghalen (ook als hij ongeldig is), anders start de path-unit steeds opnieuw ----------
REQ_BODY="$(request_read request.json || true)"
REQ_PRESENT=0
if [[ -e "$REQUEST_DIR/request.json" || -L "$REQUEST_DIR/request.json" ]]; then REQ_PRESENT=1; rm -f "$REQUEST_DIR/request.json"; fi
REQ_COMMIT="$(grep -oE '"commit":"[0-9a-f]{40}"' <<<"$REQ_BODY" | head -n1 | cut -d'"' -f4 || true)"
REQ_ID="$(grep -oE '"id":"[0-9a-f-]{36}"' <<<"$REQ_BODY" | head -n1 | cut -d'"' -f4 || true)"
CHECK_ONLY=0
grep -qE '"check"[[:space:]]*:[[:space:]]*true' <<<"$REQ_BODY" && CHECK_ONLY=1
AUTO=1
grep -qE '"auto"[[:space:]]*:[[:space:]]*false' <<<"$(request_read policy.json || true)" && AUTO=0
if [[ "$REQ_PRESENT" == 1 && "$CHECK_ONLY" == 0 ]]; then
  RUN_STARTED="$(now)"; RUN_COMMIT="$REQ_COMMIT"
  run_put bezig ophalen "Aanvraag ontvangen."
fi

setting() { sed -n "s/^$1=//p" "$ENV_FILE" 2>/dev/null | tail -n 1; }
track="$(setting AVANTA_TRACK)"; track="${track:-main}"
tunnel_container="$(setting TUNNEL_CONTAINER)"; tunnel_container="${tunnel_container:-aquatech-cloudflared}"
port="$(setting APP_PORT)"; port="${port:-3400}"

# ---------- Wat staat er klaar? ----------
git -C "$REPO_DIR" fetch -q --prune origin
current="$(git -C "$REPO_DIR" rev-parse HEAD)"
target="$(git -C "$REPO_DIR" rev-parse "origin/$track")"
version_of() { git -C "$REPO_DIR" show "$1:app/package.json" 2>/dev/null | grep -oE '"version":[[:space:]]*"[0-9.]+"' | head -n1 | grep -oE '[0-9.]+' || true; }
CUR_VER="$(version_of "$current")"; [[ "$CUR_VER" =~ $VERSION_RE ]] || CUR_VER=""
NEW_VER="$(version_of "$target")"; [[ "$NEW_VER" =~ $VERSION_RE ]] || NEW_VER=""
FAILED="$(cat "$BASE_DIR/.failed-commit" 2>/dev/null || true)"
auto_json() { [[ "$AUTO" == 1 ]] && echo true || echo false; }
status_put status.json "{\"current\":\"$CUR_VER\",\"currentCommit\":\"$current\",\"available\":\"$NEW_VER\",\"availableCommit\":\"$target\",\"checkedAt\":\"$(now)\",\"auto\":$(auto_json)}"
# Releasenotes van de beschikbare commit, één keer per commit.
if [[ "$(cat "$STATUS_DIR/.changelog-commit" 2>/dev/null || true)" != "$target" ]]; then
  status_put changelog.md "$(git -C "$REPO_DIR" show "$target:app/CHANGELOG.md" 2>/dev/null | head -c 200000 || true)"
  printf '%s' "$target" > "$STATUS_DIR/.changelog-commit"
fi

# Huidig IP van cloudflared in het tunnelnetwerk tegenover TRUST_PROXY in .env.
network="$(setting TUNNEL_NETWORK)"
tunnel_ip="$(docker inspect -f "{{with index .NetworkSettings.Networks \"$network\"}}{{.IPAddress}}{{end}}" "$tunnel_container" 2>/dev/null || true)"
ip_changed=false
[ -n "$tunnel_ip" ] && [ "$tunnel_ip" != "$(setting TRUST_PROXY)" ] && ip_changed=true

run_install() { # run_install COMMIT [fase]: install.sh van die commit draaien (fase "build" = alleen code en image)
  local script status=0
  script="$(mktemp)"
  git -C "$REPO_DIR" show "$1:deploy/apps01/install.sh" > "$script"
  INSTALL_PHASE="${2:-}" TUNNEL_CONTAINER="$tunnel_container" bash "$script" "$1" || status=$?
  rm -f "$script"; return $status
}
# De app meldt zich met de verwachte versie op /api/health.
health_version_is() {
  curl -fsS -m 10 "http://127.0.0.1:$port/api/health" 2>/dev/null | grep -q "\"version\":\"$1\""
}

if [[ "$CHECK_ONLY" == 1 ]]; then
  log "Controle op verzoek: beschikbaar ${NEW_VER:-?} (${target:0:7}), draaiend ${CUR_VER:-?} (${current:0:7})."
  exit 0
fi

# ---------- Moet er geïnstalleerd worden? ----------
install=0
RUN_VERSION="$NEW_VER"
if [[ "$REQ_PRESENT" == 1 ]]; then
  if [[ -z "$REQ_COMMIT" ]]; then run_put geweigerd klaar "De aanvraag was onleesbaar."; log "Onleesbare aanvraag genegeerd."; exit 0; fi
  if [[ "$REQ_COMMIT" != "$target" ]]; then
    run_put geweigerd klaar "Deze versie staat niet (meer) klaar; vernieuw de pagina."
    log "Aanvraag voor ${REQ_COMMIT:0:7} geweigerd: nieuwste is ${target:0:7}."; exit 0
  fi
  if [[ "$target" == "$current" ]]; then run_put geweigerd klaar "Deze versie draait al."; exit 0; fi
  if ! git -C "$REPO_DIR" cat-file -e "$target:deploy/apps01/install.sh" 2>/dev/null; then
    run_put geweigerd klaar "Deze versie heeft geen installatiescript."; exit 0
  fi
  log "Update naar ${target:0:7} aangevraagd vanuit de app."
  install=1
elif [[ "$target" != "$current" ]]; then
  REQ_ID=""
  if [[ "$AUTO" != 1 ]]; then
    log "Nieuwe commit ${target:0:7} klaar; automatisch bijwerken staat uit."
  elif [[ "$target" == "$FAILED" ]]; then
    log "Commit ${target:0:7} faalde eerder; overslaan."
  elif ! git -C "$REPO_DIR" cat-file -e "$target:deploy/apps01/install.sh" 2>/dev/null; then
    log "origin/$track (${target:0:7}) heeft nog geen deploy/apps01; blijf op ${current:0:7}."
  else
    AUTOMATIC=true; RUN_STARTED="$(now)"; install=1
  fi
fi

if [[ "$install" == 1 ]]; then
  RUN_COMMIT="$target"
  log "Update ${current:0:7} (${CUR_VER:-?}) -> ${target:0:7} (${NEW_VER:-?})"
  # 1. Code ophalen en image bouwen terwijl de site gewoon draait.
  run_put bezig ophalen "Nieuwe versie ophalen en bouwen."
  if ! run_install "$target" build; then
    git -C "$REPO_DIR" checkout -q --detach "$current" || true
    echo "$target" > "$BASE_DIR/.failed-commit"
    run_put mislukt klaar "Bouwen van de nieuwe versie mislukt; de huidige versie draait gewoon door."
    exit 1
  fi
  # 2. Onderhoudsmodus aan; de app weigert vanaf nu schrijfverzoeken. Even wachten tot lopende verzoeken klaar zijn.
  run_put bezig onderhoud "Onderhoudsmodus aan."
  status_put maintenance.json "{\"since\":\"$(now)\",\"version\":\"$NEW_VER\"}"
  sleep "$DRAIN_SECONDS"
  # 3. Versleutelde back-up met de huidige versie (migraties lopen alleen vooruit). Mislukt dat, dan gaat de update door
  #    met een waarschuwing.
  run_put bezig back-up "Back-up maken."
  if (cd "$STACK_DIR" && docker compose exec -T app node src/backup/cli.js create --update); then
    log "Back-up vóór de update gemaakt."
  else
    log "Waarschuwing: geen back-up vóór de update."
  fi
  # 4. Container vervangen en controleren (install.sh wacht zelf op /api/health; daarna de versie).
  run_put bezig herstarten "Nieuwe versie starten."
  started=0
  run_install "$target" && started=1
  run_put bezig controleren "Controleren of de nieuwe versie goed draait."
  if [[ "$started" == 1 ]] && { [[ -z "$NEW_VER" ]] || health_version_is "$NEW_VER"; }; then
    rm -f "$BASE_DIR/.failed-commit"
    status_put status.json "{\"current\":\"$NEW_VER\",\"currentCommit\":\"$target\",\"available\":\"$NEW_VER\",\"availableCommit\":\"$target\",\"checkedAt\":\"$(now)\",\"auto\":$(auto_json)}"
    run_put geslaagd klaar "Versie ${NEW_VER:-${target:0:7}} draait."
    log "Bijgewerkt naar ${target:0:7}."
    exit 0
  fi
  log "Update naar ${target:0:7} mislukt; terug naar ${current:0:7}."
  run_put bezig terugzetten "De nieuwe versie start niet goed; terug naar de vorige versie."
  echo "$target" > "$BASE_DIR/.failed-commit"
  if run_install "$current"; then
    run_put mislukt klaar "De nieuwe versie startte niet goed; de vorige versie draait weer."
  else
    run_put mislukt klaar "De nieuwe versie startte niet goed en de vorige versie start ook niet. Controleer de server."
  fi
  status_put status.json "{\"current\":\"$CUR_VER\",\"currentCommit\":\"$current\",\"available\":\"$NEW_VER\",\"availableCommit\":\"$target\",\"checkedAt\":\"$(now)\",\"auto\":$(auto_json)}"
  exit 1
fi

if $ip_changed; then
  log "IP van $tunnel_container veranderd naar $tunnel_ip; TRUST_PROXY bijwerken."
  run_install "$current"
fi
}

# Alles staat in main(): bash leest het hele script vóór het start, zodat install.sh dit bestand tijdens een uitrol
# veilig kan vervangen.
main "$@"
exit $?
