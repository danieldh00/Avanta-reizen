---
titel: Time-out op de databaseverbinding
---

## Nieuws
- Als de database even niet bereikbaar is, blijft de site niet meer eindeloos laden: na enkele seconden verschijnt een
  foutpagina en herstelt de site zich vanzelf zodra de database terug is.

## Changelog
- `database/db.js`: `connectionTimeoutMillis` (standaard 5000 ms, `DATABASE_CONNECT_TIMEOUT_MS`) en
  `idleTimeoutMillis` (30 s) op de pool; ongeldige waarden in `DATABASE_POOL_SIZE` vallen terug op 10.
- `pool.on('error')`: een verbinding die in rust wegvalt laat het proces niet meer crashen (alleen de foutcode gelogd).
