#!/usr/bin/env bash
# Installeert of werkt de stagingomgeving van de ombouw naar Vue bij (docs/VUE-OMBOUW.md §4). Herhaalbaar.
# Staging is een tweede opstelling naast de testomgeving op dezelfde server: eigen map, eigen Docker-project
# (avanta-staging), eigen database en eigen geheimen. Ze volgt de branch `develop`; bestaat die nog niet, dan `main`.
#
#   install-staging.sh              installeren of bijwerken naar de nieuwste commit van de gevolgde branch
#   install-staging.sh --timer      zoals de timer het aanroept: alleen iets doen bij een nieuwe commit, een mislukte
#                                   commit overslaan en geen testdata vullen
#
# Draait als root op de server; de servertaak `002-staging-inrichten` (deploy/apps01/servertaken.sh) roept dit aan, en
# daarna elke 15 minuten de systemd-timer avanta-staging-update.timer.
#
# Wat dit script bewust niet doet: de testomgeving aanraken (alleen haar .env lezen voor de naam en het netwerk van de
# bestaande cloudflared), iets in Cloudflare wijzigen (het adres toevoegen is één handmatige stap, zie onderaan de
# uitvoer), een back-up maken of terugzetten, of gegevens van de testomgeving kopiëren.
#
# Mislukt een nieuwe commit (bouwen of starten), dan gaat staging terug naar de vorige commit en slaat de timer die
# commit over tot er een nieuwere is. Migraties lopen alleen vooruit: de database gaat niet mee terug.
# Logboek: journalctl -u avanta-staging-update.
set -euo pipefail

main() {
REPO_URL="${REPO_URL:-https://github.com/danieldh00/Avanta-reizen.git}"
BASE_DIR="${BASE_DIR:-/opt/apps/avanta-staging}"
# De .env van de testomgeving: alleen om de bestaande cloudflared (naam en netwerk) over te nemen.
MAIN_ENV="${MAIN_ENV:-/opt/apps/avanta/repo/deploy/apps01/.env}"
STAGING_URL="${STAGING_URL:-https://avanta-staging.den-hollander.com}"
# Vrije ruimte die er minstens moet zijn voor het bouwen van een tweede image en een tweede database.
MIN_FREE_GB="${MIN_FREE_GB:-6}"
REPO_DIR="$BASE_DIR/repo"
STACK_DIR="$REPO_DIR/deploy/staging"
FAILED_FILE="$BASE_DIR/.failed-commit"
TIMER=0
[ "${1:-}" = "--timer" ] && TIMER=1

log() { echo "[$(date '+%F %T')] $*"; }
die() { echo "FOUT: $*" >&2; exit 1; }
# STAGING_TEST_ROOT is alleen voor de test (tests/deploy-staging.test.js), net als LOCK_FILE: de systemd-bestanden en
# het geïnstalleerde script komen dan onder die map en het script hoeft geen root te zijn.
TEST_ROOT="${STAGING_TEST_ROOT:-}"
SYSTEMD_DIR="$TEST_ROOT/etc/systemd/system"
SBIN_DIR="$TEST_ROOT/usr/local/sbin"
[ "$(id -u)" -eq 0 ] || [ -n "$TEST_ROOT" ] || die "draai dit als root (sudo)"
for tool in git docker openssl curl flock; do command -v "$tool" >/dev/null || die "ontbreekt: $tool"; done
docker compose version >/dev/null 2>&1 || die "docker compose-plugin ontbreekt"

exec 9>"${LOCK_FILE:-/run/avanta-staging.lock}"
flock -n 9 || { log "Staging wordt al bijgewerkt."; exit 0; }

# Leest één waarde uit een .env-bestand (laatste regel wint); leeg als het bestand of de sleutel ontbreekt.
setting() { [ -f "$1" ] || return 0; sed -n "s/^$2=//p" "$1" | tail -n 1; }
# Zet één waarde in de .env van staging (toevoegen of vervangen). Waarden bevatten geen `|`.
put_setting() {
  if grep -q "^$1=" "$STACK_DIR/.env"; then sed -i "s|^$1=.*|$1=$2|" "$STACK_DIR/.env"; else echo "$1=$2" >> "$STACK_DIR/.env"; fi
}

# ---------- Code: de nieuwste commit van develop, of van main zolang develop niet bestaat ----------
mkdir -p "$BASE_DIR"
[ -d "$REPO_DIR/.git" ] || git clone -q "$REPO_URL" "$REPO_DIR"
git -C "$REPO_DIR" fetch -q --prune origin
track="main"
git -C "$REPO_DIR" rev-parse -q --verify "refs/remotes/origin/develop" >/dev/null && track="develop"
target="$(git -C "$REPO_DIR" rev-parse "origin/$track")"
current="$(cat "$BASE_DIR/.deployed-commit" 2>/dev/null || true)"
port="$(setting "$STACK_DIR/.env" APP_PORT)"; port="${port:-3401}"
healthy() { curl -fsS -m 10 "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; }

# ---------- Bestaande cloudflared: naam en netwerk van de testomgeving, het IP-adres elke keer opnieuw ----------
tunnel_container="${TUNNEL_CONTAINER:-$(setting "$MAIN_ENV" TUNNEL_CONTAINER)}"
tunnel_network="${TUNNEL_NETWORK:-$(setting "$MAIN_ENV" TUNNEL_NETWORK)}"
[ -n "$tunnel_container" ] && [ -n "$tunnel_network" ] \
  || die "naam of netwerk van de cloudflared-container niet gevonden in $MAIN_ENV; installeer eerst de testomgeving of geef TUNNEL_CONTAINER en TUNNEL_NETWORK mee"
tunnel_ip="$(docker inspect -f "{{with index .NetworkSettings.Networks \"$tunnel_network\"}}{{.IPAddress}}{{end}}" "$tunnel_container" 2>/dev/null || true)"

if [ "$TIMER" = 1 ]; then
  # Niets te doen bij dezelfde commit, een gezonde app en hetzelfde IP-adres van cloudflared. Is dat adres veranderd
  # (container opnieuw aangemaakt), dan gaat de opstelling opnieuw omhoog met de nieuwe TRUST_PROXY.
  if [ "$target" = "$current" ] && healthy && [ "$tunnel_ip" = "$(setting "$STACK_DIR/.env" TRUST_PROXY)" ]; then exit 0; fi
  # Cloudflared draait even niet: een gezonde staging op de juiste commit blijft staan tot het adres er weer is.
  if [ -z "$tunnel_ip" ] && [ "$target" = "$current" ] && healthy; then
    log "Geen IP-adres van $tunnel_container; staging blijft op ${current:0:7}."
    exit 0
  fi
  if [ "$target" != "$current" ] && [ "$target" = "$(cat "$FAILED_FILE" 2>/dev/null || true)" ]; then
    log "Commit ${target:0:7} van $track faalde eerder; overslaan tot er een nieuwere is."
    exit 0
  fi
fi
[[ "$tunnel_ip" =~ ^[0-9a-fA-F.:]+$ ]] || die "geen IP-adres van $tunnel_container in netwerk $tunnel_network (draait de container?)"
git -C "$REPO_DIR" cat-file -e "$target:deploy/staging/compose.yml" 2>/dev/null \
  || die "origin/$track (${target:0:7}) heeft nog geen deploy/staging; wacht tot main in develop is samengevoegd"

# ---------- Ruimte: een tweede image en database passen alleen als er genoeg vrij is ----------
docker_root="$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)"
free_gb="$(df -BG --output=avail "$docker_root" 2>/dev/null | tail -n 1 | tr -dc '0-9')"
if [ -z "$current" ] && [ -n "$free_gb" ] && [ "$free_gb" -lt "$MIN_FREE_GB" ]; then
  die "te weinig schijfruimte voor staging: $free_gb GB vrij, minstens $MIN_FREE_GB GB nodig. Draai eerst de servertaak 'schijf' of vergroot de schijf."
fi

# Zet de code op een commit, schrijft de instellingen en bouwt en start de opstelling. Uitgangscode 0 = gezond.
deploy() { # <commit>
  git -C "$REPO_DIR" checkout -q --detach "$1" || return 1
  cd "$STACK_DIR" || return 1
  if [ ! -f .env ]; then
    # Eigen geheimen: staging deelt geen sleutel of wachtwoord met de testomgeving.
    (umask 077
     sed -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" \
         -e "s/^APP_DB_PASSWORD=.*/APP_DB_PASSWORD=$(openssl rand -hex 24)/" \
         -e "s/^AVANTA_MASTER_KEY=.*/AVANTA_MASTER_KEY=$(openssl rand -hex 32)/" .env.example > .env)
    echo ".env van staging aangemaakt met eigen geheimen."
  fi
  put_setting SITE_URL "$STAGING_URL"
  put_setting TUNNEL_NETWORK "$tunnel_network"
  put_setting TUNNEL_CONTAINER "$tunnel_container"
  put_setting TRUST_PROXY "$tunnel_ip"
  # Compose geeft omgevingsvariabelen voorrang boven .env: zet ze gelijk aan wat in .env staat.
  export TUNNEL_NETWORK="$tunnel_network" TRUST_PROXY="$tunnel_ip" SITE_URL="$STAGING_URL"

  docker compose build app || return 1
  # Eerst de database, dan de rol van de app (zelfde script als de testomgeving; het wachtwoord via stdin en buiten
  # het log van de databasecontainer), dan de app.
  docker compose up -d --wait db || return 1
  { printf "SET log_statement = 'none'; SET log_min_duration_statement = -1; SET log_min_error_statement = 'panic'; SET log_error_verbosity = 'terse';\n"
    printf "SELECT set_config('avanta.app_password', '%s', false);\n" "$(setting .env APP_DB_PASSWORD)"; cat "$REPO_DIR/deploy/apps01/app-rol.sql"; } \
    | docker compose exec -T db psql -q -v ON_ERROR_STOP=1 -U avanta -d avanta >/dev/null || return 1
  docker compose up -d --remove-orphans || return 1
  for _ in $(seq 1 "${HEALTH_TRIES:-45}"); do
    if healthy; then return 0; fi
    sleep "${HEALTH_WAIT:-2}"
  done
  docker compose logs --tail 30 app >&2 || true
  return 1
}

log "Staging: ${current:0:7} -> ${target:0:7} ($track)"
if deploy "$target"; then
  printf '%s' "$target" > "$BASE_DIR/.deployed-commit"
  rm -f "$FAILED_FILE"
  log "Staging draait op ${target:0:7} ($track)."
else
  printf '%s' "$target" > "$FAILED_FILE"
  if [ -n "$current" ] && [ "$current" != "$target" ]; then
    log "Commit ${target:0:7} start niet goed; terug naar ${current:0:7}."
    deploy "$current" || die "ook de vorige commit ${current:0:7} start niet; controleer de server (journalctl -u avanta-staging-update)"
    die "commit ${target:0:7} van $track is overgeslagen; staging draait weer op ${current:0:7}"
  fi
  die "staging start niet op ${target:0:7}; zie de regels hierboven"
fi

# Alleen oude images van staging opruimen, niet die van de testomgeving of andere opstellingen.
docker image prune -f --filter label=nl.avantareizen.stack=avanta-staging >/dev/null || true

# ---------- Automatisch bijwerken: dit script elke 15 minuten via een systemd-timer ----------
if command -v systemctl >/dev/null && { [ -n "$TEST_ROOT" ] || [ -d /run/systemd/system ]; }; then
  # Via een tijdelijk bestand en mv: de timer kan dit script op dat moment draaien.
  install -m 755 "$STACK_DIR/install-staging.sh" "$SBIN_DIR/.avanta-staging-update.new"
  mv -f "$SBIN_DIR/.avanta-staging-update.new" "$SBIN_DIR/avanta-staging-update"
  cat > "$SYSTEMD_DIR/avanta-staging-update.service" <<UNIT
[Unit]
Description=Avanta staging bijwerken
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
Environment=BASE_DIR=$BASE_DIR
Environment=MAIN_ENV=$MAIN_ENV
Environment=STAGING_URL=$STAGING_URL
ExecStart=/usr/local/sbin/avanta-staging-update --timer
TimeoutStartSec=30min
Nice=10
UNIT
  cat > "$SYSTEMD_DIR/avanta-staging-update.timer" <<'UNIT'
[Unit]
Description=Avanta staging elke 15 minuten bijwerken

[Timer]
OnBootSec=7min
OnUnitActiveSec=15min
RandomizedDelaySec=60

[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now avanta-staging-update.timer >/dev/null
fi

[ "$TIMER" = 1 ] && exit 0

# ---------- Eerste keer: verzonnen testdata (nooit gegevens van de testomgeving) ----------
cd "$STACK_DIR"
trips="$(docker compose exec -T db psql -U avanta -d avanta -tAc 'SELECT count(*) FROM trips' 2>/dev/null || echo onbekend)"
if [ "$trips" = "0" ]; then
  echo "Database van staging is leeg: verzonnen testdata vullen."
  docker compose exec -T app node src/dev/seed/cli.js vullen --testomgeving \
    || echo "WAARSCHUWING: testdata vullen mislukt; staging draait wel. Probeer het later opnieuw met dit script." >&2
fi

host="${STAGING_URL#https://}"
cat <<TEXT

Staging draait op de server (127.0.0.1:$port) en volgt de branch $track.
Nog één keer met de hand, in Cloudflare (Zero Trust > Networks > Tunnels > de bestaande tunnel > Public Hostname > Add):
  Hostname : $host
  Service  : http://avanta-staging-app:3400
Zet daarna een Access-toepassing op $host (Zero Trust > Access > Applications) met een beleid dat alleen je eigen
e-mailadres toelaat: staging is niet bedoeld voor bezoekers.
De installatiecode voor de eerste beheerder staat in het logboek van de app:
  sudo docker logs avanta-staging-app-1 2>&1 | grep -o 'installatiecode .*' | tail -1
TEXT
}

# Alles staat in main(): bash leest het hele script vóór het start, zodat het zichzelf tijdens een run veilig kan vervangen.
main "$@"
exit $?
