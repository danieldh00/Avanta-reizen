---
titel: Weer toegang als beheerder via de server
---

## Nieuws
- Komt een beheerder er niet meer in en is er geen tweede beheerder, dan herstelt het vaste servercommando de toegang
  (`beheerder-herstel`); de stappen staan in het draaiboek.

## Changelog
- Nieuw `app/src/crm/cli.js` met `beheerder-herstel <e-mailadres>` (bevinding F07): alleen voor een actieve beheerder;
  in één transactie een tijdelijk wachtwoord (24 tekens, alleen in de terminal), 2FA uit en een nieuwe activatiecode,
  alle sessies van die beheerder weg en auditregel `gebruiker.hersteld-server` (zonder IP). Onbekend adres: gemaskeerde
  lijst met actieve beheerders, niets veranderd.
- `deploy/apps01/servertaken.sh beheerder-herstel <e-mailadres>` (met bevestiging) roept de opdracht in de container aan.
- `docs/DRAAIBOEK-VPS-VERHUIZING.md` §7: weer toegang als beheerder en het advies om twee beheerders aan te houden.
