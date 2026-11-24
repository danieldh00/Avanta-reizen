// @ts-check
/**
 * Beheer > E-mail: de instellingen van deze groep (`FIELDS`, zie de veldbeschrijving in `beheer/settings.js`) en
 * de secties in de zijbalk (`GROUP`, zie `beheer/indeling.js`). Een nieuwe instelling in deze groep komt alleen hier.
 */
const { contrastWithWhite } = require('../../mail/layout');

/** De instellingen van de groep E-mail. */
const FIELDS = {
  mailMode: {
    type: 'enum',
    label: 'Manier van versturen',
    help: 'SMTP: inloggen bij de mailserver. Exchange Online-connector: Microsoft 365 vertrouwt het WAN-IP van deze server (poort 25, zonder inlog).',
    default: 'smtp',
    values: ['smtp', 'connector'],
    labels: { smtp: 'SMTP met gebruikersnaam en wachtwoord', connector: 'Exchange Online-connector (op IP-adres)' },
  },
  mailHost: {
    type: 'text',
    label: 'Mailserver',
    help: 'Bijv. smtp.office365.com, of bij een connector <domein>.mail.protection.outlook.com. Leeg = de app verstuurt geen mail.',
    default: '',
    max: 253,
    pattern: /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i,
    patternMessage: 'Vul een servernaam in zoals smtp.example.nl (zonder https:// of poort).',
  },
  mailPort: { type: 'int', label: 'Poort', help: '587 met STARTTLS (gebruikelijk), 465 met SSL/TLS, of 25 voor een connector.', default: 587, min: 1, max: 65535 },
  mailSecure: { type: 'bool', label: 'SSL/TLS vanaf het begin (poort 465)', help: 'Uit: de verbinding wordt met STARTTLS beveiligd; lukt dat niet, dan gaat er niets weg.', default: false },
  mailUser: { type: 'text', label: 'Gebruikersnaam', help: 'Alleen bij SMTP; meestal het volledige e-mailadres.', default: '', max: 200 },
  mailPassword: { type: 'secret', label: 'Wachtwoord', help: 'Alleen bij SMTP; bij Microsoft 365 of Gmail vaak een app-wachtwoord. Staat versleuteld opgeslagen.', default: '', max: 300 },
  mailFromName: {
    type: 'text', label: 'Naam afzender', default: 'Avanta Reizen', max: 100, required: true,
    pattern: /^[^"<>@\\]+$/, patternMessage: 'Gebruik geen aanhalingstekens, <, >, @ of \\.',
  },
  mailFromAddress: { type: 'email', label: 'E-mailadres afzender', help: 'Een adres waarvoor de mailserver mag versturen. Leeg = de app verstuurt geen mail.', default: '', max: 200 },
  mailReplyTo: { type: 'email', label: 'Antwoordadres', help: 'Waar antwoorden heen gaan (leeg = het adres van de afzender).', default: '', max: 200 },
  notifyEmail: { type: 'email', label: 'E-mailadres van kantoor', help: 'Hier komen de meldingen binnen. Leeg = geen meldingen.', default: '', max: 200 },
  notifyContact: { type: 'bool', label: 'Melding bij een nieuw bericht via het contactformulier', default: true },
  notifyBooking: { type: 'bool', label: 'Melding bij een nieuwe aanmelding', help: 'Zonder bijzondere gegevens (geboortedatum, kerk, paspoort, noodnummer, bijzonderheden); die staan alleen versleuteld in het CRM.', default: true },
  bookingConfirmEnabled: {
    type: 'bool', label: 'Bevestiging naar de reiziger na een aanmelding',
    help: 'Een mail aan het opgegeven e-mailadres met de referentie, de reisgegevens, de bedragen en de betaalinstructie. Nooit met bijzondere gegevens.',
    default: true,
  },
  bookingPaymentText: {
    type: 'textarea',
    label: 'Betaalinstructie in de bevestiging',
    help: 'Staat onder de bedragen in de bevestiging. Noem rekeningnummer, termijn en dat de referentie in de omschrijving moet. Hoogstens 10 regels.',
    default: 'Maak het bedrag binnen 24 uur over naar rekening NL94 RABO 0385 3731 55 t.n.v. Avanta Reizen en vermeld je referentie als omschrijving.\nKies je voor de aanbetaling, dan ontvang je later bericht over het restant.',
    max: 1500,
    required: true,
    validate: (value) => (value.split('\n').length > 10 ? 'Gebruik hoogstens 10 regels.' : ''),
  },
  mailHeaderColor: {
    type: 'text',
    label: 'Kleur van de titelbalk',
    help: 'Als #rrggbb; witte tekst moet goed leesbaar blijven (contrast minimaal 4,5).',
    default: '#a95c4c',
    max: 7,
    required: true,
    pattern: /^#[0-9a-f]{6}$/i,
    patternMessage: 'Gebruik een kleur als #a95c4c.',
    validate: (value) => (contrastWithWhite(value) < 4.5 ? 'Deze kleur is te licht voor witte tekst; kies een donkerdere kleur.' : ''),
  },
  mailFooterText: {
    type: 'textarea',
    label: 'Voettekst',
    help: 'Onder elke mail, bijv. naam, adres en website. Hoogstens 6 regels.',
    default: 'Avanta Reizen\nwww.avantareizen.nl',
    max: 500,
    validate: (value) => (value.split('\n').length > 6 ? 'Gebruik hoogstens 6 regels.' : ''),
  },
};

/** De groep E-mail in de zijbalk van Beheer, met haar secties. */
const GROUP = {
  title: 'E-mail',
  sections: [
    {
      id: 'mailserver',
      label: 'Mailserver',
      intro: 'De mailserver waarmee de app e-mail verstuurt: via SMTP met inloggen of via een Exchange Online-connector op het WAN-IP van deze server. Zonder server en afzender verstuurt de app niets.',
      fields: ['mailMode', 'mailHost', 'mailPort', 'mailSecure', 'mailUser', 'mailPassword', 'mailFromName', 'mailFromAddress', 'mailReplyTo'],
      extra: 'mail',
      words: 'mail e-mail smtp exchange office 365 microsoft connector starttls tls ssl poort afzender testmail wan ip wan-ip versturen',
    },
    {
      id: 'meldingen',
      label: 'Meldingen aan kantoor',
      intro: 'Een mail naar kantoor bij een nieuw contactbericht of een nieuwe aanmelding. Werkt alleen met een ingestelde mailserver; een mislukte melding verandert niets aan de inzending.',
      fields: ['notifyEmail', 'notifyContact', 'notifyBooking'],
      words: 'melding meldingen kantoor notificatie contactformulier bericht aanmelding boeking inbox',
    },
    {
      id: 'bevestiging',
      label: 'Bevestiging aan de reiziger',
      intro: 'Na een aanmelding krijgt de reiziger een bevestiging met de referentie, de reisgegevens, de bedragen en de betaalinstructie. Werkt alleen met een ingestelde mailserver; een mislukte mail verandert niets aan de aanmelding.',
      fields: ['bookingConfirmEnabled', 'bookingPaymentText'],
      words: 'bevestiging reiziger klant aanmelding boeking betaalinstructie rekeningnummer iban aanbetaling referentie',
    },
    {
      id: 'mail-opmaak',
      label: 'Mail-opmaak',
      intro: 'De opmaak van de mails van de app: het logo van de site bovenaan, een titelbalk in de huisstijlkleur en een voettekst.',
      fields: ['mailHeaderColor', 'mailFooterText'],
      extra: 'mail-opmaak',
      words: 'opmaak huisstijl kleur logo voettekst voorbeeld sjabloon template',
    },
  ],
};

module.exports = { FIELDS, GROUP };
