/**
 * Fotobibliotheek (CMS-pakket F): foto's in de tabel `media`, gekoppeld aan landen via `media_countries`. Geüploade
 * foto's staan als WebP-varianten in `DATA_DIR/media` (naam `bib-<willekeurig>-<breedte>.webp`), geïmporteerde foto's
 * onder hun importnaam. Alle vragen met gebonden parameters; een upload wordt pas zichtbaar als bestanden én rij er zijn.
 */
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { processImage } = require('./images');

/** Maximale lengte van de tekstvelden van een foto. */
const TEXT_LIMITS = { title: 200, alt_text: 300, caption: 500, photographer: 120 };

/** Kolommen van een foto (nooit `SELECT *`). */
const MEDIA_COLUMNS = `m.id, m.original_url, m.local_name, m.content_type, m.bytes, m.source, m.title, m.alt_text, m.caption, m.photographer,
  m.width, m.height, m.variants, m.uploaded_by, m.created_at, m.updated_at`;

/**
 * Leest een tekstveld: stuurtekens en regeleinden weg, spaties samengevoegd, ingekort.
 * @param {*} value Invoer.
 * @param {number} max Maximale lengte.
 * @returns {string} Tekst.
 */
function cleanText(value, max) {
  // eslint-disable-next-line no-control-regex
  return typeof value === 'string' ? value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/**
 * Een standaardtitel uit de bestandsnaam van de upload: zonder map en extensie, streepjes als spaties.
 * @param {string} filename Bestandsnaam zoals de browser die meestuurt.
 * @returns {string} Titel.
 */
function titleFromFilename(filename) {
  const base = String(filename || '').split(/[\\/]/).pop().replace(/\.[A-Za-z0-9]{1,5}$/, '');
  return cleanText(base.replace(/[_-]+/g, ' '), TEXT_LIMITS.title);
}

/**
 * Het pad van de kleinste variant die minstens zo breed is als gevraagd, of het hoofdbestand.
 * @param {{local_name: string, variants?: object}} media Foto.
 * @param {number} [minWidth] Gewenste minimale breedte.
 * @returns {string} Pad onder `/media/`.
 */
function mediaUrl(media, minWidth = 0) {
  const widths = Object.keys(media.variants || {}).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const width = widths.find((candidate) => candidate >= minWidth) ?? widths[widths.length - 1];
  const name = width !== undefined ? media.variants[String(width)] : media.local_name;
  return `/media/${encodeURIComponent(name)}`;
}

/**
 * Maakt de fotobibliotheek.
 * @param {{db: object, mediaDir: string}} options Database en map met de bestanden.
 * @returns {object} Functies van de bibliotheek.
 */
function createMediaLibrary(options) {
  const { db, mediaDir } = options;

  /**
   * Alle landen (reiscategorieën van het soort bestemming), op naam.
   * @returns {Promise<{id: number, name: string, slug: string}[]>} Landen.
   */
  const countries = () => db.query("SELECT id, name, slug FROM trip_categories WHERE kind = 'bestemming' ORDER BY name, id");

  /**
   * Houdt alleen bestaande landen over uit een lijst id's.
   * @param {{query: Function}} client Database of transactie-client.
   * @param {*} ids Lijst id's (tekst of getallen).
   * @returns {Promise<number[]>} Geldige id's van landen.
   */
  const validCountryIds = async (client, ids) => {
    const wanted = [...new Set([].concat(ids || []).map(String).filter((id) => /^\d{1,9}$/.test(id)).map(Number))];
    if (!wanted.length) return [];
    const rows = await client.query("SELECT id FROM trip_categories WHERE kind = 'bestemming' AND id = ANY($1::int[]) ORDER BY id", [wanted]);
    return rows.map((row) => row.id);
  };

  /**
   * Slaat een geüploade foto op: verwerken, bestanden wegschrijven, rij en landen in één transactie.
   * @param {{buffer: Buffer, filename: string, userId: number, countryIds?: number[], audit?: Function}} upload Bestand, naam,
   *   uploader, landen en een functie die in dezelfde transactie de audit schrijft (`(client, mediaId) => Promise`).
   * @returns {Promise<{id: number, title: string}>} De nieuwe foto.
   * @throws {import('./images').ImageError} Als het bestand geen geldige foto is.
   */
  const storeUpload = async (upload) => {
    const processed = await processImage(upload.buffer);
    const stem = `bib-${crypto.randomBytes(8).toString('hex')}`;
    const variants = {};
    const written = [];
    try {
      await fs.mkdir(mediaDir, { recursive: true });
      for (const variant of processed.variants) {
        const name = `${stem}-${variant.width}.webp`;
        const target = path.join(mediaDir, name);
        await fs.writeFile(`${target}.tmp`, variant.data, { flag: 'wx' });
        await fs.rename(`${target}.tmp`, target);
        written.push(target);
        variants[String(variant.width)] = name;
      }
      const largest = processed.variants[processed.variants.length - 1];
      const title = titleFromFilename(upload.filename);
      return await db.transaction(async (client) => {
        const [row] = await client.query(
          `INSERT INTO media (original_url, local_name, content_type, bytes, source, title, width, height, variants, uploaded_by)
           VALUES (NULL, $1, 'image/webp', $2, 'upload', $3, $4, $5, $6, $7) RETURNING id, title`,
          [variants[String(largest.width)], largest.data.length, title, processed.width, processed.height, JSON.stringify(variants), upload.userId],
        );
        const ids = await validCountryIds(client, upload.countryIds);
        if (ids.length) await client.query('INSERT INTO media_countries (media_id, category_id) SELECT $1, unnest($2::int[])', [row.id, ids]);
        if (upload.audit) await upload.audit(client, row.id);
        return row;
      });
    } catch (error) {
      await Promise.all(written.map((file) => fs.rm(file, { force: true })));
      await Promise.all(processed.variants.map((variant) => fs.rm(path.join(mediaDir, `${stem}-${variant.width}.webp.tmp`), { force: true })));
      throw error;
    }
  };

  /**
   * Een pagina foto's met filter op land, zonder land en zoektekst.
   * @param {{countryId?: (number|null), withoutCountry?: boolean, patterns?: string[], limit: number, offset: number}} filter Filter.
   * @returns {Promise<object[]>} Foto's met `countries` (namen), nieuwste eerst.
   */
  const list = (filter) => db.query(
    `SELECT ${MEDIA_COLUMNS},
            coalesce((SELECT array_agg(c.name ORDER BY c.name) FROM media_countries mc JOIN trip_categories c ON c.id = mc.category_id WHERE mc.media_id = m.id), '{}') AS countries
       FROM media m
      WHERE m.content_type LIKE 'image/%'
        AND ($1::int IS NULL OR EXISTS (SELECT 1 FROM media_countries mc WHERE mc.media_id = m.id AND mc.category_id = $1))
        AND (NOT $2::boolean OR NOT EXISTS (SELECT 1 FROM media_countries mc WHERE mc.media_id = m.id))
        AND NOT EXISTS (
              SELECT 1 FROM unnest($3::text[]) AS term
               WHERE lower(m.title || ' ' || m.alt_text || ' ' || m.caption || ' ' || m.photographer || ' ' || m.local_name) NOT LIKE term
            )
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT $4 OFFSET $5`,
    [filter.countryId ?? null, Boolean(filter.withoutCountry), filter.patterns || [], filter.limit, filter.offset],
  );

  /**
   * Eén foto met de id's van zijn landen en de naam van de uploader.
   * @param {(number|string)} id Id.
   * @returns {Promise<(object|null)>} Foto, of null.
   */
  const get = async (id) => {
    const [row] = await db.query(
      `SELECT ${MEDIA_COLUMNS}, u.name AS uploaded_by_name,
              coalesce((SELECT array_agg(mc.category_id ORDER BY mc.category_id) FROM media_countries mc WHERE mc.media_id = m.id), '{}') AS country_ids
         FROM media m LEFT JOIN users u ON u.id = m.uploaded_by
        WHERE m.id = $1 AND m.content_type LIKE 'image/%'`,
      [Number(id)],
    );
    return row || null;
  };

  /**
   * Wijzigt de gegevens en landen van een foto.
   * @param {(number|string)} id Id.
   * @param {{title?: string, alt_text?: string, caption?: string, photographer?: string, countryIds?: *}} fields Nieuwe waarden.
   * @param {Function} [audit] Schrijft in dezelfde transactie de audit (`(client) => Promise`).
   * @returns {Promise<boolean>} Waar als de foto bestaat en is gewijzigd.
   */
  const update = (id, fields, audit) => db.transaction(async (client) => {
    const [row] = await client.query(
      `UPDATE media SET title = $2, alt_text = $3, caption = $4, photographer = $5, updated_at = now()
        WHERE id = $1 AND content_type LIKE 'image/%' RETURNING id`,
      [Number(id), ...Object.entries(TEXT_LIMITS).map(([name, max]) => cleanText(fields[name], max))],
    );
    if (!row) return false;
    const ids = await validCountryIds(client, fields.countryIds);
    await client.query('DELETE FROM media_countries WHERE media_id = $1 AND NOT (category_id = ANY($2::int[]))', [row.id, ids]);
    if (ids.length) await client.query('INSERT INTO media_countries (media_id, category_id) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING', [row.id, ids]);
    if (audit) await audit(client);
    return true;
  });

  return { countries, storeUpload, list, get, update };
}

module.exports = { createMediaLibrary, mediaUrl, titleFromFilename, cleanText, TEXT_LIMITS };
