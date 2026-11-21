/**
 * Pagina's van de website in het CMS (pakket H1, migratie 17): lijst, één pagina met concept, het concept wijzigen
 * (gegevens, kopfoto, blokken toevoegen/wijzigen/verplaatsen/verwijderen), publiceren (met versie), concept weggooien
 * en een versie terugzetten als concept. Het concept staat in `pages.draft`; de site toont alleen de gepubliceerde
 * kolommen. Elke wijziging controleert `draft_version` (twee tabbladen overschrijven elkaar niet) en schrijft de audit
 * in dezelfde transactie. Alle vragen met gebonden parameters.
 */
const { cleanText, lockMediaForUse, mediaUrl } = require('../media/library');
const { normalizeBlocks, normalizeImage, publishedBlocks, mediaIdsOf, MAX_BLOCKS, MAX_TRIP_BLOCKS } = require('./blocks');

/** Maximale lengtes van de gegevens van een pagina. */
const PAGE_LIMITS = { title: 200, pretitle: 200, intro: 2000 };

/** Breedte van de foto die in een afbeeldingsblok en als kopfoto wordt opgeslagen. */
const IMAGE_WIDTH = 1600;

/** Kolommen van een pagina (nooit `SELECT *`). */
const PAGE_COLUMNS = `p.id, p.path, p.title, p.pretitle, p.intro, p.image_url, p.blocks, p.body_html, p.published, p.draft, p.draft_version,
  p.managed_in_crm, p.created_at, p.updated_at, p.legacy_id`;

/**
 * Leest en controleert de gegevens van een pagina (titel, bovenkop, inleiding) uit een formulier.
 * @param {object} body Ingezonden velden.
 * @returns {{values: {title: string, pretitle: string, intro: string}, errors: object}} Waarden en fouten.
 */
function validatePageFields(body) {
  const text = (name) => (typeof body[name] === 'string' ? body[name] : '');
  const errors = {};
  const title = cleanText(text('title'), PAGE_LIMITS.title + 1);
  if (!title) errors.title = 'Vul een titel in.';
  else if (title.length > PAGE_LIMITS.title) errors.title = `Maximaal ${PAGE_LIMITS.title} tekens.`;
  const pretitle = cleanText(text('pretitle'), PAGE_LIMITS.pretitle + 1);
  if (pretitle.length > PAGE_LIMITS.pretitle) errors.pretitle = `Maximaal ${PAGE_LIMITS.pretitle} tekens.`;
  // eslint-disable-next-line no-control-regex
  const intro = text('intro').replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim();
  if (intro.length > PAGE_LIMITS.intro) errors.intro = `Maximaal ${PAGE_LIMITS.intro} tekens.`;
  return { values: { title: title.slice(0, PAGE_LIMITS.title), pretitle: pretitle.slice(0, PAGE_LIMITS.pretitle), intro: intro.slice(0, PAGE_LIMITS.intro) }, errors };
}

/**
 * De stand die je bewerkt: het concept als dat er is, anders de gepubliceerde pagina.
 * @param {object} page Rij uit de database.
 * @returns {{title: string, pretitle: string, intro: string, imageUrl: (string|null), imageMediaId: (number|null), blocks: object[]}} Stand.
 */
function editableState(page) {
  const draft = page.draft && typeof page.draft === 'object' ? page.draft : null;
  const source = draft || { title: page.title, pretitle: page.pretitle, intro: page.intro, imageUrl: page.image_url, imageMediaId: null, blocks: publishedBlocks(page) };
  return {
    title: typeof source.title === 'string' ? source.title : page.title,
    pretitle: typeof source.pretitle === 'string' ? source.pretitle : '',
    intro: typeof source.intro === 'string' ? source.intro : '',
    imageUrl: typeof source.imageUrl === 'string' && /^(\/media\/[A-Za-z0-9._-]+|https:\/\/[^\s"]+)$/.test(source.imageUrl) ? source.imageUrl : null,
    imageMediaId: Number.isInteger(source.imageMediaId) ? source.imageMediaId : null,
    blocks: normalizeBlocks(source.blocks),
  };
}

/**
 * Een foto uit de bibliotheek als waarde van een blok of kopfoto.
 * @param {object} media Rij uit `lockMediaForUse`.
 * @returns {{mediaId: number, url: string, alt: string, width: null, height: null}} Foto.
 */
function imageFromMedia(media) {
  return normalizeImage({ mediaId: media.id, url: mediaUrl(media, IMAGE_WIDTH), alt: media.alt_text || '' });
}

/**
 * Maakt de functies voor pagina's.
 * @param {{db: object}} options Database.
 * @returns {object} Functies.
 */
function createPages(options) {
  const { db } = options;

  /**
   * Alle pagina's, met of er een concept openstaat en het aantal versies. Optioneel gefilterd op titel of pad.
   * @param {{patterns?: string[]}} [filter] Zoekpatronen (ILIKE, ge-escaped).
   * @returns {Promise<object[]>} Pagina's op pad.
   */
  const list = (filter = {}) => db.query(
    `SELECT p.id, p.path, p.title, p.published, (p.draft IS NOT NULL) AS has_draft, p.managed_in_crm, p.updated_at,
            (SELECT count(*)::int FROM page_revisions r WHERE r.page_id = p.id) AS revision_count
       FROM pages p
      WHERE cardinality($1::text[]) = 0 OR p.title ILIKE ALL($1::text[]) OR p.path ILIKE ALL($1::text[])
      ORDER BY p.path`,
    [filter.patterns || []],
  );

  /**
   * Eén pagina met de naam van wie hem het laatst wijzigde.
   * @param {(number|string)} id Id.
   * @returns {Promise<(object|null)>} Pagina of null.
   */
  const get = async (id) => {
    if (!/^\d{1,9}$/.test(String(id))) return null;
    const [row] = await db.query(
      `SELECT ${PAGE_COLUMNS}, u.name AS updated_by_name FROM pages p LEFT JOIN users u ON u.id = p.updated_by WHERE p.id = $1`,
      [Number(id)],
    );
    return row || null;
  };

  /**
   * De versies van een pagina, nieuwste eerst.
   * @param {number} id Id van de pagina.
   * @returns {Promise<object[]>} Versies (versie, notitie, moment, door wie).
   */
  const revisions = (id) => db.query(
    `SELECT r.version, r.note, r.published_at, u.name AS published_by_name
       FROM page_revisions r LEFT JOIN users u ON u.id = r.published_by
      WHERE r.page_id = $1 ORDER BY r.version DESC LIMIT 100`,
    [Number(id)],
  );

  /**
   * Wijzigt het concept in één transactie: vergrendelt de pagina, controleert de versie van het concept, laat `change`
   * de stand aanpassen en slaat die op (met audit).
   * @param {(number|string)} id Id van de pagina.
   * @param {(number|string)} version De versie van het concept waar het formulier van uitging.
   * @param {(state: object, client: object) => Promise<(object|undefined)>} change Past de stand aan; geeft eventueel
   *   `{errors}` of `{status}` terug om niet op te slaan.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit (`(client) => Promise`).
   * @returns {Promise<{status: string, version?: number, errors?: object}>} `ok`, `weg`, `verouderd` of wat `change` teruggaf.
   */
  const changeDraft = (id, version, change, context) => db.transaction(async (client) => {
    if (!/^\d{1,9}$/.test(String(id))) return { status: 'weg' };
    const [page] = await client.query(`SELECT ${PAGE_COLUMNS} FROM pages p WHERE p.id = $1 FOR UPDATE`, [Number(id)]);
    if (!page) return { status: 'weg' };
    if (String(page.draft_version) !== String(version)) return { status: 'verouderd' };
    const state = editableState(page);
    const outcome = await change(state, client);
    if (outcome && (outcome.errors || outcome.status)) return { status: 'fout', ...outcome };
    if (state.blocks.length > MAX_BLOCKS) return { status: 'fout', message: `Een pagina heeft hoogstens ${MAX_BLOCKS} blokken.` };
    if (state.blocks.filter((block) => block.type === 'reizen').length > MAX_TRIP_BLOCKS) {
      return { status: 'fout', message: `Een pagina heeft hoogstens ${MAX_TRIP_BLOCKS} blokken met reizen.` };
    }
    const [saved] = await client.query(
      `UPDATE pages SET draft = $2, draft_version = draft_version + 1, updated_at = now(), updated_by = $3
        WHERE id = $1 RETURNING draft_version`,
      [page.id, JSON.stringify(state), context.userId],
    );
    await context.audit(client);
    return { status: 'ok', version: saved.draft_version };
  });

  /**
   * Publiceert het concept: controleert en vergrendelt de gebruikte foto's (een verdwenen foto weigert), schrijft de
   * gepubliceerde kolommen en een nieuwe versie, en maakt het concept leeg. De eerste publicatie van een geïmporteerde
   * pagina bewaart eerst de stand van de import als versie 1.
   * @param {(number|string)} id Id.
   * @param {(number|string)} version Versie van het concept.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit.
   * @returns {Promise<{status: ('ok'|'weg'|'verouderd'|'geen-concept'|'foto-weg'), version?: number}>} Uitkomst.
   */
  const publish = (id, version, context) => db.transaction(async (client) => {
    if (!/^\d{1,9}$/.test(String(id))) return { status: 'weg' };
    const [page] = await client.query(`SELECT ${PAGE_COLUMNS} FROM pages p WHERE p.id = $1 FOR UPDATE`, [Number(id)]);
    if (!page) return { status: 'weg' };
    if (String(page.draft_version) !== String(version)) return { status: 'verouderd' };
    if (!page.draft) return { status: 'geen-concept' };
    const state = editableState(page);
    const mediaIds = mediaIdsOf(state.blocks);
    if (state.imageMediaId) mediaIds.push(state.imageMediaId);
    for (const mediaId of mediaIds) {
      if (!(await lockMediaForUse(client, mediaId))) return { status: 'foto-weg' };
    }
    const [{ latest }] = await client.query('SELECT coalesce(max(version), 0)::int AS latest FROM page_revisions WHERE page_id = $1', [page.id]);
    let next = latest + 1;
    if (latest === 0) {
      await client.query(
        `INSERT INTO page_revisions (page_id, version, title, pretitle, intro, image_url, blocks, note, published_by)
         VALUES ($1, 1, $2, $3, $4, $5, $6, $7, NULL)`,
        [page.id, page.title, page.pretitle, page.intro, page.image_url, JSON.stringify(publishedBlocks(page)), page.managed_in_crm ? 'Stand vóór de eerste versie' : 'Stand uit de import'],
      );
      next = 2;
    }
    const blocks = JSON.stringify(state.blocks);
    await client.query(
      `INSERT INTO page_revisions (page_id, version, title, pretitle, intro, image_url, blocks, published_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [page.id, next, state.title, state.pretitle, state.intro, state.imageUrl, blocks, context.userId],
    );
    await client.query(
      `UPDATE pages SET title = $2, pretitle = $3, intro = $4, image_url = $5, blocks = $6, draft = NULL,
              draft_version = draft_version + 1, managed_in_crm = true, updated_at = now(), updated_by = $7
        WHERE id = $1`,
      [page.id, state.title, state.pretitle, state.intro, state.imageUrl, blocks, context.userId],
    );
    await context.audit(client);
    return { status: 'ok', version: next };
  });

  /**
   * Gooit het concept weg (de gepubliceerde pagina blijft).
   * @param {(number|string)} id Id.
   * @param {(number|string)} version Versie van het concept.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit.
   * @returns {Promise<{status: ('ok'|'weg'|'verouderd'|'geen-concept')}>} Uitkomst.
   */
  const discardDraft = (id, version, context) => db.transaction(async (client) => {
    if (!/^\d{1,9}$/.test(String(id))) return { status: 'weg' };
    const [page] = await client.query('SELECT id, draft IS NOT NULL AS has_draft, draft_version FROM pages WHERE id = $1 FOR UPDATE', [Number(id)]);
    if (!page) return { status: 'weg' };
    if (String(page.draft_version) !== String(version)) return { status: 'verouderd' };
    if (!page.has_draft) return { status: 'geen-concept' };
    await client.query('UPDATE pages SET draft = NULL, draft_version = draft_version + 1, updated_at = now(), updated_by = $2 WHERE id = $1', [page.id, context.userId]);
    await context.audit(client);
    return { status: 'ok' };
  });

  /**
   * Zet een eerdere versie terug als concept (publiceren blijft een aparte stap).
   * @param {(number|string)} id Id van de pagina.
   * @param {(number|string)} revision Nummer van de versie.
   * @param {(number|string)} version Versie van het concept.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit.
   * @returns {Promise<{status: string}>} `ok`, `weg`, `versie-weg`, `verouderd`.
   */
  const restoreRevision = (id, revision, version, context) => changeDraft(id, version, async (state, client) => {
    if (!/^\d{1,9}$/.test(String(revision))) return { status: 'versie-weg' };
    const [row] = await client.query(
      'SELECT title, pretitle, intro, image_url, blocks FROM page_revisions WHERE page_id = $1 AND version = $2',
      [Number(id), Number(revision)],
    );
    if (!row) return { status: 'versie-weg' };
    // De kopfoto staat in een versie alleen als adres; zoek de foto in de bibliotheek erbij, zodat publiceren hem weer
    // controleert en vergrendelt. Een foto uit de import zonder bibliotheekrij blijft een los adres.
    const [media] = row.image_url ? await client.query(
      `SELECT m.id FROM media m
        WHERE m.content_type LIKE 'image/%'
          AND ('/media/' || m.local_name = $1 OR EXISTS (SELECT 1 FROM jsonb_each_text(m.variants) AS variant WHERE '/media/' || variant.value = $1))
        ORDER BY m.id LIMIT 1`,
      [row.image_url],
    ) : [];
    Object.assign(state, editableState({ draft: { title: row.title, pretitle: row.pretitle, intro: row.intro, imageUrl: row.image_url, imageMediaId: media ? media.id : null, blocks: row.blocks }, title: row.title }));
    return undefined;
  }, context);

  /**
   * De keuzes voor velden met een bron in het bewerkscherm: reistypes, landen en FAQ-categorieën.
   * @returns {Promise<{types: string[][], countries: string[][], faq: string[][]}>} Paren `[waarde, naam]`.
   */
  const sourceOptions = async () => {
    const [categories, faqs] = await Promise.all([
      db.query("SELECT slug, name, kind FROM trip_categories WHERE kind IN ('type', 'bestemming') ORDER BY kind, sort_order, name"),
      db.query('SELECT DISTINCT category FROM faqs WHERE category <> $1 ORDER BY category', ['']),
    ]);
    return {
      types: categories.filter((row) => row.kind === 'type').map((row) => [row.slug, row.name]),
      countries: categories.filter((row) => row.kind === 'bestemming').map((row) => [row.slug, row.name]),
      faq: faqs.map((row) => [row.category, row.category]),
    };
  };

  return { list, get, revisions, changeDraft, publish, discardDraft, restoreRevision, sourceOptions };
}

module.exports = { createPages, validatePageFields, editableState, imageFromMedia, PAGE_LIMITS, IMAGE_WIDTH };
