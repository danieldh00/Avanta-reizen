#!/usr/bin/env bash
# Automatisch bijwerken van de testomgeving op apps01 (systemd-timer avanta-update.timer, elke 15 minuten).
# Volgt de branch AVANTA_TRACK uit .env (standaard main): bij een nieuwe commit draait install.sh op die commit; mislukt
# de gezondheidscheck, dan gaat de stack terug naar de vorige commit. Verandert alleen het IP van de cloudflared-container,
# dan zet install.sh TRUST_PROXY opnieuw (zelfde commit). Logboek: journalctl -u avanta-update.
# Let op: migraties lopen alleen vooruit; een rollback zet de code terug, niet de database.
set -euo pipefail

BASE_DIR="${BASE_DIR:-/opt/apps/avanta}"
REPO_DIR="$BASE_DIR/repo"
STACK_DIR="$REPO_DIR/deploy/apps01"
ENV_FILE="$STACK_DIR/.env"

exec 9>/run/avanta-update.lock
flock -n 9 || { echo "Er loopt al een update."; exit 0; }

setting() { sed -n "s/^$1=//p" "$ENV_FILE" 2>/dev/null | tail -n 1; }
track="$(setting AVANTA_TRACK)"; track="${track:-main}"
tunnel_container="$(setting TUNNEL_CONTAINER)"; tunnel_container="${tunnel_container:-aquatech-cloudflared}"

git -C "$REPO_DIR" fetch -q --prune origin
current="$(git -C "$REPO_DIR" rev-parse HEAD)"
target="$(git -C "$REPO_DIR" rev-parse "origin/$track")"

# Huidig IP van cloudflared in het tunnelnetwerk tegenover TRUST_PROXY in .env.
network="$(setting TUNNEL_NETWORK)"
tunnel_ip="$(docker inspect -f "{{with index .NetworkSettings.Networks \"$network\"}}{{.IPAddress}}{{end}}" "$tunnel_container" 2>/dev/null || true)"
ip_changed=false
[ -n "$tunnel_ip" ] && [ "$tunnel_ip" != "$(setting TRUST_PROXY)" ] && ip_changed=true

run_install() { # run_install COMMIT: install.sh van die commit draaien
  local script; script="$(mktemp)"
  git -C "$REPO_DIR" show "$1:deploy/apps01/install.sh" > "$script"
  local status=0
  TUNNEL_CONTAINER="$tunnel_container" bash "$script" "$1" || status=$?
  rm -f "$script"; return $status
}

if [ "$target" != "$current" ]; then
  if ! git -C "$REPO_DIR" cat-file -e "$target:deploy/apps01/install.sh" 2>/dev/null; then
    echo "origin/$track ($target) heeft nog geen deploy/apps01; blijf op ${current:0:7}."
  else
    echo "Nieuwe commit op $track: ${current:0:7} -> ${target:0:7}"
    if run_install "$target"; then
      echo "Bijgewerkt naar ${target:0:7}."
      exit 0
    fi
    echo "Update naar ${target:0:7} mislukt; terug naar ${current:0:7}." >&2
    run_install "$current" || echo "Rollback mislukt; controleer met: cd $STACK_DIR && docker compose ps" >&2
    exit 1
  fi
fi

if $ip_changed; then
  echo "IP van $tunnel_container veranderd naar $tunnel_ip; TRUST_PROXY bijwerken."
  run_install "$current"
fi
