#!/usr/bin/env node
/**
 * Importeert de content van de huidige WordPress-site (www.avantareizen.nl) in PostgreSQL: reizen, reisleiders,
 * reiscategorieën, blog, pagina's en FAQ, plus alle gebruikte afbeeldingen naar DATA_DIR/media.
 * Herhaalbaar tot go-live: bestaande rijen worden bijgewerkt (op slug/pad), niets wordt dubbel aangemaakt.
 *
 * Gebruik: DATABASE_URL=… node tools/import-wordpress.js [--cache <map>] [--delay <ms>] [--zonder-media]
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createDatabase } = require('../src/database/db');
const { DATA_DIR, MEDIA_DIR } = require('../src/paths');
const { sanitizeHtml, plainText } = require('./import/sanitize');
const parsers = require('./import/parse');

const SITE = 'https://www.avantareizen.nl';
const USER_AGENT = 'Mozilla/5.0 (compatible; AvantaSiteImport/1.0)';
/** Lijstpagina's die de nieuwe site zelf opbouwt; die komen niet in de tabel pages. */
const GENERATED_PATHS = new Set(['/', '/reis/', '/blog/', '/faq/', '/reisleider/', '/aanmelden/', '/styleguide/']);
/** Afbeeldingstypen die we overnemen. */
const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/**
 * Leest de opdrachtregel.
 * @param {string[]} argv Argumenten.
 * @returns {{cache: string, delay: number, media: boolean}} Opties.
 */
function readOptions(argv) {
  const options = { cache: path.join(DATA_DIR, 'import-cache'), delay: 500, media: true };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--cache') options.cache = path.resolve(argv[++i]);
    else if (argv[i] === '--delay') options.delay = Number(argv[++i]) || 0;
    else if (argv[i] === '--zonder-media') options.media = false;
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

  return { local, download, count: () => wanted.size };
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

  const typeSlugs = new Set(trips.flatMap((trip) => trip.types.map((type) => type.slug)));
  const destinationSlugs = new Set(trips.flatMap((trip) => trip.destinations.map((destination) => destination.slug)));
  const teaserBySlug = new Map(categories.flatMap((category) => category.teasers).map((teaser) => [teaser.slug, teaser]));

  return {
    warnings,
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
      const [row] = await client.query(
        `INSERT INTO guides (legacy_id, slug, name, intro, body_html, photo_url, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (slug) DO UPDATE SET legacy_id = EXCLUDED.legacy_id, name = EXCLUDED.name, intro = EXCLUDED.intro,
           body_html = EXCLUDED.body_html, photo_url = EXCLUDED.photo_url, sort_order = EXCLUDED.sort_order
         RETURNING id`,
        [guide.legacyId, guide.slug, guide.name, guide.intro, guide.bodyHtml, guide.photoUrl, index],
      );
      guideIds.set(guide.slug, row.id);
      if (guide.legacyId) guideIds.set(String(guide.legacyId), row.id);
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
      const [row] = await client.query(
        `INSERT INTO trips (legacy_id, slug, title, tagline, summary, body_html, trip_code, departure_date, duration_label,
           duration_days, price_cents, old_price_cents, offer_until, extra_costs_cents, destinations, status_label,
           guaranteed, fully_booked, is_new, guide_id, hero_image_url, card_image_url, gallery, gallery_title, gallery_subtitle)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
         ON CONFLICT (slug) DO UPDATE SET legacy_id = EXCLUDED.legacy_id, title = EXCLUDED.title, tagline = EXCLUDED.tagline,
           summary = EXCLUDED.summary, body_html = EXCLUDED.body_html, trip_code = EXCLUDED.trip_code,
           departure_date = EXCLUDED.departure_date, duration_label = EXCLUDED.duration_label, duration_days = EXCLUDED.duration_days,
           price_cents = EXCLUDED.price_cents, old_price_cents = EXCLUDED.old_price_cents, offer_until = EXCLUDED.offer_until,
           extra_costs_cents = EXCLUDED.extra_costs_cents, destinations = EXCLUDED.destinations, status_label = EXCLUDED.status_label,
           guaranteed = EXCLUDED.guaranteed, fully_booked = EXCLUDED.fully_booked, is_new = EXCLUDED.is_new, guide_id = EXCLUDED.guide_id,
           hero_image_url = EXCLUDED.hero_image_url, card_image_url = EXCLUDED.card_image_url, gallery = EXCLUDED.gallery,
           gallery_title = EXCLUDED.gallery_title, gallery_subtitle = EXCLUDED.gallery_subtitle
         RETURNING id`,
        [trip.legacyId, trip.slug, trip.title, trip.tagline, trip.summary, trip.bodyHtml, trip.tripCode, trip.departureDate,
          trip.durationLabel, trip.durationDays, trip.priceCents, trip.oldPriceCents, trip.offerUntil, trip.extraCostsCents,
          trip.destinations.map((destination) => destination.name), trip.statusLabel, trip.guaranteed, trip.fullyBooked, trip.isNew,
          guideIds.get(String(trip.guideRef)) || null, trip.heroImageUrl, trip.cardImageUrl, JSON.stringify(trip.gallery),
          trip.galleryTitle, trip.gallerySubtitle],
      );
      await client.query('DELETE FROM trip_category_links WHERE trip_id = $1', [row.id]);
      const linkIds = [...new Set(trip.categorySlugs.map((slug) => categoryIds.get(slug)).filter(Boolean))];
      if (linkIds.length) {
        await client.query('INSERT INTO trip_category_links (trip_id, category_id) SELECT $1, UNNEST($2::int[])', [row.id, linkIds]);
      }
    }

    for (const post of data.posts) {
      await client.query(
        `INSERT INTO posts (legacy_id, slug, title, intro, excerpt, body_html, image_url, categories, published_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (slug) DO UPDATE SET legacy_id = EXCLUDED.legacy_id, title = EXCLUDED.title, intro = EXCLUDED.intro,
           excerpt = EXCLUDED.excerpt, body_html = EXCLUDED.body_html, image_url = EXCLUDED.image_url,
           categories = EXCLUDED.categories, published_at = EXCLUDED.published_at`,
        [post.legacyId, post.slug, post.title, post.intro, post.excerpt, post.bodyHtml, post.imageUrl, post.categories, post.publishedAt],
      );
    }

    for (const page of data.pages) {
      await client.query(
        `INSERT INTO pages (legacy_id, path, title, pretitle, intro, body_html, image_url) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (path) DO UPDATE SET legacy_id = EXCLUDED.legacy_id, title = EXCLUDED.title, pretitle = EXCLUDED.pretitle,
           intro = EXCLUDED.intro, body_html = EXCLUDED.body_html, image_url = EXCLUDED.image_url`,
        [page.legacyId, page.path, page.title, page.pretitle, page.intro, page.bodyHtml, page.imageUrl],
      );
    }

    await client.query('DELETE FROM faqs');
    for (const faq of data.faqs) {
      await client.query(
        'INSERT INTO faqs (slug, question, answer_html, category, sort_order) VALUES ($1,$2,$3,$4,$5)',
        [faq.slug, faq.question, faq.answerHtml, faq.category, faq.sortOrder],
      );
    }

    return { reisleiders: data.guides.length, categorieen: data.categories.length, reizen: data.trips.length, blog: data.posts.length, paginas: data.pages.length, faq: data.faqs.length };
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
    const data = await collect(createFetcher(options), media);
    const counts = await store(db, data);
    console.log('Geïmporteerd:', counts);
    console.log(`Afbeeldingen: ${media.count()} gevonden`);
    const result = await media.download(db);
    console.log(`Afbeeldingen lokaal: ${result.ok}, mislukt: ${result.failed.length}`);
    for (const line of [...data.warnings, ...result.failed].slice(0, 50)) console.warn(`  let op: ${line}`);
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Import mislukt: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { cacheName, rewriteLink, summarize, readSitemaps, collect, store, createMediaStore };
