# JSON-API van het CRM (`app/src/api/`)

Alleen wat voor deze map geldt; de algemene regels staan in de root-`CLAUDE.md` en gaan bij tegenspraak voor.
Opbouw en besluiten: `docs/VUE-OMBOUW.md` (§2 en §8). Wie in deze map een bestand toevoegt of de rol van een bestand
verandert, werkt dit bestand bij in dezelfde PR.

Gedeeld fundament voor de JSON-routes onder `/app/api/` waar de nieuwe schermen in Vue mee praten. De routes van een
module staan niet hier maar in `app/src/<module>/<onderwerp>-api.js`.

## Bestanden
- `router.js` (`createApiRouter`): bescherming, JSON-parser (grens `JSON_LIMIT`), `requireLogin`/`requireRight`/
  `requireGlobalRight` met 401/403 in JSON, `GET /app/api/sessie/` (naam, rol, rechten; geen e-mailadres), de
  API-fabrieken van de modules, 404 en een foutafhandelaar met foutcode in het logboek (bron `fout`).
- `guard.js` (`createApiGuard`): vaste kop `X-Avanta-Api: 1`, herkomstcontrole (`security/form-guard.js`),
  `application/json` bij schrijven (`multipart/form-data` alleen op opgegeven paden), `Cache-Control: no-store`.
- `errors.js` (`sendApiError`, `API_ERRORS`): één foutformaat `{ fout: { code, melding, velden?, foutcode?, naar? } }`.
- `module-helpers.js` (`createWriteLimit`: eigen limiet op schrijven per gebruiker; `apiFieldNames`: veldnamen van een
  formuliercontrole naar die van de API; `sortOrderSchema`): gedeelde stukken voor de API van een module.
- `schema.js` (`validate`, `parseInput`, `idParam`, `z`): invoer met zod (`.strict()`), Nederlandse meldingen, één
  melding per veld.

## Regels voor een API-route van een module
- Een fabriek `(context) => express.Router()` in `<onderwerp>-api.js`; koppelen in `crm/routes.js` (lijst `modules`
  bij `createApiRouter`). De context bevat ook `db`, `auth` en `now`. Voorbeeld: `cms/faq-api.js` (de eerste module); vanaf V3 met `module-helpers.js` (`cms/post-term-api.js`, `cms/menu-api.js`).
- Tests met de testhulp `test/helpers/api-app.js` (`startApiApp`: app in een eigen schema met ingelogde gebruikers, `checkAccess` voor 401/403).
- Elke route een recht via `context.requireRight` (of `requireGlobalRight`); een id uit de URL via `idParam` en samen
  met zijn eigenaar opzoeken; een onbekend of andermans id is `niet-gevonden` (404).
- Invoer altijd via `context.validate(schema)` met `.strict()`; daarna de bestaande logica van de module (geen dubbele
  queries, de bestaande opschoning blijft).
- Meldingen zijn vaste teksten; nooit invoer, geheimen of persoonsgegevens in een melding of in het logboek.
- Tests per route: zonder sessie 401, ontbrekend recht 403, andere eigenaar 404, ongeldige invoer 400.
