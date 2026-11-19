#!/usr/bin/env bash
# Installeert of werkt de testomgeving bij op apps01 (herhaalbaar): repo op de gekozen ref, .env met gegenereerde
# geheimen bij de eerste keer, image bouwen, stack starten en de gezondheid controleren.
# Draait als root op apps01; normaal aangeroepen door pve-setup.sh vanaf de Proxmox-host.
# Gebruik: sudo install.sh [git-ref]   (TUNNEL_TOKEN_FILE=<bestand> geeft het tunnel-token mee)
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/danieldh00/Avanta-reizen.git}"
BASE_DIR="${BASE_DIR:-/opt/avanta}"
REF="${1:-${AVANTA_REF:-main}}"
REPO_DIR="$BASE_DIR/repo"
STACK_DIR="$REPO_DIR/deploy/apps01"

[ "$(id -u)" -eq 0 ] || { echo "Draai dit als root (sudo)" >&2; exit 1; }
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  echo "Docker Engine + compose-plugin installeren (get.docker.com)..."
  command -v curl >/dev/null || { apt-get update -qq && apt-get install -y -qq curl ca-certificates; }
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi
command -v git >/dev/null || { apt-get update -qq && apt-get install -y -qq git; }

for tool in git docker openssl curl; do
  command -v "$tool" >/dev/null || { echo "Ontbreekt: $tool" >&2; exit 1; }
done
docker compose version >/dev/null || { echo "Docker compose-plugin ontbreekt" >&2; exit 1; }

mkdir -p "$BASE_DIR"
if [ ! -d "$REPO_DIR/.git" ]; then
  git clone "$REPO_URL" "$REPO_DIR"
fi
git -C "$REPO_DIR" fetch --prune origin
git -C "$REPO_DIR" checkout -q --detach "origin/$REF" 2>/dev/null || git -C "$REPO_DIR" checkout -q --detach "$REF"
echo "Code op $(git -C "$REPO_DIR" rev-parse --short HEAD) ($REF)"

cd "$STACK_DIR"
if [ ! -f .env ]; then
  umask 077
  sed -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" \
      -e "s/^AVANTA_MASTER_KEY=.*/AVANTA_MASTER_KEY=$(openssl rand -hex 32)/" .env.example > .env
  echo ".env aangemaakt met nieuwe geheimen (bewaar AVANTA_MASTER_KEY ook apart)."
fi

if [ -n "${TUNNEL_TOKEN_FILE:-}" ] && [ -s "$TUNNEL_TOKEN_FILE" ]; then
  token="$(tr -d '[:space:]' < "$TUNNEL_TOKEN_FILE")"
  sed -i "s|^TUNNEL_TOKEN=.*|TUNNEL_TOKEN=$token|" .env
  sed -i "s|^COMPOSE_PROFILES=.*|COMPOSE_PROFILES=tunnel|" .env
  rm -f "$TUNNEL_TOKEN_FILE"
fi
if grep -q '^COMPOSE_PROFILES=tunnel' .env && ! grep -q '^TUNNEL_TOKEN=.\+' .env; then
  read -r -s -p "Plak het TUNNEL_TOKEN uit het Cloudflare-dashboard: " token; echo
  [ -n "$token" ] || { echo "Geen token opgegeven" >&2; exit 1; }
  sed -i "s|^TUNNEL_TOKEN=.*|TUNNEL_TOKEN=$token|" .env
fi

docker compose up -d --build --remove-orphans

port="$(grep -E '^APP_PORT=' .env | cut -d= -f2)"
for attempt in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${port:-3400}/api/health" >/dev/null 2>&1; then
    echo "App gezond op poort ${port:-3400}."
    trips="$(docker compose exec -T db psql -U avanta -d avanta -tAc 'SELECT count(*) FROM trips' 2>/dev/null || echo 0)"
    if [ "${trips:-0}" = "0" ]; then
      echo "Database leeg: content en afbeeldingen van www.avantareizen.nl importeren (duurt enkele minuten)..."
      docker compose exec -T app node tools/import-wordpress.js
    fi
    docker compose ps
    docker image prune -f >/dev/null
    exit 0
  fi
  sleep 2
done
echo "App niet gezond na 60 s; laatste logregels:" >&2
docker compose logs --tail 30 app >&2
exit 1
