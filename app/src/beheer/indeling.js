/**
 * Indeling van Beheer (`/app/beheer/`): groepen met secties, zoals de zijbalk in Aquatech. Een sectie is een pagina
 * onder `/app/beheer/<id>/`. Een sectie met `fields` is een instellingenformulier voor die instellingen uit
 * `beheer/settings.js`; een sectie met `view` heeft een eigen weergave in `beheer/routes.js`. `words` zijn extra
 * zoekwoorden voor het zoekveld.
 */

/** De groepen van de zijbalk met hun secties. */
const GROUPS = [
  {
    title: 'Systeem',
    sections: [
      { id: 'overzicht', label: 'Systeemoverzicht', view: 'overzicht', words: 'versie database migratie node uptime instellingen bron omgeving status' },
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
  },
  {
    title: 'Organisatie',
    sections: [
      {
        id: 'contact',
        label: 'Contact en organisatie',
        intro: 'Contactgegevens in de voettekst van de site, en adres en social media voor de gegevens voor zoekmachines (JSON-LD).',
        fields: ['contactPhone', 'contactEmail', 'orgStreet', 'orgPostalCode', 'orgCity', 'orgKvk', 'socialFacebook', 'socialInstagram', 'socialYoutube', 'socialLinkedin'],
        words: 'telefoon e-mail mail voettekst adres postcode plaats organisatie facebook instagram youtube linkedin social sameas json-ld',
      },
      {
        id: 'ontwikkeling',
        label: 'Balk "in ontwikkeling"',
        intro: 'Een opvallende balk bovenaan de publieke site die bezoekers laat weten dat de website nog in ontwikkeling is. Wijzigingen gelden meteen.',
        fields: ['devBannerEnabled', 'devBannerText'],
        words: 'banner balk ontwikkeling in ontwikkeling testsite test concept go-live live melding waarschuwing bezoekers',
      },
    ],
  },
  {
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
  },
  {
    title: 'Toegang en beveiliging',
    sections: [
      {
        id: 'sessies',
        label: 'Sessies en bewaartermijnen',
        intro: 'Hoe lang een sessie in het CRM geldig blijft en hoe lang het auditlog, de IP-adressen daarin en de 404-lijst worden bewaard. Opruimen gebeurt bij het starten van de app en daarna dagelijks.',
        fields: ['sessionIdleHours', 'sessionMaxDays', 'auditRetentionMonths', 'auditIpRetentionDays', 'notFoundRetentionDays'],
        words: 'sessie inloggen uitloggen time-out inactiviteit bewaartermijn bewaren auditlog ip ip-adres avg privacy opruimen 404',
      },
      {
        id: 'tweestaps',
        label: 'Tweestapsverificatie',
        intro: 'Na het wachtwoord vraagt het CRM een code uit een authenticator-app (bijv. Microsoft Authenticator of Google Authenticator). Een geraden of gelekt wachtwoord is dan niet genoeg om in te loggen. Standaard is het optioneel: ieder zet het zelf aan onder Tweestapsverificatie; hier kun je het verplicht maken. Kan iemand niet meer bij de app (toestel kwijt), dan zet een beheerder de tweestapsverificatie van die gebruiker uit onder Gebruikers.',
        fields: ['mfaRequiredFor'],
        words: 'tweestapsverificatie 2fa mfa totp authenticator app code herstelcode inloggen beveiliging',
      },
      {
        id: 'captcha',
        label: 'Captcha op formulieren',
        intro: 'Een onzichtbare captcha (Google reCAPTCHA v3) op het contact- en aanmeldformulier, naast de bestaande beveiliging (honeypot, tijdcontrole en limiet). Zonder sleutels of met de schakelaar uit staat er niets van Google in de site.',
        fields: ['captchaEnabled', 'captchaSiteKey', 'captchaSecret', 'captchaMinScore', 'captchaOnUnreachable'],
        extra: 'captcha',
        words: 'captcha recaptcha google robot spam bot formulier contact aanmelden beveiliging score',
      },
    ],
  },
  {
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
  },
  {
    title: 'Vindbaarheid',
    sections: [
      {
        id: 'zoekmachines',
        label: 'Zoekmachines',
        intro: 'Of zoekmachines de site mogen opnemen, het basisadres en de verificatie voor Google Search Console en Bing.',
        fields: ['seoIndexing', 'siteUrl', 'googleVerification', 'bingVerification'],
        words: 'seo indexeren noindex go-live live basisadres canonical domein search console bing webmaster verificatie google',
      },
      {
        id: 'teksten',
        label: 'Titels en omschrijving',
        intro: 'De naam van de site, de titel van de homepage en de standaardomschrijving en -afbeelding voor zoekresultaten en social media.',
        fields: ['siteName', 'homeTitle', 'defaultDescription', 'socialImage'],
        words: 'seo titel title omschrijving description meta open graph og afbeelding social delen',
      },
      {
        id: 'robots',
        label: 'Robots, sitemap en llms.txt',
        intro: 'Extra regels voor robots.txt, pagina\'s die niet in de sitemap horen en de samenvatting voor AI-zoekmachines.',
        fields: ['robotsExtra', 'sitemapExclude', 'llmsEnabled', 'llmsIntro'],
        words: 'seo robots.txt crawler sitemap.xml uitsluiten llms.txt ai chatgpt gptbot',
      },
      {
        id: 'analytics',
        label: 'Google Analytics en cookies',
        intro: 'Bezoekersstatistieken met Google Analytics (GA4). Zonder toestemming van de bezoeker wordt niets van Google geladen en komen er geen cookies; advertentiefuncties staan altijd uit.',
        fields: ['analyticsEnabled', 'analyticsMeasurementId'],
        words: 'ga4 google analytics statistieken bezoekers cookies toestemming consent cookiebalk meet-id tag',
      },
      { id: 'doorverwijzingen', label: 'Doorverwijzingen', view: 'doorverwijzingen', words: 'seo redirect 301 302 omleiding oud adres verhuisd url' },
      { id: 'niet-gevonden', label: 'Niet gevonden (404)', view: 'niet-gevonden', words: 'seo 404 niet gevonden kapotte link dode link fout' },
    ],
  },
];

/** Alle secties in één lijst, met de titel van hun groep. */
const SECTIONS = GROUPS.flatMap((group) => group.sections.map((section) => ({ ...section, group: group.title })));

/**
 * Zoekt een sectie op id.
 * @param {string} id Id uit de URL.
 * @returns {(object|undefined)} De sectie, of niets.
 */
function findSection(id) {
  return SECTIONS.find((section) => section.id === id);
}

/**
 * Maakt tekst geschikt om te zoeken: kleine letters, zonder accenten.
 * @param {string} text Tekst.
 * @returns {string} Genormaliseerde tekst.
 */
function normalizeSearch(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Filtert de groepen op een zoekterm: een sectie past als elk woord van de zoekterm voorkomt in de naam, de groep,
 * de zoekwoorden of de labels van haar instellingen.
 * @param {string} query Zoekterm (leeg = alles).
 * @param {object} fields Beschrijvingen van de instellingen (`SETTING_FIELDS`).
 * @returns {Array<{title: string, sections: object[]}>} Groepen met de passende secties (lege groepen vallen weg).
 */
function filterGroups(query, fields) {
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean).slice(0, 8);
  if (!terms.length) return GROUPS;
  return GROUPS.map((group) => ({
    title: group.title,
    sections: group.sections.filter((section) => {
      const labels = (section.fields || []).map((key) => (fields[key] ? `${fields[key].label} ${fields[key].help || ''}` : ''));
      const haystack = normalizeSearch([section.label, group.title, section.words, section.intro, ...labels].join(' '));
      return terms.every((term) => haystack.includes(term));
    }),
  })).filter((group) => group.sections.length);
}

module.exports = { GROUPS, SECTIONS, findSection, filterGroups, normalizeSearch };
