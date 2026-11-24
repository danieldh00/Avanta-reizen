---
titel: Infobrief aan de deelnemers van een vertrek
bump: minor
---

## Nieuws
- Kantoor stuurt de infobrief nu vanuit het CRM (Boekingen > Infobrieven): kies het vertrek, schrijf de tekst met de
  teksteditor, bekijk het voorbeeld, stuur een testmail naar jezelf en verstuur hem naar alle deelnemers (en de ouder of
  voogd van deelnemers onder de 16). Per infobrief zie je daarna aan wie hij is verzonden, met een export naar Excel.

## Changelog
- Nieuwe module `app/src/infobrief/` met migratie 32 (`infobrieven`, `infobrief_recipients`), recht `infobrief`
  (beheerder, kantoor) en menu-item *Infobrieven*.
- Versturen in de achtergrond (`sender.js`): rondes elke 15 seconden, limiet per minuut in Beheer > E-mail > Infobrief
  (`infobriefPerMinute`, standaard 20). Nooit dubbel: één keer van concept naar verzenden onder `FOR UPDATE`, unieke
  sleutel per ontvanger, *bezig* vóór het versturen en *niet zeker verzonden* na een herstart. Alleen mislukte kunnen
  opnieuw.
- Geen e-mailadressen in de wachtrij of op het scherm: het adres wordt pas bij het versturen opgezocht (persoon, anders
  formulier; de ouder uit het versleutelde blok). Hetzelfde adres krijgt de brief één keer.
- Mailvoorbeeld in een frame met een eigen, strenge CSP; testmail naar het eigen adres (limiet 10 per 10 minuten);
  verzendoverzicht als .xlsx; alle acties in het auditlog.
- `mail/rich-text.js`: opgemaakte tekst naar e-mail (opnieuw opschonen, volledige adressen, inline stijlen, platte
  tekst); `renderMail` kent `richHtml`/`richText`.
