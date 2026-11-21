/**
 * Fotobibliotheek (CMS-pakket F): foto's in de tabel `media`, gekoppeld aan landen via `media_countries`. Geüploade
 * foto's staan als WebP-varianten in `DATA_DIR/media` (naam `bib-<willekeurig>-<breedte>.webp`), geïmporteerde foto's
 * onder hun importnaam. Alle vragen met gebonden parameters; een upload wordt pas zichtbaar als bestanden én rij er zijn.
 */
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { processImage } = require('./images');

/** Waar een foto gebruikt kan worden: soort, tabel, titelkolom, sleutelkolom, kolommen met adressen en het publieke pad. */
const USAGE_SOURCES = [
  { kind: 'Reis', table: 'trips', title: 'title', key: 'slug', columns: ['hero_image_url', 'card_image_url', 'gallery::text', 'body_html'], href: (key) => `/reis/${key}/` },
  { kind: 'Blogbericht', table: 'posts', title: 'title', key: 'slug', columns: ['image_url', 'body_html'], href: (key) => `/${key}/` },
  { kind: 'Pagina', table: 'pages', title: 'title', key: 'path', columns: ['image_url', 'body_html'], href: (key) => key },
  { kind: 'Reisleider', table: 'guides', title: 'name', key: 'slug', columns: ['photo_url', 'body_html'], href: (key) => `/reisleider/${key}/` },
  { kind: 'Reistype of land', table: 'trip_categories', title: 'name', key: 'slug', columns: ['image_url', 'body_html'], href: (key) => `/reis-categorie/${key}/` },
];

/** Bestanden in DATA_DIR met vaste inhoud die naar foto's kan verwijzen (tot pakket G/H dit overneemt). */
const USAGE_FILES = [{ file: 'homepage.json', kind: 'Homepage', href: '/' }, { file: 'site-content.json', kind: 'Vaste inhoud van de site', href: '' }];

/** Maximaal aantal plekken dat "gebruikt in" toont. */
const USAGE_LIMIT = 50;

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
 * Alle bestandsnamen van een foto: het hoofdbestand en de varianten.
 * @param {{local_name: string, variants?: object}} media Foto.
 * @returns {string[]} Unieke bestandsnamen.
 */
function fileNamesOf(media) {
  return [...new Set([media.local_name, ...Object.values(media.variants || {})].filter((name) => typeof name === 'string' && name))];
}

/**
 * Maakt de fotobibliotheek.
 * @param {{db: object, mediaDir: string, dataDir?: string}} options Database, map met de bestanden en de datamap met
 *   de vaste-inhoudbestanden (standaard de map boven `mediaDir`).
 * @returns {object} Functies van de bibliotheek.
 */
function createMediaLibrary(options) {
  const { db, mediaDir } = options;
  const dataDir = options.dataDir || path.dirname(mediaDir);

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

  /**
   * Waar een foto gebruikt wordt: reizen, berichten, pagina's, reisleiders, reiscategorieën en de vaste inhoud.
   * @param {{query: Function}} client Database of transactie-client.
   * @param {{local_name: string, variants?: object}} media Foto.
   * @returns {Promise<{kind: string, title: string, href: string}[]>} Plekken (hoogstens `USAGE_LIMIT`).
   */
  const usage = async (client, media) => {
    const names = fileNamesOf(media);
    const patterns = names.map((name) => `%/media/${name.replace(/[\\%_]/g, '\\$&')}%`);
    const union = USAGE_SOURCES.map((source, index) => `SELECT ${index} AS source, ${source.title} AS title, ${source.key} AS key FROM ${source.table}
       WHERE concat_ws(' ', ${source.columns.join(', ')}) LIKE ANY($1::text[])`).join(' UNION ALL ');
    const rows = await client.query(`SELECT source, title, key FROM (${union}) AS found ORDER BY source, title LIMIT ${USAGE_LIMIT}`, [patterns]);
    const places = rows.map((row) => ({ kind: USAGE_SOURCES[row.source].kind, title: row.title, href: USAGE_SOURCES[row.source].href(row.key) }));
    for (const entry of USAGE_FILES) {
      let text = '';
      try {
        text = await fs.readFile(path.join(dataDir, entry.file), 'utf8');
      } catch {
        continue;
      }
      if (names.some((name) => text.includes(`/media/${name}`))) places.push({ kind: entry.kind, title: entry.file, href: entry.href });
    }
    return places;
  };

  /**
   * Verwijdert een geüploade foto als die nergens gebruikt wordt: rij (met landen) in een transactie, daarna de bestanden.
   * Een foto uit de import wordt niet verwijderd (de import zou hem opnieuw ophalen).
   * @param {(number|string)} id Id.
   * @param {Function} [audit] Schrijft in dezelfde transactie de audit (`(client) => Promise`).
   * @returns {Promise<{status: ('weg'|'import'|'gebruikt'|'ok'), places?: object[]}>} Uitkomst.
   */
  const remove = async (id, audit) => {
    const outcome = await db.transaction(async (client) => {
      const [row] = await client.query("SELECT id, local_name, variants, source FROM media WHERE id = $1 AND content_type LIKE 'image/%' FOR UPDATE", [Number(id)]);
      if (!row) return { status: 'weg' };
      if (row.source !== 'upload') return { status: 'import' };
      const places = await usage(client, row);
      if (places.length) return { status: 'gebruikt', places };
      await client.query('DELETE FROM media WHERE id = $1', [row.id]);
      if (audit) await audit(client);
      return { status: 'ok', files: fileNamesOf(row) };
    });
    if (outcome.status === 'ok') {
      // Alleen eigen bestandsnamen (bib-…webp), nooit een pad uit de database blind volgen.
      await Promise.all(outcome.files.filter((name) => /^bib-[0-9a-f]{16}-\d{1,5}\.webp$/.test(name)).map((name) => fs.rm(path.join(mediaDir, name), { force: true })));
      return { status: 'ok' };
    }
    return outcome;
  };

  /**
   * Aantal foto's per land (alle landen, ook zonder foto's) en het aantal foto's zonder land.
   * @returns {Promise<{countries: {id: number, name: string, count: number}[], without: number}>} Tellingen.
   */
  const folders = async () => {
    const [countryRows, [without]] = await Promise.all([
      db.query(
        `SELECT c.id, c.name, count(m.id)::int AS count
           FROM trip_categories c
           LEFT JOIN media_countries mc ON mc.category_id = c.id
           LEFT JOIN media m ON m.id = mc.media_id AND m.content_type LIKE 'image/%'
          WHERE c.kind = 'bestemming'
          GROUP BY c.id ORDER BY c.name, c.id`,
      ),
      db.query("SELECT count(*)::int AS count FROM media m WHERE m.content_type LIKE 'image/%' AND NOT EXISTS (SELECT 1 FROM media_countries mc WHERE mc.media_id = m.id)"),
    ]);
    return { countries: countryRows, without: without.count };
  };

  /**
   * Ruimt bestanden van de bibliotheek op (`bib-…webp`, ook `.tmp`) waar geen rij in `media` naar verwijst, bijvoorbeeld
   * na een crash tussen wegschrijven en opslaan. Alleen bestanden ouder dan `minAgeMs`, zodat een lopende upload blijft.
   * @param {{minAgeMs?: number, now?: number}} [cleanupOptions] Minimale leeftijd (standaard een dag) en het huidige moment.
   * @returns {Promise<number>} Aantal verwijderde bestanden.
   */
  const cleanupOrphans = async (cleanupOptions = {}) => {
    const minAgeMs = cleanupOptions.minAgeMs ?? 24 * 60 * 60 * 1000;
    const now = cleanupOptions.now ?? Date.now();
    let entries;
    try {
      entries = await fs.readdir(mediaDir);
    } catch {
      return 0;
    }
    const candidates = entries.filter((name) => /^bib-[0-9a-f]{16}-\d{1,5}\.webp(\.tmp)?$/.test(name));
    if (!candidates.length) return 0;
    const rows = await db.query("SELECT local_name, variants FROM media WHERE source = 'upload'");
    const known = new Set(rows.flatMap(fileNamesOf));
    let removed = 0;
    for (const name of candidates) {
      if (known.has(name)) continue;
      const file = path.join(mediaDir, name);
      try {
        const stats = await fs.stat(file);
        if (now - stats.mtimeMs < minAgeMs) continue;
        await fs.rm(file, { force: true });
        removed++;
      } catch {
        // Intussen weg of niet leesbaar: overslaan.
      }
    }
    return removed;
  };

  /**
   * Start het dagelijks opruimen van losse bestanden (direct bij het starten en daarna elke dag).
   * @returns {void}
   */
  const startCleanupTimer = () => {
    const run = () => cleanupOrphans()
      .then((count) => { if (count) console.log(`fotobibliotheek: ${count} los(se) bestand(en) opgeruimd`); })
      .catch((error) => console.error(`fotobibliotheek: opruimen mislukt (${error.code || error.name})`));
    run();
    setInterval(run, 24 * 60 * 60 * 1000).unref();
  };

  return { countries, storeUpload, list, get, update, usage, remove, folders, cleanupOrphans, startCleanupTimer };
}

module.exports = { createMediaLibrary, mediaUrl, titleFromFilename, cleanText, fileNamesOf, TEXT_LIMITS, USAGE_SOURCES };
