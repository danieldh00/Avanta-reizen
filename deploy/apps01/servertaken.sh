#!/usr/bin/env bash
# Vaste servertaken voor de Avanta-testomgeving op apps01: bediening VANAF DE PROXMOX-HOST (pve), als root.
#
#   bash servertaken.sh                  status (standaard): alleen lezen, met samenvatting
#   bash servertaken.sh status           idem
#   bash servertaken.sh logs [uren]      foutregels van de app (standaard 24 uur; geen persoonsgegevens, die logt de app niet)
#   bash servertaken.sh update           nu bijwerken naar de nieuwste commit van main (back-up, onderhoudsmodus, terugval)
#   bash servertaken.sh openstaand       voert alle nog openstaande servertaken uit (de afvinklijst in Beheer > Servertaken)
#                                        en onthoudt op de server welke gedaan zijn (met TASKS_REF=<volledige commit>)
#   bash servertaken.sh beheerder-herstel <e-mailadres>
#                                        weer toegang voor een beheerder die er niet meer in komt: tijdelijk wachtwoord,
#                                        tweestapsverificatie uit + activatiecode, sessies weg (app/src/crm/cli.js)
#   bash servertaken.sh testdata [vullen|opnieuw|verwijderen]
#                                        verzonnen testdata in de database (standaard vullen; app/src/dev/seed/cli.js);
#                                        weigert op het productiedomein en als zoekmachines de site mogen indexeren
#   bash servertaken.sh help             deze uitleg
#
# Het vaste commando voor Daniël staat in de app (Beheer > Systeem > Servertaken); het haalt de nieuwste commit van main
# op, pint dit script op die commit en geeft hem mee als TASKS_REF. Daniël typt dus nooit losse servercommando's.
#
# Servertaken (openstaand): de lijst staat in de app (app/src/system/host-tasks.js, `HOST_TASKS`); elke taak heeft
# hieronder een functie `hosttask_<id met underscores>` en een regel in HOST_TASK_IDS (een test bewaakt dat beide
# lijsten gelijk zijn). Wat gedaan is, staat in /opt/apps/avanta/update/status/host-tasks.json (de app vinkt dat af).
#
# Opties: --yes (of YES=1) = geen bevestigingsvraag. `update` en `openstaand` vragen eerst om bevestiging;
# `status` en `logs` wijzigen niets.
#
# Het script zoekt het gast-systeem apps01 zoals pve-setup.sh (LXC via `pct exec`, anders ssh als daniel@apps01 met
# `sudo -n`) en voert zichzelf daar uit (het eigen bestand gaat via stdin mee; er wordt niets op de server geïnstalleerd).
# Er gaan geen wachtwoorden of geheimen over de verbinding en geen geheimen in de uitvoer (.env wordt niet getoond).
#
# Instellingen (omgevingsvariabelen, allemaal optioneel):
#   APPS01_NAME (apps01)   APPS01_CTID (vaste LXC-id)   APPS01_SSH (ssh-doel, standaard daniel@apps01)
#   BASE_DIR (/opt/apps/avanta)   YES=1 (geen bevestigingsvraag)
set -euo pipefail

BASE_DIR="${BASE_DIR:-/opt/apps/avanta}"

# =====================================================================================================================
# Deel 1: draait OP DE SERVER (apps01). Het host-deel hieronder stuurt dit bestand met SERVERTAKEN_REMOTE=1 erheen.
# =====================================================================================================================
STACK_DIR="$BASE_DIR/repo/deploy/apps01"
STATUS_DIR="$BASE_DIR/update/status"
OK_COUNT=0; WARN_COUNT=0; FAIL_COUNT=0

log() { echo "[$(date '+%F %T')] $*"; }
ok() { OK_COUNT=$((OK_COUNT + 1)); printf '  [ OK ] %s\n' "$*"; }
warn() { WARN_COUNT=$((WARN_COUNT + 1)); printf '  [WARN] %s\n' "$*"; }
fail() { FAIL_COUNT=$((FAIL_COUNT + 1)); printf '  [FOUT] %s\n' "$*"; }
info() { printf '         %s\n' "$*"; }
section() { printf '\n== %s ==\n' "$*"; }
# Eén veld uit een JSON-bestand van update.sh (alleen vaste velden, geen geheimen).
json_field() { grep -oE "\"$2\":\"[^\"]*\"" "$1" 2>/dev/null | head -n1 | cut -d'"' -f4 || true; }
app_port() { local port; port="$(sed -n 's/^APP_PORT=//p' "$STACK_DIR/.env" 2>/dev/null | tail -n1)"; echo "${port:-3400}"; }
health_version() { curl -fsS -m 10 "http://127.0.0.1:$(app_port)/api/health" 2>/dev/null | grep -oE '"version":"[^"]*"' | head -n1 | cut -d'"' -f4 || true; }

# ---------- status ----------
remote_status() {
  section "Containers"
  local name state health restarts
  for name in avanta-app-1 avanta-db-1; do
    if ! docker inspect "$name" >/dev/null 2>&1; then fail "$name bestaat niet"; continue; fi
    state="$(docker inspect -f '{{.State.Status}}' "$name")"
    health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}' "$name")"
    restarts="$(docker inspect -f '{{.RestartCount}}' "$name")"
    if [[ "$state" != running ]]; then fail "$name draait niet (status: $state)"
    elif [[ "$health" != healthy && "$health" != "-" ]]; then fail "$name is $health"
    elif (( restarts > 0 )); then warn "$name draait, maar is $restarts keer herstart"
    else ok "$name draait${health:+ ($health)}"; fi
  done

  section "App en updates"
  local version
  version="$(health_version)"
  if [[ -n "$version" ]]; then ok "/api/health antwoordt (versie $version)"; else fail "/api/health antwoordt niet"; fi
  if [[ -f "$STATUS_DIR/status.json" ]]; then
    local current available
    current="$(json_field "$STATUS_DIR/status.json" currentCommit)"; available="$(json_field "$STATUS_DIR/status.json" availableCommit)"
    if [[ -n "$available" && "$available" != "$current" ]]; then
      warn "nieuwere versie klaar: $(json_field "$STATUS_DIR/status.json" available) (${available:0:7}); de timer of 'servertaken.sh update' installeert hem"
    else
      ok "draait de nieuwste commit (${current:0:7}, gecontroleerd $(json_field "$STATUS_DIR/status.json" checkedAt))"
    fi
  else
    warn "nog geen update-status ($STATUS_DIR/status.json); de timer schrijft die binnen een kwartier"
  fi
  if [[ -f "$STATUS_DIR/run.json" ]]; then
    case "$(json_field "$STATUS_DIR/run.json" state)" in
      geslaagd) ok "laatste uitrol geslaagd ($(json_field "$STATUS_DIR/run.json" version), $(json_field "$STATUS_DIR/run.json" finishedAt))" ;;
      bezig) warn "er loopt een uitrol: $(json_field "$STATUS_DIR/run.json" step)" ;;
      "") ;;
      *) fail "laatste uitrol: $(json_field "$STATUS_DIR/run.json" state) - $(json_field "$STATUS_DIR/run.json" message)" ;;
    esac
  fi
  [[ -f "$BASE_DIR/.failed-commit" ]] && warn "commit $(head -c 7 "$BASE_DIR/.failed-commit") faalde eerder en wordt door de timer overgeslagen"
  [[ -f "$STATUS_DIR/maintenance.json" ]] && warn "onderhoudsmodus van de update staat aan (schrijven wordt geweigerd)"
  local unit
  for unit in avanta-update.timer avanta-update-now.path avanta-restore-test.timer avanta-restore-test-now.path; do
    if systemctl is-active --quiet "$unit" 2>/dev/null; then ok "$unit actief"; else fail "$unit is niet actief"; fi
  done
  [[ -d "$BASE_DIR/update/request" && "$(stat -c %u "$BASE_DIR/update/request")" == 1000 ]] && ok "aanvraagmap voor de app in orde" || fail "aanvraagmap $BASE_DIR/update/request ontbreekt of heeft de verkeerde eigenaar"

  section "Database"
  if docker exec avanta-db-1 pg_isready -U avanta -d avanta >/dev/null 2>&1; then ok "PostgreSQL accepteert verbindingen"; else fail "PostgreSQL accepteert geen verbindingen"; fi
  local migration
  migration="$(docker exec avanta-db-1 psql -U avanta -d avanta -Atc 'SELECT max(id) FROM schema_migrations' 2>/dev/null | tr -cd '0-9' || true)"
  [[ -n "$migration" ]] && info "laatste migratie: $migration"

  section "Server"
  local use_pct mem_available
  use_pct="$(df --output=pcent / 2>/dev/null | tail -n1 | tr -dc '0-9')"
  if [[ -z "$use_pct" ]]; then warn "schijfgebruik niet te bepalen"
  elif (( use_pct >= 95 )); then fail "schijf ${use_pct}% vol"
  elif (( use_pct >= 85 )); then warn "schijf ${use_pct}% vol"
  else ok "schijf ${use_pct}% vol"; fi
  mem_available="$(free -m | awk '/^Mem:/{print $7}')"
  if (( mem_available < 300 )); then fail "weinig geheugen vrij: ${mem_available} MB"
  elif (( mem_available < 800 )); then warn "geheugen krap: ${mem_available} MB"
  else ok "geheugen: ${mem_available} MB beschikbaar"; fi
  info "belasting: $(cut -d' ' -f1-3 /proc/loadavg), $(nproc) CPU's"

  section "Back-ups"
  local newest age_hours
  newest="$(docker exec avanta-app-1 node src/backup/cli.js list 2>/dev/null | head -n1 | cut -f1 || true)"
  if [[ "$newest" =~ ^avanta-([0-9]{8})-([0-9]{6})\.dump\.enc$ ]]; then
    age_hours=$(( ($(date -u +%s) - $(date -u -d "${BASH_REMATCH[1]} ${BASH_REMATCH[2]:0:2}:${BASH_REMATCH[2]:2:2}" +%s)) / 3600 ))
    if (( age_hours > 30 )); then fail "laatste back-up is ${age_hours} uur oud ($newest)"; else ok "laatste back-up ${age_hours} uur oud ($newest)"; fi
  else
    fail "geen back-up gevonden"
  fi

  section "Samenvatting"
  printf '  %d in orde, %d waarschuwing(en), %d fout(en)\n' "$OK_COUNT" "$WARN_COUNT" "$FAIL_COUNT"
  if (( FAIL_COUNT > 0 )); then echo "  Stand: AANDACHT NODIG"; return 1
  elif (( WARN_COUNT > 0 )); then echo "  Stand: werkt, met opmerkingen"
  else echo "  Stand: alles in orde"; fi
}

# ---------- logs ----------
remote_logs() {
  local hours="${1:-24}"
  [[ "$hours" =~ ^[0-9]{1,4}$ ]] || { echo "FOUT: geef het aantal uren als getal (bijv. logs 48)." >&2; return 2; }
  (cd "$STACK_DIR" && docker compose logs --no-color --since "${hours}h" app 2>&1) | grep -iE 'fout|error|mislukt|waarschuwing|warn|\[traag\]' | tail -n 200 | cut -c1-400 \
    || echo "Geen foutregels in de laatste ${hours} uur."
}

# ---------- beheerder-herstel ----------
# Toont het tijdelijke wachtwoord en de activatiecode alleen in deze terminal; ze komen niet in een bestand of log.
remote_beheerder_herstel() {
  local email="${1:-}"
  [[ "$email" =~ ^[^[:space:]@]+@[^[:space:]@]+$ ]] || { echo "FOUT: geef het e-mailadres van de beheerder (beheerder-herstel naam@voorbeeld.nl)." >&2; return 2; }
  (cd "$STACK_DIR" && docker compose exec -T app node src/crm/cli.js beheerder-herstel "$email")
}

# ---------- testdata ----------
# Verzonnen testdata (wachtlijstpunt W00). De app zelf weigert op productie; het wachtwoord van de testgebruikers staat
# alleen in deze terminal.
remote_testdata() {
  local mode="${1:-vullen}"
  [[ "$mode" =~ ^(vullen|opnieuw|verwijderen)$ ]] || { echo "FOUT: kies vullen, opnieuw of verwijderen." >&2; return 2; }
  (cd "$STACK_DIR" && docker compose exec -T app node src/dev/seed/cli.js "$mode" --testomgeving)
}

# ---------- update ----------
# Alleen lezen. Uitgangscode 10 = er staat een nieuwere commit klaar; 0 = niets te doen.
remote_update_check() {
  local track current target
  track="$(sed -n 's/^AVANTA_TRACK=//p' "$STACK_DIR/.env" 2>/dev/null | tail -n1)"; track="${track:-main}"
  git -C "$BASE_DIR/repo" fetch -q --prune origin || { echo "FOUT: ophalen van GitHub mislukt." >&2; return 1; }
  current="$(git -C "$BASE_DIR/repo" rev-parse HEAD)"; target="$(git -C "$BASE_DIR/repo" rev-parse "origin/$track")"
  echo "Draait: ${current:0:7} (versie $(health_version)); nieuwste op $track: ${target:0:7}."
  [[ "$current" == "$target" ]] && { echo "Er is niets nieuws: niets te doen."; return 0; }
  return 10
}
# Zet een aanvraag klaar zoals de knop Nu updaten (dus ook als automatisch bijwerken uit staat) en start de service.
remote_update_run() {
  local target request_tmp
  target="$(git -C "$BASE_DIR/repo" rev-parse "origin/$(sed -n 's/^AVANTA_TRACK=//p' "$STACK_DIR/.env" 2>/dev/null | tail -n1 | grep . || echo main)")"
  [[ -d "$BASE_DIR/update/request" ]] || { echo "FOUT: $BASE_DIR/update/request ontbreekt; draai eerst 'servertaken.sh openstaand'." >&2; return 1; }
  # Veilig schrijven: tijdelijk bestand in de root-eigen statusmap, dan rename (een symlink van de app wordt vervangen, nooit gevolgd).
  request_tmp="$(mktemp "$STATUS_DIR/.tmp.XXXXXX")"
  printf '{"id":"%s","commit":"%s","requestedAt":"%s","byName":"servertaken.sh"}\n' "$(cat /proc/sys/kernel/random/uuid)" "$target" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$request_tmp"
  chown 1000:1000 -- "$request_tmp"; chmod 644 -- "$request_tmp"
  mv -T -f -- "$request_tmp" "$BASE_DIR/update/request/request.json"
  log "Update starten (bouwen, onderhoudsmodus, back-up, wisselen, controle, terugval)"
  systemctl start avanta-update.service || true
  echo "Uitrol: $(json_field "$STATUS_DIR/run.json" state) - $(json_field "$STATUS_DIR/run.json" message)"
  echo "Draait nu: $(health_version)."
  [[ "$(json_field "$STATUS_DIR/run.json" state)" == "geslaagd" ]] || { echo "De update is niet gelukt; zie: servertaken.sh status en journalctl -u avanta-update" >&2; return 1; }
}

# ---------- servertaken (openstaand) ----------
# Alle taken, oudste eerst. Zelfde id's als HOST_TASKS in app/src/system/host-tasks.js (een test bewaakt dat).
HOST_TASK_IDS=(
  001-updaten-vanuit-app-inrichten
)
LEDGER="$STATUS_DIR/host-tasks.json"
hosttask_function() { printf 'hosttask_%s' "${1//-/_}"; }
ledger_done_ids() { grep -oE '"[0-9]{3}-[a-z0-9-]{1,80}":"[^"]*"' "$LEDGER" 2>/dev/null | cut -d'"' -f2 || true; }
ledger_time() {
  local at
  at="$(grep -oE "\"$1\":\"[^\"]*\"" "$LEDGER" 2>/dev/null | head -n1 | cut -d'"' -f4 || true)"
  printf '%s' "${at:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
}
# Schrijft het logboek opnieuw met de gedane id's (+ eventueel één nieuwe), in één keer (tijdelijk bestand + mv).
ledger_write() { # [nieuwe id]
  local now_text entries="" id tmp
  mkdir -p "$STATUS_DIR"
  now_text="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  for id in $(ledger_done_ids); do
    [[ "$id" != "${1:-}" ]] && entries+="${entries:+,}\"$id\":\"$(ledger_time "$id")\""
  done
  [[ -n "${1:-}" ]] && entries+="${entries:+,}\"$1\":\"$now_text\""
  tmp="$(mktemp "$STATUS_DIR/.tmp.XXXXXX")"
  printf '{"done":{%s},"checkedAt":"%s"}\n' "$entries" "$now_text" > "$tmp"
  chmod 644 "$tmp"
  mv -f "$tmp" "$LEDGER"
}
pending_host_tasks() {
  local done_ids id
  done_ids="$(ledger_done_ids)"
  for id in "${HOST_TASK_IDS[@]}"; do grep -qx -- "$id" <<<"$done_ids" || echo "$id"; done
}
# De commit waarop de taken draaien (40 tekens): een root-script op de server loopt nooit mee met een branch.
need_tasks_ref() {
  [[ "${TASKS_REF:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "FOUT: geef TASKS_REF=<volledige commit van 40 tekens> mee (het vaste commando uit de app doet dat zelf)." >&2; exit 2; }
}
# Haalt een bestand uit de repo op TASKS_REF en controleert de syntaxis.
fetch_task_file() { # <doel> <pad in de repo>
  curl -fsSL -m 60 "${TASKS_BASE:-https://raw.githubusercontent.com/danieldh00/Avanta-reizen}/$TASKS_REF/$2" -o "$1" || { echo "FOUT: ophalen van $2 mislukt." >&2; return 1; }
  bash -n "$1" || { echo "FOUT: $2 is geen geldig script." >&2; return 1; }
}

# Taak 001: bijwerken via de gewone updateservice en controleren dat updaten vanuit de app is ingericht; lukt dat niet,
# dan install.sh van TASKS_REF draaien (zelfde als de automatische update). Veilig herhaalbaar.
hosttask_001_updaten_vanuit_app_inrichten() {
  local ready=1 dir
  systemctl start avanta-update.service || true
  for check in "systemctl is-active --quiet avanta-update-now.path" "test -d $BASE_DIR/update/status" "test \"\$(stat -c %u $BASE_DIR/update/request)\" = 1000"; do
    bash -c "$check" 2>/dev/null || ready=0
  done
  if [[ "$ready" == 0 ]]; then
    log "Nog niet ingericht; install.sh van ${TASKS_REF:0:10} draaien."
    dir="$(mktemp -d)"
    fetch_task_file "$dir/install.sh" deploy/apps01/install.sh || { rm -rf "$dir"; return 1; }
    bash "$dir/install.sh" "$TASKS_REF" || { rm -rf "$dir"; return 1; }
    rm -rf "$dir"
  fi
  systemctl is-active --quiet avanta-update-now.path || { echo "FOUT: avanta-update-now.path is niet actief." >&2; return 1; }
  echo "Updaten vanuit de app is ingericht (avanta-update-now.path actief, mappen in $BASE_DIR/update)."
}

# Toont wat er openstaat. Uitgangscode 10 = er is iets te doen (two_step vraagt dan om bevestiging).
remote_openstaand_check() {
  local pending id
  need_tasks_ref
  pending="$(pending_host_tasks)"
  if [[ -z "$pending" ]]; then ledger_write; echo "Alle servertaken zijn gedaan. Niets te doen."; return 0; fi
  echo "Openstaande servertaken (uit commit ${TASKS_REF:0:10}):"
  for id in $pending; do echo "  - $id"; done
  return 10
}
# Voert de openstaande taken één voor één uit en legt elke gelukte taak vast. Bij een fout stopt het (de rest blijft open).
remote_openstaand_run() {
  local id
  need_tasks_ref
  for id in $(pending_host_tasks); do
    echo; echo "== Taak $id =="
    if "$(hosttask_function "$id")"; then
      ledger_write "$id"; echo "Taak $id gedaan en vastgelegd."
    else
      echo "FOUT: taak $id is mislukt; de overige taken zijn niet uitgevoerd. Draai het commando opnieuw als het probleem opgelost is." >&2
      return 1
    fi
  done
  echo; echo "Alle servertaken zijn gedaan."
}

remote_main() {
  exec </dev/null
  [[ -d "$BASE_DIR/repo" ]] || { echo "FOUT: $BASE_DIR/repo bestaat niet op de server (zet BASE_DIR)." >&2; exit 1; }
  command -v docker >/dev/null || { echo "FOUT: docker niet gevonden op de server." >&2; exit 1; }
  local action="${1:-status}"; shift || true
  case "$action" in
    status) remote_status ;;
    logs) remote_logs "$@" ;;
    update-check) remote_update_check ;;
    update-run) remote_update_run ;;
    openstaand-check) remote_openstaand_check ;;
    openstaand-run) remote_openstaand_run ;;
    beheerder-herstel) remote_beheerder_herstel "$@" ;;
    testdata) remote_testdata "$@" ;;
    *) echo "Onbekende opdracht: $action" >&2; exit 2 ;;
  esac
}

if [[ "${SERVERTAKEN_REMOTE:-}" == "1" ]]; then
  remote_main "$@"
  exit $?
fi

# =====================================================================================================================
# Deel 2: draait OP DE PROXMOX-HOST. Zoekt apps01 en voert dit bestand daar uit.
# =====================================================================================================================
NAME="${APPS01_NAME:-apps01}"
die() { echo "FOUT: $*" >&2; exit 1; }
usage() { sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

ARGS=()
for argument in "$@"; do
  case "$argument" in
    -y | --yes) YES=1 ;;
    -h | --help) usage ;;
    *) ARGS+=("$argument") ;;
  esac
done
ACTION="${ARGS[0]:-status}"
case "$ACTION" in
  status | logs | update | openstaand | beheerder-herstel | testdata) ;;
  *) usage ;;
esac
[[ $(id -u) -eq 0 ]] || die "Draai dit als root op de Proxmox-host."

# ---------- Gast-systeem zoeken: LXC (pct exec) of ssh (zoals pve-setup.sh) ----------
MODE=""; GUEST_ID="${APPS01_CTID:-}"; SSH_TARGET="${APPS01_SSH:-}"
if [[ -z "$SSH_TARGET" && -z "$GUEST_ID" ]] && command -v pct >/dev/null; then
  GUEST_ID="$(pct list 2>/dev/null | awk -v n="$NAME" 'NR>1 && $NF==n {print $1; exit}')"
fi
if [[ -n "$GUEST_ID" ]]; then MODE="pct"; echo "Server: LXC $GUEST_ID ($NAME), via pct exec"
else MODE="ssh"; SSH_TARGET="${SSH_TARGET:-daniel@$NAME}"; echo "Server: $SSH_TARGET, via ssh"; fi
SUDO=()
[[ "$MODE" == "ssh" && "${SSH_TARGET%%@*}" != "root" ]] && SUDO=(sudo -n)

# Voert dit bestand op de server uit met een opdracht (het bestand gaat via stdin mee).
remote() { # <opdracht> [argumenten...]
  local environment=(SERVERTAKEN_REMOTE=1 "BASE_DIR=$BASE_DIR")
  [[ -n "${TASKS_REF:-}" ]] && environment+=("TASKS_REF=$TASKS_REF")
  if [[ "$MODE" == "pct" ]]; then
    pct exec "$GUEST_ID" -- env "${environment[@]}" bash -s -- "$@" <"$0"
  else
    local command_line
    printf -v command_line '%q ' "${SUDO[@]}" env "${environment[@]}" bash -s -- "$@"
    # shellcheck disable=SC2029  # bewust: de opdracht wordt hier opgebouwd en op de server uitgevoerd
    ssh -o ConnectTimeout=15 -o ServerAliveInterval=30 "$SSH_TARGET" "$command_line" <"$0"
  fi
}

# Vraagt om bevestiging (met --yes/YES=1 niet). Zonder terminal en zonder --yes: afbreken.
confirm() { # <tekst>
  [[ "${YES:-}" == "1" ]] && return 0
  echo; echo -e "$1"
  local answer
  printf "Typ 'ja' om door te gaan: " >&2
  { read -r answer </dev/tty; } 2>/dev/null || die "Geen terminal om te bevestigen; gebruik --yes."
  [[ "$answer" == "ja" ]] || { echo "Afgebroken; niets veranderd."; exit 0; }
}

# Voert check + (na bevestiging) uitvoering uit. Check-uitgangscode 10 = er is iets te doen.
two_step() { # <naam> <bevestigingstekst>
  local code=0
  remote "$1-check" || code=$?
  case "$code" in
    0) exit 0 ;;
    10) ;;
    *) exit "$code" ;;
  esac
  confirm "$2"
  remote "$1-run"
}

case "$ACTION" in
  status) remote status ;;
  logs) remote logs "${ARGS[@]:1}" ;;
  update) two_step update "De nieuwste versie wordt gebouwd en na een back-up gestart (ca. een minuut onderhoudsmodus). Lukt het niet, dan zet update.sh de vorige versie terug." ;;
  beheerder-herstel)
    [[ "${ARGS[1]:-}" =~ ^[^[:space:]@]+@[^[:space:]@]+$ ]] || die "Geef het e-mailadres van de beheerder: beheerder-herstel naam@voorbeeld.nl"
    confirm "Beheerder ${ARGS[1]} krijgt een nieuw tijdelijk wachtwoord; de tweestapsverificatie gaat uit (met een nieuwe activatiecode) en alle sessies van deze beheerder worden beëindigd."
    remote beheerder-herstel "${ARGS[1]}" ;;
  testdata)
    TESTDATA_MODE="${ARGS[1]:-vullen}"
    [[ "$TESTDATA_MODE" =~ ^(vullen|opnieuw|verwijderen)$ ]] || die "Kies: testdata vullen, testdata opnieuw of testdata verwijderen."
    case "$TESTDATA_MODE" in
      vullen) confirm "Er komt verzonnen testdata in de database van de testomgeving: reizen, reisleiders, personen, aanmeldingen, betalingen, blog, FAQ, pagina's en één testgebruiker per rol (<rol>@example.com)." ;;
      opnieuw) confirm "De bestaande testdata (test-slugs en @example.com-adressen) wordt verwijderd en opnieuw aangemaakt; andere gegevens blijven staan. De testgebruikers krijgen een nieuw wachtwoord." ;;
      verwijderen) confirm "Alle testdata (test-slugs en @example.com-adressen) wordt verwijderd; andere gegevens blijven staan." ;;
    esac
    remote testdata "$TESTDATA_MODE" ;;
  openstaand) two_step openstaand "De openstaande servertaken worden nu uitgevoerd (ze staan hierboven; de app kan daarbij even herstarten). Elke gelukte taak wordt afgevinkt in de app." ;;
esac
