# Draaiboek: back-up terugzetten en verhuizen naar een andere server

Stand: 23-11-2026 (pakket C; §7 uit P2.4). Voor apps01 (testomgeving) en elke volgende server (VPS) met dezelfde Docker-stack uit
`deploy/apps01`. Alle commando's als root (`sudo -i`) op de server zelf, tenzij anders vermeld.

## 1. Wat je nodig hebt
| Onderdeel | Waar | Waarom |
|---|---|---|
| Een back-up `avanta-JJJJMMDD-UUMMSS.dump.enc` | Beheer > Back-ups en herstel > Back-ups (downloaden), Google Drive (map *Avanta back-ups*) of `/data/backups` in volume `avanta_app-data` | de hele database (pg_dump), versleuteld |
| De hoofdsleutel `AVANTA_MASTER_KEY` (64 hex-tekens) | `.env` naast `docker-compose.yml`, en een kopie in de wachtwoordkluis | zonder sleutel zijn de back-ups én de versleutelde aanmeldvelden onleesbaar |
| Het sleutel-id | Beheer > Back-ups (bijv. `3fa1…`) | controle dat je de juiste hoofdsleutel hebt |

**Geüploade foto's** (fotobibliotheek) zitten wél in de back-up: de grootste variant staat in de database (tabel
`media_files`). Na het terugzetten zet de app bij het starten de bestanden in `/data/media` vanzelf terug, ook de kleinere
varianten. **Afbeeldingen uit de import** van de huidige site zitten er ook in: de app zet elk
importbestand ongewijzigd in `media_files` (bij het starten en daarna dagelijks) en zet het na het terugzetten terug.
De back-up wordt daardoor zo groot als de afbeeldingen (circa 250 MB).

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
Mislukt de veiligheidsback-up, dan stopt het script zonder iets te veranderen. Alleen als er echt niets te bewaren is
(een nieuwe server die nog niet in gebruik is) kun je dan doorgaan met `ZONDER_VEILIGHEIDSBACKUP=1` ervoor.

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
5. **Afbeeldingen**: geüploade foto's zet de app bij het starten zelf terug uit de database (Beheer > Logboek, bron
   *fotobibliotheek*: *foto('s) hersteld uit de database*); dat geldt ook voor de afbeeldingen uit de import. Meldt het
   logboek *importfoto('s) zonder bruikbaar bestand*, haal ze dan opnieuw op met de import uit stap 2 of kopieer het volume van de oude server:
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

## 7. Weer toegang als beheerder
Bevinding F07: een CRM-gebruiker kan zijn wachtwoord niet zelf herstellen. Dat doet een **andere beheerder** onder
Gebruikers (wachtwoord instellen, tweestapsverificatie uitzetten en een activatiecode maken). Houd daarom altijd **twee
actieve beheerders** aan; de startpagina van Beheer waarschuwt als er maar één is.

Is er geen andere beheerder (of komt niemand er meer in), dan herstelt de server de toegang. Op de **Proxmox-host als
root**: het vaste commando uit Beheer > Systeem > Servertaken, met aan het eind `beheerder-herstel <e-mailadres>` in
plaats van `openstaand`:

```sh
REF=$(curl -fsSL -H 'Accept: application/vnd.github.sha' https://api.github.com/repos/danieldh00/Avanta-reizen/commits/main) && T=$(mktemp) && trap 'rm -f "$T"' EXIT && curl -fsSL "https://raw.githubusercontent.com/danieldh00/Avanta-reizen/$REF/deploy/apps01/servertaken.sh" -o "$T" && TASKS_REF="$REF" bash "$T" beheerder-herstel <e-mailadres>
```

Na `ja` krijgt die beheerder (alleen een **actieve** gebruiker met de rol beheerder):
- een **tijdelijk wachtwoord**, alleen in de terminal getoond: log in op `/app/inloggen/` en kies meteen een eigen
  wachtwoord onder *Wachtwoord*;
- **tweestapsverificatie uit** en een nieuwe **activatiecode** (7 dagen geldig) om de authenticator opnieuw te koppelen;
- **alle sessies beëindigd** (ook een gestolen sessie).

Het auditlog krijgt de regel *Toegang van beheerder hersteld op de server*. Klopt het adres niet, dan toont de opdracht de
actieve beheerders gemaskeerd (`d***@voorbeeld.nl`) en verandert er niets. Op een andere server dan apps01: in de map
met `docker-compose.yml` `docker compose exec -T app node src/crm/cli.js beheerder-herstel <e-mailadres>`.
Is er nog helemaal geen gebruiker (lege tabel), dan geldt de installatiecode uit het log (`README.md`, *Eerste beheerder*).

## 8. Hoofdsleutel roteren
Wanneer: als de hoofdsleutel mogelijk is uitgelekt (verloren laptop met de kluis, oud-medewerker met toegang tot de
server), en verder eens per jaar. De app leest tijdens en na de rotatie gewoon door; er is geen onderhoudsvenster.

Op de **Proxmox-host als root**: het vaste commando uit Beheer > Systeem > Servertaken, met aan het eind
`sleutel-roteren` in plaats van `openstaand`:

```sh
REF=$(curl -fsSL -H 'Accept: application/vnd.github.sha' https://api.github.com/repos/danieldh00/Avanta-reizen/commits/main) && T=$(mktemp) && trap 'rm -f "$T"' EXIT && curl -fsSL "https://raw.githubusercontent.com/danieldh00/Avanta-reizen/$REF/deploy/apps01/servertaken.sh" -o "$T" && TASKS_REF="$REF" bash "$T" sleutel-roteren
```

Na `ja`:
1. een **back-up** met de huidige sleutel (mislukt die, dan verandert er niets);
2. een kopie van `.env` (`.env.voor-sleutelrotatie-<datum>`, alleen leesbaar voor root);
3. een **nieuwe** `AVANTA_MASTER_KEY` in `.env`; de oude gaat vooraan in `AVANTA_MASTER_KEY_PREVIOUS`;
4. de app start opnieuw (start hij niet, dan komt de oude `.env` terug);
5. alle versleutelde gegevens worden opnieuw versleuteld en de `match_key` van personen opnieuw berekend
   (`app/src/security/key-rotation-cli.js`); het auditlog krijgt *Hoofdsleutel geroteerd* met het id van de nieuwe sleutel.

Daarna zelf:
- de **nieuwe sleutel in de wachtwoordkluis** zetten (zelfde regel als in §1) en het nieuwe sleutel-id in Beheer >
  Back-ups noteren; de oude sleutel in de kluis laten staan met de datum erbij;
- `AVANTA_MASTER_KEY_PREVIOUS` laten staan zolang er back-ups van vóór de rotatie bestaan (back-ups, hersteltests en
  `restore-backup.sh` kiezen de sleutel op het id in de back-up). Een teruggezette oude back-up is meteen leesbaar;
  draai daarna `sleutel-roteren` gerust nog eens, of in de container `node src/security/key-rotation-cli.js herversleutelen`.

Gevolgen: CRM-gebruikers en reizigers moeten opnieuw inloggen als hun formulier openstond (CSRF-tokens zijn van de
sleutel afgeleid); betaallinks in al verstuurde mails blijven werken. Meldt de opdracht waarden die met geen enkele
bekende sleutel te openen zijn, dan blijven die staan en draait de app gewoon door: neem dan contact op met de
ontwikkelaar voordat een vorige sleutel wordt weggehaald. Op een andere server dan apps01: dezelfde stappen met de hand
(`.env` aanpassen, `docker compose up -d app`, `docker compose exec -T app node src/security/key-rotation-cli.js
herversleutelen`).
