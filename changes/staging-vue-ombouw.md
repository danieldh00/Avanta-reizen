---
titel: Stagingomgeving voor de ombouw naar Vue
---

## Nieuws
- Beheer > Systeem > Servertaken heeft een nieuwe taak: de stagingomgeving voor de ombouw naar Vue inrichten. Dat is een tweede opstelling naast de testomgeving, met een eigen database en alleen testdata.

## Changelog
- Servertaak `002-staging-inrichten` (`system/host-tasks.js`, `deploy/apps01/servertaken.sh`).
- `deploy/staging/`: `compose.yml` (project `avanta-staging`, eigen database en volumes, eigen imagenaam, nooit vindbaar, geen updatemappen), `.env.example` en `install-staging.sh` (volgt `develop`, anders `main`; eigen geheimen; neemt alleen naam en netwerk van de bestaande cloudflared over van de testomgeving; timer elke 15 minuten; terugval en overslaan bij een commit die niet start; testdata bij een lege database).
- Tests: `tests/deploy-staging.test.js` (nagebootste docker, curl en systemctl); het compose-bestand van staging valt onder de controle op vastgepinde images.
