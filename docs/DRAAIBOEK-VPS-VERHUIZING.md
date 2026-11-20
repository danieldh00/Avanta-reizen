# Draaiboek: back-up terugzetten en verhuizen naar een andere server

Stand: 20-11-2026 (pakket C). Voor apps01 (testomgeving) en elke volgende server (VPS) met dezelfde Docker-stack uit
`deploy/apps01`. Alle commando's als root (`sudo -i`) op de server zelf, tenzij anders vermeld.

## 1. Wat je nodig hebt
| Onderdeel | Waar | Waarom |
|---|---|---|
| Een back-up `avanta-JJJJMMDD-UUMMSS.dump.enc` | Beheer > Back-ups en herstel > Back-ups (downloaden), Google Drive (map *Avanta back-ups*) of `/data/backups` in volume `avanta_app-data` | de hele database (pg_dump), versleuteld |
| De hoofdsleutel `AVANTA_MASTER_KEY` (64 hex-tekens) | `.env` naast `docker-compose.yml`, en een kopie in de wachtwoordkluis | zonder sleutel zijn de back-ups én de versleutelde aanmeldvelden onleesbaar |
| Het sleutel-id | Beheer > Back-ups (bijv. `3fa1…`) | controle dat je de juiste hoofdsleutel hebt |

Afbeeldingen (`/data/media`) zitten niet in de back-up; die komen uit de import van de huidige site of uit een kopie van
het volume (stap 4.5).

**Hoofdsleutel in de kluis zetten** (eenmalig, nu doen): op de server
`grep '^AVANTA_MASTER_KEY=' /opt/apps/avanta/repo/deploy/apps01/.env` en de waarde in de wachtwoordkluis zetten.
Controle van een sleutel tegen het sleutel-id in Beheer (vervang `<sleutel>`):

```sh
printf %s avanta-back-up-sleutel-id | openssl dgst -sha256 -mac HMAC -macopt hexkey:<sleutel> | awk '{print substr($NF,1,16)}'
```

## 2. Een back-up terugzetten (zelfde server)

```sh
bash /opt/apps/avanta/repo/deploy/apps01/restore-backup.sh avanta-JJJJMMDD-UUMMSS.dump.enc
```

`restore-backup.sh` maakt eerst een veiligheidsback-up van de huidige stand, ontsleutelt en controleert de back-up,
stopt de app, zet alles in één transactie terug (mislukt het, dan blijft de database zoals hij was), wist de
ontsleutelde dump en start de app weer. Een gedownloade back-up: geef het volledige pad
(`… restore-backup.sh /root/avanta-JJJJMMDD-UUMMSS.dump.enc`). Vraag om bevestiging overslaan: `HERSTEL_JA=1`.

Een back-up van een **nieuwere** versie van de app kan niet in een oudere versie (migraties lopen alleen vooruit); werk
eerst de app bij. Een oudere back-up in een nieuwere versie kan wel: de app voert bij het starten de ontbrekende
migraties uit.

## 3. Verhuizen: voorbereiden
1. **Nieuwe server**: Debian 12 of Ubuntu 24.04, minimaal 2 GB RAM en 20 GB schijf, met Docker en de compose-plugin
   (`curl -fsSL https://get.docker.com | sh`), plus `git`, `curl` en `openssl`.
2. **Tunnel**: maak in Cloudflare (**Zero Trust > Networks > Tunnels > Create a tunnel**, type *Cloudflared*) een tunnel
   voor de nieuwe server en kopieer het token. Start op de nieuwe server:
   ```sh
   docker network create avanta-tunnel
   docker run -d --name avanta-cloudflared --restart unless-stopped --network avanta-tunnel \
     cloudflare/cloudflared:latest tunnel --no-autoupdate run --token <token>
   ```
   Voeg nog **geen** public hostname toe; dat is de laatste stap (6).
3. **Hoofdsleutel** uit de kluis bij de hand (stap 1), en controleer het sleutel-id.
4. Kies een rustig moment: wat na de laatste back-up op de oude server verandert, komt niet mee.

## 4. Verhuizen: uitvoeren
1. **Oude server**, Beheer > Back-ups: **Nu een back-up maken** en daarna **Downloaden** (of neem de nieuwste uit
   Google Drive). Zet de back-up op de nieuwe server, bijv. `scp avanta-….dump.enc root@<nieuwe-server>:/root/`.
2. **Nieuwe server**, stack installeren met de bestaande hoofdsleutel (`<sha>` = de commit die nu op de oude server
   draait, te zien in Beheer > Systeemoverzicht of `git -C /opt/apps/avanta/repo rev-parse HEAD`):
   ```sh
   curl -fsSL https://raw.githubusercontent.com/danieldh00/Avanta-reizen/<sha>/deploy/apps01/install.sh -o /root/install.sh
   AVANTA_MASTER_KEY=<sleutel> TUNNEL_CONTAINER=avanta-cloudflared bash /root/install.sh <sha>
   ```
   `install.sh` maakt `.env` met deze sleutel en een nieuw databasewachtwoord, bouwt de stack, zet de timers (updates,
   hersteltest) en importeert bij een lege database de content van de huidige site.
   Pas daarna in `/opt/apps/avanta/repo/deploy/apps01/.env` `SITE_URL` aan als het adres verandert, en start opnieuw:
   `cd /opt/apps/avanta/repo/deploy/apps01 && docker compose up -d`.
3. **Back-up terugzetten**: `HERSTEL_JA=1 bash /opt/apps/avanta/repo/deploy/apps01/restore-backup.sh /root/avanta-….dump.enc`.
4. **Controleren** (via `curl -s http://127.0.0.1:3400/api/health` en straks in de browser): inloggen met je bestaande
   account, Beheer > Systeemoverzicht (versie, laatste migratie), Beheer > Back-ups (**sleutel-id gelijk aan de oude
   server**), een aanmelding openen in het CRM (versleutelde velden leesbaar), **Nu een back-up maken**.
5. **Afbeeldingen**: de import uit stap 2 haalt ze opnieuw op. Of kopieer het volume van de oude server:
   ```sh
   # oude server
   docker run --rm -v avanta_app-data:/data -v /root:/uit alpine tar czf /uit/media.tgz -C /data media
   # nieuwe server (na scp van media.tgz naar /root)
   docker run --rm -v avanta_app-data:/data -v /root:/in alpine sh -c 'tar xzf /in/media.tgz -C /data && chown -R 1000:1000 /data/media'
   ```
6. **Google Drive**: de koppeling (versleuteld in de database) komt mee met de back-up. Verandert het adres van de site,
   voeg dan in de Google Cloud Console het nieuwe terugkeeradres toe (`docs/GOOGLE-DRIVE.md`, stap 3.3) en klik in
   Beheer > Google Drive op **Opnieuw koppelen met Google**. Klik daarna **Nu synchroniseren**.

## 5. Omschakelen
1. In Cloudflare bij de **nieuwe** tunnel: **Public Hostname > Add**: het adres van de site → `HTTP` →
   `avanta-app:3400`. Haal dezelfde hostname weg bij de oude tunnel (anders twee routes naar één naam).
2. Controleer `https://<adres>/api/health` en het contactformulier (een 403 betekent dat `TRUST_PROXY` niet klopt; draai
   `install.sh` dan nog eens, het zet het IP van de cloudflared-container opnieuw).
3. **Oude server**: `cd /opt/apps/avanta/repo/deploy/apps01 && docker compose stop` en
   `systemctl disable --now avanta-update.timer avanta-restore-test.timer avanta-restore-test-now.path`.
   Laat de volumes nog een week staan; daarna `docker compose down -v`.

## 6. Terug naar de oude server (als er iets misgaat)
Zolang de oude server niet is opgeruimd: zet de public hostname terug op de oude tunnel en start daar de stack
(`docker compose start` en de timers weer aan). Wijzigingen die al op de nieuwe server zijn gedaan, haal je over met een
back-up van de nieuwe server en `restore-backup.sh` op de oude.
