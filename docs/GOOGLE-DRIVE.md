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
4. Bij *Doelgroep* (Audience): staat de app op **Testen**, klik dan **App publiceren** (status *In productie*).
   Anders verloopt de koppeling na 7 dagen. Een verificatie door Google is niet nodig: de scope `drive.file` is niet
   gevoelig.
5. Bij *Gegevenstoegang* (Data access) hoeft niets: de app vraagt zelf alleen `drive.file`.

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
| `redirect_uri_mismatch` bij Google | Het terugkeeradres in stap 3.3 wijkt af van wat Beheer toont (let op `https`, `/app/` en de slash aan het eind). |
| "Google weigert de koppeling; koppel opnieuw" | Toegang ingetrokken, wachtwoord gewijzigd of de app stond op *Testen* (7 dagen). Publiceer de app (stap 2.4) en klik **Opnieuw koppelen met Google**. |
| "Google gaf geen refresh-token" | Haal de toegang weg op <https://myaccount.google.com/permissions> (*Avanta back-ups*) en koppel opnieuw. |
