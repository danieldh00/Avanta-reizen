/**
 * Instellingen van de app, te beheren onder Beheer (`/app/beheer/`, recht `systeem`). Zelfde opzet als in Aquatech:
 * - Elke instelling staat in `SETTING_FIELDS` met type, standaardwaarde, eventueel een omgevingsvariabele en grenzen.
 * - Volgorde per instelling: database (tabel `settings`) → omgevingsvariabele → standaardwaarde. De omgeving is dus
 *   alleen een startwaarde; wat in Beheer is opgeslagen gaat voor en werkt zonder herstart.
 * - Geheimen (`type: 'secret'`) staan versleuteld in de database (`vault`, gebonden aan de naam van de instelling) en
 *   gaan nooit volledig naar de browser: `view()` geeft alleen "ingesteld" en de laatste 4 tekens.
 * - De waarden staan in het geheugen (één proces per database); `update()` schrijft de database en het geheugen bij.
 */

const { contrastWithWhite } = require('../mail/layout');

/** Hoogste lengte van een tekstwaarde als de instelling zelf geen maximum noemt. */
const DEFAULT_MAX_LENGTH = 500;

/** Patroon voor een e-mailadres (zelfde controle als in het CRM). */
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i;

/** Stuurtekens die nooit in een instelling horen (regeleinden alleen bij `textarea`). */
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/**
 * Alle instellingen. Velden per instelling:
 * - `type`: `text` | `email` | `url` | `textarea` | `bool` | `int` | `enum` | `secret`
 * - `label`, `help`: tekst voor het formulier in Beheer
 * - `default`: standaardwaarde; `env`: omgevingsvariabele als startwaarde
 * - `max` (tekens) of `min`/`max` (getal), `values` (keuzes bij `enum`), `pattern` + `patternMessage` (tekst),
 *   `required` (niet leeg), `validate(waarde)` (eigen controle op de schone tekst: geeft een melding of leeg)
 * - `confirmOn` (bij `bool`): aanzetten vraagt het wachtwoord van de beheerder (zie `beheer/routes.js`)
 */
const SETTING_FIELDS = {
  contactPhone: {
    type: 'text',
    label: 'Telefoonnummer',
    help: 'Staat in de voettekst van de site en in de gegevens voor zoekmachines.',
    default: '0118 638427',
    max: 30,
    required: true,
    pattern: /^\+?[0-9 ()-]{6,30}$/,
    patternMessage: 'Gebruik alleen cijfers, spaties, haakjes, een streepje en eventueel een + vooraan.',
  },
  contactEmail: {
    type: 'email',
    label: 'E-mailadres',
    help: 'Staat in de voettekst van de site, in de gegevens voor zoekmachines en als meldadres voor beveiligingsproblemen in /.well-known/security.txt.',
    default: 'info@avantareizen.nl',
    max: 200,
    required: true,
  },
  orgStreet: { type: 'text', label: 'Straat en huisnummer', help: 'Op de contactpagina en in de gegevens voor zoekmachines (leeg = geen adres).', default: '', max: 100 },
  orgPostalCode: {
    type: 'text', label: 'Postcode', default: '', max: 7, pattern: /^[1-9][0-9]{3} ?[A-Za-z]{2}$/, patternMessage: 'Vul een Nederlandse postcode in, bijvoorbeeld 4331 AB.',
  },
  orgCity: { type: 'text', label: 'Plaats', default: '', max: 60 },
  orgKvk: {
    type: 'text', label: 'KvK-nummer', help: 'Op de contactpagina (leeg = niet tonen).', default: '', max: 8, pattern: /^[0-9]{8}$/, patternMessage: 'Vul de acht cijfers van het KvK-nummer in.',
  },
  socialFacebook: { type: 'url', label: 'Facebook-pagina', help: 'Volledig adres; komt als "sameAs" in de gegevens voor zoekmachines.', default: '', max: 200 },
  socialInstagram: { type: 'url', label: 'Instagram-account', default: '', max: 200 },
  socialYoutube: { type: 'url', label: 'YouTube-kanaal', default: '', max: 200 },
  socialLinkedin: { type: 'url', label: 'LinkedIn-pagina', default: '', max: 200 },
  seoIndexing: {
    type: 'bool',
    label: 'Zoekmachines mogen de site opnemen (indexeren)',
    help: 'Pas aanzetten bij go-live. Uit: elke pagina krijgt noindex en robots.txt weert alle zoekmachines. Aanzetten vraagt je wachtwoord.',
    default: false,
    env: 'SITE_INDEXABLE',
    confirmOn: true,
  },
  siteUrl: {
    type: 'url',
    label: 'Basisadres van de site',
    help: 'Voor canonical-links, de sitemap en de gegevens voor zoekmachines. Nooit het adres uit het verzoek.',
    default: 'https://www.avantareizen.nl',
    env: 'SITE_URL',
    max: 200,
    required: true,
    validate: (value) => (/[?#]/.test(value) ? 'Gebruik een adres zonder ? of #.' : ''),
  },
  googleVerification: {
    type: 'text', label: 'Google Search Console: verificatiecode', help: 'Alleen de code uit de meta-tag (content="…").', default: '', max: 100,
    pattern: /^[A-Za-z0-9_-]{8,100}$/, patternMessage: 'Alleen letters, cijfers, - en _ (de waarde van content="…").',
  },
  bingVerification: {
    type: 'text', label: 'Bing Webmaster Tools: verificatiecode', default: '', max: 100,
    pattern: /^[A-Za-z0-9_-]{8,100}$/, patternMessage: 'Alleen letters, cijfers, - en _ (de waarde van content="…").',
  },
  devBannerEnabled: {
    type: 'bool',
    label: 'Balk "Deze website is in ontwikkeling" tonen',
    help: 'Een balk bovenaan elke pagina van de publieke site (niet in het CRM). Zet hem uit bij go-live.',
    default: true,
  },
  devBannerText: {
    type: 'text',
    label: 'Tekst van de balk',
    help: 'Eén regel, zonder opmaak.',
    default: 'Deze website is nog in ontwikkeling. Aan de inhoud kunnen nog geen rechten worden ontleend.',
    max: 200,
    required: true,
  },
  siteName: { type: 'text', label: 'Naam van de site', help: 'Achter elke paginatitel en in Open Graph.', default: 'Avanta reizen', max: 60, required: true },
  homeTitle: {
    type: 'text', label: 'Titel van de homepage', help: 'Zichtbaar in zoekresultaten; ideaal 50 tot 60 tekens.', default: 'Avontuurlijke groepsreizen over heel de wereld - Avanta reizen', max: 90, required: true,
  },
  defaultDescription: {
    type: 'textarea',
    label: 'Standaardomschrijving',
    help: 'Voor pagina\'s zonder eigen omschrijving; ideaal 120 tot 160 tekens.',
    default: 'Christelijke, avontuurlijke groepsreizen over heel de wereld: kamperen, verre reizen en reizen voor jeugd, jongeren en plussers.',
    max: 300,
    required: true,
    validate: (value) => (/\n/.test(value) ? 'Gebruik één regel.' : ''),
  },
  socialImage: {
    type: 'text',
    label: 'Afbeelding voor social media',
    help: 'Pad op de site (bijv. /media/foto.jpg) of een https-adres; voor pagina\'s zonder eigen afbeelding.',
    default: '/images/logo.png',
    max: 300,
    required: true,
    pattern: /^(\/(?!\/)[^\s"'<>\\]*|https:\/\/[^\s"'<>\\]+)$/,
    patternMessage: 'Gebruik een pad dat met / begint of een adres dat met https:// begint, zonder spaties.',
  },
  robotsExtra: {
    type: 'textarea',
    label: 'Extra regels voor robots.txt',
    help: 'Alleen als de site geïndexeerd mag worden. Eén regel per keer: User-agent, Allow, Disallow of # opmerking.',
    default: '',
    max: 2000,
    validate: (value) => {
      const wrong = value.split('\n').find((line) => line.trim() && !/^(#.*|(User-agent|Allow|Disallow):[ \t]*[^\s].*)$/i.test(line.trim()));
      return wrong ? `Deze regel kan niet: "${wrong.trim().slice(0, 60)}".` : '';
    },
  },
  sitemapExclude: {
    type: 'textarea',
    label: 'Uitsluiten van de sitemap',
    help: 'Eén pad per regel, bijv. /algemene-voorwaarden/. Eindigt een regel op *, dan valt alles daaronder weg.',
    default: '',
    max: 4000,
    validate: (value) => {
      const wrong = value.split('\n').find((line) => line.trim() && !/^\/[^\s*]*\*?$/.test(line.trim()));
      return wrong ? `Dit is geen pad: "${wrong.trim().slice(0, 60)}".` : '';
    },
  },
  llmsEnabled: { type: 'bool', label: 'llms.txt aanbieden', help: 'Een korte samenvatting voor AI-zoekmachines op /llms.txt, alleen als de site geïndexeerd mag worden.', default: true },
  llmsIntro: { type: 'textarea', label: 'Inleiding in llms.txt', help: 'Wie Avanta is en wat ze aanbiedt, in een paar zinnen (leeg = de standaardomschrijving).', default: '', max: 2000 },
  analyticsEnabled: { type: 'bool', label: 'Google Analytics gebruiken', help: 'Alleen met een geldig meet-ID. Bezoekers krijgen eerst de keuze; zonder toestemming wordt niets van Google geladen.', default: false },
  analyticsMeasurementId: {
    type: 'text',
    label: 'Meet-ID (GA4)',
    help: 'Begint met G-, te vinden in Google Analytics onder Beheer > Gegevensstromen.',
    default: '',
    max: 20,
    pattern: /^G-[A-Z0-9]{4,14}$/i,
    patternMessage: 'Een meet-ID begint met G- gevolgd door 4 tot 14 letters of cijfers.',
  },
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
  paymentDepositDays: {
    type: 'int', label: 'Aanbetaling binnen (dagen na aanmelden)',
    help: 'Vervaldatum van de aanbetaling (aanbetaling van de reis + boekingskosten + SGR-garantie), en van het hele bedrag bij wie het totaalbedrag kiest. Geldt ook voor bestaande aanmeldingen.',
    default: 7, min: 0, max: 60,
  },
  paymentBalanceDaysBefore: {
    type: 'int', label: 'Restant uiterlijk (dagen vóór vertrek)',
    help: 'Vervaldatum van het restant. Wie zich later aanmeldt, betaalt het restant op de vervaldatum van de aanbetaling. Advies: 42 dagen (6 weken).',
    default: 42, min: 0, max: 365,
  },
  paymentReminderAuto: {
    type: 'bool', label: 'Automatisch herinneren bij een te late betaling',
    help: 'Elke dag krijgt een reiziger van wie de aanbetaling of het restant te laat is een herinnering per mail (alleen bij aanmeldingen die kantoor heeft bevestigd; de mail gaat naar het opgegeven adres), met het openstaande bedrag en de betaalinstructie uit de bevestiging. Werkt alleen met een ingestelde mailserver. Herinneren met de hand kan altijd op de betaalpagina.',
    default: false,
  },
  paymentReminderEveryDays: {
    type: 'int', label: 'Volgende automatische herinnering na (dagen)',
    help: 'Zo lang wacht de app na een herinnering voor dezelfde termijn voordat hij de volgende stuurt.', default: 7, min: 1, max: 60,
  },
  paymentReminderMax: {
    type: 'int', label: 'Hoogstens zoveel automatische herinneringen per termijn',
    help: 'Daarna stopt de app voor die termijn; kantoor neemt dan zelf contact op.', default: 3, min: 1, max: 10,
  },
  mollieEnabled: {
    type: 'bool', label: 'Online betalen via Mollie',
    help: 'Reizigers kunnen het openstaande bedrag dan met iDEAL (of een andere methode in je Mollie-account) betalen via een persoonlijke link in de betaalherinnering. Een geslaagde betaling komt vanzelf bij de betalingen van de aanmelding. Werkt pas met een geldige sleutel hieronder en een openbaar basisadres van de site (https).',
    default: false,
  },
  mollieApiKey: {
    type: 'secret', label: 'Mollie API-sleutel',
    help: 'Uit het Mollie-dashboard (Ontwikkelaars > API-sleutels): begin met een testsleutel (test_…) en zet pas na een proefbetaling de live-sleutel (live_…) erin. Staat versleuteld opgeslagen en gaat nooit naar de browser.',
    default: '', max: 70, pattern: /^(test|live)_[A-Za-z0-9]{20,64}$/, patternMessage: 'Een Mollie-sleutel begint met test_ of live_ gevolgd door letters en cijfers.',
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
  mfaRequiredFor: {
    type: 'enum', label: 'Tweestapsverificatie verplicht voor', default: 'niemand', values: ['niemand', 'gegevens', 'iedereen'],
    labels: { niemand: 'Niemand (optioneel: ieder zet het zelf aan)', gegevens: 'Rollen met toegang tot bijzondere gegevens (beheerder, kantoor, reisleider)', iedereen: 'Iedereen' },
    help: 'Wie het verplicht heeft, stelt het in bij de eerstvolgende keer inloggen, met een activatiecode van de beheerder. Wie het zelf heeft aangezet, geeft bij het inloggen altijd de code.',
  },
  passwordBreachCheck: {
    type: 'bool', label: 'Nieuwe wachtwoorden controleren bij Have I Been Pwned', default: true, env: 'PASSWORD_BREACH_CHECK',
    help: 'Alleen de eerste 5 tekens van een hash van het wachtwoord gaan naar de dienst; het wachtwoord zelf nooit. Is de dienst niet bereikbaar, dan geldt alleen de lokale controle.',
  },
  sessionIdleHours: { type: 'int', label: 'Uitloggen na inactiviteit (uren)', help: 'Een sessie zonder activiteit vervalt na zoveel uur. Geldt meteen, ook voor wie al is ingelogd.', default: 8, min: 1, max: 24 },
  sessionMaxDays: { type: 'int', label: 'Maximale duur van een sessie (dagen)', help: 'Daarna moet iedereen opnieuw inloggen, ook bij activiteit. Korter geldt meteen, ook voor wie al is ingelogd; langer alleen voor nieuwe sessies.', default: 7, min: 1, max: 30 },
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

class SettingsError extends Error {
  /**
   * Fout in een ingevoerde instelling, met de naam van de instelling (voor de melding bij het veld).
   * @param {string} key Naam van de instelling.
   * @param {string} message Melding voor de beheerder.
   */
  constructor(key, message) {
    super(message);
    this.name = 'SettingsError';
    this.key = key;
  }
}

/**
 * Zet een opgeslagen of startwaarde om naar het type van de instelling. Een waarde die niet (meer) past, geeft de
 * standaardwaarde; zo breekt een oude of verkeerde omgevingsvariabele de site nooit.
 * @param {object} definition Beschrijving uit `SETTING_FIELDS`.
 * @param {*} raw De ruwe waarde.
 * @returns {*} De waarde in het juiste type.
 */
function coerce(definition, raw) {
  if (definition.type === 'bool') return raw === true || raw === 'true' || raw === '1' || raw === 1;
  if (definition.type === 'int') {
    const number = Number(raw);
    return Number.isInteger(number) && number >= definition.min && number <= definition.max ? number : definition.default;
  }
  if (definition.type === 'enum') return definition.values.includes(raw) ? raw : definition.default;
  if (typeof raw !== 'string') return definition.default;
  try {
    return validateText('', definition, raw);
  } catch (_) {
    return definition.default;
  }
}

/**
 * Controleert een tekstwaarde (tekst, e-mail, URL, tekstvak, geheim) en maakt hem schoon.
 * @param {string} key Naam van de instelling (voor de fout).
 * @param {object} definition Beschrijving uit `SETTING_FIELDS`.
 * @param {string} raw Ingevoerde tekst.
 * @returns {string} Schone tekst (zonder witruimte aan de randen; e-mail in kleine letters; URL zonder slash achteraan).
 * @throws {SettingsError} Bij een ongeldige waarde.
 */
function validateText(key, definition, raw) {
  let value = String(raw).trim();
  if (definition.type === 'textarea') value = value.replace(/\r\n?/g, '\n');
  const max = definition.max || DEFAULT_MAX_LENGTH;
  if (value.length > max) throw new SettingsError(key, `Gebruik hoogstens ${max} tekens.`);
  if (CONTROL_CHARACTERS.test(value) || (definition.type !== 'textarea' && /[\r\n]/.test(value))) {
    throw new SettingsError(key, 'Deze tekst bevat ongeldige tekens.');
  }
  if (!value) {
    if (definition.required) throw new SettingsError(key, 'Vul dit veld in.');
    return '';
  }
  if (definition.type === 'secret' && definition.min && value.length < definition.min) {
    throw new SettingsError(key, `Gebruik minimaal ${definition.min} tekens.`);
  }
  if (definition.type === 'email') {
    value = value.toLowerCase();
    if (!EMAIL_PATTERN.test(value)) throw new SettingsError(key, 'Vul een geldig e-mailadres in.');
  }
  if (definition.type === 'url') {
    let url;
    try {
      url = new URL(value);
    } catch (_) {
      throw new SettingsError(key, 'Vul een volledig webadres in, beginnend met https://.');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new SettingsError(key, 'Vul een webadres in dat begint met https://.');
    if (url.username || url.password) throw new SettingsError(key, 'Een webadres met een gebruikersnaam of wachtwoord kan niet.');
    value = `${url.origin}${url.pathname.replace(/\/+$/, '')}${url.search}`;
  }
  if (definition.pattern && !definition.pattern.test(value)) throw new SettingsError(key, definition.patternMessage || 'Deze waarde klopt niet.');
  const problem = definition.validate ? definition.validate(value) : '';
  if (problem) throw new SettingsError(key, problem);
  return value;
}

/**
 * Controleert een ingevoerde waarde voor een instelling.
 * @param {string} key Naam van de instelling.
 * @param {object} definition Beschrijving uit `SETTING_FIELDS`.
 * @param {*} raw Ingevoerde waarde (uit het formulier: tekst; bij `bool` ook true/false).
 * @returns {*} De waarde in het juiste type.
 * @throws {SettingsError} Bij een ongeldige waarde.
 */
function validateValue(key, definition, raw) {
  if (definition.type === 'bool') {
    if (typeof raw === 'boolean') return raw;
    if (raw === 'ja' || raw === '') return raw === 'ja';
    throw new SettingsError(key, 'Ongeldige waarde.');
  }
  if (typeof raw !== 'string') throw new SettingsError(key, 'Ongeldige waarde.');
  if (definition.type === 'int') {
    const text = raw.trim();
    const number = /^-?\d{1,9}$/.test(text) ? Number(text) : NaN;
    if (!Number.isInteger(number) || number < definition.min || number > definition.max) {
      throw new SettingsError(key, `Kies een geheel getal van ${definition.min} tot ${definition.max}.`);
    }
    return number;
  }
  if (definition.type === 'enum') {
    if (!definition.values.includes(raw)) throw new SettingsError(key, 'Kies een van de mogelijkheden.');
    return raw;
  }
  return validateText(key, definition, raw);
}

/**
 * Maakt de instellingenlaag.
 * @param {{db: object, vault: {seal: Function, open: Function}, env?: object, fields?: object}} options Database, kluis
 *   voor geheimen, omgevingsvariabelen (standaard `process.env`) en (voor tests) een eigen lijst instellingen.
 * @returns {object} Functies: `load`, `ready`, `get`, `source`, `view`, `update`, `fields`.
 */
function createSettings(options) {
  const { db, vault } = options;
  const env = options.env || process.env;
  const fields = options.fields || SETTING_FIELDS;
  /** Waarden uit de database (geheimen ontsleuteld), per naam. */
  let stored = new Map();
  /** Lopende of afgeronde eerste lading. */
  let loading = null;

  /**
   * Of een naam een bekende instelling is (niet via het prototype).
   * @param {string} key Naam.
   * @returns {boolean} Waar als de instelling bestaat.
   */
  const known = (key) => typeof key === 'string' && Object.hasOwn(fields, key);

  /**
   * Zet een waarde om naar de tekst voor de database; een geheim versleuteld en gebonden aan de naam.
   * @param {string} key Naam van de instelling.
   * @param {*} value De waarde.
   * @returns {string} JSON-tekst.
   */
  const encode = (key, value) => JSON.stringify(fields[key].type === 'secret' ? { enc: vault.seal({ key, value }) } : value);

  /**
   * Leest een opgeslagen waarde terug. Een geheim dat bij een andere instelling hoort of met een andere hoofdsleutel
   * is versleuteld, telt als niet opgeslagen.
   * @param {string} key Naam van de instelling.
   * @param {string} text JSON-tekst uit de database.
   * @returns {{ok: boolean, value?: *}} De waarde, of `ok: false`.
   */
  const decode = (key, text) => {
    try {
      const parsed = JSON.parse(text);
      if (fields[key].type !== 'secret') return { ok: true, value: parsed };
      const opened = parsed && typeof parsed.enc === 'string' ? vault.open(parsed.enc) : null;
      if (!opened || opened.key !== key || typeof opened.value !== 'string') return { ok: false };
      return { ok: true, value: opened.value };
    } catch (_) {
      return { ok: false };
    }
  };

  /**
   * Leest alle instellingen uit de database in het geheugen. Onleesbare regels worden overgeslagen (met een melding
   * zonder waarde in het log).
   * @returns {Promise<void>}
   */
  const load = async () => {
    const rows = await db.query('SELECT key, value FROM settings');
    const next = new Map();
    for (const row of rows) {
      if (!known(row.key)) continue;
      const result = decode(row.key, row.value);
      if (result.ok) next.set(row.key, result.value);
      else console.warn(`Instelling ${row.key} is onleesbaar (of versleuteld met een andere hoofdsleutel) en wordt genegeerd.`);
    }
    stored = next;
  };

  /**
   * Wacht tot de instellingen één keer zijn geladen. Mislukt dat, dan probeert het volgende verzoek het opnieuw.
   * @returns {Promise<void>}
   */
  const ready = () => {
    if (!loading) loading = load().catch((error) => { loading = null; throw error; });
    return loading;
  };

  /**
   * Waar de huidige waarde vandaan komt.
   * @param {string} key Naam van de instelling.
   * @returns {'database'|'omgeving'|'standaard'} De bron.
   */
  const source = (key) => {
    if (!known(key)) throw new Error(`Onbekende instelling ${key}`);
    if (stored.has(key)) return 'database';
    const definition = fields[key];
    if (definition.env && env[definition.env] !== undefined && env[definition.env] !== '') return 'omgeving';
    return 'standaard';
  };

  /**
   * De waarde van een instelling (synchroon; vereist dat `ready()` klaar is, anders geldt omgeving/standaard).
   * @param {string} key Naam van de instelling.
   * @returns {*} De waarde.
   * @throws {Error} Bij een onbekende instelling.
   */
  const get = (key) => (source(key) === 'database' ? coerce(fields[key], stored.get(key)) : startValue(key));

  /**
   * De startwaarde van een instelling: wat geldt zonder waarde in de database (omgeving, anders standaard). Dit is
   * ook de waarde na "terugzetten".
   * @param {string} key Naam van de instelling.
   * @returns {*} De waarde.
   * @throws {Error} Bij een onbekende instelling.
   */
  const startValue = (key) => {
    if (!known(key)) throw new Error(`Onbekende instelling ${key}`);
    const definition = fields[key];
    if (definition.env && env[definition.env] !== undefined && env[definition.env] !== '') return coerce(definition, env[definition.env]);
    return definition.default;
  };

  /**
   * De waarde voor het scherm: een geheim alleen als "ingesteld" met de laatste 4 tekens.
   * @param {string} key Naam van de instelling.
   * @returns {*} Waarde, of bij een geheim `{set: boolean, last4: string}`.
   */
  const view = (key) => {
    const value = get(key);
    if (fields[key].type !== 'secret') return value;
    return { set: Boolean(value), last4: value ? value.slice(-4) : '' };
  };

  /**
   * Slaat wijzigingen op. Een geheim: weglaten of lege tekst = ongewijzigd, `clear` = leegmaken. `reset` zet een
   * instelling terug naar de startwaarde (omgeving of standaard) door de databaseregel te verwijderen. Een waarde die
   * gelijk is aan wat er al geldt, telt niet als wijziging.
   * @param {{values?: object, clear?: string[], reset?: string[]}} patch Nieuwe waarden, te legen geheimen en terug te zetten instellingen.
   * @param {{userId?: (number|null), inTransaction?: Function}} [context] Wie het doet en een functie
   *   `(client, changed) => Promise` die in dezelfde transactie draait (bijv. het auditlog): mislukt die, dan wordt niets opgeslagen.
   * @returns {Promise<string[]>} Namen van de gewijzigde instellingen.
   * @throws {SettingsError} Bij een onbekende instelling of ongeldige waarde (er wordt dan niets opgeslagen).
   */
  const update = async (patch, context = {}) => {
    await ready();
    const writes = new Map();
    const removals = new Set();
    // Terugzetten gaat altijd voor: een teruggezette instelling neemt nooit de waarde uit het formulier over, ook niet
    // als er geen rij in de database is.
    const resetKeys = new Set(patch.reset || []);
    for (const key of resetKeys) {
      if (!known(key)) throw new SettingsError(key, 'Onbekende instelling.');
      if (stored.has(key)) removals.add(key);
    }
    for (const key of patch.clear || []) {
      if (!known(key) || fields[key].type !== 'secret') throw new SettingsError(key, 'Onbekende instelling.');
      if (!resetKeys.has(key) && get(key) !== '') writes.set(key, '');
    }
    for (const [key, raw] of Object.entries(patch.values || {})) {
      if (!known(key)) throw new SettingsError(key, 'Onbekende instelling.');
      if (resetKeys.has(key) || writes.has(key)) continue;
      const definition = fields[key];
      if (definition.type === 'secret' && (raw === undefined || raw === '')) continue;
      const value = validateValue(key, definition, raw);
      if (value === get(key)) continue;
      writes.set(key, value);
    }
    const changed = [...removals, ...writes.keys()];
    if (!changed.length) return [];
    await db.transaction(async (client) => {
      for (const key of removals) await client.query('DELETE FROM settings WHERE key = $1', [key]);
      for (const [key, value] of writes) {
        await client.query(
          `INSERT INTO settings (key, value, updated_at, updated_by) VALUES ($1, $2, now(), $3)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
          [key, encode(key, value), context.userId ?? null],
        );
      }
      if (context.inTransaction) await context.inTransaction(client, changed);
    });
    for (const key of removals) stored.delete(key);
    for (const [key, value] of writes) stored.set(key, value);
    return changed;
  };

  return { load, ready, get, source, startValue, view, update, fields };
}

module.exports = { SETTING_FIELDS, SettingsError, createSettings, validateValue, coerce };
