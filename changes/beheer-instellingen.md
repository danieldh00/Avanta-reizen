---
titel: Beheer met instellingen
bump: minor
---

## Nieuws
- Nieuw onderdeel **Beheer** in het CRM (alleen voor de beheerder): een zijbalk met zoekveld, een systeemoverzicht en
  instellingen die zonder herstart werken.
- De contactgegevens in de voettekst van de site (telefoon en e-mail) zijn nu aan te passen in Beheer.

## Changelog
- Migratie 5: tabel `settings` (sleutel, waarde, gewijzigd op/door).
- `src/beheer/settings.js`: register `SETTING_FIELDS` (tekst, e-mail, URL, tekstvak, ja/nee, getal, keuze, geheim) met
  controle op de server; volgorde database → omgevingsvariabele → standaard; geheimen versleuteld met de hoofdsleutel en
  gebonden aan de naam van de instelling, in het scherm alleen "ingesteld" met de laatste 4 tekens; terugzetten naar de
  startwaarde; opslaan en auditlog in één transactie.
- `src/beheer/indeling.js` + `routes.js`: `/app/beheer/` met groepen, zoeken (ook zonder JavaScript), systeemoverzicht en
  generieke instellingenformulieren; nieuw recht `systeem` (rol beheerder), menu-item *Beheer*.
- Contactgegevens uit Beheer in de voettekst en de JSON-LD van de homepage (`res.locals.contact`).
- Auditacties `instelling.gewijzigd` en `instelling.teruggezet` (alleen de naam van de instelling, nooit de waarde).
