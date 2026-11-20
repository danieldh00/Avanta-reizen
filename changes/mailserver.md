---
titel: E-mail versturen via een eigen mailserver
---

## Nieuws
- In Beheer staat een nieuw onderdeel *E-mail > Mailserver*: stel een SMTP-server of een Exchange Online-connector in,
  verstuur een testmail en zie het WAN-IP van de server en de laatste verzendingen.

## Changelog
- `mail/mailer.js` (nodemailer): SMTP met inloggen of Exchange Online-connector (poort 25, zonder inlog). Verbinden
  alleen met een openbaar adres (`security/netguard.js`, tegen SSRF), STARTTLS verplicht zonder SSL/TLS, certificaat
  gecontroleerd op de servernaam, TLS 1.2 of hoger, geen kop-injectie via onderwerp of afzender. Leesbare meldingen bij
  fouten (inloggen, TLS, time-out, geweigerde verbinding of afzender) zonder adressen of wachtwoord.
- `mail/wan-ip.js`: WAN-IP (IPv4) van de server via vaste opzoekdiensten, een uur bewaard, voor de connector.
- Instellingen `mailMode`, `mailHost`, `mailPort`, `mailSecure`, `mailUser`, `mailPassword` (versleuteld),
  `mailFromName`, `mailFromAddress`, `mailReplyTo` in de nieuwe groep *E-mail* van Beheer.
- Testmail (5 per tien minuten per beheerder, in het auditlog als `mail.test` zonder adres) en een overzicht van de
  laatste 20 verzendingen in het geheugen, zonder adressen of inhoud.
