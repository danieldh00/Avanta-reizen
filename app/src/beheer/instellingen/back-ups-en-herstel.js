/**
 * Beheer > Back-ups en herstel: de instellingen van deze groep (`FIELDS`, zie de veldbeschrijving in `beheer/settings.js`) en
 * de secties in de zijbalk (`GROUP`, zie `beheer/indeling.js`). Een nieuwe instelling in deze groep komt alleen hier.
 */

/** De instellingen van de groep Back-ups en herstel. */
const FIELDS = {
  backupEnabled: { type: 'bool', label: 'Dagelijks automatisch een back-up maken', help: 'Een versleutelde back-up van de hele database, elke dag op het ingestelde uur.', default: true },
  backupHour: { type: 'int', label: 'Uur van de dagelijkse back-up', help: 'Nederlandse tijd, 0 tot en met 23. Kies een rustig moment, bijvoorbeeld 3 (03:00 uur).', default: 3, min: 0, max: 23 },
  backupKeepDays: { type: 'int', label: 'Back-ups bewaren (dagen)', help: 'Oudere back-ups op de server worden na elke nieuwe back-up verwijderd; de nieuwste drie blijven altijd staan.', default: 14, min: 1, max: 365 },
  driveEnabled: { type: 'bool', label: 'Back-ups ook naar Google Drive kopiëren', help: 'Na elke back-up en elk uur gaan ontbrekende back-ups (versleuteld) naar Google Drive. Werkt pas na het koppelen.', default: false },
  driveClientId: {
    type: 'text', label: 'Client-ID (Google Cloud)', help: 'Van de OAuth-client (type webapplicatie) in de Google Cloud Console; eindigt op .apps.googleusercontent.com.', default: '', max: 200,
    pattern: /^[0-9]{6,30}-[a-z0-9]{10,64}\.apps\.googleusercontent\.com$/, patternMessage: 'Een client-ID ziet eruit als 123456789012-abc….apps.googleusercontent.com.',
  },
  driveClientSecret: { type: 'secret', label: 'Client-secret', help: 'Van dezelfde OAuth-client; staat versleuteld opgeslagen en gaat nooit naar de browser.', default: '', min: 8, max: 200 },
  driveFolderName: {
    type: 'text', label: 'Map op Google Drive', help: 'De app maakt deze map zelf aan en ziet alleen wat ze zelf aanmaakte (scope drive.file).', default: 'Avanta back-ups', max: 100, required: true,
    pattern: /^[^\/\\]+$/, patternMessage: 'Gebruik geen / of \\ in de mapnaam.',
  },
  driveKeepCount: { type: 'int', label: 'Aantal back-ups op Google Drive', help: 'De nieuwste zoveel blijven op Drive staan; oudere verwijdert de app.', default: 30, min: 1, max: 365 },
  driveRefreshToken: { type: 'secret', label: 'Koppeling met Google Drive', help: 'Alleen via Koppelen en Ontkoppelen; staat in geen enkel formulier.', default: '', max: 4000 },
};

/** De groep Back-ups en herstel in de zijbalk van Beheer, met haar secties. */
const GROUP = {
  title: 'Back-ups en herstel',
  sections: [
    {
      id: 'back-ups',
      label: 'Back-ups',
      intro: 'Versleutelde back-ups van de hele database (pg_dump, AES-256-GCM met een sleutel afgeleid van de hoofdsleutel). Zonder de hoofdsleutel is een back-up onbruikbaar: bewaar die apart, buiten de server.',
      fields: ['backupEnabled', 'backupHour', 'backupKeepDays'],
      extra: 'back-ups',
      words: 'back-up backup herstel terugzetten restore database dump pg_dump versleuteld bewaartermijn download hoofdsleutel',
    },
    {
      id: 'google-drive',
      label: 'Google Drive',
      intro: 'Een kopie van elke back-up op Google Drive, buiten de server. De back-ups zijn al versleuteld: Google kan de inhoud niet lezen. De app krijgt alleen toegang tot de map die ze zelf aanmaakt.',
      fields: ['driveEnabled', 'driveClientId', 'driveClientSecret', 'driveFolderName', 'driveKeepCount'],
      extra: 'google-drive',
      words: 'google drive kopie extern buiten de server oauth cloud console client koppelen back-up backup',
    },
    { id: 'hersteltest', label: 'Hersteltest', view: 'hersteltest', words: 'hersteltest herstel terugzetten restore test controle wekelijks back-up backup drive' },
  ],
};

module.exports = { FIELDS, GROUP };
