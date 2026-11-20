#!/usr/bin/env bash
# Zet een versleutelde back-up terug in de database van deze stack (docs/DRAAIBOEK-VPS-VERHUIZING.md).
# Draait als root op de server met de stack (apps01 of een nieuwe VPS):
#   sudo bash /opt/apps/avanta/repo/deploy/apps01/restore-backup.sh avanta-JJJJMMDD-UUMMSS.dump.enc   (staat al op de server)
#   sudo bash /opt/apps/avanta/repo/deploy/apps01/restore-backup.sh /pad/naar/avanta-….dump.enc        (download of Drive)
# Stappen: (1) eerst een veiligheidsback-up van de huidige stand, (2) ontsleutelen in het datavolume (de tag wordt
# gecontroleerd; een andere hoofdsleutel of beschadiging stopt hier), (3) app stoppen, (4) alles in één transactie
# terugzetten, (5) de ontsleutelde dump wissen en de app starten. Mislukt stap 4, dan blijft de database zoals hij was.
# Zonder vraag: HERSTEL_JA=1.
set -euo pipefail

BASE_DIR="${BASE_DIR:-/opt/apps/avanta}"
STACK_DIR="$BASE_DIR/repo/deploy/apps01"
die() { echo "FOUT: $*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "draai dit als root (sudo)"
[ $# -eq 1 ] || die "gebruik: restore-backup.sh <naam of pad van de back-up>"
cd "$STACK_DIR"

source_arg="$1"
name="$(basename "$source_arg")"
[[ "$name" =~ ^avanta-[0-9]{8}-[0-9]{6}\.dump\.enc$ ]] || die "geen back-upnaam: $name (verwacht avanta-JJJJMMDD-UUMMSS.dump.enc)"
docker compose ps --status running --services | grep -qx app || die "de app draait niet; start eerst de stack (docker compose up -d)"

if [ -f "$source_arg" ]; then
  echo "Back-up naar het datavolume kopiëren..."
  docker compose cp "$source_arg" "app:/data/backups/$name"
  docker compose exec -T -u root app chown node:node "/data/backups/$name"
fi
docker compose exec -T app test -f "/data/backups/$name" || die "$name staat niet in /data/backups (geef het volledige pad)"

if [ "${HERSTEL_JA:-}" != "1" ]; then
  echo "Dit vervangt ALLE gegevens in de database door die uit $name."
  read -r -p "Typ HERSTEL om door te gaan: " answer
  [ "$answer" = "HERSTEL" ] || die "afgebroken"
fi

echo "1/5 Veiligheidsback-up van de huidige stand..."
docker compose exec -T app node src/backup/cli.js create --update || echo "Waarschuwing: veiligheidsback-up mislukt (lege of nieuwe database?)." >&2

echo "2/5 Ontsleutelen en controleren..."
docker compose exec -T app rm -f /data/backups/.herstel.dump
docker compose exec -T app node src/backup/cli.js decrypt "$name" /data/backups/.herstel.dump

echo "3/5 App stoppen..."
docker compose stop app

echo "4/5 Terugzetten (één transactie)..."
status=0
docker compose run --rm --no-deps -T --entrypoint sh app -c \
  'pg_restore --clean --if-exists --no-owner --no-acl --single-transaction -d "$DATABASE_URL" /data/backups/.herstel.dump; status=$?; rm -f /data/backups/.herstel.dump; exit $status' \
  || status=$?

echo "5/5 App starten..."
docker compose start app
port="$(sed -n 's/^APP_PORT=//p' .env)"; port="${port:-3400}"
for _ in $(seq 1 45); do
  curl -fsS "http://127.0.0.1:$port/api/health" >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS "http://127.0.0.1:$port/api/health" >/dev/null 2>&1 || die "app niet gezond na het terugzetten; zie: docker compose logs --tail 50 app"
[ "$status" -eq 0 ] || die "terugzetten mislukt (code $status); de database is ongewijzigd en de app draait weer"
echo "Klaar: $name is teruggezet en de app is gezond."
