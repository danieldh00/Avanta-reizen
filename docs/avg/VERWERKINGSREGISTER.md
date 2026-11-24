# Verwerkingsregister (art. 30 AVG)

Opzet, stand 23-11-2026. Avanta Reizen stelt het register vast en houdt het bij.

## Verwerkingsverantwoordelijke

| | |
|---|---|
| Naam | Avanta Reizen |
| Adres en KvK-nummer | **Open**: invullen (staat ook in Beheer > Organisatie > Contact) |
| Contact voor privacyvragen | info@avantareizen.nl, 0118 638427 |
| Functionaris gegevensbescherming | **Open**: niet verplicht voor een organisatie van deze omvang, tenzij de DPIA anders uitwijst; vastleggen wie privacyvragen behandelt |

## Verwerkingen

### 1. Aanmeldingen voor een reis

| Onderdeel | Inhoud |
|---|---|
| Doel | Aanmelding verwerken, de reis organiseren (vervoer, verblijf, verzekering, reisdocumenten), contact vóór en tijdens de reis, betalingen |
| Grondslag | Uitvoering van de overeenkomst (art. 6.1b); voor de boekhouding een wettelijke plicht (art. 6.1c, fiscale bewaarplicht) |
| Betrokkenen | Deelnemers; bij een deelnemer onder de 16 ook een ouder of voogd |
| Herkomst | Het aanmeldformulier op de site, of kantoor voert de aanmelding in het CRM in na een telefoontje, mail of papieren formulier (CRM > Aanmeldingen > Aanmelding invoeren). Dezelfde velden en controles; kantoor vinkt een toestemming alleen aan als de deelnemer of ouder die zelf gaf, en legt vast hoe de aanmelding binnenkwam |
| Gegevens | Naam (volgens paspoort), roepnaam, geslacht, adres, e-mail, telefoon, beroep, geboortedatum, nationaliteit, soort en nummer en geldigheid van paspoort of ID-kaart, noodnummer, reisvoorkeuren (samen reizen, eerder mee, creditcard, chauffeur), betaalkeuze en betalingen |
| Bijzondere gegevens (art. 9) | Kerkgenootschap (religie) en bijzonderheden over gezondheid: vrijwillig, alleen met een eigen, uitdrukkelijke toestemming per soort (art. 9.2a), vastgelegd met de versie van de tekst |
| Minderjarigen | Onder de 16 (op de dag van aanmelden) geeft een ouder of voogd de toestemming (art. 8 AVG, art. 5 UAVG); naam, relatie, e-mail en telefoon van de ouder worden versleuteld vastgelegd en de ouder krijgt een eigen bevestiging. Vanaf 16 worden geen oudergegevens bewaard |
| Ontvangers | Kantoor van Avanta; de reisleider van dat vertrek (alleen wat nodig is, zie §4 van `docs/OPZET-CRM.md`); verwerkers uit `VERWERKERS.md` (hosting, mail, back-up, betalingen) |
| Doorgifte buiten de EER | Alleen via verwerkers met passende waarborgen, zie `VERWERKERS.md`. **Open**: voor reizen buiten Europa gaan gegevens (naam, paspoort) naar vervoerders en accommodaties in het land van bestemming; Avanta beschrijft dat per soort reis (art. 49.1b: nodig voor de overeenkomst) |
| Bewaartermijn (standaard, instelbaar) | Bijzondere en paspoortgegevens, noodnummer en oudergegevens: 1 maand na de laatste reis gewist (geboortedatum blijft voor het herkennen van een terugkerende deelnemer). Persoon: 24 maanden na de laatste reis of activiteit geanonimiseerd. Aanmeldingen (geanonimiseerd: reis, bedragen, status): 7 jaar. Geannuleerd zonder betaling: 6 maanden na annulering verwijderd |
| Infobrief | Vóór vertrek stuurt kantoor vanuit het CRM (Boekingen > Infobrieven, recht `infobrief`) de infobrief naar de deelnemers van dat vertrek en, bij deelnemers onder de 16, naar de ouder of voogd: contact vóór de reis, dus dezelfde grondslag (art. 6.1b). Alleen het e-mailadres wordt gebruikt, pas op het moment van versturen opgezocht en niet apart opgeslagen. Het verzendoverzicht bewaart per aanmelding de rol, de status en het tijdstip (geen adressen, geen inhoud in het auditlog) en toont na het anonimiseren van de aanmelding geen naam meer. De inhoud van de brief zelf is geen persoonsgegeven en bevat nooit bijzondere gegevens |
| Beveiliging | Bijzondere en identiteitsgegevens per categorie versleuteld (AES-256-GCM, sleutel buiten de database); rechten per categorie; inzien via *Toon* met auditregel; tweestapsverificatie (verplicht voor rollen met bijzondere gegevens bij de livegang); meldingen aan kantoor zonder bijzondere gegevens |

### 2. Reizigersaccount

| Onderdeel | Inhoud |
|---|---|
| Doel | Reiziger ziet eigen aanmeldingen en gegevens, boekt opnieuw met vooraf ingevulde gegevens |
| Grondslag | Uitvoering van de overeenkomst (art. 6.1b), op verzoek van de reiziger |
| Gegevens | E-mailadres, wachtwoord (alleen als scrypt-hash), sessies en eenmalige links; toont alleen gewone gegevens, nooit bijzondere |
| Bewaartermijn | Onbevestigde accounts en verlopen links: dagelijks opgeruimd. Ongebruikt account: 24 maanden. Wissen van een persoon in het CRM verwijdert ook het account met hetzelfde adres |

### 3. Contactformulier

| Onderdeel | Inhoud |
|---|---|
| Doel | Vragen beantwoorden |
| Grondslag | Gerechtvaardigd belang (art. 6.1f): een vraag beantwoorden die de bezoeker zelf stelt |
| Gegevens | Naam, e-mail, telefoon (vrijwillig), onderwerp, bericht, eventueel de reis waar de vraag over gaat; bij het afhandelen in het CRM wie het afhandelde, wanneer en een korte notitie van kantoor |
| Toegang | CRM > Berichten, recht `berichten` (beheerder, kantoor); afhandelen en verwijderen staan in het auditlog zonder de inhoud |
| Bewaartermijn | 12 maanden (ook de notitie: het bericht wordt in zijn geheel gewist) |

### 4. Betalingen

| Onderdeel | Inhoud |
|---|---|
| Doel | Verwachte bedragen, ontvangen betalingen en herinneringen bijhouden; online betalen (optioneel, via Mollie) |
| Grondslag | Uitvoering van de overeenkomst (art. 6.1b); bewaren voor de boekhouding (art. 6.1c) |
| Gegevens | Bedragen, data, betaalmethode, kenmerk van de online betaling; geen rekening- of kaartnummers in de app (die staan bij Mollie of de bank) |
| Bewaartermijn | Met de aanmelding, 7 jaar |

### 5. Websitebezoek

| Onderdeel | Inhoud |
|---|---|
| Doel | Website tonen en beveiligen; met toestemming bezoekstatistieken; video's tonen |
| Grondslag | Gerechtvaardigd belang (art. 6.1f) voor beveiliging (limieten, onzichtbare captcha); toestemming (art. 6.1a, Telecommunicatiewet art. 11.7a) voor Google Analytics en YouTube |
| Gegevens | IP-adres (alleen kort in het geheugen voor limieten), technische gegevens; met toestemming een Analytics-cookie; bij een video na een klik de gegevens die YouTube verzamelt |
| Bewaartermijn | Limieten: minuten, alleen in het geheugen. Logboek (zonder persoonsgegevens): 30 dagen. 404-lijst (alleen adressen): 90 dagen |
| Standaard | Google Analytics en de captcha staan uit tot Avanta ze aanzet in Beheer; zonder toestemming laadt de site niets van Google |

### 6. Gebruikers van het CRM

| Onderdeel | Inhoud |
|---|---|
| Doel | Toegang tot het CRM en verantwoording (wie zag of wijzigde wat) |
| Grondslag | Gerechtvaardigd belang (art. 6.1f) en beveiligingsplicht (art. 32) |
| Betrokkenen | Medewerkers, reisleiders en andere gebruikers van het CRM |
| Gegevens | Naam, e-mail, rol, wachtwoord-hash, tweestapsgeheim (versleuteld), sessies, auditlog met ingekort IP-adres |
| Bewaartermijn | Auditlog 24 maanden, IP-adres daarin 90 dagen |

### 7. Back-ups

| Onderdeel | Inhoud |
|---|---|
| Doel | Herstel na een storing of fout (art. 32.1c) |
| Grondslag | Wettelijke plicht tot beveiliging (art. 6.1c met art. 32) |
| Gegevens | De hele database, versleuteld (AES-256-GCM) vóór opslag; de sleutel staat niet bij de back-up |
| Bewaartermijn | Op de server en op Google Drive (als gekoppeld): de nieuwste 30. Gewiste gegevens verdwijnen zo binnen die termijn ook uit de back-ups |
| Hersteltest | Elke week zet de server de nieuwste back-up terug in een wegwerpdatabase op dezelfde server, zonder netwerk naar buiten, om te controleren dat herstel werkt. Die tijdelijke, onversleutelde kopie staat in een eigen Docker-volume en wordt direct na de test verwijderd; blijft er na een stroomuitval of afgebroken run iets achter, dan ruimt de volgende run het eerst op. Er gaan geen gegevens uit de kopie naar het logboek of de melding, alleen foutregels zonder inhoud |

## Rechten van betrokkenen

| Recht | Hoe in de software |
|---|---|
| Inzage (art. 15) | CRM > deelnemer > *Gegevens exporteren* (Excel, recht `avg`); reiziger met account: eigen export na een code per e-mail |
| Rectificatie (art. 16) | CRM > deelnemer > wijzigen (recht `deelnemers.wijzigen`) |
| Wissen (art. 17) | CRM > deelnemer > *Persoon wissen* (anonimiseren; aanmeldingen blijven geanonimiseerd voor de boekhouding) |
| Intrekken toestemming (art. 7.3) | CRM > deelnemer > toestemming *Intrekken en gegevens wissen* (art. 9) |
| Bezwaar, beperking, overdraagbaarheid | Via kantoor; de Excel-export dient ook voor overdraagbaarheid |

**Open**: termijn en werkwijze voor verzoeken vastleggen (binnen een maand, art. 12.3), en wie ze afhandelt.
