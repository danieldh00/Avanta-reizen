# Ombouw naar Vue: gestopt

Op 25-11-2026 is de ombouw van het CRM naar Vue 3 + TypeScript + Vite gestopt en helemaal teruggedraaid (besluit
Daniël). Dit bestand bewaart alleen de reden en wat er gebeurd is, zodat niemand zonder nieuw besluit opnieuw begint.

## Wat er gebouwd was
- V0: integratiebranch `develop` met een nachtelijke samenvoeging uit `main`, een stagingomgeving naast de
  testomgeving (servertaak 002) en de stand van staging bij Updates en onderhoud.
- V1: Vite-project `app/web/`, JSON-API onder `/app/api/` met zod, koppelpunt in de schil en bouwstenen.
- V2: de veelgestelde vragen in Vue (op `main` sinds release 0.36.3).
- V3 (alleen op `develop`): categorieën en tags, menu's, reistypes en landen, lijstpagina's, en het meesturen van de
  eerste gegevens in de pagina.

## Waarom gestopt
Op staging voelden de schermen duidelijk trager dan die van de server. Gemeten (lokaal, 60 ms netwerkvertraging, tot
de inhoud er staat): server ~95 ms, Vue ~150 ms; met de eerste gegevens mee in de pagina ~100 ms. Ook dat voelde
nog trager, en de winst woog niet op tegen het extra onderhoud (tweede bouwstap, API-laag, tweede set tests).

## Wat er is teruggedraaid
- `main`: de merges van #150 (V1 en V2) en #151 teruggedraaid; de FAQ heeft weer de schermen van de server.
- De stagingomgeving, servertaak 002, de stand van staging (#146), `develop-sync.yml` en de werkwijze met `develop`
  zijn weg; servertaak 003 ruimt staging op de server op. De branch `develop` is verwijderd.
