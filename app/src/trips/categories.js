/**
 * Reistypes en landen (CMS-pakket G1, migratie 14): de tabel `trip_categories` met soort (`type`, `bestemming`,
 * `overig`), naam, slug, icoon (uit de vaste set eigen iconen), inleiding, tekst, foto uit de fotobibliotheek, volgorde
 * en "tonen op de homepage". Dubbelingen uit de import (bijv. `saudi-arabie-2`) kunnen worden samengevoegd: de reizen en
 * foto's gaan naar de andere categorie en het oude adres krijgt een 301. Een gewijzigde slug maakt ook een 301.
 * Alle vragen met gebonden parameters; elke wijziging met audit in dezelfde transactie.
 */
const { sanitizeHtml } = require('../../tools/import/sanitize');
const { TYPE_ICONS } = require('../site/icons');
const { categoryPath } = require('../site/format');
const { cleanText, lockMediaForUse, mediaUrl } = require('../media/library');
const { slugify, isValidSlug, recordMove } = require('./slugs');

/** Soorten met hun naam voor het scherm. */
const KINDS = { type: 'Reistype', bestemming: 'Land', overig: 'Overig' };

/** De iconen die een reistype kan krijgen (de eigen SVG-set uit `site/icons.js`). */
const ICON_CHOICES = [...new Set(Object.values(TYPE_ICONS))].sort();

/** Maximale lengtes van de velden. */
const LIMITS = { name: 120, intro: 2000, body: 100_000 };

/** Breedte van de foto die bij een categorie wordt opgeslagen (kopfoto en banner). */
const IMAGE_WIDTH = 1600;

/** Kolommen van een categorie (nooit `SELECT *`). */
const CATEGORY_COLUMNS = `c.id, c.slug, c.name, c.kind, c.icon, c.intro, c.body_html, c.image_url, c.sort_order, c.show_on_home,
  c.legacy_id, c.updated_at`;

/**
 * Leest en controleert de velden van een categorie uit een formulier.
 * @param {object} body Ingezonden velden.
 * @returns {{values: object, errors: object}} Opgeschoonde waarden en fouten per veld.
 */
function validateCategory(body) {
  const text = (name) => (typeof body[name] === 'string' ? body[name] : '');
  const errors = {};
  const name = cleanText(text('name'), LIMITS.name);
  if (!name) errors.name = 'Vul een naam in.';
  const slug = text('slug').trim().toLowerCase() || slugify(name);
  if (!isValidSlug(slug)) errors.slug = 'Gebruik alleen kleine letters, cijfers en streepjes (maximaal 80 tekens).';
  const kind = text('kind');
  if (!Object.hasOwn(KINDS, kind)) errors.kind = 'Kies een soort.';
  const icon = text('icon');
  if (icon && !ICON_CHOICES.includes(icon)) errors.icon = 'Kies een icoon uit de lijst.';
  const intro = text('intro').replace(/\r\n/g, '\n').trim();
  if (intro.length > LIMITS.intro) errors.intro = `Maximaal ${LIMITS.intro} tekens.`;
  const rawBody = text('body_html');
  if (rawBody.length > LIMITS.body) errors.body_html = 'De tekst is te lang.';
  const sortText = text('sort_order').trim() || '0';
  const sortOrder = Number(sortText);
  if (!/^-?\d{1,4}$/.test(sortText)) errors.sort_order = 'Vul een heel getal in tussen -9999 en 9999.';
  return {
    values: {
      name,
      slug,
      kind,
      icon,
      intro,
      bodyHtml: errors.body_html ? '' : sanitizeHtml(rawBody),
      sortOrder: Number.isInteger(sortOrder) ? sortOrder : 0,
      showOnHome: body.show_on_home === '1',
    },
    errors,
  };
}

/**
 * Of een databasefout een dubbele slug is.
 * @param {Error} error Fout.
 * @returns {boolean} Waar bij een schending van de unieke slug.
 */
function isDuplicateSlug(error) {
  return error && error.code === '23505' && /slug/.test(error.constraint || error.detail || '');
}

/**
 * Maakt de functies voor reistypes en landen.
 * @param {{db: object}} options Database.
 * @returns {object} Functies.
 */
function createCategories(options) {
  const { db } = options;

  /**
   * Alle categorieën van een soort (of alle), met het aantal reizen (komend en totaal) en foto's.
   * @param {{kind?: string}} [filter] Soort.
   * @returns {Promise<object[]>} Categorieën op volgorde en naam.
   */
  const list = (filter = {}) => db.query(
    `SELECT c.id, c.slug, c.name, c.kind, c.icon, c.image_url, c.sort_order, c.show_on_home,
            (SELECT count(*)::int FROM trip_category_links l WHERE l.category_id = c.id) AS trip_count,
            (SELECT count(*)::int FROM trip_category_links l JOIN trips t ON t.id = l.trip_id
              WHERE l.category_id = c.id AND t.departure_date >= (now() AT TIME ZONE 'Europe/Amsterdam')::date) AS upcoming_count,
            (SELECT count(*)::int FROM media_countries mc WHERE mc.category_id = c.id) AS photo_count
       FROM trip_categories c
      WHERE ($1::text IS NULL OR c.kind = $1)
      ORDER BY c.kind, c.sort_order, c.name, c.id`,
    [filter.kind && Object.hasOwn(KINDS, filter.kind) ? filter.kind : null],
  );

  /**
   * Eén categorie met dezelfde tellingen als in de lijst.
   * @param {(number|string)} id Id.
   * @returns {Promise<(object|null)>} Categorie of null.
   */
  const get = async (id) => {
    const [row] = await db.query(
      `SELECT ${CATEGORY_COLUMNS},
              (SELECT count(*)::int FROM trip_category_links l WHERE l.category_id = c.id) AS trip_count,
              (SELECT count(*)::int FROM media_countries mc WHERE mc.category_id = c.id) AS photo_count
         FROM trip_categories c WHERE c.id = $1`,
      [Number(id)],
    );
    return row || null;
  };

  /**
   * Maakt een nieuwe categorie.
   * @param {object} values Waarden uit `validateCategory`.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit (`(client, id) => Promise`).
   * @returns {Promise<{id?: number, errors?: object}>} Het nieuwe id, of fouten.
   */
  const create = async (values, context) => {
    try {
      return await db.transaction(async (client) => {
        const [row] = await client.query(
          `INSERT INTO trip_categories (slug, name, kind, icon, intro, body_html, sort_order, show_on_home)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [values.slug, values.name, values.kind, values.icon, values.intro, values.bodyHtml, values.sortOrder, values.showOnHome],
        );
        // Een oude doorverwijzing vanaf dit adres zou de nieuwe pagina verbergen.
        await client.query('DELETE FROM redirects WHERE from_path = $1', [categoryPath(values.slug)]);
        await context.audit(client, row.id);
        return { id: row.id };
      });
    } catch (error) {
      if (isDuplicateSlug(error)) return { errors: { slug: 'Deze slug is al in gebruik.' } };
      throw error;
    }
  };

  /**
   * Wijzigt een categorie; bij een andere slug komt er een 301 van het oude adres.
   * @param {(number|string)} id Id.
   * @param {object} values Waarden uit `validateCategory`.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit (`(client) => Promise`).
   * @returns {Promise<{status: ('ok'|'weg'|'fout'), errors?: object, moved?: boolean}>} Uitkomst.
   */
  const update = async (id, values, context) => {
    try {
      return await db.transaction(async (client) => {
        const [current] = await client.query('SELECT id, slug FROM trip_categories WHERE id = $1 FOR UPDATE', [Number(id)]);
        if (!current) return { status: 'weg' };
        await client.query(
          `UPDATE trip_categories SET slug = $2, name = $3, kind = $4, icon = $5, intro = $6, body_html = $7, sort_order = $8,
             show_on_home = $9, updated_at = now() WHERE id = $1`,
          [current.id, values.slug, values.name, values.kind, values.icon, values.intro, values.bodyHtml, values.sortOrder, values.showOnHome],
        );
        const moved = current.slug !== values.slug;
        if (moved) {
          await recordMove(client, { fromPath: categoryPath(current.slug), toPath: categoryPath(values.slug), userId: context.userId, note: 'Automatisch: slug van reistype of land gewijzigd' });
        }
        await context.audit(client);
        return { status: 'ok', moved };
      });
    } catch (error) {
      if (isDuplicateSlug(error)) return { status: 'fout', errors: { slug: 'Deze slug is al in gebruik.' } };
      throw error;
    }
  };

  /**
   * Zet de foto van een categorie: een foto uit de bibliotheek (vergrendeld met `FOR SHARE`, zodat hij niet tegelijk
   * verwijderd kan worden) of geen foto.
   * @param {(number|string)} id Id van de categorie.
   * @param {(number|null)} mediaId Id van de foto, of null voor geen foto.
   * @param {Function} audit Audit in dezelfde transactie (`(client) => Promise`).
   * @returns {Promise<('ok'|'weg'|'foto-weg')>} Uitkomst.
   */
  const setImage = (id, mediaId, audit) => db.transaction(async (client) => {
    const [current] = await client.query('SELECT id FROM trip_categories WHERE id = $1 FOR UPDATE', [Number(id)]);
    if (!current) return 'weg';
    let url = null;
    if (mediaId !== null) {
      const photo = await lockMediaForUse(client, mediaId);
      if (!photo) return 'foto-weg';
      url = mediaUrl(photo, IMAGE_WIDTH);
    }
    await client.query('UPDATE trip_categories SET image_url = $2, updated_at = now() WHERE id = $1', [current.id, url]);
    await audit(client);
    return 'ok';
  });

  /**
   * Voegt een categorie samen met een andere (dubbelingen opruimen): de reizen en foto's van de bron horen voortaan bij
   * het doel, de bron verdwijnt en zijn adres krijgt een 301 naar het doel.
   * @param {(number|string)} sourceId Categorie die verdwijnt.
   * @param {(number|string)} targetId Categorie die blijft.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit (`(client) => Promise`).
   * @returns {Promise<{status: ('ok'|'weg'|'doel-weg'|'zelfde'), trips?: number, target?: object}>} Uitkomst.
   */
  const merge = (sourceId, targetId, context) => {
    if (Number(sourceId) === Number(targetId)) return Promise.resolve({ status: 'zelfde' });
    return db.transaction(async (client) => {
      // Beide rijen op volgorde van id vergrendelen, zodat twee gelijktijdige samenvoegingen niet op elkaar wachten.
      const rows = await client.query('SELECT id, slug, name FROM trip_categories WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE', [[Number(sourceId), Number(targetId)]]);
      const source = rows.find((row) => row.id === Number(sourceId));
      const target = rows.find((row) => row.id === Number(targetId));
      if (!source) return { status: 'weg' };
      if (!target) return { status: 'doel-weg' };
      const moved = await client.query(
        `INSERT INTO trip_category_links (trip_id, category_id)
           SELECT trip_id, $2 FROM trip_category_links WHERE category_id = $1
         ON CONFLICT DO NOTHING RETURNING trip_id`,
        [source.id, target.id],
      );
      await client.query(
        `INSERT INTO media_countries (media_id, category_id)
           SELECT media_id, $2 FROM media_countries WHERE category_id = $1
         ON CONFLICT DO NOTHING`,
        [source.id, target.id],
      );
      await client.query('DELETE FROM trip_categories WHERE id = $1', [source.id]);
      await recordMove(client, { fromPath: categoryPath(source.slug), toPath: categoryPath(target.slug), userId: context.userId, note: `Automatisch: samengevoegd met ${target.name}` });
      await context.audit(client);
      return { status: 'ok', trips: moved.length, target };
    });
  };

  /**
   * Verwijdert een categorie die nergens gebruikt wordt (geen reizen en geen foto's).
   * @param {(number|string)} id Id.
   * @param {Function} audit Audit in dezelfde transactie (`(client) => Promise`).
   * @returns {Promise<('ok'|'weg'|'gebruikt')>} Uitkomst.
   */
  const remove = (id, audit) => db.transaction(async (client) => {
    const [row] = await client.query('SELECT id FROM trip_categories WHERE id = $1 FOR UPDATE', [Number(id)]);
    if (!row) return 'weg';
    const [usage] = await client.query(
      `SELECT EXISTS (SELECT 1 FROM trip_category_links WHERE category_id = $1)
              OR EXISTS (SELECT 1 FROM media_countries WHERE category_id = $1) AS used`,
      [row.id],
    );
    if (usage.used) return 'gebruikt';
    await client.query('DELETE FROM trip_categories WHERE id = $1', [row.id]);
    await audit(client);
    return 'ok';
  });

  return { list, get, create, update, setImage, merge, remove };
}

module.exports = { createCategories, validateCategory, KINDS, ICON_CHOICES, LIMITS, IMAGE_WIDTH };
