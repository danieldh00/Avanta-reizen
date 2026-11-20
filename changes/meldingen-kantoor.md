---
titel: Meldingen aan kantoor en mail-opmaak
---

## Nieuws
- Kantoor krijgt een mail bij een nieuw bericht via het contactformulier en bij een nieuwe aanmelding (instelbaar in
  Beheer > E-mail > Meldingen aan kantoor). Antwoorden op zo'n melding gaat direct naar de afzender.
- Alle mails van de app hebben nu de huisstijl: logo, een gekleurde titelbalk en een voettekst (Beheer > E-mail >
  Mail-opmaak, met voorbeeld).

## Changelog
- `mail/layout.js`: e-mailveilige HTML (tabellen, inline stijlen, alle waarden ge-escaped) met platte-tekstversie en
  het logo als ingebedde bijlage (`cid:`); kleur van de titelbalk met contrastcontrole (minimaal 4,5 tegen wit).
- `mail/notifications.js`: melding na het opslaan van een contactbericht of aanmelding, zonder dat de bezoeker wacht;
  een mislukte melding verandert niets aan de inzending en staat in het overzicht van de mailserver. Een aanmelding gaat
  zonder bijzondere gegevens (geboortedatum, kerk, paspoort, noodnummer, bijzonderheden) de deur uit.
- Instellingen `notifyEmail`, `notifyContact`, `notifyBooking`, `mailHeaderColor`, `mailFooterText`; de testmail
  gebruikt de nieuwe opmaak. Voorbeeld op `/app/beheer/mail-opmaak/voorbeeld/` (recht `systeem`).
- Naar aanleiding van de review van B1: Teredo (`2001::/32`) en 6to4 (`2002::/16`) gelden niet als openbaar adres,
  de limietstatus (429) volgt uit een eigen veld in plaats van de meldingstekst, en de ongebruikte `mailer.verify` is weg.
