# DPIA: aanmeldingen en deelnemersbeheer (opzet)

Opzet van een gegevensbeschermingseffectbeoordeling (art. 35 AVG), in de volgorde van het model van de Autoriteit
Persoonsgegevens. Stand 23-11-2026. Avanta beoordeelt en stelt vast, bij voorkeur met een AVG-jurist of FG; de
technische delen beschrijven de software zoals die is gebouwd.

## 1. Waarom een DPIA

Avanta verwerkt bijzondere persoonsgegevens (religie, gezondheid) en identiteitsgegevens, ook van kinderen en
jongeren (jeugdreizen). Volgens de lijst van de AP en de criteria van de EDPB (gevoelige gegevens, kwetsbare
betrokkenen, gegevens over meerdere jaren) is een DPIA daarom waarschijnlijk verplicht en in elk geval verstandig.

## 2. Beschrijving van de verwerking

- **Wat**: aanmelden voor een groepsreis via de website, beheer van deelnemers, betalingen en deelnemerslijsten in
  het CRM; zie `VERWERKINGSREGISTER.md` §1 tot en met §4.
- **Wie**: deelnemers (ook onder de 16), ouders of voogden, medewerkers van kantoor, reisleiders.
- **Hoeveel**: **Open**: aantal aanmeldingen per jaar en aandeel jeugdreizen invullen.
- **Systemen**: eigen webapplicatie (Node.js, PostgreSQL) op een server van de hostingpartij, achter een tunnel;
  verwerkers in `VERWERKERS.md`.
- **Gegevensstroom**: formulier → controle op de server → persoon (ontdubbeld) met per categorie versleutelde blokken →
  CRM (inzien per categorie met rechten en audit) → deelnemerslijst per vertrek → opschonen na de reis.

## 3. Doelen en belangen

Een reis veilig en goed organiseren: weten wie meegaat, kunnen handelen bij een medisch probleem of noodgeval,
reisdocumenten regelen, en de boekhouding op orde. Kerkgenootschap hoort bij het christelijke karakter van de reizen;
Avanta heeft besloten het veld te houden (21-11-2026), vrijwillig en met eigen toestemming.

## 4. Noodzaak en evenredigheid

| Toets | Beoordeling |
|---|---|
| Grondslag | Overeenkomst voor de gewone gegevens; uitdrukkelijke toestemming per soort voor art. 9; ouder of voogd onder de 16 |
| Dataminimalisatie | Art. 9-velden vrijwillig; oudergegevens alleen onder de 16; meldingen en mails zonder bijzondere gegevens; reisleider ziet alleen het eigen vertrek en bijzondere gegevens alleen in een venster vóór vertrek. **Open**: is het kerkgenootschap nodig voor de reis, of alleen nice-to-have? Dat weegt mee in de evenredigheid |
| Bewaartermijnen | Bijzondere en paspoortgegevens 1 maand na de reis; persoon 24 maanden; boekhouding 7 jaar (geanonimiseerd). **Open**: Avanta bevestigt de termijnen (open vraag 4 uit `docs/OPZET-CRM.md`) |
| Rechten van betrokkenen | Inzage-export, wijzigen, wissen en intrekken in het CRM; zie het register |
| Oude gegevens | Art. 9-gegevens van het oude formulier (zonder losse toestemming) worden niet overgenomen en eerder overgenomen gegevens gewist (audit A10) |

## 5. Risico's

| Risico | Kans zonder maatregel | Gevolg | Maatregelen in de software | Restrisico |
|---|---|---|---|---|
| Onbevoegde inzage in gezondheid of religie (lek, inbraak) | Middel | Hoog | Versleuteling per categorie met sleutel buiten de database; rechten per categorie; *Toon* met auditregel; 2FA (verplicht bij livegang voor rollen met bijzondere gegevens); CSP en beveiligingskoppen; limieten op inloggen | Laag |
| Medewerker of reisleider kijkt verder dan nodig | Middel | Middel | Rechten per rol, reisleider alleen eigen vertrek en tijdvenster, auditlog met export | Laag tot middel (organisatorisch: afspraken) |
| Kind meldt zich aan zonder medeweten ouder | Middel | Middel | Leeftijd op de server bepaald; onder de 16 verplicht ouder met eigen vinkje; bevestigingsmail naar de ouder | Laag tot middel (e-mailadres van de ouder wordt niet geverifieerd) |
| Gegevens langer bewaard dan nodig | Hoog | Middel | Dagelijkse automatische opschoning met instelbare termijnen; rondes zichtbaar in Beheer | Laag |
| Verlies van gegevens (storing, fout) | Middel | Hoog | Dagelijkse versleutelde back-up, kopie buiten de server (Drive), wekelijkse hersteltest, bewaking | Laag, mits de hoofdsleutel veilig buiten de server staat (audit A04) |
| Verlies van de hoofdsleutel | Laag | Hoog (gegevens onleesbaar) | Sleutel in wachtwoordkluis (draaiboek §1) | **Open**: actie Daniël/Avanta |
| Uitlekken van de hoofdsleutel | Laag | Hoog (versleutelde gegevens leesbaar voor wie ook de database heeft) | Sleutel buiten de database; rotatie met opnieuw versleutelen van alle gegevens (draaiboek §8, P7.5) | Laag, mits na een vermoedelijk lek direct geroteerd wordt |
| Gegevens in mail of logboek | Middel | Middel | Mails zonder bijzondere gegevens; privacyfilter in het logboek; geen persoonsgegevens in audit | Laag |
| Doorgifte buiten de EER (verwerkers, bestemmingen) | Middel | Middel | Alleen verwerkers met waarborgen; geen trackers zonder toestemming | Middel; **Open**: per verwerker vastleggen |
| Valse aanmeldingen of misbruik van formulieren | Middel | Laag | Limiet, herkomstcontrole, honeypot, ondertekend tijdstempel, optionele captcha | Laag |

## 6. Conclusie en vervolg

**Open**: Avanta trekt de conclusie (restrisico aanvaardbaar of niet). Bij een hoog restrisico is voorafgaande
raadpleging van de AP nodig (art. 36). Vervolgacties vóór de eerste echte aanmelding:

1. Verwerkersovereenkomsten sluiten (`VERWERKERS.md`).
2. Privacyverklaring publiceren (`PRIVACYVERKLARING-VOORSTEL.md`).
3. Bewaartermijnen bevestigen en zo nodig in Beheer aanpassen.
4. Hoofdsleutel in de wachtwoordkluis, hersteltest groen (audit A04).
5. Tweestapsverificatie verplicht voor rollen met bijzondere gegevens (besluit 23-11-2026, bij de livegang).
6. Teksten van het formulier (toestemmingen, ouder of voogd) laten toetsen.
7. DPIA elk jaar en bij elke grote wijziging opnieuw bekijken.
