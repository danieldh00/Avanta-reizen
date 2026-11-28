# Verwerkers en andere ontvangers

Opzet, stand 23-11-2026. Per partij: wat ze verwerkt, of dat standaard aan staat, en of er een verwerkersovereenkomst
(art. 28 AVG) nodig is. Avanta sluit de overeenkomsten en bewaart ze; de kolom *Overeenkomst* houdt zij bij.

| Partij | Rol | Wat | Wanneer actief | Locatie en waarborgen | Overeenkomst |
|---|---|---|---|---|---|
| Hostingpartij (server en database) | Verwerker | Alle gegevens van website en CRM (bijzondere gegevens versleuteld) | Altijd | **Open**: keuze hosting voor productie (audit A01); voorkeur binnen de EER | **Open** |
| Cloudflare (tunnel en DNS) | Verwerker | Al het websiteverkeer gaat versleuteld door de tunnel; IP-adressen en verzoeken | Altijd (zoals nu ingericht) | VS-bedrijf; EU-VS Data Privacy Framework, standaardcontractbepalingen | **Open**: Cloudflare DPA (online akkoord) |
| Mailprovider (SMTP of Microsoft 365) | Verwerker | Meldingen aan kantoor, bevestigingen aan reiziger en ouder, betaalherinneringen, links van het reizigersaccount; nooit bijzondere gegevens in mail | Zodra de mailserver is ingesteld | **Open**: welke provider; bij Microsoft 365 de EU Data Boundary | **Open** |
| Google (Drive) | Verwerker | Versleutelde back-ups van de database; Google kan de inhoud niet lezen (sleutel blijft bij Avanta) | Alleen als gekoppeld (Beheer > Back-ups en herstel) | VS-bedrijf; Data Privacy Framework, Google Cloud DPA | **Open**: Google Workspace/Cloud DPA |
| Google (reCAPTCHA v3) | Verwerker of zelfstandig (**Open**: juridisch laten duiden) | Gedrag en technische gegevens van bezoekers op het contact- en aanmeldformulier | Standaard uit; alleen als Avanta het aanzet | VS-bedrijf; Data Privacy Framework | **Open**; vermelden in de privacyverklaring |
| Google (Analytics 4) | Verwerker | Bezoekstatistieken met een cookie, IP ingekort door Google | Standaard uit; alleen met meet-ID én toestemming van de bezoeker | VS-bedrijf; Data Privacy Framework; gegevensdeling met Google uitzetten in GA4 | **Open**: verwerkersvoorwaarden in GA4 accepteren |
| Microsoft (Clarity) | Verwerker of zelfstandig (**Open**: juridisch laten duiden) | Klik-, scrol- en muisgedrag, heatmaps en sessie-opnames van de publieke site met cookies op de site (`_clck`, `_clsk`) en mogelijk eigen cookies van Microsoft op clarity.ms/bing.com (`CLID`, `MUID`, niet door de site te wissen); formulieren altijd gemaskeerd; niet op Mijn Avanta, aanmelden, betalen en CRM | Standaard uit; alleen met project-ID én toestemming van de bezoeker | VS-bedrijf; Data Privacy Framework; advertentiekoppeling (Microsoft Ads) uit, maskering op *Strict* in het Clarity-project | **Open**: Clarity-voorwaarden en DPA accepteren |
| YouTube (Google) | Zelfstandige verantwoordelijke | Bij een video pas na een klik van de bezoeker | Alleen bij videoblokken | VS-bedrijf | Niet nodig; vermelden in de privacyverklaring |
| Mollie | Zelfstandige verantwoordelijke voor de betaling (PSP), verwerker voor de koppeling | Bedrag, omschrijving met referentie, betaalgegevens die de klant zelf bij Mollie invult | Alleen als online betalen aan staat | Nederland, EER | Mollie-voorwaarden; **Open**: controleren |
| Have I Been Pwned (wachtwoordcontrole) | Geen persoonsgegevens | Alleen de eerste 5 tekens van een SHA-1-hash van een nieuw wachtwoord (k-anonimiteit) | Bij wachtwoord kiezen in CRM of account, uit te zetten in Beheer | VS | Niet nodig |
| Bewakingsdienst (webhook of heartbeat) | Verwerker als er een adres wordt ingevuld | Alleen meldingen over de werking, zonder persoonsgegevens | Alleen als ingevuld (Beheer > Systeem > Bewaking) | Afhankelijk van de gekozen dienst | Niet nodig zolang er geen persoonsgegevens in gaan |
| Reisleiders | Onder gezag van Avanta (geen verwerker) | Deelnemerslijst van hun eigen vertrek, bijzondere gegevens alleen binnen het venster vóór vertrek | Per reis | Afspraak over geheimhouding en vernietiging na de reis | **Open**: geheimhoudingsverklaring |
| Vervoerders, accommodaties, verzekeraar | Ontvangers (zelfstandig) | Naam, paspoortgegevens, soms geboortedatum, voor de uitvoering van de reis | Per reis, buiten de software | Soms buiten de EER (art. 49.1b) | Niet via de software; **Open**: beschrijven in de privacyverklaring |

## Wat de software zelf afdwingt

- Uitgaande verbindingen alleen naar openbare adressen (`security/netguard.js`); adressen die de beheerder invult alleen
  over https.
- Geen trackers of externe scripts zonder instelling in Beheer; Analytics, Clarity en YouTube pas na toestemming van de bezoeker.
- Mails aan kantoor en reizigers bevatten nooit kerkgenootschap, gezondheid, geboortedatum, paspoort of noodnummer.
- Logboek en bewaking bevatten geen persoonsgegevens (privacyfilter in `system/app-log.js`).
