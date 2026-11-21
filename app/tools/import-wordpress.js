#!/usr/bin/env node
/**
 * Importeert de content van de huidige WordPress-site (www.avantareizen.nl) in PostgreSQL: reizen, reisleiders,
 * reiscategorieën, blog, pagina's en FAQ, plus alle gebruikte afbeeldingen naar DATA_DIR/media, en de vaste inhoud van
 * de homepage (slider, inspiratie, "over Avanta") naar DATA_DIR/homepage.json (zie `src/site/homepage.js`).
 * Herhaalbaar tot go-live: bestaande rijen worden bijgewerkt (op slug/pad), niets wordt dubbel aangemaakt.
 *
 * Gebruik: DATABASE_URL=… node tools/import-wordpress.js [--cache <map>] [--delay <ms>] [--zonder-media] [--alleen-vaste-inhoud]
 * (`--alleen-vaste-inhoud`, ook `--alleen-homepage`: alleen homepage.json en site-content.json met hun foto's
 * vernieuwen, altijd vers van de huidige site; de database blijft verder ongemoeid)
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createDatabase } = require('../src/database/db');
const { DATA_DIR, MEDIA_DIR } = require('../src/paths');
const { sanitizeHtml, plainText } = require('./import/sanitize');
const parsers = require('./import/parse');
const { HOMEPAGE_FILE } = require('../src/site/homepage');
const { SITE_CONTENT_FILE, SITE_CONTENT_VERSION } = require('../src/site/site-content');
const { linkImportedMedia } = require('../src/media/library');

const SITE = 'https://www.avantareizen.nl';
const USER_AGENT = 'Mozilla/5.0 (compatible; AvantaSiteImport/1.0)';
/** Lijstpagina's die de nieuwe site zelf opbouwt; die komen niet in de tabel pages. */
const GENERATED_PATHS = new Set(['/', '/reis/', '/blog/', '/faq/', '/reisleider/', '/aanmelden/', '/styleguide/']);
/** Afbeeldingstypen die we overnemen. */
const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
/** Lijstpagina's waarvan de kop (pretitel, titel, foto, inleiding) in site-content.json komt. */
const ARCHIVE_PAGES = [['reis', '/reis/'], ['reisleider', '/reisleider/'], ['blog', '/blog/'], ['faq', '/faq/'], ['aanmelden', '/aanmelden/']];

/**
 * Leest de opdrachtregel.
 * @param {string[]} argv Argumenten.
 * @returns {{cache: string, delay: number, media: boolean, fixedOnly?: boolean}} Opties.
 */
function readOptions(argv) {
  const options = { cache: path.join(DATA_DIR, 'import-cache'), delay: 500, media: true };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--cache') options.cache = path.resolve(argv[++i]);
    else if (argv[i] === '--delay') options.delay = Number(argv[++i]) || 0;
    else if (argv[i] === '--zonder-media') options.media = false;
    else if (argv[i] === '--alleen-vaste-inhoud' || argv[i] === '--alleen-homepage') options.fixedOnly = true;
  }
  return options;
}

/**
 * Wacht een aantal milliseconden.
 * @param {number} milliseconds Wachttijd.
 * @returns {Promise<void>}
 */
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Bestandsnaam in de cache voor een URL (zelfde schema als de eerste crawl: pad met `__` als scheiding).
 * @param {string} url De URL.
 * @returns {string} Bestandsnaam.
 */
function cacheName(url) {
  const name = url.replace(/^https?:\/\/[^/]+\//, '').replace(/\/$/, '').replace(/\//g, '__');
  return `${name || 'home'}.html`;
}

/**
 * Maakt een ophaler met cache en een vaste pauze tussen verzoeken (beleefd naar de huidige site).
 * @param {{cache: string, delay: number}} options Cachemap en pauze.
 * @returns {(url: string) => Promise<string>} Functie die de HTML van een URL geeft.
 */
function createFetcher(options) {
  fs.mkdirSync(options.cache, { recursive: true });
  return async (url) => {
    const file = path.join(options.cache, cacheName(url));
    if (fs.existsSync(file) && fs.statSync(file).size > 0) return fs.readFileSync(file, 'utf8');
    await sleep(options.delay);
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    const text = await response.text();
    fs.writeFileSync(file, text);
    return text;
  };
}

/**
 * Ophaler zonder cache (voor de vaste inhoud, altijd vers), met een pauze tussen de verzoeken.
 * @param {{delay: number}} options Pauze.
 * @returns {(url: string) => Promise<string>} Functie die de HTML van een URL geeft.
 */
function createFreshFetcher(options) {
  return async (url) => {
    await sleep(options.delay);
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.text();
  };
}

/**
 * Haalt alle URL's uit de sitemaps, gegroepeerd per soort (journey, guide, page, post, …).
 * @param {(url: string) => Promise<string>} fetchText Ophaler.
 * @returns {Promise<Record<string, string[]>>} URL's per soort.
 */
async function readSitemaps(fetchText) {
  const locations = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].trim());
  const index = await fetchText(`${SITE}/sitemap_index.xml`);
  const groups = {};
  for (const sitemap of locations(index)) {
    const kind = /\/([a-z_-]+)-sitemap\d*\.xml$/.exec(sitemap)?.[1] || 'overig';
    const urls = locations(await fetchText(sitemap)).filter((url) => !/\.(jpe?g|png|webp|gif)$/i.test(url));
    groups[kind] = [...(groups[kind] || []), ...urls];
  }
  return groups;
}

/**
 * Maakt de afbeeldingenbeheerder: verzamelt URL's, downloadt ze één keer en geeft het nieuwe pad.
 * @param {{media: boolean}} options Of afbeeldingen gedownload worden.
 * @returns {{local: (url: string) => (string|null), download: (db: object) => Promise<{ok: number, failed: string[]}>}} Beheerder.
 */
function createMediaStore(options) {
  const wanted = new Map();
  /**
   * Geeft het lokale pad voor een afbeelding van de oude site (en onthoudt hem voor de download).
   * @param {string} url Originele URL.
   * @returns {(string|null)} Nieuw pad onder /media/, of null als het geen afbeelding van de site is.
   */
  const local = (url) => {
    if (!url) return null;
    let absolute;
    try {
      absolute = new URL(url, SITE).href;
    } catch (_) {
      return null;
    }
    if (!absolute.startsWith(`${SITE}/app/uploads/`)) return options.media ? null : absolute;
    const extension = (/\.(jpe?g|png|webp|gif)$/i.exec(new URL(absolute).pathname)?.[0] || '.jpg').toLowerCase().replace('.jpeg', '.jpg');
    const name = crypto.createHash('sha1').update(absolute).digest('hex').slice(0, 20) + extension;
    wanted.set(absolute, name);
    return options.media ? `/media/${name}` : absolute;
  };

  /**
   * Downloadt alle onthouden afbeeldingen die nog niet lokaal staan (twee tegelijk).
   * @param {object} db Database (tabel media).
   * @returns {Promise<{ok: number, failed: string[]}>} Resultaat.
   */
  const download = async (db) => {
    if (!options.media) return { ok: 0, failed: [] };
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    const queue = [...wanted.entries()];
    const failed = [];
    let ok = 0;
    /**
     * Verwerkt de wachtrij tot hij leeg is.
     * @returns {Promise<void>}
     */
    const worker = async () => {
      while (queue.length) {
        const [url, name] = queue.shift();
        const file = path.join(MEDIA_DIR, name);
        if (fs.existsSync(file)) { ok++; continue; }
        try {
          const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
          const type = (response.headers.get('content-type') || '').split(';')[0].trim();
          if (!response.ok || !IMAGE_TYPES[type]) throw new Error(`HTTP ${response.status} ${type}`);
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length > MAX_IMAGE_BYTES) throw new Error('te groot');
          fs.writeFileSync(file, bytes);
          await db.query(
            'INSERT INTO media (original_url, local_name, content_type, bytes) VALUES ($1, $2, $3, $4) ON CONFLICT (original_url) DO UPDATE SET bytes = EXCLUDED.bytes',
            [url, name, type, bytes.length],
          );
          ok++;
        } catch (error) {
          failed.push(`${url} (${error.message})`);
        }
      }
    };
    await Promise.all([worker(), worker()]);
    return { ok, failed };
  };

  /**
   * Geeft het lokale pad voor de stilstaande afbeelding van een YouTube-video (voor de slider, zodat bezoekers geen
   * verbinding met YouTube maken) en onthoudt hem voor de download.
   * @param {string} videoId Id van de video (11 tekens).
   * @returns {(string|null)} Pad onder /media/, of null bij een ongeldig id of zonder media.
   */
  const poster = (videoId) => {
    if (!options.media || !/^[A-Za-z0-9_-]{11}$/.test(String(videoId || ''))) return null;
    const name = `yt-${videoId}.jpg`;
    wanted.set(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, name);
    return `/media/${name}`;
  };

  return { local, poster, download, count: () => wanted.size };
}

/**
 * Herschrijft een link van de oude site naar een relatief pad op de nieuwe site.
 * @param {string} url De link.
 * @returns {string} Nieuwe link.
 */
function rewriteLink(url) {
  if (/^https?:\/\/(www\.)?avantareizen\.nl/i.test(url)) {
    const target = new URL(url);
    if (target.pathname.startsWith('/app/uploads/')) return url;
    return target.pathname + target.search + target.hash;
  }
  return url;
}

/**
 * Maakt een korte samenvatting van HTML.
 * @param {string} markup HTML.
 * @param {number} [length] Maximale lengte.
 * @returns {string} Samenvatting.
 */
function summarize(markup, length = 220) {
  const text = plainText(markup).replace(/\[[^\]]{0,40}\]\s*/g, '');
  return text.length > length ? `${text.slice(0, length).replace(/\s+\S*$/, '')} …` : text;
}

/**
 * Zet een link van de homepage om naar de nieuwe site: eigen pad in plaats van het oude domein, en het oude filter
 * `/reis/?trip_destination=<id>&trip_type=<id>` naar `/reis/?bestemming=<slug>&type=<slug>` (en `trip_new=1` naar
 * `nieuw=1`).
 * @param {string} href Oude link.
 * @param {Map<number, string>} slugByLegacyId Slug per oud categorie-id.
 * @returns {string} Nieuwe link.
 */
function homepageLink(href, slugByLegacyId) {
  if (!href) return '';
  const local = rewriteLink(href);
  if (!local.startsWith('/reis/?')) return local;
  const query = new URLSearchParams(local.slice('/reis/?'.length));
  const result = new URLSearchParams();
  const destination = slugByLegacyId.get(Number(query.get('trip_destination')));
  const type = slugByLegacyId.get(Number(query.get('trip_type')));
  if (destination) result.set('bestemming', destination);
  if (type) result.set('type', type);
  if (query.get('trip_new') === '1') result.set('nieuw', '1');
  const search = result.toString();
  return search ? `/reis/?${search}` : '/reis/';
}

/**
 * Maakt de inhoud voor `DATA_DIR/homepage.json` uit de geparste homepage: links omgezet, foto's lokaal; een videoslide
 * krijgt de stilstaande afbeelding van de video.
 * @param {object} home Uitkomst van `parsers.parseHome`.
 * @param {{local: Function, poster: Function}} media Mediaopslag van de import.
 * @param {Map<number, string>} slugByLegacyId Slug per oud categorie-id.
 * @returns {object} De inhoud.
 */
function homepageData(home, media, slugByLegacyId) {
  return {
    importedAt: new Date().toISOString(),
    slides: home.slides.map((slide) => ({
      pretitle: slide.pretitle,
      title: slide.title,
      button: slide.button,
      href: homepageLink(slide.href, slugByLegacyId),
      image: (slide.image && media.local(slide.image)) || (slide.videoId && media.poster(slide.videoId)) || '',
      videoId: slide.videoId || null,
    })),
    sections: home.sections,
    inspiration: home.inspiration.map((item) => ({ title: item.title, text: item.text, image: (item.image && media.local(item.image)) || '' })),
    about: { ...home.about, href: homepageLink(home.about.href, slugByLegacyId), image: (home.about.image && media.local(home.about.image)) || '' },
    typeSlugs: home.typeSlugs,
  };
}

/**
 * Schrijft `homepage.json` in DATA_DIR (eerst naar een tijdelijk bestand, dan hernoemen, zodat de site nooit een half
 * bestand leest).
 * @param {object} data Inhoud.
 * @returns {string} Pad van het bestand.
 */
function writeHomepage(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, HOMEPAGE_FILE);
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(temporary, file);
  return file;
}

/**
 * Leest de koppen van de lijstpagina's, de volgorde van de reisleiders en de tags van het weblog (met per tag de
 * kopfoto en de berichten); een fout bij één pagina stopt de rest niet.
 * @param {(url: string) => Promise<string>} fetchText Ophaler.
 * @param {string[]} warnings Lijst waar fouten in komen.
 * @returns {Promise<{archives: object, guideOrder: string[], blogTags: object[], blogArchiveLink: (object|null), featuredPost: string}>}
 *   Koppen per lijst, de volgorde (slugs of oude id's), de tags, de link naar het oude blogarchief en het uitgelichte bericht.
 */
async function collectArchives(fetchText, warnings) {
  const archives = {};
  let guideOrder = [];
  let blogTags = [];
  let blogArchiveLink = null;
  let featuredPost = '';
  for (const [key, urlPath] of ARCHIVE_PAGES) {
    try {
      const markup = await fetchText(`${SITE}${urlPath}`);
      archives[key] = parsers.parseArchiveHeader(markup);
      if (key === 'reisleider') guideOrder = parsers.parseGuideOrder(markup);
      // Zonder gekozen reis staat er een melding in de inleiding; de echte inleiding is de vaste tekst.
      if (key === 'aanmelden') archives[key].introduction = '';
      if (key === 'blog') ({ tags: blogTags, archiveLink: blogArchiveLink, featured: featuredPost } = parsers.parseBlogTags(markup));
    } catch (error) {
      warnings.push(`${urlPath}: ${error.message}`);
    }
  }
  for (const tag of blogTags) {
    try {
      Object.assign(tag, parsers.parseTagPage(await fetchText(`${SITE}/tag/${encodeURIComponent(tag.slug)}/`)));
    } catch (error) {
      warnings.push(`/tag/${tag.slug}/: ${error.message}`);
    }
  }
  return { archives, guideOrder, blogTags: blogTags.filter((tag) => Array.isArray(tag.posts)), blogArchiveLink, featuredPost };
}

/**
 * Maakt de inhoud voor `DATA_DIR/site-content.json`: lijstkoppen, extra gegevens per reisleider en hun volgorde, de
 * tags van het weblog en de link naar het oude blogarchief, met foto's lokaal. Oude id's in de volgorde (adressen als /reisleider/23250/) worden slugs.
 * @param {{archives: object, guideOrder: string[], blogTags?: object[], blogArchiveLink?: (object|null), featuredPost?: string}} fixed Uitkomst van `collectArchives`.
 * @param {Array<{slug: string, legacyId: (number|null), extra: object}>} guides Geparste reisleiders.
 * @param {{local: Function}} media Mediaopslag van de import.
 * @param {Array<{path: string, gallery: object}>} [galleries] Fotogalerijen onder berichten en pagina's (`galleriesOf`).
 * @returns {object} De inhoud.
 */
function siteContentData(fixed, guides, media, galleries = []) {
  const slugByLegacyId = new Map(guides.filter((guide) => guide.legacyId).map((guide) => [String(guide.legacyId), guide.slug]));
  const local = (url) => (url && media.local(url)) || '';
  return {
    version: SITE_CONTENT_VERSION,
    importedAt: new Date().toISOString(),
    archives: Object.fromEntries(Object.entries(fixed.archives).map(([key, header]) => [key, { ...header, image: local(header.image) }])),
    guides: Object.fromEntries(guides.filter((guide) => guide.extra).map((guide) => [guide.slug, {
      ...guide.extra,
      portrait: local(guide.extra.portrait),
      image: local(guide.extra.image),
      gallery: guide.extra.gallery.map(local).filter(Boolean),
    }])),
    guideOrder: fixed.guideOrder.map((reference) => slugByLegacyId.get(reference) || reference),
    blogTags: (fixed.blogTags || []).map((tag) => ({ ...tag, image: local(tag.image) })),
    galleries: Object.fromEntries(galleries.map((item) => [item.path, { ...item.gallery, images: item.gallery.images.map(local).filter(Boolean) }])),
    ...(fixed.blogArchiveLink ? { blogArchiveLink: fixed.blogArchiveLink } : {}),
    featuredPost: fixed.featuredPost || '',
  };
}

/**
 * De fotogalerijen onder blogberichten en pagina's, op pad (alleen met foto's).
 * @param {Array<{slug: string, gallery?: object}>} posts Geparste berichten.
 * @param {Array<{path: string, gallery?: object}>} pages Geparste pagina's.
 * @returns {Array<{path: string, gallery: object}>} Pad en galerij.
 */
function galleriesOf(posts, pages) {
  return [
    ...posts.map((post) => ({ path: `/${post.slug}/`, gallery: post.gallery })),
    ...pages.map((page) => ({ path: page.path, gallery: page.gallery })),
  ].filter((item) => item.gallery && item.gallery.images.length);
}

/**
 * Schrijft `site-content.json` in DATA_DIR (tijdelijk bestand, dan hernoemen).
 * @param {object} data Inhoud.
 * @returns {string} Pad van het bestand.
 */
function writeSiteContent(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, SITE_CONTENT_FILE);
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(temporary, file);
  return file;
}

/**
 * Haalt foto's uit `site-content.json` die niet gedownload konden worden.
 * @param {object} data Inhoud voor `site-content.json`.
 * @returns {object} Dezelfde inhoud met alleen bestaande foto's.
 */
function withExistingSiteImages(data) {
  const keep = (image) => (image && fs.existsSync(path.join(MEDIA_DIR, path.basename(image))) ? image : '');
  return {
    ...data,
    archives: Object.fromEntries(Object.entries(data.archives).map(([key, header]) => [key, { ...header, image: keep(header.image) }])),
    guides: Object.fromEntries(Object.entries(data.guides).map(([slug, guide]) => [slug, {
      ...guide, portrait: keep(guide.portrait), image: keep(guide.image), gallery: guide.gallery.map(keep).filter(Boolean),
    }])),
    blogTags: (data.blogTags || []).map((tag) => ({ ...tag, image: keep(tag.image) })),
    galleries: Object.fromEntries(Object.entries(data.galleries || {}).map(([itemPath, gallery]) => [itemPath, { ...gallery, images: gallery.images.map(keep).filter(Boolean) }])),
  };
}

/**
 * Leest alle pagina's van de oude site en zet ze om naar rijen voor de database.
 * @param {(url: string) => Promise<string>} fetchText Ophaler.
 * @param {object} media Afbeeldingenbeheerder.
 * @returns {Promise<object>} Alle te importeren gegevens en waarschuwingen.
 */
async function collect(fetchText, media) {
  const groups = await readSitemaps(fetchText);
  const warnings = [];
  const clean = (markup) => sanitizeHtml(markup, { rewriteLink, rewriteImage: (url) => media.local(url) || '' });

  /**
   * Leest elke URL van een soort met de juiste parser; een fout bij één pagina stopt de rest niet.
   * @param {string} kind Soort uit de sitemap.
   * @param {Function} parser Parserfunctie.
   * @returns {Promise<object[]>} Gelezen items.
   */
  const readAll = async (kind, parser) => {
    const items = [];
    for (const url of groups[kind] || []) {
      try {
        items.push({ url, ...parser(await fetchText(url), url) });
      } catch (error) {
        warnings.push(`${url}: ${error.message}`);
      }
    }
    return items;
  };

  const guides = (await readAll('guide', parsers.parseGuide)).filter((guide) => guide.slug !== 'reisleider' && guide.name);
  const trips = (await readAll('journey', parsers.parseTrip)).filter((trip) => trip.slug !== 'reis' && trip.title);
  const categories = (await readAll('journey-category', parsers.parseCategory)).filter((category) => category.name);
  const posts = (await readAll('post', parsers.parsePost)).filter((post) => post.title && post.slug !== 'blog');
  const pages = (await readAll('page', parsers.parsePage)).filter((page) => page.title && !GENERATED_PATHS.has(page.path));
  const faqCategories = await readAll('faq-category', parsers.parseFaqCategory);
  let home = null;
  try {
    home = parsers.parseHome(await fetchText(`${SITE}/`));
  } catch (error) {
    warnings.push(`homepage: ${error.message}`);
  }

  const typeSlugs = new Set(trips.flatMap((trip) => trip.types.map((type) => type.slug)));
  const destinationSlugs = new Set(trips.flatMap((trip) => trip.destinations.map((destination) => destination.slug)));
  const teaserBySlug = new Map(categories.flatMap((category) => category.teasers).map((teaser) => [teaser.slug, teaser]));

  const slugByLegacyId = new Map(categories.filter((category) => category.legacyId).map((category) => [category.legacyId, category.slug]));
  const fixed = await collectArchives(fetchText, warnings);
  return {
    warnings,
    homepage: home ? homepageData(home, media, slugByLegacyId) : null,
    siteContent: siteContentData(fixed, guides, media, galleriesOf(posts, pages)),
    guides: guides.map((guide) => ({
      legacyId: guide.legacyId, slug: guide.slug, name: guide.name, intro: guide.intro,
      bodyHtml: clean(guide.bodyHtml), photoUrl: media.local(guide.photo),
    })),
    categories: categories.map((category) => ({
      legacyId: category.legacyId, slug: category.slug, name: category.name, intro: category.intro,
      kind: typeSlugs.has(category.slug) ? 'type' : destinationSlugs.has(category.slug) ? 'bestemming' : 'overig',
      bodyHtml: clean(category.bodyHtml), imageUrl: media.local(category.headerImage),
    })),
    trips: trips.map((trip) => {
      const teaser = teaserBySlug.get(trip.slug);
      return {
        ...trip,
        bodyHtml: clean(trip.bodyHtml),
        summary: summarize(trip.bodyHtml),
        heroImageUrl: media.local(trip.headerImage),
        cardImageUrl: media.local(teaser?.image || trip.gallery[0]?.url || trip.ogImage),
        gallery: trip.gallery.map((image) => ({ url: media.local(image.url), alt: image.alt })).filter((image) => image.url),
        isNew: Boolean(teaser?.isNew),
        categorySlugs: [...trip.destinations, ...trip.types].map((link) => link.slug),
      };
    }),
    posts: posts.map((post) => ({
      legacyId: post.legacyId, slug: post.slug, title: post.title, intro: post.intro,
      excerpt: post.intro || summarize(post.bodyHtml), bodyHtml: clean(post.bodyHtml),
      imageUrl: media.local(post.headerImage || post.image), categories: post.categories, publishedAt: post.publishedAt,
    })),
    pages: pages.map((page) => ({
      legacyId: page.legacyId, path: page.path, title: page.title, pretitle: page.pretitle, intro: page.intro,
      bodyHtml: clean(page.bodyHtml), imageUrl: media.local(page.headerImage),
    })),
    faqs: faqCategories.flatMap((category) => category.items.map((item, index) => ({
      slug: `${category.slug}-${index + 1}`, question: item.question, answerHtml: clean(item.answerHtml), category: category.name, sortOrder: index,
    }))),
  };
}

/**
 * Schrijft alle gegevens in één transactie naar de database (bijwerken op slug of pad).
 * @param {object} db Database.
 * @param {object} data Resultaat van collect().
 * @returns {Promise<Record<string, number>>} Aantallen per soort.
 */
async function store(db, data) {
  return db.transaction(async (client) => {
    const guideIds = new Map();
    for (const [index, guide] of data.guides.entries()) {
      // Een reisleider die in het CRM een ander adres kreeg, wordt op zijn oude id gevonden in plaats van opnieuw
      // aangemaakt (legacy_id is uniek); de reizen koppelen dan aan hem.
      const [moved] = guide.legacyId
        ? await client.query('SELECT id FROM guides WHERE legacy_id = $1 AND slug <> $2 AND managed_in_crm', [guide.legacyId, guide.slug])
        : [];
      if (moved) {
        guideIds.set(guide.slug, moved.id);
        guideIds.set(String(guide.legacyId), moved.id);
        continue;
      }
      const [row] = await client.query(
        `INSERT INTO guides (legacy_id, slug, name, intro, body_html, photo_url, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (slug) DO UPDATE SET legacy_id = EXCLUDED.legacy_id, name = EXCLUDED.name, intro = EXCLUDED.intro,
           body_html = EXCLUDED.body_html, photo_url = EXCLUDED.photo_url, sort_order = EXCLUDED.sort_order
         WHERE NOT guides.managed_in_crm
         RETURNING id`,
        [guide.legacyId, guide.slug, guide.name, guide.intro, guide.bodyHtml, guide.photoUrl, index],
      );
      // Een reisleider uit het CRM blijft staan (dan geen RETURNING); de reizen koppelen nog wel aan hem.
      const [kept] = row ? [row] : await client.query('SELECT id FROM guides WHERE slug = $1', [guide.slug]);
      guideIds.set(guide.slug, kept.id);
      if (guide.legacyId) guideIds.set(String(guide.legacyId), kept.id);
    }

    const categoryIds = new Map();
    for (const category of data.categories) {
      const [row] = await client.query(
        `INSERT INTO trip_categories (legacy_id, slug, name, kind, intro, body_html, image_url) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (slug) DO UPDATE SET legacy_id = EXCLUDED.legacy_id, name = EXCLUDED.name, kind = EXCLUDED.kind,
           intro = EXCLUDED.intro, body_html = EXCLUDED.body_html, image_url = EXCLUDED.image_url
         RETURNING id`,
        [category.legacyId, category.slug, category.name, category.kind, category.intro, category.bodyHtml, category.imageUrl],
      );
      categoryIds.set(category.slug, row.id);
    }

    for (const trip of data.trips) {
      // Een reis die in het CRM is gewijzigd (managed_in_crm) blijft zoals hij is: dan komt er geen rij terug.
      const [row] = await client.query(
        `INSERT INTO trips (legacy_id, slug, title, tagline, summary, body_html, trip_code, departure_date, duration_label,
           duration_days, price_cents, old_price_cents, offer_until, extra_costs_cents, status_label,
           guaranteed, fully_booked, is_new, hero_image_url, card_image_url, gallery, gallery_title, gallery_subtitle)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
         ON CONFLICT (slug) DO UPDATE SET legacy_id = EXCLUDED.legacy_id, title = EXCLUDED.title, tagline = EXCLUDED.tagline,
           summary = EXCLUDED.summary, body_html = EXCLUDED.body_html, trip_code = EXCLUDED.trip_code,
           departure_date = EXCLUDED.departure_date, duration_label = EXCLUDED.duration_label, duration_days = EXCLUDED.duration_days,
           price_cents = EXCLUDED.price_cents, old_price_cents = EXCLUDED.old_price_cents, offer_until = EXCLUDED.offer_until,
           extra_costs_cents = EXCLUDED.extra_costs_cents, status_label = EXCLUDED.status_label,
           guaranteed = EXCLUDED.guaranteed, fully_booked = EXCLUDED.fully_booked, is_new = EXCLUDED.is_new,
           hero_image_url = EXCLUDED.hero_image_url, card_image_url = EXCLUDED.card_image_url, gallery = EXCLUDED.gallery,
           gallery_title = EXCLUDED.gallery_title, gallery_subtitle = EXCLUDED.gallery_subtitle
         WHERE NOT trips.managed_in_crm
         RETURNING id`,
        [trip.legacyId, trip.slug, trip.title, trip.tagline, trip.summary, trip.bodyHtml, trip.tripCode, trip.departureDate,
          trip.durationLabel, trip.durationDays, trip.priceCents, trip.oldPriceCents, trip.offerUntil, trip.extraCostsCents,
          trip.statusLabel, trip.guaranteed, trip.fullyBooked, trip.isNew,
          trip.heroImageUrl, trip.cardImageUrl, JSON.stringify(trip.gallery),
          trip.galleryTitle, trip.gallerySubtitle],
      );
      if (!row) continue;
      await client.query('DELETE FROM trip_guides WHERE trip_id = $1', [row.id]);
      const guideId = guideIds.get(String(trip.guideRef));
      if (guideId) await client.query('INSERT INTO trip_guides (trip_id, guide_id) VALUES ($1, $2)', [row.id, guideId]);
      await client.query('DELETE FROM trip_category_links WHERE trip_id = $1', [row.id]);
      const linkIds = [...new Set(trip.categorySlugs.map((slug) => categoryIds.get(slug)).filter(Boolean))];
      if (linkIds.length) {
        await client.query('INSERT INTO trip_category_links (trip_id, category_id) SELECT $1, UNNEST($2::int[])', [row.id, linkIds]);
      }
    }

    for (const post of data.posts) {
      await client.query(
        // Een bericht dat in het CRM is gepubliceerd (managed_in_crm) of waar een concept voor openstaat (draft) blijft
        // zoals het is (CMS-pakket I1); een bericht dat in het CRM een ander adres kreeg komt niet terug op het oude.
        `INSERT INTO posts (legacy_id, slug, title, intro, excerpt, body_html, image_url, categories, published_at)
         SELECT $1::int, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text, $8::text[], $9::timestamptz
          WHERE NOT EXISTS (SELECT 1 FROM posts moved WHERE moved.legacy_id = $1::int AND moved.slug <> $2::text)
         ON CONFLICT (slug) DO UPDATE SET legacy_id = EXCLUDED.legacy_id, title = EXCLUDED.title, intro = EXCLUDED.intro,
           excerpt = EXCLUDED.excerpt, body_html = EXCLUDED.body_html, image_url = EXCLUDED.image_url,
           categories = EXCLUDED.categories, published_at = EXCLUDED.published_at
         WHERE NOT posts.managed_in_crm AND posts.draft IS NULL`,
        [post.legacyId, post.slug, post.title, post.intro, post.excerpt, post.bodyHtml, post.imageUrl, post.categories, post.publishedAt],
      );
    }

    for (const page of data.pages) {
      await client.query(
        // De tekst wordt één tekstblok (CMS-pakket H). Een pagina die in het CRM is gepubliceerd (managed_in_crm) of
        // waar een concept voor openstaat (draft) blijft zoals hij is, zodat het concept niet op oude inhoud rust.
        `INSERT INTO pages (legacy_id, path, title, pretitle, intro, body_html, image_url, blocks)
         SELECT $1,$2,$3,$4,$5,$6,$7, CASE WHEN $6 <> '' THEN jsonb_build_array(jsonb_build_object(
           'id', 'b' || substr(md5('import-' || $2), 1, 12), 'type', 'tekst', 'data', jsonb_build_object('html', $6::text), 'style', '{}'::jsonb))
           ELSE '[]'::jsonb END
          -- In het CRM naar een ander adres verplaatst: niet opnieuw op het oude adres aanmaken.
          WHERE NOT EXISTS (SELECT 1 FROM pages moved WHERE moved.legacy_id = $1 AND moved.path <> $2)
         ON CONFLICT (path) DO UPDATE SET legacy_id = EXCLUDED.legacy_id, title = EXCLUDED.title, pretitle = EXCLUDED.pretitle,
           intro = EXCLUDED.intro, body_html = EXCLUDED.body_html, image_url = EXCLUDED.image_url, blocks = EXCLUDED.blocks
         WHERE NOT pages.managed_in_crm AND pages.draft IS NULL`,
        [page.legacyId, page.path, page.title, page.pretitle, page.intro, page.bodyHtml, page.imageUrl],
      );
    }

    // Vragen die in het CRM zijn gemaakt of gewijzigd blijven staan (ook hun categorie wordt dan niet opnieuw gemaakt,
    // bijv. na hernoemen); de categorie van de rest komt in `faq_categories` (op naam).
    await client.query('DELETE FROM faqs WHERE NOT managed_in_crm');
    let faqsKept = 0;
    for (const faq of data.faqs) {
      const [kept] = await client.query('SELECT 1 AS kept FROM faqs WHERE slug = $1 AND managed_in_crm', [faq.slug]);
      if (kept) {
        faqsKept += 1;
        continue;
      }
      const categoryName = String(faq.category || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Algemeen';
      const [category] = await client.query(
        `INSERT INTO faq_categories (name, sort_order) VALUES ($1, (SELECT COALESCE(max(sort_order), 0) + 10 FROM faq_categories))
         ON CONFLICT ((lower(name))) DO UPDATE SET name = faq_categories.name RETURNING id, name`,
        [categoryName],
      );
      await client.query(
        'INSERT INTO faqs (slug, question, answer_html, category, category_id, sort_order) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (slug) DO NOTHING',
        [faq.slug, faq.question, faq.answerHtml, category.name, category.id, faq.sortOrder],
      );
    }

    return { reisleiders: data.guides.length, categorieen: data.categories.length, reizen: data.trips.length, blog: data.posts.length, paginas: data.pages.length, faq: data.faqs.length - faqsKept, faqUitCrm: faqsKept };
  });
}

/**
 * Voert de hele import uit.
 * @returns {Promise<void>}
 */
async function main() {
  const options = readOptions(process.argv.slice(2));
  const db = createDatabase(process.env.DATABASE_URL);
  try {
    await db.migrate();
    const media = createMediaStore(options);
    if (options.fixedOnly) {
      // Alleen de vaste inhoud, altijd vers (niet uit de cache): homepage, lijstkoppen en reisleiders.
      const fetchText = createFreshFetcher(options);
      const warnings = [];
      const categories = await db.query('SELECT legacy_id, slug FROM trip_categories WHERE legacy_id IS NOT NULL');
      const slugByLegacyId = new Map(categories.map((category) => [category.legacy_id, category.slug]));
      const homepage = homepageData(parsers.parseHome(await fetchText(`${SITE}/`)), media, slugByLegacyId);
      const groups = await readSitemaps(fetchText);
      const guides = [];
      for (const url of groups.guide || []) {
        try {
          const guide = parsers.parseGuide(await fetchText(url), url);
          if (guide.slug !== 'reisleider' && guide.name) guides.push(guide);
        } catch (error) {
          warnings.push(`${url}: ${error.message}`);
        }
      }
      // Berichten en pagina's alleen voor hun fotogalerij (de tekst staat al in de database).
      const readGalleries = async (urls, parser) => {
        const items = [];
        for (const url of urls || []) {
          try {
            items.push(parser(await fetchText(url), url));
          } catch (error) {
            warnings.push(`${url}: ${error.message}`);
          }
        }
        return items;
      };
      const posts = await readGalleries(groups.post, parsers.parsePost);
      const pages = await readGalleries(groups.page, parsers.parsePage);
      const siteContent = siteContentData(await collectArchives(fetchText, warnings), guides, media, galleriesOf(posts, pages));
      const result = await media.download(db);
      console.log(`Vaste inhoud: ${homepage.slides.length} dia's, ${Object.keys(siteContent.guides).length} reisleiders, ${Object.keys(siteContent.galleries).length} fotogalerijen, afbeeldingen lokaal: ${result.ok}, mislukt: ${result.failed.length}`);
      console.log(`Opgeslagen in ${writeHomepage(withExistingImages(homepage))} en ${writeSiteContent(withExistingSiteImages(siteContent))}`);
      for (const line of [...warnings, ...result.failed].slice(0, 20)) console.warn(`  let op: ${line}`);
      return;
    }
    const data = await collect(createFetcher(options), media);
    const counts = await store(db, data);
    console.log('Geïmporteerd:', counts);
    console.log(`Afbeeldingen: ${media.count()} gevonden`);
    const result = await media.download(db);
    console.log(`Afbeeldingen lokaal: ${result.ok}, mislukt: ${result.failed.length}`);
    // Fotobibliotheek: foto's zonder land krijgen de landen van de reizen waarin ze staan.
    const linked = await linkImportedMedia(db);
    console.log(`Fotobibliotheek: ${linked.linked} foto('s) automatisch aan een land gekoppeld`);
    if (data.homepage) console.log(`Homepage opgeslagen in ${writeHomepage(withExistingImages(data.homepage))}`);
    console.log(`Lijstkoppen en reisleiders opgeslagen in ${writeSiteContent(withExistingSiteImages(data.siteContent))}`);
    for (const line of [...data.warnings, ...result.failed].slice(0, 50)) console.warn(`  let op: ${line}`);
  } finally {
    await db.close();
  }
}

/**
 * Haalt foto's uit de homepage-inhoud die niet gedownload konden worden, zodat de site geen kapotte afbeelding toont
 * (de route vult dan een foto van een reis in).
 * @param {object} homepage Inhoud voor `homepage.json`.
 * @returns {object} Dezelfde inhoud met alleen bestaande foto's.
 */
function withExistingImages(homepage) {
  const keep = (image) => (image && fs.existsSync(path.join(MEDIA_DIR, path.basename(image))) ? image : '');
  return {
    ...homepage,
    slides: homepage.slides.map((slide) => ({ ...slide, image: keep(slide.image) })),
    inspiration: homepage.inspiration.map((item) => ({ ...item, image: keep(item.image) })),
    about: { ...homepage.about, image: keep(homepage.about.image) },
  };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Import mislukt: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  cacheName, rewriteLink, summarize, readSitemaps, collect, store, createMediaStore, homepageLink, homepageData, withExistingImages,
  collectArchives, siteContentData, withExistingSiteImages, galleriesOf,
};
