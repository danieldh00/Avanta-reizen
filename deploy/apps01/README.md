# Testomgeving op apps01: avanta.den-hollander.com

Aparte Docker-stack (projectnaam `avanta`, map `/opt/apps/avanta`) op apps01 met de app en een eigen PostgreSQL 17.
**Geen eigen tunnel**: de bestaande `aquatech-cloudflared` krijgt er een losse public hostname bij,
`avanta.den-hollander.com -> http://avanta-app:3400`. De app hangt daarvoor met alias `avanta-app` in het
Docker-netwerk van die cloudflared (naast zijn eigen netwerk met de database); er staan geen poorten open naar buiten.
Dit is test/staging: `SITE_URL=https://avanta.den-hollander.com` en altijd `SITE_INDEXABLE=false`.
Productie blijft `www.avantareizen.nl`.

## Eén commando op de Proxmox-host

Als root in de shell van de pve, met `<sha>` = de commit die je wilt uitrollen:

```sh
AVANTA_REF=<sha> bash <(curl -fsSL https://raw.githubusercontent.com/danieldh00/Avanta-reizen/<sha>/deploy/apps01/pve-setup.sh)
```

`pve-setup.sh` (herhaalbaar):
1. zoekt apps01 zoals de Aquatech-scripts: LXC via `pct exec`, anders ssh als `daniel@apps01` met `sudo -n`
   (instelbaar met `APPS01_SSH`, `APPS01_CTID`, `APPS01_NAME`);
2. draait daar `install.sh`: repo naar `/opt/apps/avanta/repo` op dezelfde commit, `.env` met gegenereerde geheimen
   (eenmalig), netwerk van `aquatech-cloudflared` opzoeken (`TUNNEL_NETWORK`), image bouwen, stack starten,
   gezondheidscheck en bij een lege database de content-import van www.avantareizen.nl;
3. leest uit de draaiende cloudflared alleen het account- en tunnel-id (het geheime deel van het token blijft op apps01)
   en vraagt een Cloudflare API-token (*Account > Cloudflare Tunnel > Edit* en *Zone > DNS > Edit*, beperkt tot
   den-hollander.com). Daarmee voegt het de ingress-regel toe vóór de catch-all (bestaande regels blijven staan) en
   maakt het de proxied CNAME `avanta -> <tunnel-id>.cfargotunnel.com`. Een andere bestaande record voor die naam
   wordt niet overschreven. Leeg laten = het script toont de handmatige stap hieronder.
4. controleert `https://avanta.den-hollander.com/api/health`.

Bijwerken = hetzelfde commando met een nieuwere `<sha>` (of `AVANTA_REF=main` na de merges).

## Handmatige binding in Cloudflare (zonder API-token)

**Zero Trust > Networks > Tunnels** > de tunnel van `aquatech-cloudflared` > **Public Hostname** (nieuw dashboard:
*Published application routes*) > **Add**:

| Veld | Waarde |
|---|---|
| Subdomain | `avanta` |
| Domain | `den-hollander.com` |
| Service type | `HTTP` |
| URL | `avanta-app:3400` |

Cloudflare maakt de DNS-record dan zelf. Het Universal SSL-certificaat dekt `*.den-hollander.com`. Laat **Rocket
Loader** uit (botst met de CSP). Optioneel: zet er een **Access**-applicatie (One-time PIN op e-mail) voor, zolang
het een testsite is.

## Op apps01 zelf

```sh
cd /opt/apps/avanta/repo/deploy/apps01
docker compose ps
docker compose logs -f app
curl -sI https://avanta.den-hollander.com/ | grep -i x-robots-tag   # noindex, nofollow
```

Een 403 op het contactformulier betekent dat `TRUST_PROXY` niet klopt (de app ziet dan `http` in plaats van `https`).
Migraties draaien automatisch bij elke start van de app.

Wordt `aquatech-cloudflared` met een ander netwerk opnieuw aangemaakt, draai dan het commando opnieuw: `install.sh`
zoekt het netwerk elke keer opnieuw op.

## Back-up en herstel

```sh
docker compose exec -T db pg_dump -U avanta -Fc avanta > /opt/apps/avanta/backup-$(date +%F).dump
docker compose exec -T db pg_restore -U avanta -d avanta --clean --if-exists < backup-JJJJ-MM-DD.dump
```

Bewaar `AVANTA_MASTER_KEY` (in `.env`) apart van de dump; zonder sleutel zijn de versleutelde aanmeldvelden
onleesbaar. Afbeeldingen staan in volume `avanta_app-data` (opnieuw te importeren).

## Opruimen

`docker compose down` stopt de stack; `docker compose down -v` verwijdert ook database en afbeeldingen. Verwijder dan
ook de public hostname en de CNAME in Cloudflare.
