# Testomgeving op apps01: avanta.den-hollander.com

Aparte Docker-stack (projectnaam `avanta`) op apps01 met app, eigen PostgreSQL 17 en een eigen cloudflared. Geen
poorten open naar buiten: Cloudflare Tunnel brengt het verkeer naar `app:3400` binnen het Docker-netwerk.
Dit is test/staging: `SITE_URL=https://avanta.den-hollander.com` en altijd `SITE_INDEXABLE=false`.
Productie blijft `www.avantareizen.nl`.

## Snelste route: één commando op de Proxmox-host

Als root in de shell van de pve, met `<sha>` = de commit die je wilt uitrollen:

```sh
AVANTA_REF=<sha> bash <(curl -fsSL https://raw.githubusercontent.com/danieldh00/Avanta-reizen/<sha>/deploy/apps01/pve-setup.sh)
```

`pve-setup.sh` doet dan alles, herhaalbaar:
- zoekt de gast `apps01` (LXC: via `pct exec`, controleert `nesting=1`; VM: via `ssh` als gewone gebruiker + sudo,
  doel instelbaar met `SSH_TARGET=gebruiker@host`);
- vraagt een Cloudflare API-token (Account > Cloudflare Tunnel > Edit, Zone > DNS > Edit, Zone > Zone > Read) en maakt
  daarmee tunnel `avanta-apps01`, de public hostname `avanta.den-hollander.com -> http://app:3400` en de proxied CNAME.
  Een bestaande andere record voor die naam wordt niet overschreven. Leeg laten = zelf een tunnel-token plakken;
- draait op apps01 `install.sh`: Docker installeren als die ontbreekt, repo naar `/opt/avanta/repo` op dezelfde commit,
  `.env` met gegenereerde geheimen (eenmalig), image bouwen, stack starten, gezondheidscheck en bij een lege database
  de content-import.

Bijwerken = hetzelfde commando met een nieuwere `<sha>` (of `AVANTA_REF=main` na de merges). Hieronder dezelfde
stappen met de hand.

## 1. Cloudflare: tunnel en hostname

Dashboard: **Zero Trust > Networks > Tunnels** (in het nieuwe dashboard: *Networks > Connectors > Cloudflare Tunnels*).

1. **Create a tunnel** > type **Cloudflared** > naam `avanta-apps01` > Save.
2. Kies bij *Install connector* **Docker** en kopieer alleen het token (de lange `eyJ…`-string na `--token`).
   Niet de getoonde `docker run` uitvoeren; de stack start cloudflared zelf.
3. Tabblad **Public Hostname** (nieuw: *Published application routes*) > **Add**:
   | Veld | Waarde |
   |---|---|
   | Subdomain | `avanta` |
   | Domain | `den-hollander.com` |
   | Path | leeg |
   | Service type | `HTTP` |
   | URL | `app:3400` |
4. Cloudflare maakt zelf de DNS-record `avanta` (CNAME naar `<tunnel-id>.cfargotunnel.com`, proxied). Staat er al
   een record `avanta` in **DNS > Records**, verwijder die eerst; anders weigert het dashboard de hostname.

Geen extra certificaat nodig: het Universal SSL-certificaat dekt `*.den-hollander.com`. Laat **Rocket Loader** uit
voor deze hostname; die herschrijft scripts en botst met de CSP (`script-src 'self'`).

Optioneel, aanbevolen zolang dit een testsite is: **Zero Trust > Access > Applications > Add > Self-hosted** op
`avanta.den-hollander.com` met een policy *Emails* (of *Emails ending in*) en One-time PIN, zodat alleen jij en
Avanta de site zien.

### Liever je bestaande tunnel?

Draait er al een cloudflared voor `*.den-hollander.com` op een andere host, dan kan die ook doorsturen:
voeg bij die tunnel een Public Hostname toe met URL `http://<LAN-IP van apps01>:3400`, en zet in `.env`:
`COMPOSE_PROFILES=` (leeg), `APP_BIND=0.0.0.0` (of het LAN-IP van apps01) en `TRUST_PROXY=<IP van de cloudflared-host>`.
Beperk poort 3400 dan in de firewall tot die host.

## 2. apps01: stack opzetten

Vereist: Docker Engine met compose-plugin, git en uitgaand HTTPS.

```sh
sudo mkdir -p /opt/avanta && sudo chown "$USER": /opt/avanta
git clone https://github.com/danieldh00/Avanta-reizen.git /opt/avanta/repo
cd /opt/avanta/repo
git checkout claude/contactformulier   # tot de PR's in main staan; daarna: git checkout main

cd deploy/apps01
cp .env.example .env && chmod 600 .env
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" .env
sed -i "s/^AVANTA_MASTER_KEY=.*/AVANTA_MASTER_KEY=$(openssl rand -hex 32)/" .env
nano .env                               # TUNNEL_TOKEN=eyJ… plakken

docker compose up -d --build
docker compose ps                       # app en db: healthy, cloudflared: Up
curl -s http://127.0.0.1:3400/api/health   # {"ok":true,...}
docker compose logs cloudflared | grep -i "registered tunnel connection"
```

Is de repo privé, clone dan met een fine-grained PAT (alleen *Contents: read*) of een deploy key.

Migraties draaien automatisch bij elke start van de app (met advisory lock); er is geen los migratiecommando.

## 3. Content importeren

De database is leeg na de eerste start. Haal content en afbeeldingen (circa 250 MB) van de huidige site op:

```sh
docker compose exec app node tools/import-wordpress.js
```

Herhaalbaar: bestaande rijen worden bijgewerkt. Daarna `https://avanta.den-hollander.com/` openen.

## 4. Controleren

```sh
curl -sI https://avanta.den-hollander.com/ | grep -i x-robots-tag   # noindex, nofollow
curl -s  https://avanta.den-hollander.com/robots.txt                  # Disallow: /
curl -s  https://avanta.den-hollander.com/ | grep canonical           # https://avanta.den-hollander.com/
```

Test ook het contactformulier: een 403 betekent dat `TRUST_PROXY` niet klopt (de app ziet dan `http` in plaats van
`https` en keurt de herkomst af).

## 5. Bijwerken

```sh
cd /opt/avanta/repo && git pull
cd deploy/apps01 && docker compose up -d --build
docker image prune -f
```

Zodra het GHCR-image er is (release-workflow): zet `AVANTA_IMAGE=ghcr.io/danieldh00/avanta-reizen:<versie>` in
`.env` en gebruik `docker compose pull && docker compose up -d` (bij een privé-package eerst `docker login ghcr.io`).

## 6. Back-up en herstel

```sh
docker compose exec -T db pg_dump -U avanta -Fc avanta > /opt/avanta/backup-$(date +%F).dump
docker compose exec -T db pg_restore -U avanta -d avanta --clean --if-exists < backup-JJJJ-MM-DD.dump
```

Bewaar `AVANTA_MASTER_KEY` apart van de dump; zonder sleutel zijn de versleutelde aanmeldvelden onleesbaar.
Afbeeldingen staan in volume `avanta_app-data` (opnieuw te importeren). Of neem gewoon de hele VM/LXC mee in de
Proxmox-back-up (PBS).

## Opruimen

`docker compose down` stopt de stack; `docker compose down -v` verwijdert ook database en afbeeldingen.
