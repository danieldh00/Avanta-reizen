/**
 * Beheer > Systeem: de instellingen van deze groep (`FIELDS`, zie de veldbeschrijving in `beheer/settings.js`) en
 * de secties in de zijbalk (`GROUP`, zie `beheer/indeling.js`). Een nieuwe instelling in deze groep komt alleen hier.
 */

/** De instellingen van de groep Systeem. */
const FIELDS = {
  updateAuto: {
    type: 'bool', label: 'Automatisch bijwerken', help: 'Aan: de server installeert een nieuwe versie van main zelf (binnen een kwartier). Uit: alleen met Nu updaten.', default: true,
  },
  maintenanceMode: {
    type: 'bool', label: 'Onderhoudsmodus', help: 'Aan: versturen en opslaan (formulieren, CRM) geeft een melding; lezen blijft werken. Inloggen blijft mogelijk.', default: false,
  },
  maintenanceMessage: {
    type: 'text', label: 'Tekst van de onderhoudsmelding', help: 'Leeg = de standaardtekst.', default: '', max: 300,
  },
  debugMode: {
    type: 'bool', label: 'Debugmodus', help: 'Aan: bij een fout zien beheerders (en alleen zij) de details op de foutpagina: soort fout, melding en de plek in de code. Bezoekers zien altijd alleen de foutcode. Zet hem weer uit na het zoeken.', default: false,
  },
  logSlowMs: { type: 'int', label: 'Traag verzoek vanaf (ms)', help: 'Verzoeken die langer duren komen als "traag" in het logboek.', default: 1500, min: 200, max: 60000 },
  logRetentionDays: { type: 'int', label: 'Logboek bewaren (dagen)', help: 'Oudere regels worden dagelijks verwijderd. Het logboek bevat geen persoonsgegevens.', default: 30, min: 1, max: 365 },
  monitorEnabled: { type: 'bool', label: 'Bewaking aan', help: 'Elke vijf minuten controleren en bij een probleem een melding sturen. Uit = geen incidenten, geen meldingen en geen heartbeat.', default: true },
  monitorEmail: { type: 'email', label: 'Meldadres voor de bewaking', help: 'Leeg = het e-mailadres van kantoor (E-mail > Meldingen aan kantoor). Werkt alleen met een ingestelde mailserver.', default: '', max: 200 },
  monitorWebhookUrl: {
    type: 'secret', label: 'Webhook-URL', help: 'Optioneel: elke melding gaat ook als JSON (met de velden text en content) naar dit https-adres, bijvoorbeeld een kanaal in Teams, Slack, Discord of ntfy. Staat versleuteld opgeslagen.', default: '', max: 500,
    validate: (value) => (/^https:\/\/[^\s/@]+(\/\S*)?$/.test(value) ? '' : 'Vul een volledig adres in dat begint met https://.'),
  },
  monitorHeartbeatUrl: {
    type: 'secret', label: 'Heartbeat-URL', help: 'Optioneel: dit https-adres wordt elke vijf minuten aangeroepen zolang er geen ernstig incident open staat (bijvoorbeeld Healthchecks.io of Uptime Kuma). Blijft de aanroep weg, dan waarschuwt die dienst; ook als de hele server plat ligt. Staat versleuteld opgeslagen.', default: '', max: 500,
    validate: (value) => (/^https:\/\/[^\s/@]+(\/\S*)?$/.test(value) ? '' : 'Vul een volledig adres in dat begint met https://.'),
  },
  monitorRepeatHours: { type: 'int', label: 'Herinnering na (uur)', help: 'Zolang een incident open staat, volgt na zoveel uur een herinnering. 0 = geen herinnering.', default: 24, min: 0, max: 168 },
  monitorBackupMaxHours: { type: 'int', label: 'Back-up te oud na (uur)', help: 'Een incident als de laatste geslaagde back-up ouder is.', default: 26, min: 2, max: 336 },
  monitorDiskMinPercent: { type: 'int', label: 'Minimale vrije schijfruimte (%)', help: 'Onder dit percentage een ernstig incident, onder het dubbele een waarschuwing.', default: 10, min: 1, max: 50 },
  monitorErrorsPerHour: { type: 'int', label: 'Fouten per uur', help: 'Een waarschuwing vanaf zoveel fouten in het logboek in één uur. 0 = niet controleren.', default: 20, min: 0, max: 10000 },
  hostTasksDone: {
    type: 'text', label: 'Met de hand afgevinkte servertaken', help: 'Alleen via Beheer > Servertaken; staat in geen enkel formulier.', default: '', max: 4000,
    pattern: /^[0-9]{3}-[a-z0-9-]{1,80}(,[0-9]{3}-[a-z0-9-]{1,80})*$/, patternMessage: 'Ongeldige lijst met servertaken.',
  },
};

/** De groep Systeem in de zijbalk van Beheer, met haar secties. */
const GROUP = {
  title: 'Systeem',
  sections: [
    { id: 'overzicht', label: 'Systeemoverzicht', view: 'overzicht', words: 'versie database migratie node uptime status' },
    { id: 'instellingen', label: 'Alle instellingen en hun bron', view: 'instellingen', words: 'instellingen bron omgeving startwaarde standaard standaardwaarde overzicht lijst' },
    { id: 'updates', label: 'Updates en onderhoud', view: 'updates', words: 'update updaten bijwerken versie release releasenotes changelog automatisch onderhoud onderhoudsmodus 503 uitrol' },
    { id: 'logboek', label: 'Logboek', view: 'logboek', words: 'logboek log fout fouten foutcode error waarschuwing traag request-id verzoek console' },
    {
      id: 'foutopsporing',
      label: 'Foutopsporing',
      intro: 'Bij elke fout krijgt de bezoeker een foutcode; die staat met de details in het logboek. De debugmodus toont beheerders de details meteen op de foutpagina.',
      fields: ['debugMode', 'logSlowMs', 'logRetentionDays'],
      words: 'debug debugmodus foutcode stacktrace traag drempel bewaartermijn logboek opsporen',
    },
    {
      id: 'bewaking',
      label: 'Bewaking en meldingen',
      intro: 'Elke vijf minuten controleert de app de back-up, de kopie op Google Drive, de hersteltest, het versturen van mail, de schijfruimte, het aantal fouten en de laatste update. Een probleem wordt een incident met een melding per mail en eventueel webhook; is het opgelost, dan volgt ook een melding.',
      fields: ['monitorEnabled', 'monitorEmail', 'monitorWebhookUrl', 'monitorHeartbeatUrl', 'monitorRepeatHours', 'monitorBackupMaxHours', 'monitorDiskMinPercent', 'monitorErrorsPerHour'],
      extra: 'bewaking',
      words: 'bewaking monitoring incident incidenten melding alarm webhook heartbeat healthchecks uptime kuma teams slack discord ntfy schijf schijfruimte disk back-up hersteltest mail fouten',
    },
    { id: 'servertaken', label: 'Servertaken', view: 'servertaken', words: 'server servertaak taken commando proxmox pve apps01 host script afvinken' },
  ],
};

module.exports = { FIELDS, GROUP };
