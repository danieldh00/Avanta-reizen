/**
 * Fotobibliotheek (CMS-pakket F): foto's in de tabel `media`, gekoppeld aan landen via `media_countries`. Geüploade
 * foto's staan als WebP-varianten in `DATA_DIR/media` (naam `bib-<willekeurig>-<breedte>.webp`), geïmporteerde foto's
 * onder hun importnaam. Alle vragen met gebonden parameters; een upload wordt pas zichtbaar als bestanden én rij er zijn.
 */
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { processImage, resizeWebp, webpWidth, MAX_UPLOAD_BYTES } = require('./images');

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
 * Vergrendelt een foto die ergens gebruikt gaat worden (reis, reistype, land) met `SELECT … FOR SHARE`, zodat hij niet
 * tegelijk verwijderd kan worden (`remove` neemt `FOR UPDATE` op dezelfde rij). Aanroepen in de transactie die de
 * verwijzing opslaat; een verdwenen foto of iets anders dan een afbeelding geeft null.
 * @param {{query: Function}} client Transactie-client.
 * @param {(number|string)} id Id van de foto.
 * @returns {Promise<(object|null)>} De foto (id, local_name, variants, alt_text) of null.
 */
async function lockMediaForUse(client, id) {
  if (!/^\d{1,9}$/.test(String(id))) return null;
  const [row] = await client.query(
    "SELECT id, local_name, variants, alt_text FROM media WHERE id = $1 AND content_type LIKE 'image/%' FOR SHARE",
    [Number(id)],
  );
  return row || null;
}

/**
 * Koppelt foto's uit de import die nog geen land hebben automatisch aan landen (CMS-pakket F3): een foto die in een
 * reis staat (kop-, kaart- of galerijfoto of in de tekst) krijgt de landen van die reis, een foto die de kopfoto of in
 * de tekst van een landpagina staat krijgt dat land. Foto's met al een land (ook met de hand gekozen) blijven ongemoeid.
 * @param {{query: Function}} client Database of transactie-client.
 * @returns {Promise<{linked: number, links: number}>} Aantal foto's dat een land kreeg en aantal koppelingen.
 */
async function linkImportedMedia(client) {
  // De bestandsnaam als LIKE-patroon: \, % en _ ge-escaped.
  const rows = await client.query(
    `WITH open_media AS (
       SELECT m.id, '%/media/' || replace(replace(replace(m.local_name, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%' AS pattern
         FROM media m
        WHERE m.source = 'import' AND m.content_type LIKE 'image/%'
          AND NOT EXISTS (SELECT 1 FROM media_countries mc WHERE mc.media_id = m.id)
     ),
     found AS (
       SELECT o.id AS media_id, c.id AS category_id
         FROM open_media o
         JOIN trips t ON concat_ws(' ', t.hero_image_url, t.card_image_url, t.gallery::text, t.body_html) LIKE o.pattern
         JOIN trip_category_links l ON l.trip_id = t.id
         JOIN trip_categories c ON c.id = l.category_id AND c.kind = 'bestemming'
       UNION
       SELECT o.id, c.id
         FROM open_media o
         JOIN trip_categories c ON c.kind = 'bestemming' AND concat_ws(' ', c.image_url, c.body_html) LIKE o.pattern
     )
     INSERT INTO media_countries (media_id, category_id)
     SELECT media_id, category_id FROM found
     ON CONFLICT DO NOTHING
     RETURNING media_id`,
  );
  return { linked: new Set(rows.map((row) => row.media_id)).size, links: rows.length };
}

/**
 * SHA-256 van een buffer, als hex.
 * @param {Buffer} data Inhoud.
 * @returns {string} Hash.
 */
function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Of een pad een bestaand bestand is.
 * @param {string} file Pad.
 * @returns {Promise<boolean>} Waar als het bestand bestaat.
 */
async function fileExists(file) {
  try {
    return (await fs.stat(file)).isFile();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
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
 * @param {{db: object, mediaDir: string, dataDir?: string, appLog?: object}} options Database, map met de bestanden,
 *   de datamap met de vaste-inhoudbestanden (standaard de map boven `mediaDir`) en het logboek van de app
 *   (`system/app-log.js`, voor de meldingen van het onderhoud; zonder logboek naar de console).
 * @returns {object} Functies van de bibliotheek.
 */
function createMediaLibrary(options) {
  const { db, mediaDir } = options;
  const dataDir = options.dataDir || path.dirname(mediaDir);
  const appLog = options.appLog || {
    info: (source, message) => console.log(`${source}: ${message}`),
    error: (source, message) => console.error(`${source}: ${message}`),
  };

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
    // FOR SHARE: wacht op een lopende wijziging van de soort (`categories.update` met FOR UPDATE) en kijkt dan opnieuw,
    // zodat een foto nooit aan een categorie komt te hangen die net geen land meer is.
    const rows = await client.query("SELECT id FROM trip_categories WHERE kind = 'bestemming' AND id = ANY($1::int[]) ORDER BY id FOR SHARE", [wanted]);
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
        // De grootste variant ook in de database: zo zit de foto in elke back-up (M13).
        await client.query('INSERT INTO media_files (media_id, width, sha256, data) VALUES ($1, $2, $3, $4)', [row.id, largest.width, sha256(largest.data), largest.data]);
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
      } catch (error) {
        // Alleen een ontbrekend bestand betekent "niet gebruikt"; elke andere leesfout gaat door, zodat verwijderen
        // dan veilig mislukt in plaats van een gebruikte foto weg te halen.
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      if (names.some((name) => text.includes(`/media/${name}`))) places.push({ kind: entry.kind, title: entry.file, href: entry.href });
    }
    return places;
  };

  /**
   * Verwijdert een geüploade foto als die nergens gebruikt wordt: rij (met landen) in een transactie, daarna de bestanden.
   * Een foto uit de import wordt niet verwijderd (de import zou hem opnieuw ophalen).
   * Het slot ligt op de `media`-rij; schermen die een foto aan een reis, reistype of land koppelen vergrendelen dezelfde
   * rij met `lockMediaForUse` (`FOR SHARE`) en weigeren een verdwenen foto, zodat koppelen en verwijderen niet kunnen racen.
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
   * Zet geüploade foto's van vóór migratie 13 (alleen als bestand op schijf) alsnog in de database, zodat ze in de
   * back-up komen. Een ontbrekend, onleesbaar of beschadigd bestand wordt overgeslagen en geteld; de rest gaat door.
   * @returns {Promise<{stored: number, missing: number}>} Aantallen.
   */
  const backfillFiles = async () => {
    const rows = await db.query(
      `SELECT m.id, m.local_name FROM media m
        WHERE m.source = 'upload' AND NOT EXISTS (SELECT 1 FROM media_files f WHERE f.media_id = m.id) ORDER BY m.id`,
    );
    let stored = 0;
    let missing = 0;
    for (const row of rows) {
      let data;
      let width = null;
      try {
        const file = path.join(mediaDir, row.local_name);
        if (/^bib-[0-9a-f]{16}-\d{1,5}\.webp$/.test(row.local_name) && (await fs.stat(file)).size <= MAX_UPLOAD_BYTES) {
          data = await fs.readFile(file);
          // De breedte uit het bestand zelf: daarmee herkent het herstel de grootste variant.
          width = await webpWidth(data);
        }
      } catch {
        // Ontbrekend of onleesbaar (bijv. EACCES): overslaan en tellen, de rest gaat door.
      }
      if (!width) {
        missing++;
        continue;
      }
      await db.query('INSERT INTO media_files (media_id, width, sha256, data) VALUES ($1, $2, $3, $4) ON CONFLICT (media_id) DO NOTHING', [row.id, width, sha256(data), data]);
      stored++;
    }
    return { stored, missing };
  };

  /**
   * Herstelt ontbrekende bestanden van geüploade foto's uit de database (na het terugzetten van een back-up op een
   * nieuwe server, of als er een bestand weg is): de grootste variant zoals opgeslagen, de kleinere opnieuw gemaakt.
   * Eén foto tegelijk, zodat het geheugen klein blijft.
   * @returns {Promise<{restored: number, failed: number}>} Aantal herstelde foto's en mislukte (beschadigde inhoud).
   */
  const restoreMissingFiles = async () => {
    const rows = await db.query(
      `SELECT m.id, m.local_name, m.variants, f.width, f.sha256 FROM media m JOIN media_files f ON f.media_id = m.id
        WHERE m.source = 'upload' ORDER BY m.id`,
    );
    let restored = 0;
    let failed = 0;
    await fs.mkdir(mediaDir, { recursive: true });
    for (const row of rows) {
      const names = Object.entries(row.variants || {}).filter(([, name]) => /^bib-[0-9a-f]{16}-\d{1,5}\.webp$/.test(name));
      const missingNames = [];
      for (const [width, name] of names) if (!(await fileExists(path.join(mediaDir, name)))) missingNames.push([Number(width), name]);
      if (!missingNames.length) continue;
      const [file] = await db.query('SELECT data FROM media_files WHERE media_id = $1', [row.id]);
      if (!file || sha256(file.data) !== row.sha256) {
        failed++;
        continue;
      }
      try {
        for (const [width, name] of missingNames) {
          const data = width === row.width ? file.data : await resizeWebp(file.data, width);
          const target = path.join(mediaDir, name);
          await fs.writeFile(`${target}.tmp`, data);
          await fs.rename(`${target}.tmp`, target);
        }
        restored++;
      } catch (error) {
        if (error.code === 'ENOSPC' || error.code === 'EACCES') throw error;
        failed++;
      }
    }
    return { restored, failed };
  };

  /**
   * Start het onderhoud van de bibliotheek: bij het starten en daarna dagelijks foto's van vóór migratie 13 in de
   * database zetten, ontbrekende bestanden herstellen en losse bestanden opruimen. Meldingen gaan naar het logboek.
   * @returns {Promise<void>} De eerste ronde (faalt nooit; fouten staan in het logboek).
   */
  const startCleanupTimer = () => {
    const run = async () => {
      try {
        const backfill = await backfillFiles();
        if (backfill.stored) appLog.info('fotobibliotheek', `${backfill.stored} foto('s) in de database gezet voor de back-up`);
        if (backfill.missing) appLog.error('fotobibliotheek', `${backfill.missing} geüploade foto('s) zonder bruikbaar bestand en zonder kopie in de database`);
        const restore = await restoreMissingFiles();
        if (restore.restored) appLog.info('fotobibliotheek', `${restore.restored} foto('s) hersteld uit de database`);
        if (restore.failed) appLog.error('fotobibliotheek', `${restore.failed} foto('s) niet te herstellen uit de database`);
        const count = await cleanupOrphans();
        if (count) appLog.info('fotobibliotheek', `${count} los(se) bestand(en) opgeruimd`);
      } catch (error) {
        appLog.error('fotobibliotheek', `onderhoud mislukt (${error.code || error.name})`);
      }
    };
    setInterval(run, 24 * 60 * 60 * 1000).unref();
    return run();
  };

  return { countries, storeUpload, list, get, update, usage, remove, folders, cleanupOrphans, backfillFiles, restoreMissingFiles, startCleanupTimer };
}

module.exports = { createMediaLibrary, linkImportedMedia, lockMediaForUse, mediaUrl, titleFromFilename, cleanText, fileNamesOf, TEXT_LIMITS, USAGE_SOURCES };
