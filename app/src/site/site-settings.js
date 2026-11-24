// @ts-check
/**
 * De instellingen die de publieke site per verzoek nodig heeft (uit Beheer, `beheer/settings.js`), in één object:
 * indexeren, basisadres, naam en titels, standaardomschrijving en -afbeelding, contact- en organisatiegegevens, social media (voettekst),
 * verificatiecodes, robots.txt-regels, sitemap-uitsluitingen, llms.txt, het actieve GA4-meet-ID en de balk "in ontwikkeling". De middleware in `server.js` zet het op
 * `res.locals.site`; routes en `renderPage` lezen het daar.
 */
const seo = require('./seo');
const { activeMeasurementId } = require('./analytics');

/** Instellingen met een social-media-adres, in de volgorde van `sameAs`. */
const SOCIAL_KEYS = ['socialFacebook', 'socialInstagram', 'socialYoutube', 'socialLinkedin'];

/**
 * Splitst een tekstvak in regels zonder witruimte aan de randen; lege regels vallen weg.
 * @param {string} text Tekst.
 * @returns {string[]} Regels.
 */
function linesOf(text) {
  return String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);
}

/**
 * Bouwt de site-instellingen uit de instellingenlaag.
 * @param {{get: Function}} settings Instellingen (geladen).
 * @returns {object} Site-instellingen, zie het kopcommentaar.
 */
function siteSettingsOf(settings) {
  const siteUrl = seo.normalizeSiteUrl(settings.get('siteUrl'));
  const postalCode = settings.get('orgPostalCode').toUpperCase().replace(/^(\d{4}) ?([A-Z]{2})$/, '$1 $2');
  return {
    indexable: settings.get('seoIndexing') === true,
    siteUrl,
    siteName: settings.get('siteName'),
    homeTitle: settings.get('homeTitle'),
    description: settings.get('defaultDescription'),
    imageUrl: seo.absoluteUrl(siteUrl, settings.get('socialImage')),
    contact: { phone: settings.get('contactPhone'), email: settings.get('contactEmail') },
    social: {
      facebook: settings.get('socialFacebook'),
      instagram: settings.get('socialInstagram'),
      youtube: settings.get('socialYoutube'),
      linkedin: settings.get('socialLinkedin'),
    },
    organisation: {
      street: settings.get('orgStreet'),
      postalCode,
      city: settings.get('orgCity'),
      kvk: settings.get('orgKvk'),
      sameAs: SOCIAL_KEYS.map((key) => settings.get(key)).filter(Boolean),
    },
    verification: { google: settings.get('googleVerification'), bing: settings.get('bingVerification') },
    robotsExtra: linesOf(settings.get('robotsExtra')),
    sitemapExclude: linesOf(settings.get('sitemapExclude')),
    llms: { enabled: settings.get('llmsEnabled') === true, intro: settings.get('llmsIntro') },
    devBanner: settings.get('devBannerEnabled') === true ? settings.get('devBannerText') : '',
    analytics: { measurementId: activeMeasurementId(settings.get('analyticsEnabled'), settings.get('analyticsMeasurementId')) },
  };
}

/**
 * Of een pad van de sitemap is uitgesloten: gelijk aan een regel, of eronder als de regel op `*` eindigt.
 * @param {string} path Pad (zoals in de sitemap, URL-gecodeerd of niet).
 * @param {string[]} exclusions Regels uit de instelling.
 * @returns {boolean} Waar als het pad wegvalt.
 */
function isExcluded(path, exclusions) {
  let decoded = path;
  try {
    decoded = decodeURI(path);
  } catch (_) {
    // Een pad dat niet te decoderen is, wordt alleen letterlijk vergeleken.
  }
  return exclusions.some((rule) => {
    if (rule.endsWith('*')) {
      const prefix = rule.slice(0, -1);
      return path.startsWith(prefix) || decoded.startsWith(prefix);
    }
    return path === rule || decoded === rule;
  });
}

module.exports = { siteSettingsOf, isExcluded, linesOf, SOCIAL_KEYS };
