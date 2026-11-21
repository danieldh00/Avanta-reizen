/**
 * Categorieën en tags van het blog (CMS-pakket I2, migratie 20): lijst met het aantal berichten, nieuw, wijzigen (een
 * gewijzigde slug geeft een 301 vanaf het oude adres), verwijderen, de koppeling van een bericht aan categorieën en
 * tags, het uitgelichte bericht (`posts.featured`, hoogstens één) en het eenmalig overnemen van de tags uit
 * `site-content.json` (de tags van de huidige site met hun foto en berichten). Elke wijziging schrijft de audit in
 * dezelfde transactie. Alle vragen met gebonden parameters.
 */
const { cleanText } = require('../media/library');
const { slugify, isValidSlug, recordMove } = require('../trips/slugs');

/** Soorten met hun naam en het adres op de site. */
const TERM_KINDS = Object.freeze({
  categorie: { label: 'Categorie', plural: 'Categorieën', prefix: '/category/' },
  tag: { label: 'Tag', plural: 'Tags', prefix: '/tag/' },
});

/** Maximale lengtes en aantallen. */
const TERM_LIMITS = { name: 100, intro: 1000, terms: 200 };

/**
 * Leest en controleert de gegevens van een categorie of tag uit een formulier.
 * @param {object} body Ingezonden velden.
 * @returns {{values: {name: string, slug: string, intro: string, sortOrder: number}, errors: object}} Waarden en fouten.
 */
function validateTermFields(body) {
  const text = (name) => (typeof body[name] === 'string' ? body[name] : '');
  const errors = {};
  const name = cleanText(text('name'), TERM_LIMITS.name + 1);
  if (!name) errors.name = 'Vul een naam in.';
  else if (name.length > TERM_LIMITS.name) errors.name = `Maximaal ${TERM_LIMITS.name} tekens.`;
  const slug = text('slug').trim() || slugify(name);
  if (!isValidSlug(slug)) errors.slug = 'Gebruik kleine letters, cijfers en streepjes (bijv. jongerenreizen).';
  const intro = cleanText(text('intro'), TERM_LIMITS.intro + 1);
  if (intro.length > TERM_LIMITS.intro) errors.intro = `Maximaal ${TERM_LIMITS.intro} tekens.`;
  const order = text('sort_order').trim();
  if (order && !/^-?\d{1,6}$/.test(order)) errors.sort_order = 'Vul een heel getal in.';
  return {
    values: { name: name.slice(0, TERM_LIMITS.name), slug, intro: intro.slice(0, TERM_LIMITS.intro), sortOrder: order && !errors.sort_order ? Number(order) : 0 },
    errors,
  };
}

/**
 * Maakt de functies voor categorieën en tags.
 * @param {{db: object}} options Database.
 * @returns {object} Functies.
 */
function createPostTerms(options) {
  const { db } = options;

  /**
   * Alle categorieën en tags met het aantal gekoppelde berichten, op soort, volgorde en naam.
   * @returns {Promise<object[]>} Rijen.
   */
  const list = () => db.query(
    `SELECT t.id, t.kind, t.slug, t.name, t.sort_order, t.image_url,
            (SELECT count(*)::int FROM post_term_links l WHERE l.term_id = t.id) AS post_count
       FROM post_terms t ORDER BY t.kind, t.sort_order, t.name LIMIT $1`,
    [TERM_LIMITS.terms * 2],
  );

  /**
   * Eén categorie of tag.
   * @param {(number|string)} id Id.
   * @returns {Promise<(object|null)>} Rij of null.
   */
  const get = async (id) => {
    if (!/^\d{1,9}$/.test(String(id))) return null;
    const [row] = await db.query('SELECT id, kind, slug, name, intro, image_url, sort_order, updated_at FROM post_terms WHERE id = $1', [Number(id)]);
    return row || null;
  };

  /**
   * Maakt een categorie of tag.
   * @param {string} kind `categorie` of `tag`.
   * @param {object} values Uit `validateTermFields`.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit (`(client, id) => Promise`).
   * @returns {Promise<{id?: number, errors?: object}>} Nieuw id of fouten.
   */
  const create = (kind, values, context) => db.transaction(async (client) => {
    if (!Object.hasOwn(TERM_KINDS, kind)) return { errors: { kind: 'Kies categorie of tag.' } };
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['blog-indeling-adres']);
    const [{ count }] = await client.query('SELECT count(*)::int AS count FROM post_terms WHERE kind = $1', [kind]);
    if (count >= TERM_LIMITS.terms) return { errors: { name: `Er zijn hoogstens ${TERM_LIMITS.terms} ${TERM_KINDS[kind].plural.toLowerCase()}.` } };
    const [row] = await client.query(
      `INSERT INTO post_terms (kind, slug, name, intro, sort_order, updated_by) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (kind, slug) DO NOTHING RETURNING id`,
      [kind, values.slug, values.name, values.intro, values.sortOrder, context.userId],
    );
    if (!row) return { errors: { slug: 'Dit adres bestaat al.' } };
    await context.audit(client, row.id);
    return { id: row.id };
  });

  /**
   * Wijzigt een categorie of tag; een andere slug geeft een 301 vanaf het oude adres (daarna `redirects.reload()`).
   * @param {(number|string)} id Id.
   * @param {object} values Uit `validateTermFields`.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit.
   * @returns {Promise<{status: ('ok'|'weg'|'fout'), errors?: object, moved?: boolean}>} Uitkomst.
   */
  const update = (id, values, context) => db.transaction(async (client) => {
    if (!/^\d{1,9}$/.test(String(id))) return { status: 'weg' };
    // Gelijktijdige wijzigingen naar dezelfde slug na elkaar, zodat de controle hieronder klopt (geen 500 op de unieke index).
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['blog-indeling-adres']);
    const [term] = await client.query('SELECT id, kind, slug FROM post_terms WHERE id = $1 FOR UPDATE', [Number(id)]);
    if (!term) return { status: 'weg' };
    if (values.slug !== term.slug) {
      const [other] = await client.query('SELECT id FROM post_terms WHERE kind = $1 AND slug = $2', [term.kind, values.slug]);
      if (other) return { status: 'fout', errors: { slug: 'Dit adres bestaat al.' } };
    }
    await client.query(
      'UPDATE post_terms SET slug = $2, name = $3, intro = $4, sort_order = $5, updated_at = now(), updated_by = $6 WHERE id = $1',
      [term.id, values.slug, values.name, values.intro, values.sortOrder, context.userId],
    );
    const { prefix } = TERM_KINDS[term.kind];
    if (values.slug !== term.slug) {
      await recordMove(client, { fromPath: `${prefix}${term.slug}/`, toPath: `${prefix}${values.slug}/`, userId: context.userId, note: `${TERM_KINDS[term.kind].label} kreeg een ander adres` });
    }
    await context.audit(client);
    return { status: 'ok', moved: values.slug !== term.slug };
  });

  /**
   * Verwijdert een categorie of tag (de koppelingen gaan mee); het adres verwijst daarna naar het blog.
   * @param {(number|string)} id Id.
   * @param {{audit: Function}} context Audit.
   * @returns {Promise<{status: ('ok'|'weg')}>} Uitkomst.
   */
  const remove = (id, context) => db.transaction(async (client) => {
    if (!/^\d{1,9}$/.test(String(id))) return { status: 'weg' };
    const [term] = await client.query('DELETE FROM post_terms WHERE id = $1 RETURNING id', [Number(id)]);
    if (!term) return { status: 'weg' };
    await context.audit(client);
    return { status: 'ok' };
  });

  /**
   * De id's van de categorieën en tags van een bericht.
   * @param {number} postId Id van het bericht.
   * @returns {Promise<number[]>} Id's.
   */
  const termIdsOfPost = async (postId) => (await db.query('SELECT term_id FROM post_term_links WHERE post_id = $1', [postId])).map((row) => row.term_id);

  /**
   * Zet de categorieën en tags van een bericht en of het uitgelicht is (meteen op de site, geen concept). Onbekende
   * id's worden genegeerd; uitgelicht maakt een eventueel ander uitgelicht bericht gewoon en kan alleen bij een
   * gepubliceerd (of ingepland) bericht, anders toont de site stil niets.
   * @param {(number|string)} postId Id van het bericht.
   * @param {{termIds: string[], featured: boolean}} values Gekozen id's en uitgelicht.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit.
   * @returns {Promise<{status: ('ok'|'weg'|'fout'), message?: string}>} Uitkomst.
   */
  const setPostTerms = (postId, values, context) => db.transaction(async (client) => {
    if (!/^\d{1,9}$/.test(String(postId))) return { status: 'weg' };
    const ids = [...new Set(values.termIds)];
    if (ids.length > TERM_LIMITS.terms || !ids.every((id) => typeof id === 'string' && /^\d{1,9}$/.test(id))) return { status: 'fout', message: 'Kies categorieën en tags uit de lijst.' };
    // Uitlichten na elkaar: twee redacteuren die tegelijk een ander bericht uitlichten geven anders een deadlock.
    if (values.featured) await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['blog-uitgelicht']);
    const [post] = await client.query('SELECT id, published FROM posts WHERE id = $1 FOR UPDATE', [Number(postId)]);
    if (!post) return { status: 'weg' };
    if (values.featured && !post.published) return { status: 'fout', message: 'Alleen een gepubliceerd bericht kan uitgelicht worden. Zet het bericht eerst online.' };
    await client.query('DELETE FROM post_term_links WHERE post_id = $1', [post.id]);
    await client.query(
      'INSERT INTO post_term_links (post_id, term_id) SELECT $1, t.id FROM post_terms t WHERE t.id = ANY($2::int[])',
      [post.id, ids.map(Number)],
    );
    if (values.featured) await client.query('UPDATE posts SET featured = false WHERE featured AND id <> $1', [post.id]);
    await client.query('UPDATE posts SET featured = $2, updated_at = now(), updated_by = $3 WHERE id = $1', [post.id, Boolean(values.featured), context.userId]);
    await context.audit(client);
    return { status: 'ok' };
  });

  /**
   * Neemt de tags uit `site-content.json` over (naam, slug, foto, volgorde en berichten op slug), alleen als er nog geen
   * tags zijn, en het uitgelichte bericht als er nog geen is.
   * @param {{blogTags: object[], featuredPost: string}} fixed Inhoud uit `site-content.json`.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit.
   * @returns {Promise<{status: ('ok'|'bestaan-al'), tags?: number}>} Uitkomst en aantal overgenomen tags.
   */
  const importSiteTags = (fixed, context) => db.transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['blog-tags-overnemen']);
    const [{ count }] = await client.query("SELECT count(*)::int AS count FROM post_terms WHERE kind = 'tag'");
    if (count > 0) return { status: 'bestaan-al' };
    let added = 0;
    for (const [index, tag] of fixed.blogTags.slice(0, TERM_LIMITS.terms).entries()) {
      // Zelfde controle als `site-content.js` (slugs van de huidige site kunnen dubbele streepjes hebben).
      if (typeof tag.slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,119}$/.test(tag.slug)) continue;
      const [row] = await client.query(
        `INSERT INTO post_terms (kind, slug, name, image_url, sort_order, updated_by) VALUES ('tag', $1, $2, $3, $4, $5)
         ON CONFLICT (kind, slug) DO NOTHING RETURNING id`,
        [tag.slug, cleanText(tag.name, TERM_LIMITS.name) || tag.slug, tag.image || null, (index + 1) * 10, context.userId],
      );
      if (!row) continue;
      added += 1;
      await client.query(
        'INSERT INTO post_term_links (post_id, term_id) SELECT p.id, $1 FROM posts p WHERE p.slug = ANY($2::text[]) ON CONFLICT DO NOTHING',
        [row.id, (tag.posts || []).filter((slug) => typeof slug === 'string')],
      );
    }
    if (fixed.featuredPost) {
      await client.query(
        'UPDATE posts SET featured = true WHERE slug = $1 AND NOT EXISTS (SELECT 1 FROM posts other WHERE other.featured)',
        [fixed.featuredPost],
      );
    }
    await context.audit(client);
    return { status: 'ok', tags: added };
  });

  return { list, get, create, update, remove, termIdsOfPost, setPostTerms, importSiteTags };
}

module.exports = { createPostTerms, validateTermFields, TERM_KINDS, TERM_LIMITS };
