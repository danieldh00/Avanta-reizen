/**
 * Pagina's van de website in het CMS (pakket H1, migratie 17; H3, migratie 18: nieuwe pagina's, adres wijzigen, offline
 * halen en verwijderen, SEO-velden): lijst, één pagina met concept, het concept wijzigen
 * (gegevens, kopfoto, blokken toevoegen/wijzigen/verplaatsen/verwijderen), publiceren (met versie), concept weggooien
 * en een versie terugzetten als concept. Het concept staat in `pages.draft`; de site toont alleen de gepubliceerde
 * kolommen. Elke wijziging controleert `draft_version` (twee tabbladen overschrijven elkaar niet) en schrijft de audit
 * in dezelfde transactie. Alle vragen met gebonden parameters.
 */
const { cleanText, lockMediaForUse, mediaUrl } = require('../media/library');
const { normalizeBlocks, normalizeImage, publishedBlocks, mediaIdsOf, newBlock, MAX_BLOCKS, MAX_TRIP_BLOCKS } = require('./blocks');
const { isValidSlug, recordMove } = require('../trips/slugs');

/** Maximale lengtes van de gegevens van een pagina. */
const PAGE_LIMITS = { title: 200, pretitle: 200, intro: 2000, seoTitle: 70, seoDescription: 300, path: 300 };

/**
 * Eerste delen van een pad die de site zelf gebruikt: daar kan geen pagina staan (de vaste route gaat voor, of het is
 * een bestand of het CRM).
 */
const RESERVED_SEGMENTS = new Set([
  'app', 'api', 'media', 'css', 'js', 'images', 'fonts', 'reis', 'reis-categorie', 'reisleider', 'blog', 'tag', 'faq',
  'faq-categorie', 'category', 'zoeken', 'aanmelden', 'sitemap-xml', 'robots-txt', 'llms-txt', 'wp-admin', 'wp-content', 'feed',
]);

/** Breedte van de foto die in een afbeeldingsblok en als kopfoto wordt opgeslagen. */
const IMAGE_WIDTH = 1600;

/** Kolommen van een pagina (nooit `SELECT *`). */
const PAGE_COLUMNS = `p.id, p.path, p.title, p.pretitle, p.intro, p.image_url, p.blocks, p.body_html, p.published, p.draft, p.draft_version,
  p.managed_in_crm, p.created_at, p.updated_at, p.legacy_id, p.seo_title, p.seo_description`;

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
  const seoTitle = cleanText(text('seo_title'), PAGE_LIMITS.seoTitle + 1);
  if (seoTitle.length > PAGE_LIMITS.seoTitle) errors.seo_title = `Maximaal ${PAGE_LIMITS.seoTitle} tekens.`;
  const seoDescription = cleanText(text('seo_description'), PAGE_LIMITS.seoDescription + 1);
  if (seoDescription.length > PAGE_LIMITS.seoDescription) errors.seo_description = `Maximaal ${PAGE_LIMITS.seoDescription} tekens.`;
  return {
    values: {
      title: title.slice(0, PAGE_LIMITS.title),
      pretitle: pretitle.slice(0, PAGE_LIMITS.pretitle),
      intro: intro.slice(0, PAGE_LIMITS.intro),
      seoTitle: seoTitle.slice(0, PAGE_LIMITS.seoTitle),
      seoDescription: seoDescription.slice(0, PAGE_LIMITS.seoDescription),
    },
    errors,
  };
}

/**
 * Bouwt en controleert het pad van een pagina uit een slug en het pad van de bovenliggende pagina (`/` = hoofdniveau).
 * @param {string} slug Laatste deel van het adres.
 * @param {string} parentPath Pad van de bovenliggende pagina (met slash aan beide kanten) of `/`.
 * @returns {{path?: string, error?: string}} Pad, of een foutmelding.
 */
function buildPagePath(slug, parentPath) {
  if (!isValidSlug(slug)) return { error: 'Gebruik kleine letters, cijfers en streepjes (bijv. onze-reizen).' };
  if (typeof parentPath !== 'string' || !/^\/(?:[^/\s]+\/)*$/.test(parentPath)) return { error: 'Kies een bovenliggende pagina uit de lijst.' };
  const path = `${parentPath}${slug}/`;
  if (path.length > PAGE_LIMITS.path) return { error: `Het adres is te lang (hoogstens ${PAGE_LIMITS.path} tekens).` };
  const first = path.split('/')[1];
  if (RESERVED_SEGMENTS.has(first)) return { error: `Het adres /${first}/ gebruikt de site zelf; kies een ander adres.` };
  return { path };
}

/**
 * De stand die je bewerkt: het concept als dat er is, anders de gepubliceerde pagina.
 * @param {object} page Rij uit de database.
 * @returns {{title: string, pretitle: string, intro: string, imageUrl: (string|null), imageMediaId: (number|null), blocks: object[], seoTitle: string, seoDescription: string}} Stand.
 */
function editableState(page) {
  const draft = page.draft && typeof page.draft === 'object' ? page.draft : null;
  const source = draft || {
    title: page.title, pretitle: page.pretitle, intro: page.intro, imageUrl: page.image_url, imageMediaId: null, blocks: publishedBlocks(page),
    seoTitle: page.seo_title, seoDescription: page.seo_description,
  };
  return {
    title: typeof source.title === 'string' ? source.title : page.title,
    pretitle: typeof source.pretitle === 'string' ? source.pretitle : '',
    intro: typeof source.intro === 'string' ? source.intro : '',
    imageUrl: typeof source.imageUrl === 'string' && /^(\/media\/[A-Za-z0-9._-]+|https:\/\/[^\s"]+)$/.test(source.imageUrl) ? source.imageUrl : null,
    imageMediaId: Number.isInteger(source.imageMediaId) ? source.imageMediaId : null,
    blocks: normalizeBlocks(source.blocks),
    seoTitle: typeof source.seoTitle === 'string' ? source.seoTitle.slice(0, PAGE_LIMITS.seoTitle) : '',
    seoDescription: typeof source.seoDescription === 'string' ? source.seoDescription.slice(0, PAGE_LIMITS.seoDescription) : '',
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
 * Zoekt de foto in de bibliotheek bij een adres onder `/media/` (het bestand zelf of een van zijn formaten).
 * @param {object} client Database of transactie-client.
 * @param {string} url Adres.
 * @returns {Promise<({id: number, alt_text: string}|null)>} Foto, of null (bijv. een los bestand uit de import).
 */
async function mediaByUrl(client, url) {
  const [media] = await client.query(
    `SELECT m.id, m.alt_text FROM media m
      WHERE m.content_type LIKE 'image/%'
        AND ('/media/' || m.local_name = $1 OR EXISTS (SELECT 1 FROM jsonb_each_text(m.variants) AS variant WHERE '/media/' || variant.value = $1))
      ORDER BY m.id LIMIT 1`,
    [url],
  );
  return media || null;
}

/**
 * Zet de vaste homepage (`site/homepage.js`, uit `homepage.json`) om in blokken (H4), met dezelfde teksten, links en
 * foto's. Foto's uit de bibliotheek krijgen hun id (zodat publiceren ze controleert); een dia zonder foto en alles
 * erna gebruikt de reservefoto's van reizen, zodat dia en foto bij elkaar blijven.
 * @param {object} home Inhoud uit `normalizeHomepage`.
 * @param {object} client Database of transactie-client.
 * @returns {Promise<object[]>} Blokken.
 */
async function homepageBlocks(home, client) {
  const images = async (list) => {
    const result = [];
    for (const url of list) {
      if (!url) break;
      const media = await mediaByUrl(client, url);
      const image = normalizeImage({ mediaId: media ? media.id : null, url, alt: media ? media.alt_text || '' : '' });
      if (!image) break;
      result.push(image);
    }
    return result;
  };
  const block = (type, data) => ({ ...newBlock(type), data: { ...newBlock(type).data, ...data } });
  const about = home.about;
  const aboutImage = about.image ? (await images([about.image]))[0] || null : null;
  return [
    block('home-slider', {
      dias: home.slides.map((slide) => ({ bovenkop: slide.pretitle, titel: slide.title, knoptekst: slide.button, link: slide.href, youtube: slide.videoId })),
      fotos: await images(home.slides.map((slide) => slide.image)),
    }),
    block('home-zoekbalk', {}),
    block('home-lastminutes', { titel: home.sections.lastMinutes.title, subtitel: home.sections.lastMinutes.subtitle, knoptekst: home.sections.lastMinutes.button }),
    block('home-reistypes', { titel: home.sections.types.title, subtitel: home.sections.types.subtitle }),
    block('home-inspiratie', {
      dias: home.inspiration.map((item) => ({ titel: item.title, tekst: item.text })),
      fotos: await images(home.inspiration.map((item) => item.image)),
    }),
    block('home-bestemmingen', { titel: home.sections.destinations.title, subtitel: home.sections.destinations.subtitle }),
    block('home-blog', { titel: home.sections.blog.title, subtitel: home.sections.blog.subtitle, knoptekst: home.sections.blog.button }),
    block('home-over', { titel: about.title, tekst: about.text, linktekst: about.linkLabel, link: about.href, foto: aboutImage }),
  ];
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
   * Publiceert het concept (en zet de pagina online): controleert en vergrendelt de gebruikte foto's (een verdwenen foto weigert), schrijft de
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
    // Een nieuwe pagina (nog nooit online, niet uit de import) heeft geen eerdere stand om te bewaren.
    if (latest === 0 && (page.published || page.legacy_id !== null)) {
      await client.query(
        `INSERT INTO page_revisions (page_id, version, title, pretitle, intro, image_url, blocks, note, published_by, seo_title, seo_description)
         VALUES ($1, 1, $2, $3, $4, $5, $6, $7, NULL, $8, $9)`,
        [page.id, page.title, page.pretitle, page.intro, page.image_url, JSON.stringify(publishedBlocks(page)), page.managed_in_crm ? 'Stand vóór de eerste versie' : 'Stand uit de import', page.seo_title, page.seo_description],
      );
      next = 2;
    }
    const blocks = JSON.stringify(state.blocks);
    await client.query(
      `INSERT INTO page_revisions (page_id, version, title, pretitle, intro, image_url, blocks, published_by, seo_title, seo_description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [page.id, next, state.title, state.pretitle, state.intro, state.imageUrl, blocks, context.userId, state.seoTitle, state.seoDescription],
    );
    await client.query(
      `UPDATE pages SET title = $2, pretitle = $3, intro = $4, image_url = $5, blocks = $6, seo_title = $8, seo_description = $9,
              draft = NULL, draft_version = draft_version + 1, managed_in_crm = true, published = true, updated_at = now(), updated_by = $7
        WHERE id = $1`,
      [page.id, state.title, state.pretitle, state.intro, state.imageUrl, blocks, context.userId, state.seoTitle, state.seoDescription],
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
      'SELECT title, pretitle, intro, image_url, blocks, seo_title, seo_description FROM page_revisions WHERE page_id = $1 AND version = $2',
      [Number(id), Number(revision)],
    );
    if (!row) return { status: 'versie-weg' };
    // De kopfoto staat in een versie alleen als adres; zoek de foto in de bibliotheek erbij, zodat publiceren hem weer
    // controleert en vergrendelt. Een foto uit de import zonder bibliotheekrij blijft een los adres.
    const media = row.image_url ? await mediaByUrl(client, row.image_url) : null;
    Object.assign(state, editableState({ draft: { title: row.title, pretitle: row.pretitle, intro: row.intro, imageUrl: row.image_url, imageMediaId: media ? media.id : null, blocks: row.blocks, seoTitle: row.seo_title, seoDescription: row.seo_description }, title: row.title }));
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

  /**
   * Of een pad vrij is voor een pagina: geen andere pagina en (op het hoofdniveau) geen blogbericht met die slug, want
   * een pagina gaat op de site voor een bericht.
   * @param {object} client Transactie-client.
   * @param {string} path Pad.
   * @param {(number|null)} selfId Id van de pagina zelf (bij verplaatsen).
   * @returns {Promise<(string|null)>} Foutmelding, of null als het vrij is.
   */
  const pathTaken = async (client, path, selfId) => {
    const [page] = await client.query('SELECT id FROM pages WHERE path = $1', [path]);
    if (page && page.id !== selfId) return 'Op dit adres staat al een pagina.';
    const segments = path.split('/').filter(Boolean);
    if (segments.length === 1) {
      const [post] = await client.query('SELECT id FROM posts WHERE slug = $1', [segments[0]]);
      if (post) return 'Op dit adres staat een blogbericht; kies een ander adres.';
    }
    return null;
  };

  /**
   * De pagina's die als bovenliggende pagina kunnen dienen (op pad), zonder de pagina zelf en wat eronder staat.
   * @param {(string|null)} [ownPath] Pad van de pagina die je verplaatst.
   * @returns {Promise<{path: string, title: string}[]>} Pagina's.
   */
  const parentOptions = (ownPath = null) => db.query(
    `SELECT path, title FROM pages
      WHERE path <> '/' AND ($1::text IS NULL OR left(path, length($1)) <> $1)
      ORDER BY path LIMIT 500`,
    [ownPath],
  );

  /**
   * Maakt een nieuwe pagina: offline (`published = false`) met een concept met alleen de titel, tot de eerste publicatie.
   * @param {{title: string, slug: string, parentPath: string}} values Titel, slug en pad van de bovenliggende pagina.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit (`(client, id) => Promise`).
   * @returns {Promise<{id?: number, errors?: object}>} Nieuw id of fouten.
   */
  const create = (values, context) => db.transaction(async (client) => {
    const title = cleanText(values.title || '', PAGE_LIMITS.title + 1);
    const errors = {};
    if (!title) errors.title = 'Vul een titel in.';
    else if (title.length > PAGE_LIMITS.title) errors.title = `Maximaal ${PAGE_LIMITS.title} tekens.`;
    const built = buildPagePath(values.slug, values.parentPath);
    if (built.error) errors.slug = built.error;
    if (!built.error && values.parentPath !== '/') {
      const [parent] = await client.query('SELECT id FROM pages WHERE path = $1', [values.parentPath]);
      if (!parent) errors.parent = 'Kies een bovenliggende pagina uit de lijst.';
    }
    if (!errors.slug && !errors.parent) {
      // Slot op het pad: twee gelijktijdige nieuwe pagina's op hetzelfde adres krijgen niet allebei een id.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pagina:${built.path}`]);
      const taken = await pathTaken(client, built.path, null);
      if (taken) errors.slug = taken;
    }
    if (Object.keys(errors).length) return { errors };
    const draft = { title, pretitle: '', intro: '', imageUrl: null, imageMediaId: null, blocks: [], seoTitle: '', seoDescription: '' };
    const [row] = await client.query(
      `INSERT INTO pages (path, title, published, draft, managed_in_crm, updated_by)
       VALUES ($1, $2, false, $3, true, $4) RETURNING id`,
      [built.path, title, JSON.stringify(draft), context.userId],
    );
    await context.audit(client, row.id);
    return { id: row.id };
  });

  /**
   * Verplaatst een pagina naar een nieuw adres, met alle pagina's eronder. Elk oud adres krijgt een 301 naar het nieuwe
   * (`recordMove`) en menu-items die naar een oud adres wezen gaan mee. Daarna `redirects.reload()` en `menus.reload()`.
   * @param {(number|string)} id Id.
   * @param {{slug: string, parentPath: string}} values Nieuwe slug en bovenliggende pagina.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit.
   * @returns {Promise<{status: ('ok'|'weg'|'fout'|'gelijk'), errors?: object, path?: string}>} Uitkomst.
   */
  const move = (id, values, context) => db.transaction(async (client) => {
    if (!/^\d{1,9}$/.test(String(id))) return { status: 'weg' };
    const [page] = await client.query('SELECT id, path FROM pages WHERE id = $1 FOR UPDATE', [Number(id)]);
    if (!page) return { status: 'weg' };
    if (page.path === '/') return { status: 'fout', errors: { slug: 'De homepage blijft op /.' } };
    const built = buildPagePath(values.slug, values.parentPath);
    if (built.error) return { status: 'fout', errors: { slug: built.error } };
    if (built.path === page.path) return { status: 'gelijk' };
    if (built.path.startsWith(page.path)) return { status: 'fout', errors: { parent: 'Een pagina kan niet onder zichzelf staan.' } };
    if (values.parentPath !== '/') {
      const [parent] = await client.query('SELECT id FROM pages WHERE path = $1', [values.parentPath]);
      if (!parent) return { status: 'fout', errors: { parent: 'Kies een bovenliggende pagina uit de lijst.' } };
    }
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pagina:${built.path}`]);
    const moving = await client.query(
      'SELECT id, path FROM pages WHERE left(path, length($1)) = $1 ORDER BY path FOR UPDATE',
      [page.path],
    );
    for (const row of moving) {
      const target = built.path + row.path.slice(page.path.length);
      if (target.length > PAGE_LIMITS.path) return { status: 'fout', errors: { slug: 'Een adres eronder wordt te lang.' } };
      const taken = await pathTaken(client, target, row.id);
      if (taken) return { status: 'fout', errors: { slug: row.id === page.id ? taken : `${taken} (${target})` } };
    }
    // Eerst alle paden tijdelijk vrijmaken: zo botst een verschuiving binnen dezelfde boom niet met de unieke index.
    await client.query("UPDATE pages SET path = '#verplaatsen-' || id::text WHERE id = ANY($1::int[])", [moving.map((row) => row.id)]);
    for (const row of moving) {
      const target = built.path + row.path.slice(page.path.length);
      await client.query('UPDATE pages SET path = $2, managed_in_crm = true, updated_at = now(), updated_by = $3 WHERE id = $1', [row.id, target, context.userId]);
      await recordMove(client, { fromPath: row.path, toPath: target, userId: context.userId, note: 'Pagina verplaatst' });
      await client.query(
        `UPDATE menu_items SET href = $2 || substr(href, length($1) + 1), updated_at = now()
          WHERE href = $1 OR left(href, length($1) + 1) IN ($1 || '#', $1 || '?')`,
        [row.path, target],
      );
      // Zonder slash aan het eind, ook met een anker of query erachter (`/over-ons#x` wordt `/nieuw/#x`).
      await client.query(
        `UPDATE menu_items SET href = $2 || substr(href, length(rtrim($1, '/')) + 1), updated_at = now()
          WHERE href = rtrim($1, '/') OR left(href, length(rtrim($1, '/')) + 1) IN (rtrim($1, '/') || '#', rtrim($1, '/') || '?')`,
        [row.path, target],
      );
    }
    await context.audit(client);
    return { status: 'ok', path: built.path };
  });

  /**
   * Zet een pagina offline of weer online. Online kan alleen als de pagina eerder online stond of uit de import komt
   * (een nieuwe pagina gaat online met *Publiceren*).
   * @param {(number|string)} id Id.
   * @param {boolean} online Gewenste stand.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit.
   * @returns {Promise<{status: ('ok'|'weg'|'nooit-gepubliceerd')}>} Uitkomst.
   */
  const setOnline = (id, online, context) => db.transaction(async (client) => {
    if (!/^\d{1,9}$/.test(String(id))) return { status: 'weg' };
    const [page] = await client.query(
      `SELECT p.id, p.legacy_id, EXISTS (SELECT 1 FROM page_revisions r WHERE r.page_id = p.id) AS has_revisions
         FROM pages p WHERE p.id = $1 FOR UPDATE`,
      [Number(id)],
    );
    if (!page) return { status: 'weg' };
    if (online && !page.has_revisions && page.legacy_id === null) return { status: 'nooit-gepubliceerd' };
    await client.query('UPDATE pages SET published = $2, updated_at = now(), updated_by = $3 WHERE id = $1', [page.id, online, context.userId]);
    await context.audit(client);
    return { status: 'ok' };
  });

  /**
   * Verwijdert een pagina die offline staat, niet uit de import komt (die zou bij een nieuwe import terugkomen; zet hem
   * offline), geen pagina's onder zich heeft en niet in een menu staat. Versies gaan mee (ON DELETE CASCADE).
   * @param {(number|string)} id Id.
   * @param {{audit: Function}} context Audit.
   * @returns {Promise<{status: ('ok'|'weg'|'online'|'import'|'onderliggend'|'in-menu')}>} Uitkomst (`in-menu`: een menu-item wijst
   *   nog naar de pagina).
   */
  const remove = (id, context) => db.transaction(async (client) => {
    if (!/^\d{1,9}$/.test(String(id))) return { status: 'weg' };
    const [page] = await client.query('SELECT id, path, published, legacy_id FROM pages WHERE id = $1 FOR UPDATE', [Number(id)]);
    if (!page) return { status: 'weg' };
    if (page.published) return { status: 'online' };
    if (page.legacy_id !== null) return { status: 'import' };
    const [child] = page.path === '/' ? [] : await client.query('SELECT id FROM pages WHERE left(path, length($1)) = $1 AND id <> $2 LIMIT 1', [page.path, page.id]);
    if (child) return { status: 'onderliggend' };
    const [menuItem] = await client.query(
      `SELECT id FROM menu_items
        WHERE href = $1 OR href = rtrim($1, '/')
           OR left(href, length($1) + 1) IN ($1 || '#', $1 || '?')
           OR left(href, length(rtrim($1, '/')) + 1) IN (rtrim($1, '/') || '#', rtrim($1, '/') || '?')
        LIMIT 1`,
      [page.path],
    );
    if (menuItem) return { status: 'in-menu' };
    await client.query('DELETE FROM pages WHERE id = $1', [page.id]);
    await context.audit(client);
    return { status: 'ok' };
  });

  /**
   * Zet de homepage op als blokpagina (pad `/`): offline, met een concept met de huidige inhoud van de vaste homepage.
   * Tot de eerste publicatie toont de site de vaste homepage. Bestaat de pagina al, dan verandert er niets.
   * @param {object} home Inhoud uit `normalizeHomepage` (`homepage.json`).
   * @param {{userId: number, audit: Function}} context Gebruiker en audit (`(client, id) => Promise`).
   * @returns {Promise<{id: number, created: boolean}>} Id van de homepage.
   */
  const createHomepage = (home, context) => db.transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['pagina:/']);
    const [existing] = await client.query("SELECT id FROM pages WHERE path = '/'");
    if (existing) return { id: existing.id, created: false };
    const draft = { title: 'Homepage', pretitle: '', intro: '', imageUrl: null, imageMediaId: null, blocks: await homepageBlocks(home, client), seoTitle: '', seoDescription: '' };
    const [row] = await client.query(
      `INSERT INTO pages (path, title, published, draft, managed_in_crm, updated_by)
       VALUES ('/', 'Homepage', false, $1, true, $2) RETURNING id`,
      [JSON.stringify(draft), context.userId],
    );
    await context.audit(client, row.id);
    return { id: row.id, created: true };
  });

  return { list, get, revisions, changeDraft, publish, discardDraft, restoreRevision, sourceOptions, parentOptions, create, createHomepage, move, setOnline, remove };
}

module.exports = { createPages, homepageBlocks, mediaByUrl, validatePageFields, buildPagePath, editableState, imageFromMedia, PAGE_LIMITS, IMAGE_WIDTH, RESERVED_SEGMENTS };
