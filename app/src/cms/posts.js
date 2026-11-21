/**
 * Blogberichten in het CMS (pakket I1, migratie 19): lijst, één bericht met concept, het concept wijzigen (gegevens,
 * uitgelichte afbeelding, blokken uit `cms/blocks.js`), publiceren of inplannen (met versie), concept weggooien, een
 * versie terugzetten, een nieuw bericht, het adres (slug) wijzigen met een 301, offline/online en verwijderen.
 * Werkt zoals pagina's (`cms/pages.js`): het concept staat in `posts.draft`, de site toont alleen de gepubliceerde
 * kolommen, elke wijziging controleert `draft_version` en schrijft de audit in dezelfde transactie. Een bericht met een
 * publicatiedatum in de toekomst is *ingepland* en verschijnt pas dan (`VISIBLE_POST_SQL` in `site/content.js`).
 * Alle vragen met gebonden parameters.
 */
const { parse } = require('node-html-parser');
const { cleanText, lockMediaForUse } = require('../media/library');
const { BLOCK_TYPES, normalizeBlocks, publishedBlocks, mediaIdsOf, MAX_BLOCKS, MAX_TRIP_BLOCKS } = require('./blocks');
const { isValidSlug, recordMove } = require('../trips/slugs');
const { RESERVED_SEGMENTS } = require('./pages');
const { postSummary } = require('../site/format');

/** Maximale lengtes van de gegevens van een bericht. */
const POST_LIMITS = { title: 200, intro: 2000, excerpt: 400, seoTitle: 70, seoDescription: 300 };

/** Tijdzone van de publicatiedatum in het formulier. */
const TIME_ZONE = 'Europe/Amsterdam';

/** Een datum en tijd uit een `datetime-local`-veld (jjjj-mm-ddTuu:mm). */
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** Kolommen van een bericht (nooit `SELECT *`). */
const POST_COLUMNS = `p.id, p.slug, p.title, p.intro, p.excerpt, p.image_url, p.blocks, p.body_html, p.published, p.published_at,
  (p.published AND p.published_at > now()) AS scheduled, p.draft, p.draft_version, p.managed_in_crm, p.created_at, p.updated_at,
  p.legacy_id, p.seo_title, p.seo_description, p.featured`;

/**
 * Of een tekst een geldige datum en tijd uit het formulier is (bestaande dag, jaar 2000–2099).
 * @param {string} value Waarde (jjjj-mm-ddTuu:mm).
 * @returns {boolean} Geldig.
 */
function isLocalDateTime(value) {
  const match = LOCAL_DATE_TIME.exec(String(value));
  if (!match) return false;
  const [, year, month, day, hour, minute] = match.map(Number);
  if (year < 2000 || year > 2099 || hour > 23 || minute > 59) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Een tijdstip als datum en tijd in Nederland voor een `datetime-local`-veld.
 * @param {(Date|string|null)} value Tijdstip.
 * @returns {string} jjjj-mm-ddTuu:mm, of leeg.
 */
function toLocalDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('sv-SE', { timeZone: TIME_ZONE, hourCycle: 'h23' }).slice(0, 16).replace(' ', 'T');
}

/**
 * Het tijdstip van een datum en tijd in Nederland uit een `datetime-local`-veld (rekening houdend met zomertijd).
 * @param {string} value jjjj-mm-ddTuu:mm.
 * @returns {(Date|null)} Tijdstip, of null als de waarde ongeldig is.
 */
function fromLocalDateTime(value) {
  if (!isLocalDateTime(value)) return null;
  const asUtc = (text) => {
    const [, year, month, day, hour, minute] = LOCAL_DATE_TIME.exec(text).map(Number);
    return Date.UTC(year, month - 1, day, hour, minute);
  };
  const wanted = asUtc(value);
  let time = wanted;
  // Twee stappen: eerst het verschil met de Nederlandse tijd, dan nog eens rond de wissel van zomer- naar wintertijd.
  for (let step = 0; step < 2; step += 1) time -= asUtc(toLocalDateTime(new Date(time))) - wanted;
  return new Date(time);
}

/**
 * Leest en controleert de gegevens van een bericht uit een formulier.
 * @param {object} body Ingezonden velden.
 * @returns {{values: {title: string, intro: string, excerpt: string, seoTitle: string, seoDescription: string, postDate: string}, errors: object}}
 *   Waarden en fouten.
 */
function validatePostFields(body) {
  const text = (name) => (typeof body[name] === 'string' ? body[name] : '');
  const errors = {};
  const limited = (name, key, value) => {
    if (value.length > POST_LIMITS[key]) errors[name] = `Maximaal ${POST_LIMITS[key]} tekens.`;
    return value.slice(0, POST_LIMITS[key]);
  };
  const title = cleanText(text('title'), POST_LIMITS.title + 1);
  if (!title) errors.title = 'Vul een titel in.';
  // eslint-disable-next-line no-control-regex
  const intro = text('intro').replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim();
  const postDate = text('post_date').trim();
  if (postDate && !isLocalDateTime(postDate)) errors.post_date = 'Vul een geldige datum en tijd in.';
  return {
    values: {
      title: limited('title', 'title', title),
      intro: limited('intro', 'intro', intro),
      excerpt: limited('excerpt', 'excerpt', cleanText(text('excerpt'), POST_LIMITS.excerpt + 1)),
      seoTitle: limited('seo_title', 'seoTitle', cleanText(text('seo_title'), POST_LIMITS.seoTitle + 1)),
      seoDescription: limited('seo_description', 'seoDescription', cleanText(text('seo_description'), POST_LIMITS.seoDescription + 1)),
      postDate: errors.post_date ? '' : postDate,
    },
    errors,
  };
}

/**
 * De platte tekst van blokken (opgemaakte tekst en tekstvakken), voor de automatische samenvatting.
 * @param {object[]} blocks Blokken.
 * @returns {string} Tekst.
 */
function blocksText(blocks) {
  const parts = [];
  for (const block of normalizeBlocks(blocks)) {
    for (const field of BLOCK_TYPES[block.type].fields) {
      const value = block.data[field.name];
      if (typeof value !== 'string' || !value) continue;
      if (field.kind === 'richtext') parts.push(parse(value.replace(/<a [^>]*>Bekijk de video<\/a>/g, ''), { comment: false }).text);
      else if (field.kind === 'textarea') parts.push(value);
    }
    if (parts.join(' ').length > 2000) break;
  }
  return parts.join(' ');
}

/**
 * De stand die je bewerkt: het concept als dat er is, anders het gepubliceerde bericht.
 * @param {object} post Rij uit de database.
 * @returns {{title: string, intro: string, excerpt: string, imageUrl: (string|null), imageMediaId: (number|null), blocks: object[], seoTitle: string, seoDescription: string, postDate: string}} Stand.
 */
function editablePostState(post) {
  const draft = post.draft && typeof post.draft === 'object' ? post.draft : null;
  const source = draft || {
    title: post.title, intro: post.intro, excerpt: post.excerpt, imageUrl: post.image_url, imageMediaId: null, blocks: publishedBlocks(post),
    seoTitle: post.seo_title, seoDescription: post.seo_description, postDate: toLocalDateTime(post.published_at),
  };
  const string = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
  return {
    title: typeof source.title === 'string' && source.title ? source.title.slice(0, POST_LIMITS.title) : post.title,
    intro: string(source.intro, POST_LIMITS.intro),
    excerpt: string(source.excerpt, POST_LIMITS.excerpt),
    imageUrl: typeof source.imageUrl === 'string' && /^(\/media\/[A-Za-z0-9._-]+|https:\/\/[^\s"]+)$/.test(source.imageUrl) ? source.imageUrl : null,
    imageMediaId: Number.isInteger(source.imageMediaId) ? source.imageMediaId : null,
    blocks: normalizeBlocks(source.blocks),
    seoTitle: string(source.seoTitle, POST_LIMITS.seoTitle),
    seoDescription: string(source.seoDescription, POST_LIMITS.seoDescription),
    postDate: typeof source.postDate === 'string' && isLocalDateTime(source.postDate) ? source.postDate : '',
  };
}

/**
 * De status van een bericht voor de lijst en het bewerkscherm.
 * @param {{published: boolean, scheduled: boolean}} post Rij met `published` en `scheduled`.
 * @returns {('online'|'ingepland'|'offline')} Status.
 */
function postStatus(post) {
  if (!post.published) return 'offline';
  return post.scheduled ? 'ingepland' : 'online';
}

/**
 * Maakt de functies voor blogberichten.
 * @param {{db: object}} options Database.
 * @returns {object} Functies.
 */
function createPosts(options) {
  const { db } = options;

  /**
   * Alle berichten (nieuwste eerst), met of er een concept openstaat en het aantal versies; optioneel gefilterd op
   * titel of slug en op status.
   * @param {{patterns?: string[], status?: string}} [filter] Zoekpatronen (ILIKE, ge-escaped) en status.
   * @returns {Promise<object[]>} Berichten (hoogstens 500).
   */
  const list = (filter = {}) => db.query(
    `SELECT p.id, p.slug, p.title, p.published, p.published_at, (p.published AND p.published_at > now()) AS scheduled,
            (p.draft IS NOT NULL) AS has_draft, p.updated_at,
            (SELECT count(*)::int FROM post_revisions r WHERE r.post_id = p.id) AS revision_count
       FROM posts p
      WHERE (cardinality($1::text[]) = 0 OR p.title ILIKE ALL($1::text[]) OR p.slug ILIKE ALL($1::text[]))
        AND CASE $2::text
              WHEN 'online' THEN p.published AND (p.published_at IS NULL OR p.published_at <= now())
              WHEN 'ingepland' THEN p.published AND p.published_at > now()
              WHEN 'offline' THEN NOT p.published
              WHEN 'concept' THEN p.draft IS NOT NULL
              ELSE true END
      ORDER BY p.published_at DESC NULLS FIRST, p.id DESC
      LIMIT 500`,
    [filter.patterns || [], filter.status || ''],
  );

  /**
   * Eén bericht met de naam van wie het het laatst wijzigde.
   * @param {(number|string)} id Id.
   * @returns {Promise<(object|null)>} Bericht of null.
   */
  const get = async (id) => {
    if (!/^\d{1,9}$/.test(String(id))) return null;
    const [row] = await db.query(
      `SELECT ${POST_COLUMNS}, u.name AS updated_by_name FROM posts p LEFT JOIN users u ON u.id = p.updated_by WHERE p.id = $1`,
      [Number(id)],
    );
    return row || null;
  };

  /**
   * De versies van een bericht, nieuwste eerst.
   * @param {number} id Id van het bericht.
   * @returns {Promise<object[]>} Versies (versie, notitie, moment, door wie).
   */
  const revisions = (id) => db.query(
    `SELECT r.version, r.note, r.published_at, u.name AS published_by_name
       FROM post_revisions r LEFT JOIN users u ON u.id = r.published_by
      WHERE r.post_id = $1 ORDER BY r.version DESC LIMIT 100`,
    [Number(id)],
  );

  /**
   * Wijzigt het concept in één transactie: vergrendelt het bericht, controleert de versie van het concept, laat
   * `change` de stand aanpassen en slaat die op (met audit).
   * @param {(number|string)} id Id van het bericht.
   * @param {(number|string)} version De versie van het concept waar het formulier van uitging.
   * @param {(state: object, client: object) => Promise<(object|undefined)>} change Past de stand aan; geeft eventueel
   *   `{errors}` of `{status}` terug om niet op te slaan.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit (`(client) => Promise`).
   * @returns {Promise<{status: string, version?: number, errors?: object}>} `ok`, `weg`, `verouderd` of wat `change` teruggaf.
   */
  const changeDraft = (id, version, change, context) => db.transaction(async (client) => {
    if (!/^\d{1,9}$/.test(String(id))) return { status: 'weg' };
    const [post] = await client.query(`SELECT ${POST_COLUMNS} FROM posts p WHERE p.id = $1 FOR UPDATE`, [Number(id)]);
    if (!post) return { status: 'weg' };
    if (String(post.draft_version) !== String(version)) return { status: 'verouderd' };
    const state = editablePostState(post);
    const outcome = await change(state, client);
    if (outcome && (outcome.errors || outcome.status)) return { status: 'fout', ...outcome };
    if (state.blocks.length > MAX_BLOCKS) return { status: 'fout', message: `Een bericht heeft hoogstens ${MAX_BLOCKS} blokken.` };
    if (state.blocks.some((block) => BLOCK_TYPES[block.type].homeOnly)) return { status: 'fout', message: 'Homepage-secties kunnen niet in een bericht.' };
    if (state.blocks.filter((block) => block.type === 'reizen').length > MAX_TRIP_BLOCKS) {
      return { status: 'fout', message: `Een bericht heeft hoogstens ${MAX_TRIP_BLOCKS} blokken met reizen.` };
    }
    const [saved] = await client.query(
      `UPDATE posts SET draft = $2, draft_version = draft_version + 1, updated_at = now(), updated_by = $3
        WHERE id = $1 RETURNING draft_version`,
      [post.id, JSON.stringify(state), context.userId],
    );
    await context.audit(client);
    return { status: 'ok', version: saved.draft_version };
  });

  /**
   * Publiceert het concept: controleert en vergrendelt de gebruikte foto's (een verdwenen foto weigert), schrijft de
   * gepubliceerde kolommen en een nieuwe versie, zet het bericht online en maakt het concept leeg. De publicatiedatum
   * is die uit het concept, anders de bestaande, anders nu; ligt hij in de toekomst, dan is het bericht ingepland. Een
   * lege samenvatting wordt het begin van de tekst. De eerste publicatie van een geïmporteerd bericht bewaart eerst de
   * stand van de import als versie 1.
   * @param {(number|string)} id Id.
   * @param {(number|string)} version Versie van het concept.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit.
   * @returns {Promise<{status: ('ok'|'weg'|'verouderd'|'geen-concept'|'foto-weg'), version?: number, scheduled?: boolean}>} Uitkomst.
   */
  const publish = (id, version, context) => db.transaction(async (client) => {
    if (!/^\d{1,9}$/.test(String(id))) return { status: 'weg' };
    const [post] = await client.query(`SELECT ${POST_COLUMNS} FROM posts p WHERE p.id = $1 FOR UPDATE`, [Number(id)]);
    if (!post) return { status: 'weg' };
    if (String(post.draft_version) !== String(version)) return { status: 'verouderd' };
    if (!post.draft) return { status: 'geen-concept' };
    const state = editablePostState(post);
    const mediaIds = mediaIdsOf(state.blocks);
    if (state.imageMediaId) mediaIds.push(state.imageMediaId);
    for (const mediaId of mediaIds) {
      if (!(await lockMediaForUse(client, mediaId))) return { status: 'foto-weg' };
    }
    const [{ latest }] = await client.query('SELECT coalesce(max(version), 0)::int AS latest FROM post_revisions WHERE post_id = $1', [post.id]);
    let next = latest + 1;
    if (latest === 0 && (post.published || post.legacy_id !== null)) {
      await client.query(
        `INSERT INTO post_revisions (post_id, version, title, intro, excerpt, image_url, blocks, seo_title, seo_description, post_date, note, published_by)
         VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL)`,
        [post.id, post.title, post.intro, post.excerpt, post.image_url, JSON.stringify(publishedBlocks(post)), post.seo_title, post.seo_description,
          post.published_at, post.managed_in_crm ? 'Stand vóór de eerste versie' : 'Stand uit de import'],
      );
      next = 2;
    }
    // postSummary leest HTML; de platte tekst daarom eerst escapen, zodat een < in de tekst geen tag wordt.
    const plain = blocksText(state.blocks).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const excerpt = state.excerpt || postSummary(plain).slice(0, POST_LIMITS.excerpt);
    const blocks = JSON.stringify(state.blocks);
    // De datum uit het formulier is een tijd in Nederland (op de minuut); zonder datum, of dezelfde minuut als nu
    // gepubliceerd, blijft het bestaande tijdstip exact staan (seconden en het dubbele uur bij de wintertijd); anders nu.
    const changedDate = state.postDate && state.postDate !== toLocalDateTime(post.published_at) ? state.postDate : null;
    const [{ post_date: postDate }] = await client.query(
      "SELECT coalesce(($1::text)::timestamp AT TIME ZONE 'Europe/Amsterdam', $2::timestamptz, now()) AS post_date",
      [changedDate, post.published_at],
    );
    await client.query(
      `INSERT INTO post_revisions (post_id, version, title, intro, excerpt, image_url, blocks, seo_title, seo_description, post_date, published_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [post.id, next, state.title, state.intro, state.excerpt, state.imageUrl, blocks, state.seoTitle, state.seoDescription, postDate, context.userId],
    );
    const [saved] = await client.query(
      `UPDATE posts SET title = $2, intro = $3, excerpt = $4, image_url = $5, blocks = $6, seo_title = $7, seo_description = $8,
              published_at = $9, draft = NULL, draft_version = draft_version + 1, managed_in_crm = true, published = true,
              updated_at = now(), updated_by = $10
        WHERE id = $1 RETURNING published_at > now() AS scheduled`,
      [post.id, state.title, state.intro, excerpt, state.imageUrl, blocks, state.seoTitle, state.seoDescription, postDate, context.userId],
    );
    await context.audit(client);
    return { status: 'ok', version: next, scheduled: saved.scheduled };
  });

  /**
   * Gooit het concept weg (het gepubliceerde bericht blijft).
   * @param {(number|string)} id Id.
   * @param {(number|string)} version Versie van het concept.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit.
   * @returns {Promise<{status: ('ok'|'weg'|'verouderd'|'geen-concept')}>} Uitkomst.
   */
  const discardDraft = (id, version, context) => db.transaction(async (client) => {
    if (!/^\d{1,9}$/.test(String(id))) return { status: 'weg' };
    const [post] = await client.query('SELECT id, draft IS NOT NULL AS has_draft, draft_version FROM posts WHERE id = $1 FOR UPDATE', [Number(id)]);
    if (!post) return { status: 'weg' };
    if (String(post.draft_version) !== String(version)) return { status: 'verouderd' };
    if (!post.has_draft) return { status: 'geen-concept' };
    await client.query('UPDATE posts SET draft = NULL, draft_version = draft_version + 1, updated_at = now(), updated_by = $2 WHERE id = $1', [post.id, context.userId]);
    await context.audit(client);
    return { status: 'ok' };
  });

  /**
   * Zet een eerdere versie terug als concept (publiceren blijft een aparte stap).
   * @param {(number|string)} id Id van het bericht.
   * @param {(number|string)} revision Nummer van de versie.
   * @param {(number|string)} version Versie van het concept.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit.
   * @returns {Promise<{status: string}>} `ok`, `weg`, `versie-weg`, `verouderd`.
   */
  const restoreRevision = (id, revision, version, context) => changeDraft(id, version, async (state, client) => {
    if (!/^\d{1,9}$/.test(String(revision))) return { status: 'versie-weg' };
    const [row] = await client.query(
      `SELECT title, intro, excerpt, image_url, blocks, seo_title, seo_description, post_date
         FROM post_revisions WHERE post_id = $1 AND version = $2`,
      [Number(id), Number(revision)],
    );
    if (!row) return { status: 'versie-weg' };
    const [media] = row.image_url ? await client.query(
      `SELECT m.id FROM media m
        WHERE m.content_type LIKE 'image/%'
          AND ('/media/' || m.local_name = $1 OR EXISTS (SELECT 1 FROM jsonb_each_text(m.variants) AS variant WHERE '/media/' || variant.value = $1))
        ORDER BY m.id LIMIT 1`,
      [row.image_url],
    ) : [];
    Object.assign(state, editablePostState({
      title: row.title,
      draft: {
        title: row.title, intro: row.intro, excerpt: row.excerpt, imageUrl: row.image_url, imageMediaId: media ? media.id : null, blocks: row.blocks,
        seoTitle: row.seo_title, seoDescription: row.seo_description, postDate: toLocalDateTime(row.post_date),
      },
    }));
    return undefined;
  }, context);

  /**
   * Of een slug vrij is voor een bericht: geen gereserveerd adres, geen pagina op `/<slug>/` (een pagina gaat op de
   * site voor), geen ander bericht en (bij een nieuw bericht) geen doorverwijzing vanaf dat adres.
   * @param {object} client Transactie-client.
   * @param {string} slug Slug.
   * @param {(number|null)} selfId Id van het bericht zelf (bij wijzigen).
   * @param {boolean} checkRedirect Ook een doorverwijzing weigeren.
   * @returns {Promise<(string|null)>} Foutmelding, of null als hij vrij is.
   */
  const slugTaken = async (client, slug, selfId, checkRedirect) => {
    if (!isValidSlug(slug)) return 'Gebruik kleine letters, cijfers en streepjes (bijv. mijn-reisverslag).';
    if (RESERVED_SEGMENTS.has(slug)) return `Het adres /${slug}/ gebruikt de site zelf; kies een ander adres.`;
    const path = `/${slug}/`;
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pagina:${path}`]);
    const [page] = await client.query('SELECT id FROM pages WHERE path = $1', [path]);
    if (page) return 'Op dit adres staat een pagina; kies een ander adres.';
    const [post] = await client.query('SELECT id FROM posts WHERE slug = $1', [slug]);
    if (post && post.id !== selfId) return 'Er is al een bericht met dit adres.';
    if (checkRedirect) {
      const [redirect] = await client.query('SELECT id FROM redirects WHERE from_path = $1', [path]);
      if (redirect) return 'Dit adres verwijst door naar een andere pagina (Beheer > Doorverwijzingen); kies een ander adres.';
    }
    return null;
  };

  /**
   * Maakt een nieuw bericht: offline met een concept met alleen de titel, tot de eerste publicatie.
   * @param {{title: string, slug: string}} values Titel en slug.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit (`(client, id) => Promise`).
   * @returns {Promise<{id?: number, errors?: object}>} Nieuw id of fouten.
   */
  const create = (values, context) => db.transaction(async (client) => {
    const title = cleanText(values.title || '', POST_LIMITS.title + 1);
    const errors = {};
    if (!title) errors.title = 'Vul een titel in.';
    else if (title.length > POST_LIMITS.title) errors.title = `Maximaal ${POST_LIMITS.title} tekens.`;
    const taken = await slugTaken(client, values.slug, null, true);
    if (taken) errors.slug = taken;
    if (Object.keys(errors).length) return { errors };
    const draft = { title, intro: '', excerpt: '', imageUrl: null, imageMediaId: null, blocks: [], seoTitle: '', seoDescription: '', postDate: '' };
    const [row] = await client.query(
      `INSERT INTO posts (slug, title, published, published_at, draft, managed_in_crm, updated_by)
       VALUES ($1, $2, false, NULL, $3, true, $4) RETURNING id`,
      [values.slug, title, JSON.stringify(draft), context.userId],
    );
    await context.audit(client, row.id);
    return { id: row.id };
  });

  /**
   * Wijzigt het adres van een bericht. Het oude adres krijgt een 301 naar het nieuwe (`recordMove`) en menu-items die
   * naar het oude adres wezen gaan mee. Daarna `redirects.reload()` en `menus.reload()`.
   * @param {(number|string)} id Id.
   * @param {string} slug Nieuwe slug.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit.
   * @returns {Promise<{status: ('ok'|'weg'|'fout'|'gelijk'), errors?: object}>} Uitkomst.
   */
  const changeSlug = (id, slug, context) => db.transaction(async (client) => {
    if (!/^\d{1,9}$/.test(String(id))) return { status: 'weg' };
    const [post] = await client.query('SELECT id, slug FROM posts WHERE id = $1 FOR UPDATE', [Number(id)]);
    if (!post) return { status: 'weg' };
    if (post.slug === slug) return { status: 'gelijk' };
    const taken = await slugTaken(client, slug, post.id, false);
    if (taken) return { status: 'fout', errors: { slug: taken } };
    const fromPath = `/${post.slug}/`;
    const toPath = `/${slug}/`;
    await client.query('UPDATE posts SET slug = $2, managed_in_crm = true, updated_at = now(), updated_by = $3 WHERE id = $1', [post.id, slug, context.userId]);
    await recordMove(client, { fromPath, toPath, userId: context.userId, note: 'Blogbericht kreeg een ander adres' });
    await client.query(
      `UPDATE menu_items SET href = $2 || substr(href, length($1) + 1), updated_at = now()
        WHERE href = $1 OR left(href, length($1) + 1) IN ($1 || '#', $1 || '?')`,
      [fromPath, toPath],
    );
    await client.query(
      `UPDATE menu_items SET href = $2 || substr(href, length(rtrim($1, '/')) + 1), updated_at = now()
        WHERE href = rtrim($1, '/') OR left(href, length(rtrim($1, '/')) + 1) IN (rtrim($1, '/') || '#', rtrim($1, '/') || '?')`,
      [fromPath, toPath],
    );
    await context.audit(client);
    return { status: 'ok' };
  });

  /**
   * Zet een bericht offline of weer online. Online kan alleen als het eerder gepubliceerd is of uit de import komt (een
   * nieuw bericht gaat online met *Publiceren*).
   * @param {(number|string)} id Id.
   * @param {boolean} online Gewenste stand.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit.
   * @returns {Promise<{status: ('ok'|'weg'|'nooit-gepubliceerd')}>} Uitkomst.
   */
  const setOnline = (id, online, context) => db.transaction(async (client) => {
    if (!/^\d{1,9}$/.test(String(id))) return { status: 'weg' };
    const [post] = await client.query(
      `SELECT p.id, p.legacy_id, EXISTS (SELECT 1 FROM post_revisions r WHERE r.post_id = p.id) AS has_revisions
         FROM posts p WHERE p.id = $1 FOR UPDATE`,
      [Number(id)],
    );
    if (!post) return { status: 'weg' };
    if (online && !post.has_revisions && post.legacy_id === null) return { status: 'nooit-gepubliceerd' };
    // Offline is ook niet meer uitgelicht: anders blijft het vinkje aan terwijl de site stil niets uitlicht.
    await client.query('UPDATE posts SET published = $2, featured = featured AND $2, updated_at = now(), updated_by = $3 WHERE id = $1', [post.id, online, context.userId]);
    await context.audit(client);
    return { status: 'ok' };
  });

  /**
   * Verwijdert een bericht dat offline staat en niet uit de import komt (dat zou bij een nieuwe import terugkomen; zet
   * het offline) en niet in een menu staat. Versies gaan mee, doorverwijzingen naar het bericht vervallen (ON DELETE CASCADE).
   * @param {(number|string)} id Id.
   * @param {{audit: Function}} context Audit.
   * @returns {Promise<{status: ('ok'|'weg'|'online'|'import'|'in-menu')}>} Uitkomst (`in-menu`: een menu-item wijst nog
   *   naar het bericht).
   */
  const remove = (id, context) => db.transaction(async (client) => {
    if (!/^\d{1,9}$/.test(String(id))) return { status: 'weg' };
    const [post] = await client.query('SELECT id, slug, published, legacy_id FROM posts WHERE id = $1 FOR UPDATE', [Number(id)]);
    if (!post) return { status: 'weg' };
    if (post.published) return { status: 'online' };
    if (post.legacy_id !== null) return { status: 'import' };
    const [menuItem] = await client.query(
      `SELECT id FROM menu_items
        WHERE href = $1 OR href = rtrim($1, '/')
           OR left(href, length($1) + 1) IN ($1 || '#', $1 || '?')
           OR left(href, length(rtrim($1, '/')) + 1) IN (rtrim($1, '/') || '#', rtrim($1, '/') || '?')
        LIMIT 1`,
      [`/${post.slug}/`],
    );
    if (menuItem) return { status: 'in-menu' };
    await client.query('DELETE FROM posts WHERE id = $1', [post.id]);
    // Doorverwijzingen naar het verwijderde adres (van eerdere adreswijzigingen) zouden op een 404 uitkomen.
    await client.query('DELETE FROM redirects WHERE to_url = $1', [`/${post.slug}/`]);
    await context.audit(client);
    return { status: 'ok' };
  });

  return { list, get, revisions, changeDraft, publish, discardDraft, restoreRevision, create, changeSlug, setOnline, remove };
}

module.exports = { createPosts, validatePostFields, editablePostState, postStatus, blocksText, isLocalDateTime, toLocalDateTime, fromLocalDateTime, POST_LIMITS };
