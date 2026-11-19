#!/usr/bin/env bash
# Eén commando op de Proxmox-host (als root): installeert of werkt de Avanta-testomgeving bij op apps01 en voegt aan de
# bestaande tunnel (aquatech-cloudflared) een losse public hostname toe: avanta.den-hollander.com -> http://avanta-app:3400.
# Geen nieuwe tunnel. Herhaalbaar. apps01 wordt gezocht zoals in Aquatech: LXC via pct exec, anders ssh als
# daniel@apps01 met sudo -n (root-login via ssh staat uit).
#
# Gebruik (vaste commit, zie deploy/apps01/README.md):
#   AVANTA_REF=<sha> bash <(curl -fsSL https://raw.githubusercontent.com/danieldh00/Avanta-reizen/<sha>/deploy/apps01/pve-setup.sh)
# Optioneel: APPS01_NAME (apps01), APPS01_CTID, APPS01_SSH (daniel@apps01), TUNNEL_CONTAINER (aquatech-cloudflared),
#            HOSTNAME_FQDN (avanta.den-hollander.com), CF_API_TOKEN (anders gevraagd; leeg = hostname met de hand).
set -euo pipefail

REF="${AVANTA_REF:?zet AVANTA_REF op de commit-SHA (of branch) die je wilt uitrollen}"
NAME="${APPS01_NAME:-apps01}"
FQDN="${HOSTNAME_FQDN:-avanta.den-hollander.com}"
ZONE="${CF_ZONE:-${FQDN#*.}}"
TUNNEL_CONTAINER="${TUNNEL_CONTAINER:-aquatech-cloudflared}"
SERVICE_URL="http://avanta-app:3400"
RAW="https://raw.githubusercontent.com/danieldh00/Avanta-reizen/${REF}/deploy/apps01/install.sh"
API="https://api.cloudflare.com/client/v4"

die() { echo "FOUT: $*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "draai dit als root op de Proxmox-host"
command -v python3 >/dev/null || die "python3 ontbreekt"

# ---------- 1. Gast-systeem zoeken: LXC (pct exec) of VM/host (ssh + sudo -n) ----------
MODE=""; GUEST_ID="${APPS01_CTID:-}"; SSH_TARGET="${APPS01_SSH:-}"
if [ -z "$SSH_TARGET" ] && [ -z "$GUEST_ID" ] && command -v pct >/dev/null; then
  GUEST_ID="$(pct list 2>/dev/null | awk -v n="$NAME" 'NR>1 && $NF==n {print $1; exit}')"
fi
if [ -n "$GUEST_ID" ]; then
  MODE="pct"; echo "apps01: LXC $GUEST_ID"
else
  MODE="ssh"; SSH_TARGET="${SSH_TARGET:-daniel@$NAME}"; echo "apps01: ssh $SSH_TARGET"
fi
SUDO=""; [ "$MODE" = "ssh" ] && [ "${SSH_TARGET%%@*}" != "root" ] && SUDO="sudo -n"

# run_guest SCRIPT: voert een bash-script als root uit op apps01.
run_guest() {
  if [ "$MODE" = "pct" ]; then pct exec "$GUEST_ID" -- bash -c "$1"
  else ssh -o ConnectTimeout=10 "$SSH_TARGET" "$SUDO bash -c $(printf '%q' "$1")"; fi
}
run_guest true || die "apps01 niet bereikbaar (of sudo vraagt een wachtwoord); zet APPS01_SSH of APPS01_CTID"

# ---------- 2. Installatie op apps01 ----------
run_guest "set -euo pipefail
tmp=\$(mktemp -d); trap 'rm -rf \"\$tmp\"' EXIT
curl -fsSL '$RAW' -o \"\$tmp/install.sh\"
TUNNEL_CONTAINER='$TUNNEL_CONTAINER' bash \"\$tmp/install.sh\" '$REF'"

# ---------- 3. Losse public hostname op de bestaande tunnel ----------
# Account- en tunnel-id uit het token van de draaiende cloudflared (het geheime deel verlaat apps01 niet).
ids="$(run_guest "docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' '$TUNNEL_CONTAINER' \
  | sed -n 's/^TUNNEL_TOKEN=//p' | base64 -d 2>/dev/null \
  | sed -n 's/.*\"a\":\"\([^\"]*\)\".*\"t\":\"\([^\"]*\)\".*/\1 \2/p'" || true)"
read -r account_id tunnel_id <<<"${ids:-}"

manual() {
  echo
  echo "Voeg met de hand de binding toe in Cloudflare: Zero Trust > Networks > Tunnels > ${1:-de tunnel van $TUNNEL_CONTAINER}"
  echo "  > Public Hostname > Add: subdomain '${FQDN%%.*}', domain '$ZONE', type HTTP, URL 'avanta-app:3400'."
}

if [ -z "${account_id:-}" ] || [ -z "${tunnel_id:-}" ]; then
  echo "Tunnel-id niet uit $TUNNEL_CONTAINER te lezen (geen TUNNEL_TOKEN?)."; manual
  exit 0
fi
echo "Bestaande tunnel: $tunnel_id"

if [ -z "${CF_API_TOKEN:-}" ]; then
  echo "Cloudflare API-token voor de binding (Account > Cloudflare Tunnel > Edit, Zone > DNS > Edit, beperkt tot $ZONE)."
  read -r -s -p "Plak het token, of laat leeg om de hostname zelf in het dashboard toe te voegen: " CF_API_TOKEN; echo
fi
[ -n "$CF_API_TOKEN" ] || { manual "$tunnel_id"; exit 0; }

# cf METHODE PAD [JSON-BESTAND]: Cloudflare-API; stopt bij success=false.
cf() {
  local out
  out="$(curl -sS -X "$1" "$API$2" -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" ${3:+--data-binary "@$3"})"
  python3 -c 'import json,sys
r=json.loads(sys.argv[1])
if not r.get("success"): sys.exit("Cloudflare-fout: " + json.dumps(r.get("errors")))' "$out"
  printf '%s' "$out"
}
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT

# Ingress: bestaande regels behouden; regel voor FQDN toevoegen vóór de catch-all, of bijwerken als hij er al is.
cf GET "/accounts/$account_id/cfd_tunnel/$tunnel_id/configurations" > "$work/current.json"
python3 - "$work/current.json" "$work/new.json" "$FQDN" "$SERVICE_URL" <<'PY'
import json, sys
current, target, fqdn, service = sys.argv[1:5]
config = (json.load(open(current)).get("result") or {}).get("config") or {}
ingress = config.get("ingress") or [{"service": "http_status:404"}]
for rule in ingress:
    if rule.get("hostname") == fqdn:
        rule["service"] = service
        break
else:
    position = len(ingress) - 1 if ingress and "hostname" not in ingress[-1] else len(ingress)
    ingress.insert(position, {"hostname": fqdn, "service": service})
if "hostname" in ingress[-1]:
    ingress.append({"service": "http_status:404"})
config["ingress"] = ingress
json.dump({"config": config}, open(target, "w"))
print("Ingress-regels:", ", ".join(r.get("hostname", "(rest) " + r["service"]) for r in ingress))
PY
cf PUT "/accounts/$account_id/cfd_tunnel/$tunnel_id/configurations" "$work/new.json" >/dev/null
echo "Binding $FQDN -> $SERVICE_URL op de bestaande tunnel gezet."

# DNS: proxied CNAME naar de tunnel; een andere bestaande record wordt niet overschreven.
zone_id="$(cf GET "/zones?name=$ZONE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"][0]["id"])')"
target="$tunnel_id.cfargotunnel.com"
cf GET "/zones/$zone_id/dns_records?name=$FQDN" > "$work/dns.json"
read -r record_id record_type record_content <<<"$(python3 -c 'import json,sys
r=(json.load(open(sys.argv[1]))["result"] or [{}])[0]
print(r.get("id","-"), r.get("type","-"), r.get("content","-"))' "$work/dns.json")"
printf '{"type":"CNAME","name":"%s","content":"%s","proxied":true,"comment":"Avanta test"}' "$FQDN" "$target" > "$work/record.json"
if [ "$record_id" = "-" ]; then
  cf POST "/zones/$zone_id/dns_records" "$work/record.json" >/dev/null; echo "DNS: CNAME $FQDN -> $target aangemaakt."
elif [ "$record_type" = "CNAME" ] && [ "$record_content" = "$target" ]; then
  echo "DNS: CNAME $FQDN -> $target bestond al."
else
  die "DNS: $FQDN bestaat al als $record_type -> $record_content; verwijder die record eerst (ik overschrijf hem niet)."
fi

echo; echo "Controle (kan een minuut duren):"
for _ in $(seq 1 12); do
  if curl -fsS "https://$FQDN/api/health" 2>/dev/null; then echo; echo "Klaar: https://$FQDN/ (noindex)."; exit 0; fi
  sleep 5
done
echo "https://$FQDN/ reageert nog niet; controleer over een paar minuten opnieuw."
