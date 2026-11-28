// @ts-check
/**
 * Beheer > Vindbaarheid: de instellingen van deze groep (`FIELDS`, zie de veldbeschrijving in `beheer/settings.js`) en
 * de secties in de zijbalk (`GROUP`, zie `beheer/indeling.js`). Een nieuwe instelling in deze groep komt alleen hier.
 */

/** De instellingen van de groep Vindbaarheid. */
const FIELDS = {
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
  clarityProjectId: {
    type: 'text',
    label: 'Microsoft Clarity: project-ID',
    help: 'Leeg = Clarity uit. Te vinden in Clarity onder Settings > Overview. Laadt pas na toestemming van de bezoeker, nooit op Mijn Avanta, het aanmeldformulier, online betalen of in het CRM; formulieren worden altijd gemaskeerd.',
    default: '',
    max: 20,
    pattern: /^[a-z0-9]{6,20}$/i,
    patternMessage: 'Een project-ID bestaat uit 6 tot 20 letters of cijfers, zonder spaties.',
  },
};

/** De groep Vindbaarheid in de zijbalk van Beheer, met haar secties. */
const GROUP = {
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
      label: 'Statistieken en cookies',
      intro: 'Bezoekersstatistieken met Google Analytics (GA4) en Microsoft Clarity (klik- en scrolgedrag, heatmaps en sessie-opnames). Zonder toestemming van de bezoeker wordt niets van Google of Microsoft geladen en komen er geen cookies; advertentiefuncties staan altijd uit.',
      fields: ['analyticsEnabled', 'analyticsMeasurementId', 'clarityProjectId'],
      words: 'ga4 google analytics microsoft clarity heatmap sessie opname statistieken bezoekers cookies toestemming consent cookiebalk meet-id project-id tag',
    },
    { id: 'doorverwijzingen', label: 'Doorverwijzingen', view: 'doorverwijzingen', words: 'seo redirect 301 302 omleiding oud adres verhuisd url' },
    { id: 'niet-gevonden', label: 'Niet gevonden (404)', view: 'niet-gevonden', words: 'seo 404 niet gevonden kapotte link dode link fout' },
  ],
};

module.exports = { FIELDS, GROUP };
