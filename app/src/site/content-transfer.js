// @ts-check
/**
 * Zet de vaste inhoud uit `DATA_DIR/site-content.json` en `DATA_DIR/homepage.json` eenmalig over naar de database (W28, migratie 34), zodat het CRM
 * de enige bron wordt en de JSON-terugval kan verdwijnen. Per deel staat in `content_transfers` dat het is gedaan; een
 * deel gebeurt dus precies één keer, ook als de app vaker start. Wat al in het CRM is gewijzigd, blijft staan.
 *
 * - `lijstkoppen`: de koppen van de lijstpagina's, alleen rijen die nog de standaardtekst hebben (`source = 'standaard'`).
 * - `reisleiders`: de extra gegevens van elke reisleider die nog niet in het CRM wordt beheerd (zoals bij de eerste
 *   wijziging, `adoptFixedGuide`), de galerij bij reisleiders die al wel beheerd worden maar nog geen galerij hebben, en
 *   de volgorde van de huidige site (`guideOrder`): eerst die reisleiders in die volgorde, daarna de rest op naam.
 * - `galerijen`: de fotogalerij onder een bericht of pagina wordt een galerijblok als strook op volle breedte achteraan
 *   de blokken (ook in een openstaand concept), zodat de pagina er hetzelfde uitziet; het bericht of de pagina wordt
 *   daarmee beheerd in het CRM.
 * - `blog`: de tags en het uitgelichte bericht (alleen als er nog geen tags zijn, `copySiteTags`) en de link naar het
 *   oude blogarchief (als instelling, alleen als die afwijkt van de standaard, nog niet is ingesteld en voldoet aan de
 *   regels van het veld; met een regel in de auditlog zonder gebruiker).
 * - `homepage`: bestaat er nog geen pagina `/`, dan wordt de homepage uit `homepage.json` een gepubliceerde blokpagina
 *   (`homepageBlocks`, met dezelfde teksten en foto's).
 *
 * Alleen gebonden parameters; alles in één transactie met een advisory lock, zodat twee containers het niet tegelijk doen.
 */
const { adoptFixedGuide } = require('../trips/guides');
const { copySiteTags } = require('../cms/post-terms');
const { newBlock, publishedBlocks, normalizeImage } = require('../cms/blocks');
const { homepageBlocks, mediaByUrl } = require('../cms/pages');
const { FIELDS: ORGANISATION_FIELDS } = require('../beheer/instellingen/organisatie');

/** De delen in volgorde. */
const TRANSFER_PARTS = Object.freeze(['lijstkoppen', 'reisleiders', 'galerijen', 'blog', 'homepage']);

/**
 * Zet de koppen van de lijstpagina's over.
 * @param {{query: Function}} client Transactie-client.
 * @param {Record<string, {pretitle: string, title: string, introduction: string, image: string}>} archives Koppen uit
 *   het bestand (`normalizeSiteContent`).
 * @returns {Promise<string>} Samenvatting.
 */
async function transferListHeaders(client, archives) {
  let changed = 0;
  for (const [key, header] of Object.entries(archives)) {
    const rows = await client.query(
      `UPDATE list_headers SET pretitle = $2, title = $3, introduction = $4, image_url = NULLIF($5, ''), source = 'bestand', updated_at = now()
        WHERE key = $1 AND source = 'standaard' RETURNING key`,
      [key, header.pretitle, header.title, header.introduction, header.image],
    );
    changed += rows.length;
  }
  return `${changed} kop(pen) overgenomen`;
}

/**
 * Zet de gegevens, galerijen en volgorde van de reisleiders over.
 * @param {{query: Function}} client Transactie-client.
 * @param {{guides: Map<string, any>, guideOrder: string[]}} fixed Inhoud uit het bestand (`normalizeSiteContent`).
 * @returns {Promise<string>} Samenvatting.
 */
async function transferGuides(client, fixed) {
  const rows = await client.query('SELECT id, slug, managed_in_crm FROM guides ORDER BY id FOR UPDATE');
  let adopted = 0;
  let galleries = 0;
  for (const guide of rows) {
    const extra = fixed.guides.get(guide.slug);
    if (!guide.managed_in_crm) {
      await adoptFixedGuide(client, guide.id, extra);
      adopted += 1;
    } else if (extra && extra.gallery.length) {
      const updated = await client.query(
        `UPDATE guides SET gallery = $2::jsonb, gallery_title = $3, gallery_subtitle = $4 WHERE id = $1 AND gallery = '[]'::jsonb RETURNING id`,
        [guide.id, JSON.stringify(extra.gallery.map((/** @type {string} */ url) => ({ url, alt: '' }))), extra.galleryTitle, extra.gallerySubtitle],
      );
      galleries += updated.length;
    }
  }
  if (fixed.guideOrder.length) {
    // Eerst de reisleiders in de volgorde van de huidige site (1, 2, …), daarna de rest op naam.
    await client.query(
      `WITH wanted AS (SELECT slug, position FROM unnest($1::text[]) WITH ORDINALITY AS item(slug, position)),
            ranked AS (
              SELECT g.id, row_number() OVER (ORDER BY (w.position IS NULL), w.position, g.name, g.id) AS rank
                FROM guides g LEFT JOIN wanted w ON w.slug = g.slug)
       UPDATE guides SET sort_order = ranked.rank FROM ranked WHERE guides.id = ranked.id`,
      [fixed.guideOrder],
    );
  }
  return `${adopted} reisleider(s) overgenomen, ${galleries} galerij(en) aangevuld, volgorde ${fixed.guideOrder.length ? 'overgenomen' : 'ongewijzigd'}`;
}

/**
 * Een galerijblok (strook op volle breedte) voor een galerij uit het bestand; foto's uit de bibliotheek krijgen hun id.
 * @param {{query: Function}} client Transactie-client.
 * @param {{title: string, subtitle: string, images: string[]}} gallery Galerij uit het bestand.
 * @returns {Promise<object>} Blok.
 */
async function galleryBlock(client, gallery) {
  const block = /** @type {any} */ (newBlock('galerij'));
  const fotos = [];
  for (const url of gallery.images) {
    const media = await mediaByUrl(client, url);
    const image = normalizeImage({ mediaId: media ? media.id : null, url, alt: media ? media.alt_text || '' : '' });
    if (image) fotos.push(image);
  }
  block.data = { ...block.data, titel: gallery.title, subtitel: gallery.subtitle, fotos, weergave: 'strook' };
  return block;
}

/**
 * Zet de fotogalerijen onder berichten en pagina's om in een galerijblok achteraan.
 * @param {{query: Function}} client Transactie-client.
 * @param {{galleries: Map<string, any>}} fixed Inhoud uit het bestand.
 * @returns {Promise<string>} Samenvatting.
 */
async function transferGalleries(client, fixed) {
  let moved = 0;
  for (const [pagePath, gallery] of fixed.galleries) {
    const slug = /^\/([^/]+)\/$/.exec(pagePath);
    const [target] = await client.query(
      `SELECT 'pages' AS kind, id, blocks, body_html, managed_in_crm, draft FROM pages WHERE path = $1
       UNION ALL
       SELECT 'posts', id, blocks, body_html, managed_in_crm, draft FROM posts WHERE slug = $2
       LIMIT 1`,
      [pagePath, slug ? slug[1] : null],
    );
    if (!target) continue;
    const block = await galleryBlock(client, gallery);
    const blocks = [...publishedBlocks(target), block];
    const draft = target.draft && typeof target.draft === 'object' && Array.isArray(target.draft.blocks)
      ? { ...target.draft, blocks: [...target.draft.blocks, block] } : target.draft;
    // De tabelnaam komt uit de vaste lijst in de query hierboven, nooit uit de invoer. Met de galerij in de blokken is
    // de inhoud van het CRM (`managed_in_crm`): een nieuwe import zou de tekst anders naast de blokken zetten.
    const table = target.kind === 'posts' ? 'posts' : 'pages';
    await client.query(`UPDATE ${table} SET blocks = $2::jsonb, draft = $3::jsonb, managed_in_crm = true WHERE id = $1`, [target.id, JSON.stringify(blocks), draft ? JSON.stringify(draft) : null]);
    moved += 1;
  }
  return `${moved} van ${fixed.galleries.size} galerij(en) als blok overgenomen`;
}

/**
 * Of een waarde uit het bestand voldoet aan de regels van het veld in Beheer (lengte, verplicht en eigen controle).
 * @param {'blogArchiveLabel'|'blogArchiveUrl'} key Naam van de instelling.
 * @param {*} value Waarde.
 * @returns {boolean} Geldig.
 */
function validSetting(key, value) {
  /** @type {any} */
  const field = ORGANISATION_FIELDS[key];
  if (typeof value !== 'string' || value.length > field.max || (field.required && !value)) return false;
  return !field.validate || !field.validate(value);
}

/**
 * Zet de tags, het uitgelichte bericht en de link naar het oude blogarchief over.
 * @param {{query: Function}} client Transactie-client.
 * @param {{blogTags: object[], featuredPost: string, blogArchiveLink: {label: string, href: string}}} fixed Inhoud uit het bestand.
 * @returns {Promise<string>} Samenvatting.
 */
async function transferBlog(client, fixed) {
  const tags = await copySiteTags(client, fixed, null);
  const link = fixed.blogArchiveLink;
  let linkChanged = false;
  // Alleen een link die ook in Beheer geldig zou zijn (zelfde regels als het veld); anders blijft de standaard.
  if (validSetting('blogArchiveLabel', link.label) && validSetting('blogArchiveUrl', link.href)) {
    for (const [key, value] of [['blogArchiveLabel', link.label], ['blogArchiveUrl', link.href]]) {
      if (value === ORGANISATION_FIELDS[/** @type {'blogArchiveLabel'|'blogArchiveUrl'} */ (key)].default) continue;
      const rows = await client.query('INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO NOTHING RETURNING key', [key, JSON.stringify(value)]);
      if (!rows.length) continue;
      linkChanged = true;
      await client.query("INSERT INTO audit_log (user_id, action, entity, entity_id) VALUES (NULL, 'instelling.gewijzigd', 'settings', $1)", [key]);
    }
  }
  return `${tags.status === 'ok' ? `${tags.tags} tag(s)` : 'tags stonden er al'}, link naar het blogarchief ${linkChanged ? 'overgenomen' : 'standaard'}`;
}

/**
 * Maakt van de homepage uit `homepage.json` een gepubliceerde blokpagina, als er nog geen pagina `/` is.
 * @param {{query: Function}} client Transactie-client.
 * @param {object} home Inhoud uit `normalizeHomepage`.
 * @returns {Promise<string>} Samenvatting.
 */
async function transferHomepage(client, home) {
  const [existing] = await client.query("SELECT id FROM pages WHERE path = '/'");
  if (existing) return 'pagina / bestond al';
  const blocks = JSON.stringify(await homepageBlocks(home, client));
  const [page] = await client.query(
    `INSERT INTO pages (path, title, published, blocks, managed_in_crm) VALUES ('/', 'Homepage', true, $1::jsonb, true) RETURNING id`,
    [blocks],
  );
  await client.query(
    `INSERT INTO page_revisions (page_id, version, title, blocks, note) VALUES ($1, 1, 'Homepage', $2::jsonb, 'Overgenomen van de vaste homepage')`,
    [page.id, blocks],
  );
  return 'homepage als blokpagina gepubliceerd';
}

/** Overzetfunctie per deel. */
const TRANSFERS = {
  lijstkoppen: (/** @type {any} */ client, /** @type {any} */ fixed) => transferListHeaders(client, fixed.archives),
  reisleiders: transferGuides,
  galerijen: transferGalleries,
  blog: transferBlog,
  homepage: (/** @type {any} */ client, /** @type {any} */ _fixed, /** @type {any} */ home) => transferHomepage(client, home),
};

/**
 * Zet de delen over die nog niet zijn gedaan.
 * @param {{db: {transaction: Function}, siteContent: any, homepage?: any}} options Database, de gecontroleerde inhoud van
 *   `site-content.json` (`normalizeSiteContent`), of null (dan wachten de delen die dat bestand nodig hebben tot het er
 *   is), en die van `homepage.json` (`normalizeHomepage`), of null (dan wacht het deel `homepage`).
 * @returns {Promise<Array<{part: string, summary: string}>>} De delen die nu zijn overgezet.
 */
async function transferFixedContent({ db, siteContent, homepage = null }) {
  // Elk deel heeft zijn eigen bestand nodig: `homepage` alleen `homepage.json`, de rest `site-content.json`.
  const available = TRANSFER_PARTS.filter((name) => (name === 'homepage' ? homepage : siteContent));
  if (!available.length) return [];
  return db.transaction(async (/** @type {any} */ client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['vaste-inhoud-overzetten']);
    const done = new Set((await client.query('SELECT part FROM content_transfers')).map((/** @type {{part: string}} */ row) => row.part));
    const result = [];
    for (const part of available.filter((name) => !done.has(name))) {
      const summary = await TRANSFERS[/** @type {keyof typeof TRANSFERS} */ (part)](client, siteContent, homepage);
      await client.query('INSERT INTO content_transfers (part, summary) VALUES ($1, $2)', [part, summary]);
      result.push({ part, summary });
    }
    return result;
  });
}

module.exports = { transferFixedContent, TRANSFER_PARTS };
