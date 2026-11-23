# Testomgeving op apps01: avanta.den-hollander.com

Aparte Docker-stack (projectnaam `avanta`, map `/opt/apps/avanta`) op apps01 met de app en een eigen PostgreSQL 17.
**Geen eigen tunnel**: de bestaande cloudflared-container op apps01 krijgt er een losse public hostname bij,
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
1. zoekt apps01: LXC via `pct exec`, anders ssh als `daniel@apps01` met `sudo -n`
   (instelbaar met `APPS01_SSH`, `APPS01_CTID`, `APPS01_NAME`);
2. draait daar `install.sh`: repo naar `/opt/apps/avanta/repo` op dezelfde commit, `.env` met gegenereerde geheimen
   (eenmalig), netwerk en exact IP van de cloudflared-container opzoeken (zit die in meerdere netwerken, geef dan
   `TUNNEL_NETWORK=<naam>` mee; daarna onthoudt `.env` de keuze) (`TUNNEL_NETWORK`, `TRUST_PROXY`), image bouwen, stack starten,
   gezondheidscheck en bij een lege database de content-import van www.avantareizen.nl;
3. leest uit de draaiende cloudflared alleen het account- en tunnel-id (het geheime deel van het token blijft op apps01)
   en vraagt een Cloudflare API-token (*Account > Cloudflare Tunnel > Edit* en *Zone > DNS > Edit*, beperkt tot
   den-hollander.com; het token komt niet in de proceslijst). Het bewaart eerst de huidige tunnelconfiguratie in
   `/root/cf-tunnel-<id>-<tijd>.json`, toont de nieuwe regels en vraagt bevestiging (`CF_YES=1` slaat dat over).
   Daarna voegt het de ingress-regel toe vóór de catch-all (bestaande regels blijven staan) en
   maakt het de proxied CNAME `avanta -> <tunnel-id>.cfargotunnel.com`. Een andere bestaande record voor die naam
   wordt niet overschreven. Leeg laten = het script toont de handmatige stap hieronder.
4. controleert `https://avanta.den-hollander.com/api/health`.

## Automatisch bijwerken en updaten vanuit de app

`install.sh` zet de systemd-timer `avanta-update.timer` op apps01 (elke 15 minuten, `/usr/local/sbin/avanta-update`)
en de path-unit `avanta-update-now.path` (start dezelfde service zodra de app een aanvraag neerzet):
- nieuwe commit op `AVANTA_TRACK` (standaard `main`, in `.env`) en *automatisch bijwerken* aan (Beheer > Systeem >
  Updates en onderhoud) → eerst code ophalen en het image bouwen (`INSTALL_PHASE=build`, de site draait door), dan
  onderhoudsmodus aan, back-up, `install.sh` op die commit (start, gezondheidscheck) en controle van de versie op
  `/api/health`; mislukt dat, dan terug naar de vorige commit (die mislukte commit slaat de timer daarna over,
  `.failed-commit`);
- *Nu updaten* in de app installeert alleen de commit die het script zelf als nieuwste ophaalde; *Nu controleren*
  werkt alleen de status bij;
- koppeling met de app via `/opt/apps/avanta/update/status` (alleen root schrijft; in de container alleen-lezen) en
  `/opt/apps/avanta/update/request` (eigenaar uid 1000, de app); uitleg bovenin `update.sh`;
- ander IP van de cloudflared-container (bijv. na een image-update) → `TRUST_PROXY` opnieuw gezet, zelfde commit;
- staat `deploy/apps01` nog niet op die branch, dan doet de timer niets.

Logboek: `journalctl -u avanta-update`; status: `systemctl list-timers avanta-update.timer`.
Migraties lopen alleen vooruit: een rollback zet de code terug, niet de database. Het commando van de pve opnieuw
draaien blijft mogelijk (bijv. met een vaste `<sha>`), maar de timer gaat daarna weer naar de laatste commit van
`AVANTA_TRACK`.

## Servertaken

Heeft een wijziging iets op de server nodig dat de automatische update niet zelf doet, dan staat het als taak in
Beheer > Systeem > Servertaken, met één vast commando voor de Proxmox-host (als root). Dat commando haalt
`servertaken.sh` op de nieuwste commit van main op en voert alle openstaande taken uit (na bevestiging); gelukte taken
staan daarna afgevinkt in de app. Alleen kijken: `servertaken.sh status` (containers, updates, timers, schijf,
geheugen, back-ups); verder `logs [uren]` en `update`.

## Handmatige binding in Cloudflare (zonder API-token)

**Zero Trust > Networks > Tunnels** > de tunnel van de cloudflared-container > **Public Hostname** (nieuw dashboard:
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
`TRUST_PROXY` is bewust het exacte IP van de cloudflared-container (geen subnet, zie de hoofd-README).
De naam van die container staat in `.env` (`TUNNEL_CONTAINER`); zonder waarde zoekt `install.sh` de enige draaiende
container waarvan de naam op `cloudflared` eindigt en stopt met een melding als er geen of meer dan één is.
Migraties draaien automatisch bij elke start van de app.

Wordt de cloudflared-container opnieuw aangemaakt (bijv. bij een image-update), dan kan zijn IP veranderen; de timer
zet `TRUST_PROXY` dan binnen 15 minuten goed (tot die tijd geven de formulieren 403).

## Back-up en herstel

De app maakt zelf dagelijks een versleutelde back-up van de database in volume `avanta_app-data` (`/data/backups`),
plus een vóór elke update (`update.sh`). Instellen, *Nu maken* en downloaden: **Beheer > Back-ups en herstel >
Back-ups**. Terugzetten: `sudo bash restore-backup.sh <back-up>` (veiligheidsback-up, controle, één transactie);
verhuizen naar een andere server: `docs/DRAAIBOEK-VPS-VERHUIZING.md` (`install.sh` neemt daarvoor een bestaande
`AVANTA_MASTER_KEY` over).

Elke zondag rond 04:30 draait de hersteltest (`restore-test.sh`, timer `avanta-restore-test.timer`; op verzoek via
`avanta-restore-test-now.path`): de nieuwste back-up gaat in een wegwerpdatabase met wegwerp-app, de uitslag staat in
Beheer > Hersteltest. Logboek: `journalctl -u avanta-restore-test -u avanta-restore-test-now`. Beide units zet
`install.sh` neer; de automatische update doet dat dus vanzelf.

Bewaar `AVANTA_MASTER_KEY` (in `.env`) apart van de back-ups, bijvoorbeeld in de wachtwoordkluis; zonder sleutel zijn
de back-ups en de versleutelde aanmeldvelden onleesbaar. Afbeeldingen staan in volume `avanta_app-data` (opnieuw te
importeren).

## Opruimen

`docker compose down` stopt de stack; `docker compose down -v` verwijdert ook database en afbeeldingen. Verwijder dan
ook de public hostname en de CNAME in Cloudflare.
