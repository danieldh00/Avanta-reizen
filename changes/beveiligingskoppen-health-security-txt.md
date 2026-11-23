---
titel: HSTS, /api/health zonder versie en security.txt
---

## Nieuws
- De site stuurt via https een HSTS-kop mee, zodat browsers alleen nog https gebruiken.
- Beveiligingsproblemen kunnen gemeld worden via `/.well-known/security.txt` (meldadres uit Beheer > Organisatie > Contact).

## Changelog
- Beveiligingskoppen: `Strict-Transport-Security: max-age=31536000` als het verzoek via https binnenkomt (`req.secure`,
  achter de vertrouwde proxy), zonder `includeSubDomains` (audit A06).
- `/api/health` (nieuw `app/src/system/health.js`) geeft publiek alleen `{"ok":true}`; het versienummer alleen voor
  verzoeken van binnen de server: directe verbinding van loopback of een privénetwerk, niet van de vertrouwde proxy en
  zonder doorstuurkop. `update.sh` en `servertaken.sh` werken daardoor ongewijzigd (audit A23). Ook `Cache-Control: no-store`.
- Nieuw `/.well-known/security.txt` (RFC 9116) met `Contact`, `Expires` (180 dagen vooruit), `Preferred-Languages` en
  `Canonical` (bevinding V01).
- `docker-compose.yml`: de poort standaard alleen op `127.0.0.1` (`APP_BIND`), net als op apps01.
