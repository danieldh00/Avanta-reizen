# Google Drive koppelen voor de back-ups

Eenmalig, met het Google-account waarop de back-ups moeten komen (bijvoorbeeld een kantooraccount). Duurt ongeveer tien
minuten. De back-ups zijn al versleuteld voordat ze naar Google gaan; de app krijgt alleen toegang tot de map die ze
zelf aanmaakt (scope `drive.file`), niet tot de rest van de Drive.

## 1. Project en Drive API
1. Ga naar <https://console.cloud.google.com/> en log in met het juiste account.
2. Bovenaan: projectkiezer > **Nieuw project**, naam `Avanta back-ups` > **Maken**, en selecteer het project.
3. Menu > **API's en services > Bibliotheek** > zoek **Google Drive API** > **Inschakelen**.

## 2. Toestemmingsscherm (OAuth consent screen)
1. Menu > **API's en services > OAuth-toestemmingsscherm** (nieuw: *Google Auth Platform > Branding*) > **Aan de slag**.
2. App-naam `Avanta back-ups`, ondersteuningsmail: je eigen adres > **Volgende**.
3. Doelgroep: **Extern** (met een Google Workspace-account mag ook **Intern**) > contactgegevens > **Maken**.
4. Bij *Branding*: vul **App-startpagina** (`https://avanta.den-hollander.com/`) en **Link naar privacybeleid** (de
   privacypagina van de site) in, en zet onder **Geautoriseerde domeinen** het hoofddomein: `den-hollander.com` (bij de
   echte site later ook `avantareizen.nl`). Dat domein moet geverifieerd zijn, zie stap 2a.
5. Bij *Doelgroep* (Audience): staat de app op **Testen**, klik dan **App publiceren** (status *In productie*).
   Anders verloopt de koppeling na 7 dagen. Een app-beoordeling door Google is niet nodig: de scope `drive.file` is
   niet gevoelig.
6. Bij *Gegevenstoegang* (Data access) hoeft niets: de app vraagt zelf alleen `drive.file`.

## 2a. Domeinverificatie (net als bij AquaTech)
Google accepteert een geautoriseerd domein (en daarmee het terugkeeradres op dat domein) in een gepubliceerde app pas
als je hebt bewezen dat het domein van jou is. Dat gaat via Google Search Console, met hetzelfde Google-account als het
Cloud-project (of voeg dat account daar toe als eigenaar).

1. Ga naar <https://search.google.com/search-console> > **Property toevoegen** > **Domein** > `den-hollander.com`.
   Staat het domein er al als geverifieerde property (bijvoorbeeld van AquaTech) voor dit account, dan ben je klaar en
   ga je door naar stap 3.
2. Google toont een **TXT-record** (`google-site-verification=…`). Kopieer het.
3. Cloudflare-dashboard > `den-hollander.com` > **DNS > Records** > **Record toevoegen**: type `TXT`, naam `@`,
   inhoud het gekopieerde record, TTL *Auto* > **Opslaan**. Laat het record staan: Google controleert het af en toe
   opnieuw.
4. Terug in Search Console: **Verifiëren** (soms duurt het een paar minuten voordat DNS is bijgewerkt).
5. In de Cloud Console bij *Branding* staat het domein daarna als geverifieerd. Vraagt Google om **merkverificatie**
   (app-naam en logo op het toestemmingsscherm), dien die dan in; dat duurt enkele werkdagen. Tot dan toont Google
   bij het koppelen het domein in plaats van de app-naam; de koppeling werkt wel.

Bij de overstap naar de echte site herhaal je 2a voor `avantareizen.nl` en voeg je het terugkeeradres van die site toe
(stap 3.3).

## 3. OAuth-client
1. **API's en services > Inloggegevens** (nieuw: *Clients*) > **Inloggegevens maken > OAuth-client-ID**.
2. Type: **Webapplicatie**, naam `Avanta`.
3. **Geautoriseerde omleidings-URI's** > **URI toevoegen**: het *Terugkeeradres* uit
   Beheer > Back-ups en herstel > Google Drive, voor de testomgeving:
   `https://avanta.den-hollander.com/app/beheer/google-drive/terug/`
   (bij de echte site later: `https://www.avantareizen.nl/app/beheer/google-drive/terug/` erbij).
4. **Maken**. Kopieer de **client-ID** en het **clientgeheim** (secret).

## 4. In Avanta
1. Beheer > Back-ups en herstel > **Google Drive**: vink *Back-ups ook naar Google Drive kopiëren* aan, plak client-ID
   en client-secret > **Opslaan**.
2. **Koppelen met Google** > kies het account > **Doorgaan/Toestaan**. Je komt terug in Beheer met "Gekoppeld met …".
3. **Nu synchroniseren**: de bestaande back-ups gaan naar de map *Avanta back-ups* op Drive.

## Problemen
| Melding | Oplossing |
|---|---|
| "Domein niet geverifieerd" / *Unverified domain* bij Branding, of `redirect_uri` geweigerd bij publiceren | Doe stap 2a voor het domein van het terugkeeradres, met hetzelfde Google-account als het Cloud-project. |
| `redirect_uri_mismatch` bij Google | Het terugkeeradres in stap 3.3 wijkt af van wat Beheer toont (let op `https`, `/app/` en de slash aan het eind). |
| "Google weigert de koppeling; koppel opnieuw" | Toegang ingetrokken, wachtwoord gewijzigd of de app stond op *Testen* (7 dagen). Publiceer de app (stap 2.5) en klik **Opnieuw koppelen met Google**. |
| "Google gaf geen refresh-token" | Haal de toegang weg op <https://myaccount.google.com/permissions> (*Avanta back-ups*) en koppel opnieuw. |
