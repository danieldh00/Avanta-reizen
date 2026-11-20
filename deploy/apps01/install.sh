#!/usr/bin/env bash
# Installeert of werkt de testomgeving bij op apps01 (herhaalbaar): repo op de gekozen ref, .env met gegenereerde
# geheimen bij de eerste keer, koppeling aan het netwerk van de bestaande cloudflared, image bouwen, stack starten,
# gezondheid controleren en bij een lege database de content importeren.
# Draait als root op apps01; normaal aangeroepen door pve-setup.sh vanaf de Proxmox-host.
# Gebruik: sudo install.sh [git-ref]      Optioneel: TUNNEL_CONTAINER (standaard aquatech-cloudflared), BASE_DIR,
#          INSTALL_PHASE=build (alleen code ophalen en het image bouwen; update.sh doet dat vóór de onderhoudsmodus).
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
# Keuze van het netwerk: TUNNEL_NETWORK (omgeving of bestaande .env) is leidend; anders alleen als de container in
# precies één netwerk zit. Nooit raden: bij meerdere netwerken kan er een met de Aquatech-database tussen zitten.
networks="$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$TUNNEL_CONTAINER" | grep -v '^$' || true)"
[ -n "${TUNNEL_NETWORK:-}" ] || TUNNEL_NETWORK="$(sed -n 's/^TUNNEL_NETWORK=//p' "$STACK_DIR/.env" 2>/dev/null | tail -n 1 || true)"
if [ -n "${TUNNEL_NETWORK:-}" ]; then
  grep -qx "$TUNNEL_NETWORK" <<<"$networks" || die "$TUNNEL_CONTAINER zit niet in netwerk $TUNNEL_NETWORK (wel in: $(echo $networks))"
  tunnel_network="$TUNNEL_NETWORK"
elif [ "$(grep -c . <<<"$networks")" = "1" ]; then
  tunnel_network="$networks"
else
  die "$TUNNEL_CONTAINER zit in meerdere netwerken ($(echo $networks)); kies er een met TUNNEL_NETWORK=<naam>"
fi
[ "$tunnel_network" != "host" ] || die "$TUNNEL_CONTAINER gebruikt network_mode host; dat wordt niet ondersteund"

mkdir -p "$BASE_DIR"
[ -d "$REPO_DIR/.git" ] || git clone -q "$REPO_URL" "$REPO_DIR"
git -C "$REPO_DIR" fetch -q --prune origin
git -C "$REPO_DIR" checkout -q --detach "origin/$REF" 2>/dev/null || git -C "$REPO_DIR" checkout -q --detach "$REF"
echo "Code op $(git -C "$REPO_DIR" rev-parse --short HEAD) ($REF)"

cd "$STACK_DIR"
if [ ! -f .env ]; then
  # Verhuizing (docs/DRAAIBOEK-VPS-VERHUIZING.md): geef de bestaande hoofdsleutel mee als AVANTA_MASTER_KEY, anders zijn
  # de back-ups en de versleutelde gegevens van de oude server hier onleesbaar. Zonder: een nieuwe sleutel.
  master_key="${AVANTA_MASTER_KEY:-}"
  if [ -n "$master_key" ]; then
    [[ "$master_key" =~ ^[0-9a-fA-F]{64}$ ]] || die "AVANTA_MASTER_KEY moet 64 hex-tekens zijn"
  else
    master_key="$(openssl rand -hex 32)"
  fi
  (umask 077
   sed -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" \
       -e "s/^AVANTA_MASTER_KEY=.*/AVANTA_MASTER_KEY=$master_key/" .env.example > .env)
  unset master_key
  echo ".env aangemaakt met nieuwe geheimen (bewaar AVANTA_MASTER_KEY ook apart, bijv. in de wachtwoordkluis)."
fi
# Exact adres van cloudflared in dat netwerk: de enige proxy die de app vertrouwt (TRUST_PROXY, geen subnet).
tunnel_ip="$(docker inspect -f "{{(index .NetworkSettings.Networks \"$tunnel_network\").IPAddress}}" "$TUNNEL_CONTAINER")"
[ -n "$tunnel_ip" ] || die "geen IP-adres van $TUNNEL_CONTAINER in $tunnel_network (draait de container?)"
for key in TUNNEL_NETWORK TRUST_PROXY TUNNEL_CONTAINER; do grep -q "^$key=" .env || echo "$key=" >> .env; done
grep -q '^AVANTA_TRACK=' .env || echo 'AVANTA_TRACK=main' >> .env
sed -i -e "s|^TUNNEL_NETWORK=.*|TUNNEL_NETWORK=$tunnel_network|" -e "s|^TRUST_PROXY=.*|TRUST_PROXY=$tunnel_ip|" \
       -e "s|^TUNNEL_CONTAINER=.*|TUNNEL_CONTAINER=$TUNNEL_CONTAINER|" .env
# Compose geeft omgevingsvariabelen voorrang boven .env: zet ze hier gelijk aan wat in .env staat.
export TUNNEL_NETWORK="$tunnel_network" TRUST_PROXY="$tunnel_ip"
echo "Gekoppeld aan netwerk $tunnel_network van $TUNNEL_CONTAINER (alias avanta-app); TRUST_PROXY=$tunnel_ip."

# Updaten vanuit de app (Beheer > Systeem > Updates en onderhoud): de statusmap schrijft alleen update.sh (root, in de
# container alleen-lezen), de aanvraagmap is van de app (uid 1000 = gebruiker node in het image). Zie update.sh.
update_dir="$BASE_DIR/update"
install -d -m 755 "$update_dir" "$update_dir/status"
install -d -m 755 -o 1000 -g 1000 "$update_dir/request"
grep -q '^UPDATE_DIR=' .env || echo "UPDATE_DIR=$update_dir" >> .env
sed -i "s|^UPDATE_DIR=.*|UPDATE_DIR=$update_dir|" .env
export UPDATE_DIR="$update_dir"

if [ "${INSTALL_PHASE:-}" = "build" ]; then
  docker compose build app
  echo "Image gebouwd voor $(git -C "$REPO_DIR" rev-parse --short HEAD); nog niet gestart."
  exit 0
fi

docker compose up -d --build --remove-orphans

# Automatisch bijwerken: update.sh via een systemd-timer (elke 15 minuten de branch AVANTA_TRACK volgen).
if command -v systemctl >/dev/null && [ -d /run/systemd/system ]; then
  # Via een tijdelijk bestand en mv (nieuw bestand, geen overschrijven): update.sh draait mogelijk nog terwijl dit gebeurt.
  install -m 755 "$STACK_DIR/update.sh" /usr/local/sbin/.avanta-update.new
  mv -f /usr/local/sbin/.avanta-update.new /usr/local/sbin/avanta-update
  cat > /etc/systemd/system/avanta-update.service <<UNIT
[Unit]
Description=Avanta testomgeving bijwerken
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
Environment=BASE_DIR=$BASE_DIR
ExecStart=/usr/local/sbin/avanta-update
TimeoutStartSec=30min
UNIT
  cat > /etc/systemd/system/avanta-update.timer <<'UNIT'
[Unit]
Description=Avanta testomgeving elke 15 minuten bijwerken

[Timer]
OnBootSec=5min
OnUnitActiveSec=15min
RandomizedDelaySec=60

[Install]
WantedBy=timers.target
UNIT
  # Meteen bijwerken of controleren zodra de app een aanvraag neerzet (update.sh haalt request.json altijd als eerste weg).
  cat > /etc/systemd/system/avanta-update-now.path <<UNIT
[Unit]
Description=Avanta bijwerken op aanvraag vanuit Beheer

[Path]
PathExists=$update_dir/request/request.json
Unit=avanta-update.service

[Install]
WantedBy=paths.target
UNIT
  # Wekelijkse hersteltest van de back-ups (zondag 04:30) en op verzoek vanuit Beheer (bestand restore-test-now in het
  # datavolume van de app, opgepikt door een path-unit).
  install -m 755 "$STACK_DIR/restore-test.sh" /usr/local/sbin/avanta-restore-test
  data_volume="$(docker volume inspect -f '{{.Mountpoint}}' avanta_app-data 2>/dev/null || true)"
  for kind in schema handmatig; do
    unit=avanta-restore-test; [ "$kind" = handmatig ] && unit=avanta-restore-test-now
    # Het verzoek van de knop weghalen vóór het script start: de path-unit (PathExists) start de service anders
    # steeds opnieuw zolang het bestand er staat, ook als het script direct stopt (er loopt al een test).
    pre_start=""
    if [ "$kind" = handmatig ] && [ -n "$data_volume" ]; then pre_start="ExecStartPre=/bin/rm -f $data_volume/backups/restore-test-now
"; fi
    cat > "/etc/systemd/system/$unit.service" <<UNIT
[Unit]
Description=Avanta hersteltest van de back-ups ($kind)
After=docker.service

[Service]
Type=oneshot
Environment=BASE_DIR=$BASE_DIR
${pre_start}ExecStart=/usr/local/sbin/avanta-restore-test $kind
TimeoutStartSec=45min
Nice=10
UNIT
  done
  cat > /etc/systemd/system/avanta-restore-test.timer <<'UNIT'
[Unit]
Description=Avanta wekelijkse hersteltest van de back-ups

[Timer]
OnCalendar=Sun *-*-* 04:30:00
Persistent=true
RandomizedDelaySec=10min

[Install]
WantedBy=timers.target
UNIT
  if [ -n "$data_volume" ]; then
    cat > /etc/systemd/system/avanta-restore-test-now.path <<UNIT
[Unit]
Description=Avanta hersteltest op verzoek vanuit Beheer

[Path]
PathExists=$data_volume/backups/restore-test-now
Unit=avanta-restore-test-now.service

[Install]
WantedBy=paths.target
UNIT
  fi
  systemctl daemon-reload
  systemctl enable --now avanta-update.timer >/dev/null
  systemctl enable --now avanta-update-now.path >/dev/null
  systemctl enable --now avanta-restore-test.timer >/dev/null
  if [ -n "$data_volume" ]; then systemctl enable --now avanta-restore-test-now.path >/dev/null; fi
  echo "Automatisch bijwerken actief: avanta-update.timer (volgt $(sed -n 's/^AVANTA_TRACK=//p' .env); logboek: journalctl -u avanta-update)."
fi

port="$(sed -n 's/^APP_PORT=//p' .env)"; port="${port:-3400}"
for _ in $(seq 1 45); do
  if curl -fsS "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; then
    echo "App gezond op 127.0.0.1:$port."
    # Import alleen bij een aantoonbaar lege database; een mislukte import laat de installatie niet falen
    # (anders zou update.sh terugrollen terwijl de app gezond is).
    trips="$(docker compose exec -T db psql -U avanta -d avanta -tAc 'SELECT count(*) FROM trips' 2>/dev/null || echo onbekend)"
    if [ "$trips" = "0" ]; then
      echo "Database leeg: content en afbeeldingen van www.avantareizen.nl importeren (enkele minuten)..."
      docker compose exec -T app node tools/import-wordpress.js \
        || echo "WAARSCHUWING: import mislukt; volgende run probeert het opnieuw." >&2
    fi
    docker compose ps
    # Alleen oude images van deze stack opruimen, niet die van andere stacks op apps01.
    docker image prune -f --filter label=nl.avantareizen.stack=avanta >/dev/null
    exit 0
  fi
  sleep 2
done
docker compose logs --tail 30 app >&2
die "app niet gezond na de wachttijd"
