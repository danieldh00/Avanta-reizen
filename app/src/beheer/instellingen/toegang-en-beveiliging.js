/**
 * Beheer > Toegang en beveiliging: de instellingen van deze groep (`FIELDS`, zie de veldbeschrijving in `beheer/settings.js`) en
 * de secties in de zijbalk (`GROUP`, zie `beheer/indeling.js`). Een nieuwe instelling in deze groep komt alleen hier.
 */

/** De instellingen van de groep Toegang en beveiliging. */
const FIELDS = {
  mfaRequiredFor: {
    type: 'enum', label: 'Tweestapsverificatie verplicht voor', default: 'niemand', values: ['niemand', 'gegevens', 'iedereen'],
    labels: { niemand: 'Niemand (optioneel: ieder zet het zelf aan)', gegevens: 'Rollen met toegang tot bijzondere gegevens (beheerder, kantoor, reisleider)', iedereen: 'Iedereen' },
    help: 'Wie het verplicht heeft, stelt het in bij de eerstvolgende keer inloggen, met een activatiecode van de beheerder. Wie het zelf heeft aangezet, geeft bij het inloggen altijd de code.',
  },
  passwordBreachCheck: {
    type: 'bool', label: 'Nieuwe wachtwoorden controleren bij Have I Been Pwned', default: true, env: 'PASSWORD_BREACH_CHECK',
    help: 'Alleen de eerste 5 tekens van een hash van het wachtwoord gaan naar de dienst; het wachtwoord zelf nooit. Is de dienst niet bereikbaar, dan geldt alleen de lokale controle.',
  },
  sessionIdleHours: { type: 'int', label: 'Uitloggen na inactiviteit (uren)', help: 'Een sessie zonder activiteit vervalt na zoveel uur. Geldt meteen, ook voor wie al is ingelogd. Advies: 1 uur, want het CRM toont bijzondere gegevens.', default: 1, min: 1, max: 24 },
  sessionMaxDays: { type: 'int', label: 'Maximale duur van een sessie (dagen)', help: 'Daarna moet iedereen opnieuw inloggen, ook bij activiteit. Korter geldt meteen, ook voor wie al is ingelogd; langer alleen voor nieuwe sessies. Advies: 1 dag.', default: 1, min: 1, max: 30 },
  auditRetentionMonths: { type: 'int', label: 'Bewaartermijn auditlog (maanden)', help: 'Oudere regels worden dagelijks verwijderd. Advies: 24 maanden.', default: 24, min: 6, max: 120 },
  auditIpRetentionDays: { type: 'int', label: 'IP-adressen in het auditlog bewaren (dagen)', help: 'Daarna wordt het (al ingekorte) IP-adres uit de regel gewist; de regel zelf blijft.', default: 90, min: 7, max: 730 },
  notFoundRetentionDays: { type: 'int', label: 'Bewaartermijn 404-lijst (dagen)', help: 'Adressen die zo lang niet meer zijn gevraagd, verdwijnen uit de lijst onder Vindbaarheid > Niet gevonden.', default: 90, min: 7, max: 365 },
  retentionEnabled: { type: 'bool', label: 'Dagelijks automatisch opschonen', help: 'Wist en anonimiseert elke dag wat de bewaartermijnen hieronder voorschrijven. Uitzetten alleen tijdelijk, bijv. bij een geschil of een verzoek van de toezichthouder; Nu opschonen werkt altijd.', default: true },
  retentionSpecialMonths: { type: 'int', label: 'Bijzondere en paspoortgegevens wissen na terugkomst (maanden)', help: 'Kerkgenootschap, bijzonderheden (gezondheid), noodnummer en paspoortgegevens (de geboortedatum blijft) worden gewist zoveel maanden na de laatste reis. Een nieuwe aanmelding schuift de termijn op. Advies: 1 maand.', default: 1, min: 1, max: 24 },
  retentionPersonMonths: { type: 'int', label: 'Personen anonimiseren na de laatste reis of activiteit (maanden)', help: 'Naam, adres en contactgegevens van de persoon en van de bijbehorende aanmeldingen worden gewist; de aanmeldingen zelf (reis, bedragen, status) blijven voor de boekhouding. Ook reizigersaccounts die zo lang niet zijn gebruikt verdwijnen. Advies: 24 maanden.', default: 24, min: 6, max: 120 },
  retentionCancelledMonths: { type: 'int', label: 'Geannuleerde aanmeldingen zonder betaling verwijderen na (maanden)', help: 'Een aanmelding die is geannuleerd voordat er iets is betaald, verdwijnt helemaal zoveel maanden na de annulering. Advies: 6 maanden.', default: 6, min: 1, max: 84 },
  retentionBookingYears: { type: 'int', label: 'Aanmeldingen bewaren voor de boekhouding (jaren)', help: 'Daarna worden geanonimiseerde aanmeldingen en hun historie verwijderd. De fiscale bewaarplicht is 7 jaar.', default: 7, min: 7, max: 15 },
  retentionContactMonths: { type: 'int', label: 'Berichten via het contactformulier bewaren (maanden)', help: 'Oudere berichten worden verwijderd. Advies: 12 maanden.', default: 12, min: 1, max: 60 },
  captchaEnabled: { type: 'bool', label: 'Onzichtbare captcha gebruiken', help: 'Alleen met een sitesleutel en geheime sleutel. Bezoekers zien niets; Google wordt pas geladen als iemand een formulier invult.', default: false },
  captchaSiteKey: {
    type: 'text', label: 'Sitesleutel (reCAPTCHA v3)', help: 'Uit de beheerconsole van Google reCAPTCHA (type v3, met de domeinen van de site). Begint met 6L.', default: '', max: 40,
    pattern: /^6L[A-Za-z0-9_-]{38}$/, patternMessage: 'Een sitesleutel begint met 6L en is 40 tekens lang.',
  },
  captchaSecret: { type: 'secret', label: 'Geheime sleutel', help: 'Uit dezelfde console; staat versleuteld opgeslagen en gaat nooit naar de browser.', default: '', max: 100 },
  captchaMinScore: {
    type: 'enum', label: 'Minimale score', help: 'Google geeft 0,0 (zeker een robot) tot 1,0 (zeker een mens). 0,5 is de aanbevolen start.', default: '0.5',
    values: ['0.3', '0.5', '0.7'], labels: { '0.3': '0,3 (soepel)', '0.5': '0,5 (aanbevolen)', '0.7': '0,7 (streng)' },
  },
  captchaOnUnreachable: {
    type: 'enum', label: 'Als Google niet bereikbaar is', default: 'allow', values: ['allow', 'block'],
    labels: { allow: 'Doorlaten (de andere beveiligingen blijven gelden)', block: 'Blokkeren (bezoeker probeert het later opnieuw)' },
  },
};

/** De groep Toegang en beveiliging in de zijbalk van Beheer, met haar secties. */
const GROUP = {
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
      id: 'bewaartermijnen',
      label: 'AVG en bewaartermijnen',
      intro: 'Hoe lang het CRM persoonsgegevens bewaart. Elke dag wist de app bijzondere en paspoortgegevens na terugkomst, anonimiseert personen na de bewaartermijn en verwijdert geannuleerde aanmeldingen zonder betaling, oude aanmeldingen en oude contactberichten. Onder het formulier staat wat er per ronde is gewist (alleen aantallen).',
      fields: ['retentionEnabled', 'retentionSpecialMonths', 'retentionPersonMonths', 'retentionCancelledMonths', 'retentionBookingYears', 'retentionContactMonths'],
      extra: 'bewaartermijnen',
      words: 'avg gdpr privacy bewaartermijn bewaren wissen verwijderen anonimiseren opschonen paspoort medisch gezondheid kerkgenootschap art. 9 geannuleerd contactformulier reizigersaccount',
    },
    {
      id: 'tweestaps',
      label: 'Tweestapsverificatie',
      intro: 'Na het wachtwoord vraagt het CRM een code uit een authenticator-app (bijv. Microsoft Authenticator of Google Authenticator). Een geraden of gelekt wachtwoord is dan niet genoeg om in te loggen. Standaard is het optioneel: ieder zet het zelf aan onder Tweestapsverificatie; hier kun je het verplicht maken. Kan iemand niet meer bij de app (toestel kwijt), dan zet een beheerder de tweestapsverificatie van die gebruiker uit onder Gebruikers.',
      fields: ['mfaRequiredFor'],
      words: 'tweestapsverificatie 2fa mfa totp authenticator app code herstelcode inloggen beveiliging',
    },
    {
      id: 'wachtwoorden',
      label: 'Wachtwoorden',
      intro: 'Een nieuw wachtwoord (CRM en reizigersaccount) moet minimaal 12 tekens hebben, mag niet het e-mailadres zijn en mag geen veelgebruikt woord of reeks zijn (zoals Wachtwoord2026! of 1234567890ab). Met de controle hieronder aan wordt het ook vergeleken met de wachtwoorden uit bekende datalekken (Have I Been Pwned). Bestaande wachtwoorden worden niet opnieuw gecontroleerd. Storingen staan in het logboek (bron wachtwoordcontrole).',
      fields: ['passwordBreachCheck'],
      extra: 'wachtwoordcontrole',
      words: 'wachtwoord password gelekt datalek have i been pwned hibp veelgebruikt sterk beveiliging inloggen reizigersaccount',
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
};

module.exports = { FIELDS, GROUP };
