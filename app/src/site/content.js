/**
 * Leest de content van de website uit de database: reizen, categorieën, reisleiders, blog, pagina's en FAQ.
 * Alleen de kolommen die de pagina's nodig hebben; lijsten zonder de grote HTML-kolommen.
 */

const { postSummary } = require('./format');
const { fullyBookedSql } = require('../trips/seats');

/**
 * Kolommen voor een blogbericht in een lijst: zonder de HTML, wel het begin van de tekst voor de samenvatting (tags
 * weg, de link "Bekijk de video" van een geïmporteerde video ook). De regexes draaien alleen over de eerste 6000
 * tekens van de HTML (genoeg voor 197 bytes tekst), zodat een lange lijst geen volledige berichten doorzoekt; een
 * afgekapte tag aan het eind valt ook weg.
 */
const POST_TEASER_COLUMNS = `slug, title, excerpt, image_url, published_at,
  left(regexp_replace(regexp_replace(regexp_replace(left(body_html, 6000), '<a [^>]*>Bekijk de video</a>', '', 'g'), '<[^>]*(>|$)', ' ', 'g'), '\\s+', ' ', 'g'), 800) AS body_text`;

/**
 * Een bericht uit de lijst met zijn samenvatting (`summary`) in plaats van het begin van de tekst.
 * @param {object} row Rij met `body_text`.
 * @returns {object} Bericht.
 */
function withSummary(row) {
  const { body_text: bodyText, ...post } = row;
  return { ...post, summary: postSummary(bodyText) };
}

/** Kolommen voor een reis in een lijst (teaser). */
const TRIP_CARD_COLUMNS = `t.id, t.slug, t.title, t.summary, t.trip_code, t.departure_date, t.duration_label, t.price_cents,
  t.old_price_cents, t.offer_until, t.extra_costs_cents,
  ARRAY(SELECT c.name FROM trip_category_links l JOIN trip_categories c ON c.id = l.category_id
         WHERE l.trip_id = t.id AND c.kind = 'bestemming' ORDER BY c.sort_order, c.name) AS destinations, t.status_label, t.guaranteed, ${fullyBookedSql('t')} AS fully_booked,
  t.is_new, t.card_image_url`;

/**
 * Vandaag als datum in Nederland (jjjj-mm-dd).
 * @returns {string} De datum.
 */
function today() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });
}

/**
 * Maakt de queryfuncties voor de content.
 * @param {{query: Function}} db Database.
 * @returns {object} Queryfuncties.
 */
function createContent(db) {
  return {
    /**
     * Toekomstige reizen, op vertrekdatum, optioneel gefilterd.
     * @param {{destination?: string, type?: string, departure?: string, search?: string, limit?: number, onlyAvailable?: boolean, before?: string, newFirst?: boolean}} [filter] Filters (categorieslugs, datum); `newFirst` zet nieuwe reizen bovenaan.
     * @returns {Promise<object[]>} Reizen.
     */
    async upcomingTrips(filter = {}) {
      const conditions = ['t.published', 't.departure_date >= $1'];
      const params = [today()];
      /**
       * Voegt een parameter toe en geeft de plaatshouder.
       * @param {*} value Waarde.
       * @returns {string} Plaatshouder ($n).
       */
      const param = (value) => { params.push(value); return `$${params.length}`; };
      for (const slug of [filter.destination, filter.type].filter(Boolean)) {
        conditions.push(`EXISTS (SELECT 1 FROM trip_category_links l JOIN trip_categories c ON c.id = l.category_id WHERE l.trip_id = t.id AND c.slug = ${param(slug)})`);
      }
      if (filter.departure) conditions.push(`t.departure_date = ${param(filter.departure)}`);
      if (filter.before) conditions.push(`t.departure_date <= ${param(filter.before)}`);
      if (filter.onlyAvailable) conditions.push(`NOT ${fullyBookedSql('t')}`);
      if (filter.search) conditions.push(`(t.title ILIKE ${param(`%${filter.search}%`)} OR t.trip_code ILIKE $${params.length} OR EXISTS (SELECT 1 FROM trip_category_links l JOIN trip_categories c ON c.id = l.category_id WHERE l.trip_id = t.id AND c.kind = 'bestemming' AND c.name ILIKE $${params.length}))`);
      const limit = filter.limit ? ` LIMIT ${param(filter.limit)}` : '';
      const order = filter.newFirst ? 't.is_new DESC, t.departure_date, t.title' : 't.departure_date, t.title';
      return db.query(`SELECT ${TRIP_CARD_COLUMNS} FROM trips t WHERE ${conditions.join(' AND ')} ORDER BY ${order}${limit}`, params);
    },

    /**
     * Alle vertrekdata van toekomstige reizen (voor de zoeker).
     * @returns {Promise<string[]>} Datums (jjjj-mm-dd).
     */
    async departureDates() {
      const rows = await db.query("SELECT DISTINCT to_char(departure_date, 'YYYY-MM-DD') AS day FROM trips WHERE published AND departure_date >= $1 ORDER BY day", [today()]);
      return rows.map((row) => row.day);
    },

    /**
     * Aantal nieuwe reizen die nog niet vertrokken zijn (voor "Nieuwe reizen (n)" in de filterbalk).
     * @returns {Promise<number>} Aantal.
     */
    async newTripCount() {
      const [row] = await db.query('SELECT count(*)::int AS count FROM trips t WHERE t.published AND t.is_new AND t.departure_date >= $1', [today()]);
      return row ? row.count : 0;
    },

    /**
     * Eén reis met reisleiders (`guides`, op volgorde; de eerste ook als `guide_*`) en categorieën.
     * @param {string} slug Slug van de reis.
     * @returns {Promise<(object|null)>} De reis of null.
     */
    async tripBySlug(slug) {
      const [trip] = await db.query(
        `SELECT ${TRIP_CARD_COLUMNS}, t.legacy_id, t.tagline, t.body_html, t.duration_days, t.hero_image_url, t.gallery,
           t.gallery_title, t.gallery_subtitle
         FROM trips t
         WHERE t.slug = $1 AND t.published`,
        [slug],
      );
      if (!trip) return null;
      trip.guides = await db.query(
        `SELECT g.slug, g.name, g.photo_url FROM trip_guides tg JOIN guides g ON g.id = tg.guide_id
         WHERE tg.trip_id = $1 AND g.published ORDER BY tg.sort_order, g.name`,
        [trip.id],
      );
      trip.categories = await db.query(
        `SELECT c.slug, c.name, c.kind, c.icon FROM trip_category_links l JOIN trip_categories c ON c.id = l.category_id
         WHERE l.trip_id = $1 ORDER BY c.kind, c.sort_order, c.name`,
        [trip.id],
      );
      return trip;
    },

    /**
     * Reis op het oude WordPress-id (voor /aanmelden/?id=…).
     * @param {number} legacyId Oud id.
     * @returns {Promise<(object|null)>} De reis of null.
     */
    async tripByLegacyId(legacyId) {
      const [trip] = await db.query(
        `SELECT ${TRIP_CARD_COLUMNS}, t.legacy_id FROM trips t WHERE t.legacy_id = $1 AND t.published`,
        [legacyId],
      );
      return trip || null;
    },

    /**
     * Categorieën van een soort met het aantal toekomstige reizen, op de volgorde uit het CRM en dan op naam.
     * @param {string} kind 'bestemming', 'type' of 'overig'.
     * @returns {Promise<object[]>} Categorieën (met `icon` en `show_on_home`).
     */
    async categories(kind) {
      return db.query(
        `SELECT c.slug, c.name, c.image_url, c.icon, c.show_on_home, COUNT(t.id)::int AS trip_count
         FROM trip_categories c
         LEFT JOIN trip_category_links l ON l.category_id = c.id
         LEFT JOIN trips t ON t.id = l.trip_id AND t.published AND t.departure_date >= $2
         WHERE c.kind = $1 GROUP BY c.id ORDER BY c.sort_order, c.name`,
        [kind, today()],
      );
    },

    /**
     * Eén categorie.
     * @param {string} slug Slug.
     * @returns {Promise<(object|null)>} Categorie of null.
     */
    async categoryBySlug(slug) {
      const [category] = await db.query('SELECT id, slug, name, kind, icon, intro, body_html, image_url FROM trip_categories WHERE slug = $1', [slug]);
      return category || null;
    },

    /**
     * Alle reisleiders.
     * @returns {Promise<object[]>} Reisleiders.
     */
    async guides() {
      return db.query('SELECT slug, legacy_id, name, intro, photo_url FROM guides WHERE published ORDER BY name');
    },

    /**
     * Eén reisleider op slug of oud id, met toekomstige reizen.
     * @param {string} reference Slug of oud id.
     * @returns {Promise<(object|null)>} Reisleider of null.
     */
    async guideByReference(reference) {
      const legacyId = /^\d+$/.test(reference) ? Number(reference) : null;
      const [guide] = await db.query(
        'SELECT id, slug, legacy_id, name, intro, body_html, photo_url FROM guides WHERE published AND (slug = $1 OR legacy_id = $2)',
        [reference, legacyId],
      );
      if (!guide) return null;
      guide.trips = await db.query(
        `SELECT ${TRIP_CARD_COLUMNS} FROM trips t JOIN trip_guides tg ON tg.trip_id = t.id WHERE tg.guide_id = $1 AND t.published AND t.departure_date >= $2 ORDER BY t.departure_date`,
        [guide.id, today()],
      );
      return guide;
    },

    /**
     * Blogberichten, nieuwste eerst, per pagina.
     * @param {{page?: number, perPage?: number}} [paging] Pagina en aantal.
     * @returns {Promise<{posts: object[], total: number}>} Berichten en totaal.
     */
    async posts(paging = {}) {
      const perPage = paging.perPage || 12;
      const offset = Math.max(0, (paging.page || 1) - 1) * perPage;
      const rows = await db.query(
        `SELECT ${POST_TEASER_COLUMNS} FROM posts WHERE published ORDER BY published_at DESC NULLS LAST LIMIT $1 OFFSET $2`,
        [perPage, offset],
      );
      const posts = rows.map(withSummary);
      const [{ total }] = await db.query('SELECT COUNT(*)::int AS total FROM posts WHERE published');
      return { posts, total };
    },

    /**
     * Gepubliceerde berichten op slug, in de volgorde van de lijst (onbekende slugs vallen weg).
     * @param {string[]} slugs Slugs (hoogstens 500).
     * @returns {Promise<object[]>} Berichten.
     */
    async postsBySlugs(slugs) {
      const wanted = [...new Set(slugs)].slice(0, 500);
      if (!wanted.length) return [];
      const rows = await db.query(`SELECT ${POST_TEASER_COLUMNS} FROM posts WHERE published AND slug = ANY($1::text[])`, [wanted]);
      const bySlug = new Map(rows.map((row) => [row.slug, withSummary(row)]));
      return wanted.map((slug) => bySlug.get(slug)).filter(Boolean);
    },

    /**
     * Eén blogbericht.
     * @param {string} slug Slug.
     * @returns {Promise<(object|null)>} Bericht of null.
     */
    async postBySlug(slug) {
      const [post] = await db.query('SELECT slug, title, intro, excerpt, body_html, image_url, published_at FROM posts WHERE slug = $1 AND published', [slug]);
      return post || null;
    },

    /**
     * Eén pagina op pad.
     * @param {string} path Pad met slash aan het eind.
     * @returns {Promise<(object|null)>} Pagina of null.
     */
    async pageByPath(path) {
      const [page] = await db.query('SELECT path, title, pretitle, intro, body_html, image_url FROM pages WHERE path = $1 AND published', [path]);
      return page || null;
    },

    /**
     * Alle FAQ's, op categorie.
     * @returns {Promise<object[]>} Vragen.
     */
    async faqs() {
      return db.query('SELECT slug, question, answer_html, category FROM faqs ORDER BY category, sort_order');
    },

    /**
     * Alle openbare adressen voor de sitemap: ook vertrokken reizen, want die URL's bestaan.
     * @returns {Promise<{trips: object[], categories: object[], guides: object[], posts: object[], pages: object[]}>} Rijen per soort.
     */
    async sitemapEntries() {
      const [trips, categories, guides, posts, pages] = await Promise.all([
        db.query('SELECT slug FROM trips WHERE published = $1 ORDER BY slug', [true]),
        db.query('SELECT slug FROM trip_categories ORDER BY slug'),
        db.query('SELECT slug FROM guides WHERE published = $1 ORDER BY slug', [true]),
        db.query('SELECT slug, published_at FROM posts WHERE published = $1 ORDER BY published_at DESC NULLS LAST, slug', [true]),
        db.query('SELECT path FROM pages WHERE published = $1 ORDER BY path', [true]),
      ]);
      return { trips, categories, guides, posts, pages };
    },

    /**
     * Zoekt in reizen, blog en pagina's.
     * @param {string} term Zoekterm.
     * @returns {Promise<{trips: object[], posts: object[], pages: object[]}>} Resultaten.
     */
    async search(term) {
      const pattern = `%${term}%`;
      const [trips, posts, pages] = await Promise.all([
        this.upcomingTrips({ search: term, limit: 30 }),
        db.query(`SELECT ${POST_TEASER_COLUMNS} FROM posts WHERE published AND (title ILIKE $1 OR excerpt ILIKE $1) ORDER BY published_at DESC LIMIT 20`, [pattern]).then((rows) => rows.map(withSummary)),
        db.query('SELECT path, title, intro FROM pages WHERE published AND (title ILIKE $1 OR intro ILIKE $1) ORDER BY title LIMIT 20', [pattern]),
      ]);
      return { trips, posts, pages };
    },
  };
}

module.exports = { createContent, today };
