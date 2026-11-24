// @ts-check
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
 * @param {any} data Gestructureerde gegevens.
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
 * @param {{phone: string, email: string}} contact Telefoon en e-mail (uit Beheer).
 * @param {{name?: string, imageUrl?: string, street?: string, postalCode?: string, city?: string, sameAs?: string[]}} [organisation]
 *   Naam, afbeelding, adres en social-media-adressen uit Beheer; een adres alleen met straat én plaats.
 * @returns {any} `TravelAgency`.
 */
function travelAgencyData(siteUrl, contact, organisation = {}) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'TravelAgency',
    '@id': `${siteUrl}/#organisatie`,
    name: organisation.name || SITE_NAME,
    url: `${siteUrl}/`,
    logo: absoluteUrl(siteUrl, DEFAULT_IMAGE_PATH),
    image: organisation.imageUrl || absoluteUrl(siteUrl, DEFAULT_IMAGE_PATH),
    telephone: contact.phone,
    email: contact.email,
  };
  if (organisation.street && organisation.city) {
    data.address = {
      '@type': 'PostalAddress',
      streetAddress: organisation.street,
      postalCode: organisation.postalCode || undefined,
      addressLocality: organisation.city,
      addressCountry: 'NL',
    };
  }
  if (organisation.sameAs && organisation.sameAs.length) data.sameAs = organisation.sameAs;
  return data;
}

/**
 * Gestructureerde gegevens van een reis, met aanbod en vertrekdatum.
 * @param {string} siteUrl Basisadres.
 * @param {any} trip Reis uit `tripBySlug`.
 * @param {{today: string, siteName?: string}} context Datum van vandaag (jjjj-mm-dd) voor beschikbaarheid en geldigheid,
 *   en de naam van de site (standaard `SITE_NAME`).
 * @returns {any} `Trip`.
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
    provider: { '@type': 'TravelAgency', '@id': `${siteUrl}/#organisatie`, name: context.siteName || SITE_NAME, url: `${siteUrl}/` },
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
 * @param {any} post Bericht uit `postBySlug`.
 * @param {string} [siteName] Naam van de site (standaard `SITE_NAME`).
 * @returns {any} `BlogPosting`.
 */
function blogPostingData(siteUrl, post, siteName = SITE_NAME) {
  const url = absoluteUrl(siteUrl, postPath(post.slug));
  const organisation = { '@type': 'Organization', name: siteName, url: `${siteUrl}/`, logo: { '@type': 'ImageObject', url: absoluteUrl(siteUrl, DEFAULT_IMAGE_PATH) } };
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
 * @returns {any} `BreadcrumbList`.
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
 * @param {{title: string, description?: string, canonicalUrl: string, imageUrl?: string, type?: string, structuredData?: any[], siteName?: string, defaultDescription?: string}} seo
 *   Gegevens (URL's al absoluut), met de naam van de site en de standaardomschrijving uit Beheer.
 * @returns {any} HTML van de tags.
 */
function renderSeoHead(seo) {
  const description = seo.description || seo.defaultDescription || DEFAULT_DESCRIPTION;
  const card = seo.imageUrl ? 'summary_large_image' : 'summary';
  return html`<link rel="canonical" href="${seo.canonicalUrl}">
  <meta property="og:type" content="${seo.type || 'website'}">
  <meta property="og:locale" content="nl_NL">
  <meta property="og:site_name" content="${seo.siteName || SITE_NAME}">
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
 * @param {{trips: any[], categories: any[], guides: any[], posts: any[], pages: any[], postTerms?: any[]}} entries Rijen uit `sitemapEntries`.
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
    ...(entries.postTerms || []).map((term) => ({ path: `${term.kind === 'tag' ? '/tag/' : '/category/'}${term.slug}/` })),
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

/**
 * Maakt robots.txt. Zonder indexeren worden alle crawlers geweerd (ook AI-zoekers); met indexeren alles open, plus de
 * eigen regels uit Beheer en de verwijzing naar de sitemap.
 * @param {{indexable: boolean, siteUrl: string, robotsExtra: string[]}} site Site-instellingen.
 * @returns {string} Inhoud van robots.txt.
 */
function robotsTxt(site) {
  if (!site.indexable) return 'User-agent: *\nDisallow: /\n';
  // De extra regels sluiten direct aan op de groep `User-agent: *`, zodat een losse `Disallow:` voor alle crawlers
  // geldt; een nieuwe `User-agent:` na regels begint een eigen groep (met een lege regel ervoor, alleen voor de leesbaarheid).
  const lines = ['User-agent: *', 'Allow: /'];
  for (const line of site.robotsExtra) {
    if (/^user-agent:/i.test(line) && !/^user-agent:/i.test(lines[lines.length - 1])) lines.push('');
    lines.push(line);
  }
  return `${lines.join('\n')}\n\nSitemap: ${site.siteUrl}/sitemap.xml\n`;
}

/** Zoveel dagen na vandaag verloopt security.txt; RFC 9116 raadt minder dan een jaar aan. */
const SECURITY_TXT_DAYS = 180;

/**
 * Maakt security.txt (RFC 9116, bevinding V01): waar iemand een beveiligingsprobleem kan melden. Het contactadres is het
 * e-mailadres uit Beheer > Organisatie > Contact. De vervaldatum schuift elke dag mee, zodat het bestand nooit verlopen
 * is zolang de site draait en het adres in Beheer actueel is.
 * @param {{siteUrl: string, contact: {email: string}}} site Site-instellingen.
 * @param {Date} [now] Het huidige moment (voor tests).
 * @returns {string} Inhoud van security.txt.
 */
function securityTxt(site, now = new Date()) {
  const expires = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + SECURITY_TXT_DAYS));
  return [
    `Contact: mailto:${site.contact.email}`,
    `Expires: ${expires.toISOString().replace('.000Z', 'Z')}`,
    'Preferred-Languages: nl, en',
    `Canonical: ${site.siteUrl}/.well-known/security.txt`,
    '',
  ].join('\n');
}

/**
 * Haalt Markdown-opmaak uit een tekst voor llms.txt (zodat een naam geen link of kop kan worden).
 * @param {string} text Tekst.
 * @returns {string} Tekst met `[]()#*_` vervangen door spaties of weggelaten.
 */
function plainMarkdown(text) {
  return String(text || '').replace(/[[\]()#*_`<>]/g, '').replace(/[ \t]+/g, ' ').trim();
}

/**
 * Maakt llms.txt: een korte samenvatting in Markdown voor AI-zoekmachines met wie Avanta is en waar de belangrijkste
 * pagina's staan (zie llmstxt.org).
 * @param {{siteUrl: string, siteName: string, description: string, llms: {intro: string}}} site Site-instellingen.
 * @param {{categories: Array<{name: string, slug: string}>}} content Reiscategorieën voor de lijst met bestemmingen en soorten.
 * @returns {string} Inhoud van llms.txt.
 */
function llmsTxt(site, content) {
  const intro = plainMarkdown(site.llms.intro || site.description);
  const pages = [
    ['Reisaanbod', '/reis/', 'alle groepsreizen met vertrekdata en prijzen'],
    ['Reisleiders', '/reisleider/', 'wie de reizen begeleidt'],
    ['Veelgestelde vragen', '/faq/', 'praktische vragen over boeken en reizen'],
    ['Weblog', '/blog/', 'verhalen en nieuws'],
    ['Contact', '/contact/', 'telefoon, e-mail en contactformulier'],
  ];
  const lines = [
    `# ${plainMarkdown(site.siteName)}`,
    '',
    `> ${plainMarkdown(site.description)}`,
    '',
    intro,
    '',
    '## Belangrijke pagina\'s',
    ...pages.map(([name, path, note]) => `- [${name}](${site.siteUrl}${path}): ${note}`),
  ];
  if (content.categories.length) {
    lines.push('', '## Bestemmingen en soorten reizen');
    for (const category of content.categories) lines.push(`- [${plainMarkdown(category.name)}](${absoluteUrl(site.siteUrl, categoryPath(category.slug))})`);
  }
  return `${lines.join('\n')}\n`;
}

module.exports = {
  robotsTxt,
  securityTxt,
  llmsTxt,
  plainMarkdown,
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
