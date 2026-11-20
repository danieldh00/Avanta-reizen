---
titel: Logboek met foutcodes en debugmodus
bump: minor
---

## Nieuws
- Bij een fout ziet de bezoeker een korte foutcode; onder Beheer > Systeem > Logboek staat die fout met de details, samen met trage verzoeken en waarschuwingen van achtergrondtaken.
- Beheer > Systeem > Foutopsporing: een debugmodus die beheerders de details meteen op de foutpagina toont, de drempel voor trage verzoeken en de bewaartermijn van het logboek.

## Changelog
- Migratie 7 (`beheer: logboek`): tabel `app_logs` met indexen op tijd, niveau, bron, foutcode en request-id, plus de gedeeltelijke index `audit_log_ip_idx` op `audit_log (created_at) WHERE ip_prefix IS NOT NULL` voor het opschonen van IP-adressen.
- `app/src/system/app-log.js`: gebufferd logboek (batch-insert, gelijke meldingen samengevoegd met teller, grens per minuut, terugval naar de console), privacyfilter (geheimen, e-mailadressen, IBAN's), genormaliseerde paden, foutcodes (8 hex) en request-id's (12 hex), opschonen op `logRetentionDays` en maximaal 100.000 regels; `console.warn`/`console.error` komen ook in het logboek.
- Elk verzoek krijgt `X-Request-Id`; trage verzoeken (`logSlowMs`) komen in het logboek. Nieuwe foutafhandeling: foutcode op de 500-pagina, details alleen in debugmodus (`debugMode`) en alleen voor gebruikers met recht `systeem`.
- `app/src/beheer/log-routes.js`: `/app/beheer/logboek/` met filters op niveau en bron, zoeken op foutcode, request-id of tekst, 50 per pagina op id (limiet 120 per minuut).
