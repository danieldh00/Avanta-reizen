/**
 * Zoekmachine-optimalisatie: canonical-URL, Open Graph- en Twitter-tags, gestructureerde gegevens (JSON-LD) en de
 * XML-sitemap. Alle URL's zijn absoluut op basis van `SITE_URL` (standaard het adres van de huidige site).
 */
const { html, raw } = require('./html');
const { isoDate, tripPath, categoryPath, guidePath, postPath } = require('./format');

/** Standaardadres van de site als `SITE_URL` niet is ingesteld. */
const DEFAULT_SITE_URL = 'https://www.avantareizen.nl';

/** Naam van de organisatie in tags en gestructureerde gegevens. */
const SITE_NAME = 'Avanta reizen';

/** Standaardbeschrijving voor pagina's zonder eigen beschrijving. */
const DEFAULT_DESCRIPTION = 'Christelijke, avontuurlijke groepsreizen over heel de wereld: kamperen, verre reizen en reizen voor jeugd, jongeren en plussers.';

/** Afbeelding voor social media als een pagina er zelf geen heeft. */
const DEFAULT_IMAGE_PATH = '/images/logo.png';

/** Vaste pagina's die door een eigen route worden gemaakt (niet in de tabel `pages`). */
const FIXED_PATHS = ['/', '/reis/', '/reisleider/', '/blog/', '/faq/'];

/**
 * Bepaalt het basisadres van de site: zonder slash aan het eind en alleen http(s); anders het standaardadres.
 * @param {string} [value] Waarde van `SITE_URL`.
 * @returns {string} Basisadres, bijvoorbeeld `https://www.avantareizen.nl`.
 */
function normalizeSiteUrl(value) {
  const text = String(value || '').trim();
  if (!text) return DEFAULT_SITE_URL;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return DEFAULT_SITE_URL;
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch (_) {
    return DEFAULT_SITE_URL;
  }
}

/**
 * Maakt een absolute URL van een pad of een (al absolute) URL.
 * @param {string} siteUrl Basisadres.
 * @param {string} pathOrUrl Pad (`/reis/x/`) of absolute URL.
 * @returns {string} Absolute URL, of leeg als er niets is.
 */
function absoluteUrl(siteUrl, pathOrUrl) {
  if (!pathOrUrl) return '';
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const path = String(pathOrUrl).startsWith('/') ? String(pathOrUrl) : `/${pathOrUrl}`;
  return siteUrl + path;
}

/**
 * Codeert een paginapad uit de database (met mogelijk letters als ë) als URL-pad.
 * @param {string} path Pad met slash aan begin en eind.
 * @returns {string} Gecodeerd pad.
 */
function encodePagePath(path) {
  return String(path).split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

/**
 * Zet gegevens om naar JSON voor een `<script type="application/ld+json">`-blok. Tekens die het blok kunnen
 * afsluiten of als HTML gelezen worden (`<`, `>`, `&`, regelscheiders) worden als unicode-escape geschreven.
 * @param {object} data Gestructureerde gegevens.
 * @returns {string} Veilige JSON-tekst.
 */
function serializeJsonLd(data) {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Tijdstip (Date of tekst uit de database) als ISO 8601 in UTC, zonder verschuiving naar 12:00.
 * @param {(Date|string|null)} value Tijdstip.
 * @returns {(string|undefined)} Bijvoorbeeld `2026-05-04T08:00:00.000Z`, of undefined als het onbekend is.
 */
function isoTimestamp(value) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * Prijs in centen als bedrag met twee decimalen voor schema.org.
 * @param {number} cents Bedrag in centen.
 * @returns {string} Bijvoorbeeld `799.00`.
 */
function priceFromCents(cents) {
  return (Number(cents) / 100).toFixed(2);
}

/**
 * Gestructureerde gegevens van de organisatie (homepage).
 * @param {string} siteUrl Basisadres.
 * @param {{phone: string, email: string}} contact Telefoon en e-mail (uit de layout).
 * @returns {object} `TravelAgency`.
 */
function travelAgencyData(siteUrl, contact) {
  return {
    '@context': 'https://schema.org',
    '@type': 'TravelAgency',
    '@id': `${siteUrl}/#organisatie`,
    name: SITE_NAME,
    url: `${siteUrl}/`,
    logo: absoluteUrl(siteUrl, DEFAULT_IMAGE_PATH),
    image: absoluteUrl(siteUrl, DEFAULT_IMAGE_PATH),
    telephone: contact.phone,
    email: contact.email,
  };
}

/**
 * Gestructureerde gegevens van een reis, met aanbod en vertrekdatum.
 * @param {string} siteUrl Basisadres.
 * @param {object} trip Reis uit `tripBySlug`.
 * @param {{today: string}} context Datum van vandaag (jjjj-mm-dd) voor beschikbaarheid en geldigheid.
 * @returns {object} `Trip`.
 */
function tripData(siteUrl, trip, context) {
  const url = absoluteUrl(siteUrl, tripPath(trip.slug));
  const departure = isoDate(trip.departure_date);
  const departed = Boolean(departure) && departure < context.today;
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Trip',
    name: trip.title,
    url,
    description: trip.tagline || trip.summary || undefined,
    image: absoluteUrl(siteUrl, trip.hero_image_url || trip.card_image_url) || undefined,
    departureTime: departure || undefined,
    provider: { '@type': 'TravelAgency', '@id': `${siteUrl}/#organisatie`, name: SITE_NAME, url: `${siteUrl}/` },
  };
  if (Number.isFinite(Number(trip.price_cents)) && trip.price_cents !== null) {
    const offerUntil = isoDate(trip.offer_until);
    data.offers = {
      '@type': 'Offer',
      url,
      price: priceFromCents(trip.price_cents),
      priceCurrency: 'EUR',
      availability: trip.fully_booked || departed ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
      validFrom: context.today,
      priceValidUntil: offerUntil || undefined,
      validThrough: departure || undefined,
    };
  }
  return data;
}

/**
 * Gestructureerde gegevens van een blogbericht.
 * @param {string} siteUrl Basisadres.
 * @param {object} post Bericht uit `postBySlug`.
 * @returns {object} `BlogPosting`.
 */
function blogPostingData(siteUrl, post) {
  const url = absoluteUrl(siteUrl, postPath(post.slug));
  const organisation = { '@type': 'Organization', name: SITE_NAME, url: `${siteUrl}/`, logo: { '@type': 'ImageObject', url: absoluteUrl(siteUrl, DEFAULT_IMAGE_PATH) } };
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    url,
    mainEntityOfPage: url,
    description: post.excerpt || post.intro || undefined,
    image: absoluteUrl(siteUrl, post.image_url) || undefined,
    datePublished: isoTimestamp(post.published_at),
    author: organisation,
    publisher: organisation,
  };
}

/**
 * Kruimelpad als gestructureerde gegevens.
 * @param {string} siteUrl Basisadres.
 * @param {Array<{name: string, path: string}>} items Stappen vanaf de homepage, met pad.
 * @returns {object} `BreadcrumbList`.
 */
function breadcrumbData(siteUrl, items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(siteUrl, item.path),
    })),
  };
}

/**
 * Maakt de SEO-tags voor de `<head>`: canonical, Open Graph, Twitter en JSON-LD.
 * @param {{title: string, description?: string, canonicalUrl: string, imageUrl?: string, type?: string, structuredData?: object[]}} seo Gegevens (URL's al absoluut).
 * @returns {object} HTML van de tags.
 */
function renderSeoHead(seo) {
  const description = seo.description || DEFAULT_DESCRIPTION;
  const card = seo.imageUrl ? 'summary_large_image' : 'summary';
  return html`<link rel="canonical" href="${seo.canonicalUrl}">
  <meta property="og:type" content="${seo.type || 'website'}">
  <meta property="og:locale" content="nl_NL">
  <meta property="og:site_name" content="${SITE_NAME}">
  <meta property="og:title" content="${seo.title}">
  <meta property="og:description" content="${description}">
  <meta property="og:url" content="${seo.canonicalUrl}">
  ${seo.imageUrl ? html`<meta property="og:image" content="${seo.imageUrl}">` : ''}
  <meta name="twitter:card" content="${card}">
  <meta name="twitter:title" content="${seo.title}">
  <meta name="twitter:description" content="${description}">
  ${seo.imageUrl ? html`<meta name="twitter:image" content="${seo.imageUrl}">` : ''}
  ${(seo.structuredData || []).map((data) => html`<script type="application/ld+json">${raw(serializeJsonLd(data))}</script>`)}`;
}

/**
 * Escapet tekst voor XML.
 * @param {*} value Waarde.
 * @returns {string} Ge-escapete tekst.
 */
function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Zet de inhoud van de site om naar sitemap-regels (pad en eventueel wijzigingsdatum).
 * @param {{trips: object[], categories: object[], guides: object[], posts: object[], pages: object[]}} entries Rijen uit `sitemapEntries`.
 * @returns {Array<{path: string, lastmod?: string}>} Regels, zonder dubbele paden.
 */
function sitemapUrls(entries) {
  const lastPost = entries.posts.map((post) => isoTimestamp(post.published_at)).filter(Boolean).sort().pop();
  const urls = [
    ...FIXED_PATHS.map((path) => ({ path, lastmod: path === '/blog/' ? lastPost : undefined })),
    ...entries.trips.map((trip) => ({ path: tripPath(trip.slug) })),
    ...entries.categories.map((category) => ({ path: categoryPath(category.slug) })),
    ...entries.guides.map((guide) => ({ path: guidePath(guide.slug) })),
    ...entries.posts.map((post) => ({ path: postPath(post.slug), lastmod: isoTimestamp(post.published_at) })),
    ...entries.pages.map((page) => ({ path: encodePagePath(page.path) })),
  ];
  const seen = new Set();
  return urls.filter((url) => (seen.has(url.path) ? false : seen.add(url.path)));
}

/**
 * Maakt de XML van de sitemap.
 * @param {string} siteUrl Basisadres.
 * @param {Array<{path: string, lastmod?: string}>} urls Regels uit `sitemapUrls`.
 * @returns {string} XML volgens sitemaps.org.
 */
function renderSitemap(siteUrl, urls) {
  const lines = urls.map((url) => `  <url><loc>${escapeXml(absoluteUrl(siteUrl, url.path))}</loc>${url.lastmod ? `<lastmod>${escapeXml(url.lastmod)}</lastmod>` : ''}</url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${lines.join('\n')}\n</urlset>\n`;
}

module.exports = {
  DEFAULT_SITE_URL,
  SITE_NAME,
  normalizeSiteUrl,
  absoluteUrl,
  encodePagePath,
  serializeJsonLd,
  travelAgencyData,
  tripData,
  blogPostingData,
  breadcrumbData,
  renderSeoHead,
  escapeXml,
  sitemapUrls,
  renderSitemap,
};
