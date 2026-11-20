---
titel: Kopie van de back-ups op Google Drive
---

## Nieuws
- Beheer > Back-ups en herstel > Google Drive: elke back-up gaat (versleuteld) ook naar een map op Google Drive,
  buiten de server. Instellen staat stap voor stap in `docs/GOOGLE-DRIVE.md`.

## Changelog
- `app/src/backup/drive.js`: OAuth 2.0 (scope `drive.file`, eenmalige state van 15 minuten gebonden aan de beheerder),
  refresh-token versleuteld in de instellingen (`driveRefreshToken`, in geen formulier), map zoeken/maken, hervatbare
  upload als stroom, bewaartermijn op Drive (alleen eigen back-upnamen), stand en gebeurtenissen in `drive-state.json`
  (nooit tokens), synchroniseren na elke back-up en elk uur (na een fout een kwartier wachten, na een ingetrokken token
  pas na opnieuw koppelen), downloaden voor de hersteltest.
- Beheer: sectie *Google Drive* (instellingen `driveEnabled`, `driveClientId`, `driveClientSecret`, `driveFolderName`,
  `driveKeepCount`), terugkeeradres, koppelen, ontkoppelen (token ingetrokken bij Google), Nu synchroniseren (6 per
  tien minuten); koppelen en ontkoppelen in het auditlog. De terugkeer van Google werkt zonder sessie.
- `docs/GOOGLE-DRIVE.md`: Google Cloud-project, toestemmingsscherm en OAuth-client instellen.
