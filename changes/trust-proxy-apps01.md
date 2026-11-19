---
titel: Instelbare vertrouwde proxy en testomgeving op apps01
---

## Nieuws
- De formulieren werken nu ook achter Cloudflare Tunnel (testomgeving avanta.den-hollander.com).

## Changelog
- Nieuwe instelling `TRUST_PROXY` (Express `trust proxy`; standaard `loopback` zoals voorheen, getal = aantal hops,
  `true` geweigerd). Achter cloudflared in Docker zag de app `http` en het IP van de tunnelcontainer: de
  herkomstcontrole gaf 403 op elk formulier en alle bezoekers deelden één limiet.
- `deploy/apps01/`: compose-stack (app, PostgreSQL 17, cloudflared onder profiel `tunnel`), `.env.example`,
  `install.sh` (gast) en `pve-setup.sh` (Proxmox-host: Cloudflare-tunnel, DNS en installatie in één commando).
