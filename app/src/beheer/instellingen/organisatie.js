// @ts-check
/**
 * Beheer > Organisatie: de instellingen van deze groep (`FIELDS`, zie de veldbeschrijving in `beheer/settings.js`) en
 * de secties in de zijbalk (`GROUP`, zie `beheer/indeling.js`). Een nieuwe instelling in deze groep komt alleen hier.
 */

/** De instellingen van de groep Organisatie. */
const FIELDS = {
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
  blogArchiveLabel: {
    type: 'text',
    label: 'Tekst van de link naar het oude blogarchief',
    help: 'Staat naast de tags boven het weblog op /blog/.',
    default: 'Bekijk blog archief',
    max: 60,
    required: true,
  },
  blogArchiveUrl: {
    type: 'url',
    label: 'Adres van het oude blogarchief',
    help: 'Volledig https-adres; leeg = geen link naast de tags.',
    default: 'https://avantareizen.blogspot.com/',
    max: 300,
    validate: (value) => (value && !/^https:\/\//.test(value) ? 'Gebruik een adres dat begint met https://.' : ''),
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
};

/** De groep Organisatie in de zijbalk van Beheer, met haar secties. */
const GROUP = {
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
      id: 'weblog',
      label: 'Weblog',
      intro: 'De link naar het oude blogarchief naast de tags boven het weblog. De kop van het weblog wijzig je in het CRM bij Website > Lijstpagina\'s.',
      fields: ['blogArchiveLabel', 'blogArchiveUrl'],
      words: 'blog weblog archief blogspot tags link',
    },
    {
      id: 'ontwikkeling',
      label: 'Balk "in ontwikkeling"',
      intro: 'Een opvallende balk bovenaan de publieke site die bezoekers laat weten dat de website nog in ontwikkeling is. Wijzigingen gelden meteen.',
      fields: ['devBannerEnabled', 'devBannerText'],
      words: 'banner balk ontwikkeling in ontwikkeling testsite test concept go-live live melding waarschuwing bezoekers',
    },
  ],
};

module.exports = { FIELDS, GROUP };
