#!/usr/bin/env bash
# Eén commando op de Proxmox-host (als root): richt Cloudflare Tunnel + DNS in voor avanta.den-hollander.com en
# installeert of werkt de Avanta-stack bij op de gast apps01 (LXC via pct, VM via ssh als gewone gebruiker + sudo).
# Herhaalbaar: een bestaande tunnel, DNS-record en .env worden hergebruikt.
#
# Gebruik (vaste commit, zie deploy/apps01/README.md):
#   AVANTA_REF=<sha> bash <(curl -fsSL https://raw.githubusercontent.com/danieldh00/Avanta-reizen/<sha>/deploy/apps01/pve-setup.sh)
# Optioneel: GUEST=apps01  SSH_TARGET=gebruiker@apps01  CF_API_TOKEN=…  HOSTNAME_FQDN=avanta.den-hollander.com
set -euo pipefail

REF="${AVANTA_REF:?zet AVANTA_REF op de commit-SHA (of branch) die je wilt uitrollen}"
GUEST="${GUEST:-apps01}"
FQDN="${HOSTNAME_FQDN:-avanta.den-hollander.com}"
ZONE="${CF_ZONE:-${FQDN#*.}}"
TUNNEL_NAME="${TUNNEL_NAME:-avanta-${GUEST}}"
RAW="https://raw.githubusercontent.com/danieldh00/Avanta-reizen/${REF}/deploy/apps01/install.sh"
API="https://api.cloudflare.com/client/v4"

[ "$(id -u)" -eq 0 ] || { echo "Draai dit als root op de Proxmox-host" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 ontbreekt" >&2; exit 1; }

# ---- 1. Gast vinden: LXC (pct) of VM (qm + ssh) ---------------------------------------------------------------
mode=""; ctid=""
if command -v pct >/dev/null; then
  ctid="$(pct list 2>/dev/null | awk -v n="$GUEST" 'NR>1 && $NF==n {print $1; exit}')"
fi
if [ -n "$ctid" ]; then
  mode="lxc"
  [ "$(pct status "$ctid" | awk '{print $2}')" = "running" ] || pct start "$ctid"
  if ! pct config "$ctid" | grep -q '^features:.*nesting=1'; then
    echo "Let op: LXC $ctid heeft geen nesting=1; Docker heeft dat nodig (pct set $ctid --features nesting=1,keyctl=1 en herstart)." >&2
    exit 1
  fi
  echo "Gast $GUEST gevonden als LXC $ctid."
else
  mode="ssh"
  SSH_TARGET="${SSH_TARGET:-$GUEST}"
  echo "Gast $GUEST: geen LXC gevonden, verbinden via ssh $SSH_TARGET (gewone gebruiker met sudo)."
  ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_TARGET" true 2>/dev/null \
    || ssh -o ConnectTimeout=10 "$SSH_TARGET" true \
    || { echo "ssh naar $SSH_TARGET lukt niet; zet SSH_TARGET=gebruiker@host" >&2; exit 1; }
fi

# ---- 2. Cloudflare: tunnel, ingress en DNS via de API (of handmatig token) -------------------------------------
cf() { # cf METHOD PAD [JSON] -> JSON-antwoord; stopt bij success=false
  local response
  response="$(curl -sS -X "$1" "$API$2" -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" ${3:+--data "$3"})"
  python3 -c 'import json,sys; r=json.loads(sys.argv[1]); sys.exit(0 if r.get("success") else (print("Cloudflare-fout: "+json.dumps(r.get("errors")), file=sys.stderr) or 1))' "$response"
  printf '%s' "$response"
}
jq_py() { python3 -c "import json,sys; r=json.load(sys.stdin); print($1)"; }

TUNNEL_TOKEN=""
if [ -z "${CF_API_TOKEN:-}" ]; then
  echo
  echo "Cloudflare API-token (rechten: Account > Cloudflare Tunnel > Edit, Zone > DNS > Edit, Zone > Zone > Read)."
  read -r -s -p "Plak het API-token, of laat leeg om zelf een tunnel-token te plakken: " CF_API_TOKEN; echo
fi
if [ -n "$CF_API_TOKEN" ]; then
  zone_json="$(cf GET "/zones?name=$ZONE")"
  zone_id="$(jq_py 'r["result"][0]["id"]' <<<"$zone_json")"
  account_id="$(jq_py 'r["result"][0]["account"]["id"]' <<<"$zone_json")"

  tunnel_id="$(cf GET "/accounts/$account_id/cfd_tunnel?name=$TUNNEL_NAME&is_deleted=false" | jq_py '(r["result"] or [{}])[0].get("id","")')"
  if [ -z "$tunnel_id" ]; then
    tunnel_id="$(cf POST "/accounts/$account_id/cfd_tunnel" "{\"name\":\"$TUNNEL_NAME\",\"config_src\":\"cloudflare\"}" | jq_py 'r["result"]["id"]')"
    echo "Tunnel $TUNNEL_NAME aangemaakt ($tunnel_id)."
  else
    echo "Tunnel $TUNNEL_NAME bestaat al ($tunnel_id)."
  fi
  cf PUT "/accounts/$account_id/cfd_tunnel/$tunnel_id/configurations" \
    "{\"config\":{\"ingress\":[{\"hostname\":\"$FQDN\",\"service\":\"http://app:3400\"},{\"service\":\"http_status:404\"}]}}" >/dev/null
  echo "Public hostname $FQDN -> http://app:3400 ingesteld."

  target="$tunnel_id.cfargotunnel.com"
  record_json="$(cf GET "/zones/$zone_id/dns_records?name=$FQDN")"
  record="$(jq_py '"|".join([(r["result"] or [{}])[0].get(k,"") for k in ("id","type","content")])' <<<"$record_json")"
  IFS='|' read -r record_id record_type record_content <<<"$record"
  body="{\"type\":\"CNAME\",\"name\":\"$FQDN\",\"content\":\"$target\",\"proxied\":true,\"comment\":\"Avanta test via $TUNNEL_NAME\"}"
  if [ -z "$record_id" ]; then
    cf POST "/zones/$zone_id/dns_records" "$body" >/dev/null && echo "DNS: CNAME $FQDN -> $target aangemaakt."
  elif [ "$record_type" = "CNAME" ] && [[ "$record_content" == *.cfargotunnel.com ]]; then
    [ "$record_content" = "$target" ] || cf PUT "/zones/$zone_id/dns_records/$record_id" "$body" >/dev/null
    echo "DNS: CNAME $FQDN -> $target in orde."
  else
    echo "DNS: $FQDN bestaat al als $record_type -> $record_content. Verwijder die record eerst in Cloudflare; ik overschrijf hem niet." >&2
    exit 1
  fi
  TUNNEL_TOKEN="$(cf GET "/accounts/$account_id/cfd_tunnel/$tunnel_id/token" | jq_py 'r["result"]')"
else
  echo "Handmatig: maak in Cloudflare (Networks > Tunnels) een tunnel met public hostname $FQDN -> HTTP app:3400."
  read -r -s -p "Plak het tunnel-token (eyJ…), of laat leeg als apps01 al een token heeft: " TUNNEL_TOKEN; echo
fi

# ---- 3. Installatie op de gast ---------------------------------------------------------------------------------
# remote_script TOKENBESTAND: haalt install.sh op dezelfde commit op en draait het als root.
remote_script() {
  printf '%s\n' 'set -euo pipefail' \
    'tmp="$(mktemp -d)"; trap "rm -rf \"$tmp\"" EXIT' \
    "curl -fsSL '$RAW' -o \"\$tmp/install.sh\"" \
    "[ -s '$1' ] && export TUNNEL_TOKEN_FILE='$1'" \
    "bash \"\$tmp/install.sh\" '$REF'"
}

if [ "$mode" = "lxc" ]; then
  token_file=/root/.avanta-tunnel-token
  pct exec "$ctid" -- bash -c 'command -v curl >/dev/null || { apt-get update -qq && apt-get install -y -qq curl ca-certificates; }'
  [ -z "$TUNNEL_TOKEN" ] || printf '%s' "$TUNNEL_TOKEN" | pct exec "$ctid" -- bash -c "umask 077; cat > $token_file"
  pct exec "$ctid" -- bash -c "$(remote_script "$token_file")"
else
  remote_home="$(ssh "$SSH_TARGET" 'printf %s "$HOME"')"
  token_file="$remote_home/.avanta-tunnel-token"
  [ -z "$TUNNEL_TOKEN" ] || printf '%s' "$TUNNEL_TOKEN" | ssh "$SSH_TARGET" "umask 077; cat > '$token_file'"
  # -t: sudo mag om een wachtwoord vragen. install.sh verwijdert het tokenbestand na gebruik.
  ssh -t "$SSH_TARGET" "sudo bash -c $(printf '%q' "$(remote_script "$token_file")")"
fi

echo
echo "Klaar. Controle: https://$FQDN/ (noindex; robots.txt = Disallow: /)."
