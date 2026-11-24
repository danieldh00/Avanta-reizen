/**
 * Reisleiders beheren (CMS-pakket I4, migratie 22): profiel (voornaam, achternaam, woonplaats, sinds, citaat,
 * inleiding, tekst), adres (`/reisleider/<slug>/`, een ander adres geeft een 301), portret en kopfoto uit de
 * fotobibliotheek, online/offline, nieuw en verwijderen. Een reisleider die hier is gewijzigd krijgt `managed_in_crm`:
 * de WordPress-import laat hem dan staan. De gegevens van de huidige site zijn bij de update overgezet
 * (`adoptFixedGuide`, aangeroepen door `site/content-transfer.js`); de site leest alleen de database. Ook de volgorde in de lijst op de site (`sort_order`) en de fotogalerij onderaan de pagina (titel, subtitel en
 * foto's uit de bibliotheek, migratie 34) worden hier beheerd. Elke wijziging schrijft de audit in dezelfde transactie; alle vragen met gebonden parameters.
 */
const { cleanText, lockMediaForUse, mediaUrl } = require('../media/library');
const { slugify, isValidSlug, recordMove } = require('./slugs');
const crypto = require('node:crypto');
const { sanitizeHtml } = require('../../tools/import/sanitize');

/** Maximale lengtes. */
const GUIDE_LIMITS = { name: 120, surname: 120, city: 120, quote: 400, intro: 1000, body: 50_000, galleryText: 120, gallery: 40 };

/** Grenzen van de volgorde in de lijst met reisleiders. */
const SORT_ORDER_LIMIT = 100_000;

/** Breedte van de foto's in de galerij (zoals de galerij van een reis). */
const GALLERY_WIDTH = 1600;

/** Breedte van de opgeslagen foto per soort: portret (staand, lijst en detail) en kopfoto (naast het portret). */
const PHOTO_FIELDS = Object.freeze({
  portret: { column: 'photo_url', width: 800, label: 'Portret' },
  kopfoto: { column: 'image_url', width: 1600, label: 'Tweede foto' },
});

/** Kolommen van een reisleider (nooit `SELECT *`). */
const GUIDE_COLUMNS = `g.id, g.slug, g.legacy_id, g.name, g.surname, g.intro, g.body_html, g.photo_url, g.image_url, g.city, g.since,
  g.quote, g.published, g.sort_order, g.managed_in_crm, g.updated_at, g.gallery, g.gallery_title, g.gallery_subtitle`;

/**
 * Leest en controleert het profiel van een reisleider uit een formulier; de tekst gaat door `sanitizeHtml`.
 * @param {object} body Ingezonden velden.
 * @returns {{values: object, errors: object}} Waarden (`name`, `surname`, `slug`, `city`, `since`, `quote`, `intro`,
 *   `bodyHtml`, `bodyInput`, `sortOrder`: lager staat eerder in de lijst op de site, null = ongewijzigd) en fouten per veld.
 */
function validateGuideFields(body) {
  const text = (name) => (typeof body[name] === 'string' ? body[name] : '');
  const errors = {};
  /**
   * Eén tekstregel met maximale lengte.
   * @param {string} name Veld.
   * @param {number} max Maximum.
   * @returns {string} Opgeschoonde tekst.
   */
  const line = (name, max) => {
    const value = cleanText(text(name), max + 1);
    if (value.length > max) errors[name] = `Maximaal ${max} tekens.`;
    return value.slice(0, max);
  };
  const name = line('name', GUIDE_LIMITS.name);
  if (!name && !errors.name) errors.name = 'Vul een voornaam in.';
  const slug = text('slug').trim() || slugify(name);
  if (!isValidSlug(slug)) errors.slug = 'Gebruik kleine letters, cijfers en streepjes (bijv. martijn).';
  const since = text('since').trim();
  if (since && !/^(19|20)\d\d$/.test(since)) errors.since = 'Vul een jaartal in (bijv. 2015).';
  const intro = text('intro').replace(/\r\n/g, '\n').trim();
  if (intro.length > GUIDE_LIMITS.intro) errors.intro = `Maximaal ${GUIDE_LIMITS.intro} tekens.`;
  const sortInput = text('sort_order').trim();
  /** @type {(number|null)} */
  let sortOrder = null;
  if (sortInput && (!/^-?\d{1,6}$/.test(sortInput) || Math.abs(Number(sortInput)) > SORT_ORDER_LIMIT)) errors.sort_order = 'Vul een heel getal in.';
  else if (sortInput) sortOrder = Number(sortInput);
  const bodyInput = text('body');
  if (bodyInput.length > GUIDE_LIMITS.body) errors.body = `Maximaal ${GUIDE_LIMITS.body} tekens.`;
  return {
    values: {
      name,
      surname: line('surname', GUIDE_LIMITS.surname),
      slug,
      city: line('city', GUIDE_LIMITS.city),
      since: errors.since ? '' : since,
      quote: line('quote', GUIDE_LIMITS.quote),
      // eslint-disable-next-line no-control-regex
      intro: intro.slice(0, GUIDE_LIMITS.intro).replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, ''),
      bodyHtml: errors.body ? '' : sanitizeHtml(bodyInput),
      bodyInput: bodyInput.slice(0, GUIDE_LIMITS.body),
      sortOrder,
    },
    errors,
  };
}

/**
 * Vingerafdruk van een galerij (de adressen op volgorde), zodat een formulier dat op een oudere stand is gemaakt geen
 * verkeerde foto's verschuift of weghaalt.
 * @param {*} gallery Galerij uit de database.
 * @returns {string} Korte hash.
 */
function galleryFingerprint(gallery) {
  const urls = (Array.isArray(gallery) ? gallery : []).map((item) => (item && typeof item.url === 'string' ? item.url : ''));
  return crypto.createHash('sha256').update(JSON.stringify(urls)).digest('hex').slice(0, 16);
}

/**
 * Leest de nieuwe volgorde van de galerij uit het formulier: per foto een volgnummer (`volgorde_<i>`) en vinkjes om weg
 * te halen (`weg`). Ontbrekende of foute nummers houden hun plaats; bij gelijke nummers telt de oude volgorde.
 * @param {Record<string, *>} body Ingezonden velden.
 * @param {number} count Aantal foto's in de galerij.
 * @returns {number[]} De oude posities in de nieuwe volgorde, zonder de weggehaalde.
 */
function arrangedPositions(body, count) {
  const removed = new Set([].concat(body.weg || []).map(String));
  const positions = [];
  for (let index = 0; index < count; index += 1) {
    if (removed.has(String(index))) continue;
    const input = typeof body[`volgorde_${index}`] === 'string' ? body[`volgorde_${index}`].trim() : '';
    const wanted = /^\d{1,3}$/.test(input) ? Number(input) : index + 1;
    positions.push({ index, wanted });
  }
  positions.sort((first, second) => first.wanted - second.wanted || first.index - second.index);
  return positions.map((position) => position.index);
}

/**
 * Zet de gegevens uit `site-content.json` van één reisleider in de database en zet hem op beheerd in het CRM: profiel-
 * velden, portret en tweede foto (alleen als het bestand er een heeft) en de galerij als die in de database nog leeg is.
 * Gebruikt bij het overzetten van de vaste inhoud (`site/content-transfer.js`).
 * @param {{query: Function}} client Transactie-client.
 * @param {number} guideId Id.
 * @param {object} [extra] Gegevens uit het bestand (`surname`, `city`, `since`, `quote`, `portrait`, `image`,
 *   `galleryTitle`, `gallerySubtitle`, `gallery`).
 * @returns {Promise<void>}
 */
async function adoptFixedGuide(client, guideId, extra) {
  const fixed = extra || {};
  const gallery = (Array.isArray(fixed.gallery) ? fixed.gallery : []).map((url) => ({ url, alt: '' }));
  await client.query(
    `UPDATE guides SET surname = $2, city = $3, since = $4, quote = $5, photo_url = COALESCE(NULLIF($6, ''), photo_url),
       image_url = COALESCE(NULLIF($7, ''), image_url),
       gallery = CASE WHEN gallery = '[]'::jsonb THEN $8::jsonb ELSE gallery END,
       gallery_title = CASE WHEN gallery = '[]'::jsonb THEN $9 ELSE gallery_title END,
       gallery_subtitle = CASE WHEN gallery = '[]'::jsonb THEN $10 ELSE gallery_subtitle END,
       managed_in_crm = true WHERE id = $1`,
    [guideId, fixed.surname || '', fixed.city || '', fixed.since || '', fixed.quote || '', fixed.portrait || '', fixed.image || '',
      JSON.stringify(gallery), fixed.galleryTitle || '', fixed.gallerySubtitle || ''],
  );
}

/**
 * Of een id uit de URL geldig is.
 * @param {*} id Waarde.
 * @returns {boolean} Geldig.
 */
const validId = (id) => /^\d{1,9}$/.test(String(id));

/**
 * Maakt de functies voor reisleiders.
 * @param {{db: object}} options Database.
 * @returns {object} Functies.
 */
function createGuides(options) {
  const { db } = options;

  /**
   * Alle reisleiders met het aantal reizen, op de volgorde van de site (daarna op naam); optioneel gefilterd op zoektermen (naam of achternaam).
   * @param {{patterns?: string[]}} [filter] LIKE-patronen.
   * @returns {Promise<object[]>} Rijen.
   */
  const list = (filter = {}) => {
    const patterns = filter.patterns || [];
    return db.query(
      `SELECT g.id, g.slug, g.name, g.surname, g.published, g.photo_url, g.managed_in_crm, g.sort_order,
              (SELECT count(*)::int FROM trip_guides tg WHERE tg.guide_id = g.id) AS trip_count
         FROM guides g
        WHERE cardinality($1::text[]) = 0 OR (SELECT bool_and(concat_ws(' ', g.name, g.surname) ILIKE pattern) FROM unnest($1::text[]) AS pattern)
        ORDER BY g.sort_order, g.name, g.surname, g.id LIMIT 500`,
      [patterns],
    );
  };

  /**
   * Eén reisleider met het aantal reizen.
   * @param {(number|string)} id Id.
   * @returns {Promise<(object|null)>} Rij of null.
   */
  const get = async (id) => {
    if (!validId(id)) return null;
    const [row] = await db.query(
      `SELECT ${GUIDE_COLUMNS}, (SELECT count(*)::int FROM trip_guides tg WHERE tg.guide_id = g.id) AS trip_count FROM guides g WHERE g.id = $1`,
      [Number(id)],
    );
    return row || null;
  };

  /**
   * Of een slug al door een andere reisleider wordt gebruikt.
   * @param {object} client Client.
   * @param {string} slug Slug.
   * @param {(number|null)} exceptId Eigen id.
   * @returns {Promise<boolean>} Bezet.
   */
  const slugTaken = async (client, slug, exceptId) => {
    const [other] = await client.query('SELECT id FROM guides WHERE slug = $1 AND id IS DISTINCT FROM $2', [slug, exceptId]);
    return Boolean(other);
  };

  /**
   * Maakt een reisleider (offline, beheerd in het CRM).
   * @param {{name: string, slug: string}} values Naam en slug.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit (`(client, id) => Promise`).
   * @returns {Promise<{id?: number, errors?: object, cleared?: boolean}>} Nieuw id (en of er een doorverwijzing
   *   verviel; dan `redirects.reload()`) of fouten.
   */
  const create = (values, context) => db.transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['reisleider-adres']);
    if (await slugTaken(client, values.slug, null)) return { errors: { slug: 'Dit adres bestaat al.' } };
    const [row] = await client.query(
      `INSERT INTO guides (slug, name, published, managed_in_crm, updated_by, sort_order)
       VALUES ($1, $2, false, true, $3, (SELECT COALESCE(max(sort_order), 0) + 1 FROM guides)) RETURNING id`,
      [values.slug, values.name, context.userId],
    );
    // Een oude doorverwijzing vanaf dit adres (bijv. van een verwijderde reisleider) zou de nieuwe pagina verbergen.
    const cleared = await client.query('DELETE FROM redirects WHERE from_path = $1 RETURNING id', [`/reisleider/${values.slug}/`]);
    await context.audit(client, row.id);
    return { id: row.id, cleared: cleared.length > 0 };
  });

  /**
   * Wijzigt het profiel; een ander adres geeft een 301 vanaf het oude (daarna `redirects.reload()`).
   * @param {(number|string)} id Id.
   * @param {object} values Uit `validateGuideFields`.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit.
   * @returns {Promise<{status: ('ok'|'weg'|'fout'), errors?: object, moved?: boolean}>} Uitkomst.
   */
  const update = (id, values, context) => db.transaction(async (client) => {
    if (!validId(id)) return { status: 'weg' };
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['reisleider-adres']);
    const [guide] = await client.query('SELECT id, slug FROM guides WHERE id = $1 FOR UPDATE', [Number(id)]);
    if (!guide) return { status: 'weg' };
    if (values.slug !== guide.slug && await slugTaken(client, values.slug, guide.id)) return { status: 'fout', errors: { slug: 'Dit adres bestaat al.' } };
    await client.query(
      `UPDATE guides SET name = $2, surname = $3, slug = $4, city = $5, since = $6, quote = $7, intro = $8, body_html = $9,
         sort_order = COALESCE($11, sort_order), managed_in_crm = true, updated_at = now(), updated_by = $10 WHERE id = $1`,
      [guide.id, values.name, values.surname, values.slug, values.city, values.since, values.quote, values.intro, values.bodyHtml, context.userId, values.sortOrder],
    );
    const moved = values.slug !== guide.slug;
    if (moved) await recordMove(client, { fromPath: `/reisleider/${guide.slug}/`, toPath: `/reisleider/${values.slug}/`, userId: context.userId, note: 'Reisleider kreeg een ander adres' });
    await context.audit(client);
    return { status: 'ok', moved };
  });

  /**
   * Zet een reisleider online of offline (offline: geen pagina en niet in de lijst; reizen tonen hem niet meer).
   * @param {(number|string)} id Id.
   * @param {boolean} online Online.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit.
   * @returns {Promise<{status: ('ok'|'weg')}>} Uitkomst.
   */
  const setOnline = (id, online, context) => db.transaction(async (client) => {
    if (!validId(id)) return { status: 'weg' };
    const [guide] = await client.query('SELECT id FROM guides WHERE id = $1 FOR UPDATE', [Number(id)]);
    if (!guide) return { status: 'weg' };
    await client.query('UPDATE guides SET published = $2, managed_in_crm = true, updated_at = now(), updated_by = $3 WHERE id = $1', [guide.id, online, context.userId]);
    await context.audit(client);
    return { status: 'ok' };
  });

  /**
   * Kiest het portret of de tweede foto uit de bibliotheek (of geen).
   * @param {(number|string)} id Id.
   * @param {string} kind `portret` of `kopfoto`.
   * @param {(number|null)} mediaId Foto, of null voor geen.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit.
   * @returns {Promise<('ok'|'weg'|'foto-weg')>} Uitkomst.
   */
  const setPhoto = (id, kind, mediaId, context) => db.transaction(async (client) => {
    const field = PHOTO_FIELDS[kind];
    if (!field || !validId(id)) return 'weg';
    const [guide] = await client.query('SELECT id FROM guides WHERE id = $1 FOR UPDATE', [Number(id)]);
    if (!guide) return 'weg';
    let url = null;
    if (mediaId !== null) {
      const photo = await lockMediaForUse(client, mediaId);
      if (!photo) return 'foto-weg';
      url = mediaUrl(photo, field.width);
    }
    // De kolomnaam komt uit de vaste lijst PHOTO_FIELDS, nooit uit de invoer.
    await client.query(`UPDATE guides SET ${field.column} = $2, managed_in_crm = true, updated_at = now(), updated_by = $3 WHERE id = $1`, [guide.id, url, context.userId]);
    await context.audit(client);
    return 'ok';
  });

  /**
   * Verwijdert een reisleider die offline staat, niet uit de import komt (die zou terugkomen; zet hem offline) en aan
   * geen reis hangt. Het adres verwijst daarna naar de lijst met reisleiders.
   * @param {(number|string)} id Id.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit.
   * @returns {Promise<{status: ('ok'|'weg'|'online'|'import'|'reizen')}>} Uitkomst.
   */
  const remove = (id, context) => db.transaction(async (client) => {
    if (!validId(id)) return { status: 'weg' };
    const [guide] = await client.query('SELECT id, slug, published, legacy_id FROM guides WHERE id = $1 FOR UPDATE', [Number(id)]);
    if (!guide) return { status: 'weg' };
    if (guide.published) return { status: 'online' };
    if (guide.legacy_id !== null) return { status: 'import' };
    // Geen race met koppelen: een INSERT in trip_guides neemt via de foreign key FOR KEY SHARE op deze guides-rij, wat
    // botst met de FOR UPDATE hierboven. Koppelen wacht dus (en faalt daarna op de foreign key), of verwijderen wacht
    // op de commit van het koppelen en ziet de koppeling dan wel (READ COMMITTED: nieuwe snapshot per statement).
    const [linked] = await client.query('SELECT 1 AS linked FROM trip_guides WHERE guide_id = $1 LIMIT 1', [guide.id]);
    if (linked) return { status: 'reizen' };
    await client.query('DELETE FROM guides WHERE id = $1', [guide.id]);
    await recordMove(client, { fromPath: `/reisleider/${guide.slug}/`, toPath: '/reisleider/', userId: context.userId, note: 'Reisleider verwijderd' });
    await context.audit(client);
    return { status: 'ok' };
  });


  /**
   * Vergrendelt een reisleider voor een wijziging aan de galerij.
   * @param {object} client Transactie-client.
   * @param {(number|string)} id Id.
   * @returns {Promise<(object|null)>} Id en galerij, of null.
   */
  const lockForGallery = async (client, id) => {
    if (!validId(id)) return null;
    const [guide] = await client.query('SELECT id, gallery FROM guides WHERE id = $1 FOR UPDATE', [Number(id)]);
    if (!guide) return null;
    return { id: guide.id, gallery: Array.isArray(guide.gallery) ? guide.gallery : [] };
  };

  /**
   * Schrijft de galerij en zet de reisleider op beheerd in het CRM.
   * @param {object} client Transactie-client.
   * @param {number} guideId Id.
   * @param {object[]} gallery Nieuwe galerij.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit.
   * @returns {Promise<void>}
   */
  const saveGallery = async (client, guideId, gallery, context) => {
    await client.query('UPDATE guides SET gallery = $2::jsonb, managed_in_crm = true, updated_at = now(), updated_by = $3 WHERE id = $1', [guideId, JSON.stringify(gallery), context.userId]);
    await context.audit(client);
  };

  /**
   * Voegt foto's uit de bibliotheek achter aan de galerij toe (een foto die er al in staat, slaat hij over).
   * @param {(number|string)} id Id.
   * @param {number[]} mediaIds Foto's.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit.
   * @returns {Promise<('ok'|'weg'|'foto-weg'|'te-veel')>} Uitkomst.
   */
  const addGalleryPhotos = (id, mediaIds, context) => db.transaction(async (client) => {
    const guide = await lockForGallery(client, id);
    if (!guide) return 'weg';
    const gallery = [...guide.gallery];
    for (const mediaId of [...new Set(mediaIds)]) {
      const photo = await lockMediaForUse(client, mediaId);
      if (!photo) return 'foto-weg';
      if (!gallery.some((item) => item.mediaId === photo.id)) gallery.push({ mediaId: photo.id, url: mediaUrl(photo, GALLERY_WIDTH), alt: photo.alt_text || '' });
    }
    if (gallery.length > GUIDE_LIMITS.gallery) return 'te-veel';
    await saveGallery(client, guide.id, gallery, context);
    return 'ok';
  });

  /**
   * Zet de foto's van de galerij in een nieuwe volgorde en haalt aangevinkte foto's weg.
   * @param {(number|string)} id Id.
   * @param {{fingerprint: string, body: Record<string, *>}} form Vingerafdruk van de galerij waarop het formulier is
   *   gemaakt en de ingezonden velden (zie `arrangedPositions`).
   * @param {{userId: number, audit: Function}} context Gebruiker en audit.
   * @returns {Promise<('ok'|'weg'|'gewijzigd')>} Uitkomst; `gewijzigd` als de galerij intussen anders is.
   */
  const arrangeGallery = (id, form, context) => db.transaction(async (client) => {
    const guide = await lockForGallery(client, id);
    if (!guide) return 'weg';
    if (galleryFingerprint(guide.gallery) !== form.fingerprint) return 'gewijzigd';
    const gallery = arrangedPositions(form.body, guide.gallery.length).map((index) => guide.gallery[index]);
    await saveGallery(client, guide.id, gallery, context);
    return 'ok';
  });

  /**
   * Wijzigt de titel en subtitel van de galerij.
   * @param {(number|string)} id Id.
   * @param {{title: *, subtitle: *}} texts Ingezonden teksten (worden opgeschoond en ingekort).
   * @param {{userId: number, audit: Function}} context Gebruiker en audit.
   * @returns {Promise<('ok'|'weg')>} Uitkomst.
   */
  const setGalleryText = (id, texts, context) => db.transaction(async (client) => {
    const guide = await lockForGallery(client, id);
    if (!guide) return 'weg';
    await client.query(
      'UPDATE guides SET gallery_title = $2, gallery_subtitle = $3, managed_in_crm = true, updated_at = now(), updated_by = $4 WHERE id = $1',
      [guide.id, cleanText(texts.title, GUIDE_LIMITS.galleryText), cleanText(texts.subtitle, GUIDE_LIMITS.galleryText), context.userId],
    );
    await context.audit(client);
    return 'ok';
  });

  return { list, get, create, update, setOnline, setPhoto, addGalleryPhotos, arrangeGallery, setGalleryText, remove };
}

module.exports = { createGuides, adoptFixedGuide, validateGuideFields, galleryFingerprint, arrangedPositions, GUIDE_LIMITS, PHOTO_FIELDS };
