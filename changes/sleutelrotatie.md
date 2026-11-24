---
titel: Sleutelrotatie voor de hoofdsleutel
---

## Changelog
- Kluis (`security/vault.js`): nieuw formaat `v2.<sleutel-id>.…`; leest ook met vorige sleutels
  (`AVANTA_MASTER_KEY_PREVIOUS` of `DATA_DIR/master-key.previous`). Het oude formaat `v1` blijft leesbaar.
- `security/key-rotation.js` en `key-rotation-cli.js` (`status`, `herversleutelen`): personen (blokken en `match_key`),
  oude aanmeldingen, tweestapsgeheimen en geheime instellingen opnieuw versleuteld, in porties en zonder gelijktijdige
  wijzigingen te overschrijven; auditregel *Hoofdsleutel geroteerd*.
- Na een rotatie blijven werken: zoeken van dezelfde persoon (match_key met de vorige sleutel), back-ups en hersteltests
  van vóór de rotatie (sleutel op id), betaallinks in verstuurde mails.
- apps01: `servertaken.sh sleutel-roteren` (back-up, nieuwe sleutel in `.env`, herstart, opnieuw versleutelen); procedure
  in `docs/DRAAIBOEK-VPS-VERHUIZING.md` §8 (A13).
