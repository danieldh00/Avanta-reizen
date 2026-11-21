/**
 * Reisleiders beheren (CMS-pakket I4, migratie 22): profiel (voornaam, achternaam, woonplaats, sinds, citaat,
 * inleiding, tekst), adres (`/reisleider/<slug>/`, een ander adres geeft een 301), portret en kopfoto uit de
 * fotobibliotheek, online/offline, nieuw en verwijderen. Een reisleider die hier is gewijzigd krijgt `managed_in_crm`:
 * de site toont dan de gegevens uit de database in plaats van die uit `site-content.json`, en de WordPress-import laat
 * hem staan. Bij de eerste wijziging gaan de gegevens uit `site-content.json` mee (`adopt`), zodat de site niets
 * verliest. Elke wijziging schrijft de audit in dezelfde transactie; alle vragen met gebonden parameters.
 */
const { cleanText, lockMediaForUse, mediaUrl } = require('../media/library');
const { slugify, isValidSlug, recordMove } = require('./slugs');
const { sanitizeHtml } = require('../../tools/import/sanitize');

/** Maximale lengtes. */
const GUIDE_LIMITS = { name: 120, surname: 120, city: 120, quote: 400, intro: 1000, body: 50_000 };

/** Breedte van de opgeslagen foto per soort: portret (staand, lijst en detail) en kopfoto (naast het portret). */
const PHOTO_FIELDS = Object.freeze({
  portret: { column: 'photo_url', width: 800, label: 'Portret' },
  kopfoto: { column: 'image_url', width: 1600, label: 'Tweede foto' },
});

/** Kolommen van een reisleider (nooit `SELECT *`). */
const GUIDE_COLUMNS = `g.id, g.slug, g.legacy_id, g.name, g.surname, g.intro, g.body_html, g.photo_url, g.image_url, g.city, g.since,
  g.quote, g.published, g.sort_order, g.managed_in_crm, g.updated_at`;

/**
 * Leest en controleert het profiel van een reisleider uit een formulier; de tekst gaat door `sanitizeHtml`.
 * @param {object} body Ingezonden velden.
 * @returns {{values: object, errors: object}} Waarden (`name`, `surname`, `slug`, `city`, `since`, `quote`, `intro`,
 *   `bodyHtml`, `bodyInput`) en fouten per veld.
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
    },
    errors,
  };
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
   * Alle reisleiders met het aantal reizen, op naam; optioneel gefilterd op zoektermen (naam of achternaam).
   * @param {{patterns?: string[]}} [filter] LIKE-patronen.
   * @returns {Promise<object[]>} Rijen.
   */
  const list = (filter = {}) => {
    const patterns = filter.patterns || [];
    return db.query(
      `SELECT g.id, g.slug, g.name, g.surname, g.published, g.photo_url, g.managed_in_crm,
              (SELECT count(*)::int FROM trip_guides tg WHERE tg.guide_id = g.id) AS trip_count
         FROM guides g
        WHERE cardinality($1::text[]) = 0 OR (SELECT bool_and(concat_ws(' ', g.name, g.surname) ILIKE pattern) FROM unnest($1::text[]) AS pattern)
        ORDER BY g.name, g.surname, g.id LIMIT 500`,
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
   * Neemt bij de eerste wijziging de gegevens uit `site-content.json` over (achternaam, woonplaats, sinds, citaat,
   * portret en tweede foto), zodat de site na `managed_in_crm` hetzelfde toont. Doet niets als hij al beheerd wordt.
   * @param {object} client Transactie-client.
   * @param {{id: number, managed_in_crm: boolean}} guide Rij (vergrendeld).
   * @param {object} [extra] Gegevens uit `site-content.json` (`surname`, `city`, `since`, `quote`, `portrait`, `image`).
   * @returns {Promise<void>}
   */
  const adopt = async (client, guide, extra) => {
    if (guide.managed_in_crm) return;
    const fixed = extra || {};
    await client.query(
      `UPDATE guides SET surname = $2, city = $3, since = $4, quote = $5, photo_url = COALESCE(NULLIF($6, ''), photo_url),
         image_url = COALESCE(NULLIF($7, ''), image_url), managed_in_crm = true WHERE id = $1`,
      [guide.id, fixed.surname || '', fixed.city || '', fixed.since || '', fixed.quote || '', fixed.portrait || '', fixed.image || ''],
    );
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
   * @param {{userId: number, audit: Function, extra?: object}} context Gebruiker, audit en de gegevens uit
   *   `site-content.json` (voor de eerste keer).
   * @returns {Promise<{status: ('ok'|'weg'|'fout'), errors?: object, moved?: boolean}>} Uitkomst.
   */
  const update = (id, values, context) => db.transaction(async (client) => {
    if (!validId(id)) return { status: 'weg' };
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['reisleider-adres']);
    const [guide] = await client.query('SELECT id, slug, managed_in_crm FROM guides WHERE id = $1 FOR UPDATE', [Number(id)]);
    if (!guide) return { status: 'weg' };
    if (values.slug !== guide.slug && await slugTaken(client, values.slug, guide.id)) return { status: 'fout', errors: { slug: 'Dit adres bestaat al.' } };
    await adopt(client, guide, context.extra);
    await client.query(
      `UPDATE guides SET name = $2, surname = $3, slug = $4, city = $5, since = $6, quote = $7, intro = $8, body_html = $9,
         managed_in_crm = true, updated_at = now(), updated_by = $10 WHERE id = $1`,
      [guide.id, values.name, values.surname, values.slug, values.city, values.since, values.quote, values.intro, values.bodyHtml, context.userId],
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
   * @param {{userId: number, audit: Function, extra?: object}} context Gebruiker, audit en `site-content.json`-gegevens.
   * @returns {Promise<{status: ('ok'|'weg')}>} Uitkomst.
   */
  const setOnline = (id, online, context) => db.transaction(async (client) => {
    if (!validId(id)) return { status: 'weg' };
    const [guide] = await client.query('SELECT id, managed_in_crm FROM guides WHERE id = $1 FOR UPDATE', [Number(id)]);
    if (!guide) return { status: 'weg' };
    await adopt(client, guide, context.extra);
    await client.query('UPDATE guides SET published = $2, managed_in_crm = true, updated_at = now(), updated_by = $3 WHERE id = $1', [guide.id, online, context.userId]);
    await context.audit(client);
    return { status: 'ok' };
  });

  /**
   * Kiest het portret of de tweede foto uit de bibliotheek (of geen).
   * @param {(number|string)} id Id.
   * @param {string} kind `portret` of `kopfoto`.
   * @param {(number|null)} mediaId Foto, of null voor geen.
   * @param {{userId: number, audit: Function, extra?: object}} context Gebruiker, audit en `site-content.json`-gegevens.
   * @returns {Promise<('ok'|'weg'|'foto-weg')>} Uitkomst.
   */
  const setPhoto = (id, kind, mediaId, context) => db.transaction(async (client) => {
    const field = PHOTO_FIELDS[kind];
    if (!field || !validId(id)) return 'weg';
    const [guide] = await client.query('SELECT id, managed_in_crm FROM guides WHERE id = $1 FOR UPDATE', [Number(id)]);
    if (!guide) return 'weg';
    let url = null;
    if (mediaId !== null) {
      const photo = await lockMediaForUse(client, mediaId);
      if (!photo) return 'foto-weg';
      url = mediaUrl(photo, field.width);
    }
    await adopt(client, guide, context.extra);
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

  return { list, get, create, update, setOnline, setPhoto, remove };
}

module.exports = { createGuides, validateGuideFields, GUIDE_LIMITS, PHOTO_FIELDS };
