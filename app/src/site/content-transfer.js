// @ts-check
/**
 * Zet de vaste inhoud uit `DATA_DIR/site-content.json` eenmalig over naar de database (W28, migratie 34), zodat het CRM
 * de enige bron wordt en de JSON-terugval kan verdwijnen. Per deel staat in `content_transfers` dat het is gedaan; een
 * deel gebeurt dus precies één keer, ook als de app vaker start. Wat al in het CRM is gewijzigd, blijft staan.
 *
 * - `lijstkoppen`: de koppen van de lijstpagina's, alleen rijen die nog de standaardtekst hebben (`source = 'standaard'`).
 * - `reisleiders`: de extra gegevens van elke reisleider die nog niet in het CRM wordt beheerd (zoals bij de eerste
 *   wijziging, `adoptFixedGuide`), de galerij bij reisleiders die al wel beheerd worden maar nog geen galerij hebben, en
 *   de volgorde van de huidige site (`guideOrder`): eerst die reisleiders in die volgorde, daarna de rest op naam.
 *
 * Alleen gebonden parameters; alles in één transactie met een advisory lock, zodat twee containers het niet tegelijk doen.
 */
const { adoptFixedGuide } = require('../trips/guides');

/** De delen in volgorde. */
const TRANSFER_PARTS = Object.freeze(['lijstkoppen', 'reisleiders']);

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

/** Overzetfunctie per deel. */
const TRANSFERS = {
  lijstkoppen: (/** @type {any} */ client, /** @type {any} */ fixed) => transferListHeaders(client, fixed.archives),
  reisleiders: transferGuides,
};

/**
 * Zet de delen over die nog niet zijn gedaan.
 * @param {{db: {transaction: Function}, siteContent: any}} options Database en de gecontroleerde inhoud van
 *   `site-content.json` (`normalizeSiteContent`), of null als het bestand er niet is (dan gebeurt er niets).
 * @returns {Promise<Array<{part: string, summary: string}>>} De delen die nu zijn overgezet.
 */
async function transferFixedContent({ db, siteContent }) {
  if (!siteContent) return [];
  return db.transaction(async (/** @type {any} */ client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['vaste-inhoud-overzetten']);
    const done = new Set((await client.query('SELECT part FROM content_transfers')).map((/** @type {{part: string}} */ row) => row.part));
    const result = [];
    for (const part of TRANSFER_PARTS.filter((name) => !done.has(name))) {
      const summary = await TRANSFERS[/** @type {keyof typeof TRANSFERS} */ (part)](client, siteContent);
      await client.query('INSERT INTO content_transfers (part, summary) VALUES ($1, $2)', [part, summary]);
      result.push({ part, summary });
    }
    return result;
  });
}

module.exports = { transferFixedContent, TRANSFER_PARTS };
