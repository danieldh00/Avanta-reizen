#!/usr/bin/env bash
# Installeert of werkt de testomgeving bij op apps01 (herhaalbaar): repo op de gekozen ref, .env met gegenereerde
# geheimen bij de eerste keer, koppeling aan het netwerk van de bestaande cloudflared, image bouwen, stack starten,
# gezondheid controleren en bij een lege database de content importeren.
# Draait als root op apps01; normaal aangeroepen door pve-setup.sh vanaf de Proxmox-host.
# Gebruik: sudo install.sh [git-ref]      Optioneel: TUNNEL_CONTAINER (standaard aquatech-cloudflared), BASE_DIR.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/danieldh00/Avanta-reizen.git}"
BASE_DIR="${BASE_DIR:-/opt/apps/avanta}"
REF="${1:-${AVANTA_REF:-main}}"
TUNNEL_CONTAINER="${TUNNEL_CONTAINER:-aquatech-cloudflared}"
REPO_DIR="$BASE_DIR/repo"
STACK_DIR="$REPO_DIR/deploy/apps01"

die() { echo "FOUT: $*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "draai dit als root (sudo)"
for tool in git docker openssl curl; do command -v "$tool" >/dev/null || die "ontbreekt: $tool"; done
docker compose version >/dev/null 2>&1 || die "docker compose-plugin ontbreekt"

# Bestaande tunnel: het (eerste) Docker-netwerk van de cloudflared-container.
docker inspect "$TUNNEL_CONTAINER" >/dev/null 2>&1 || die "container $TUNNEL_CONTAINER niet gevonden (zet TUNNEL_CONTAINER=<naam>)"
tunnel_network="$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$TUNNEL_CONTAINER" | grep -v '^$' | head -n 1)"
[ -n "$tunnel_network" ] && [ "$tunnel_network" != "host" ] || die "$TUNNEL_CONTAINER zit niet in een Docker-netwerk (network_mode host?)"

mkdir -p "$BASE_DIR"
[ -d "$REPO_DIR/.git" ] || git clone -q "$REPO_URL" "$REPO_DIR"
git -C "$REPO_DIR" fetch -q --prune origin
git -C "$REPO_DIR" checkout -q --detach "origin/$REF" 2>/dev/null || git -C "$REPO_DIR" checkout -q --detach "$REF"
echo "Code op $(git -C "$REPO_DIR" rev-parse --short HEAD) ($REF)"

cd "$STACK_DIR"
if [ ! -f .env ]; then
  (umask 077
   sed -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" \
       -e "s/^AVANTA_MASTER_KEY=.*/AVANTA_MASTER_KEY=$(openssl rand -hex 32)/" .env.example > .env)
  echo ".env aangemaakt met nieuwe geheimen (bewaar AVANTA_MASTER_KEY ook apart, bijv. in de wachtwoordkluis)."
fi
grep -q '^TUNNEL_NETWORK=' .env || echo 'TUNNEL_NETWORK=' >> .env
sed -i "s|^TUNNEL_NETWORK=.*|TUNNEL_NETWORK=$tunnel_network|" .env
echo "Gekoppeld aan netwerk $tunnel_network van $TUNNEL_CONTAINER (alias avanta-app)."

docker compose up -d --build --remove-orphans

port="$(sed -n 's/^APP_PORT=//p' .env)"; port="${port:-3400}"
for _ in $(seq 1 45); do
  if curl -fsS "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; then
    echo "App gezond op 127.0.0.1:$port."
    trips="$(docker compose exec -T db psql -U avanta -d avanta -tAc 'SELECT count(*) FROM trips' 2>/dev/null || echo 0)"
    if [ "${trips:-0}" = "0" ]; then
      echo "Database leeg: content en afbeeldingen van www.avantareizen.nl importeren (enkele minuten)..."
      docker compose exec -T app node tools/import-wordpress.js
    fi
    docker compose ps
    docker image prune -f >/dev/null
    exit 0
  fi
  sleep 2
done
docker compose logs --tail 30 app >&2
die "app niet gezond na 90 s"
