/**
 * Reizen beheren (CMS-pakket G2, migratie 15). Een reis is één vertrek (URL per vertrek, zoals de huidige site) met
 * prijs, reisgegevens, teksten, landen en reistypes (`trip_category_links`), reisleiders op volgorde (`trip_guides`),
 * aantal plaatsen en concept of gepubliceerd. Een reis die hier is opgeslagen krijgt `managed_in_crm`, zodat de
 * WordPress-import hem niet meer overschrijft. Een gewijzigde slug maakt een 301. Alle vragen met gebonden parameters.
 */
const { sanitizeHtml } = require('../../tools/import/sanitize');
const { tripPath } = require('../site/format');
const { cleanText } = require('../media/library');
const { slugify, isValidSlug, recordMove } = require('./slugs');

/** Maximale lengtes van de tekstvelden. */
const LIMITS = {
  title: 200, trip_code: 30, duration_label: 60, price_note: 500, status_label: 100, tagline: 300, summary: 1000, body: 200_000,
};

/** Hoogste bedrag in euro's dat een prijsveld accepteert. */
const MAX_EUROS = 100_000;

/** Aantal reisleiders dat een reis kan hebben. */
const MAX_GUIDES = 3;

/** Kolommen van een reis voor het bewerkscherm (nooit `SELECT *`). */
const TRIP_COLUMNS = `t.id, t.legacy_id, t.slug, t.title, t.tagline, t.summary, t.body_html, t.trip_code, t.departure_date,
  t.duration_label, t.duration_days, t.price_cents, t.old_price_cents, t.offer_until, t.extra_costs_cents, t.deposit_cents,
  t.price_note, t.status_label, t.guaranteed, t.fully_booked, t.is_new, t.capacity, t.published, t.managed_in_crm,
  t.hero_image_url, t.card_image_url, t.gallery_title, t.gallery_subtitle, t.created_at, t.updated_at`;

/** Bedragvelden van het formulier en hun kolom. */
const MONEY_FIELDS = { price: 'priceCents', old_price: 'oldPriceCents', extra_costs: 'extraCostsCents', deposit: 'depositCents' };

/**
 * Leest een bedrag in euro's ("1849", "1.849,50", "€ 1849,-") als centen.
 * @param {string} text Invoer.
 * @returns {{cents: (number|null), ok: boolean}} Centen (null bij leeg) en of de invoer klopte.
 */
function parseEuros(text) {
  const value = String(text || '').replace(/[€\s]/g, '').replace(/,-$/, '');
  if (!value) return { cents: null, ok: true };
  const match = /^(\d{1,3}(?:\.\d{3})+|\d{1,6})(?:,(\d{1,2}))?$/.exec(value);
  if (!match) return { cents: null, ok: false };
  const euros = Number(match[1].replace(/\./g, ''));
  const cents = euros * 100 + Number((match[2] || '0').padEnd(2, '0'));
  return euros > MAX_EUROS ? { cents: null, ok: false } : { cents, ok: true };
}

/**
 * Een bedrag in centen als tekst voor het formulier ("1849" of "1849,50").
 * @param {(number|null)} cents Centen.
 * @returns {string} Tekst, of leeg.
 */
function eurosText(cents) {
  if (cents === null || cents === undefined) return '';
  const rest = cents % 100;
  return rest ? `${Math.floor(cents / 100)},${String(rest).padStart(2, '0')}` : String(cents / 100);
}

/**
 * Of een tekst een geldige datum (jjjj-mm-dd) is.
 * @param {string} text Invoer.
 * @returns {boolean} Waar als de datum bestaat.
 */
function isDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text && text >= '2000-01-01' && text <= '2100-12-31';
}

/**
 * Een lijst id's uit een formulierveld (één waarde of herhaald), alleen gehele getallen, zonder dubbele.
 * @param {*} value Invoer.
 * @returns {number[]} Id's.
 */
function idList(value) {
  return [...new Set([].concat(value ?? []).filter((item) => typeof item === 'string' && /^\d{1,9}$/.test(item)).map(Number))];
}

/**
 * Leest en controleert de velden van een reis uit een formulier.
 * @param {object} body Ingezonden velden.
 * @returns {{values: object, errors: object}} Opgeschoonde waarden en fouten per veld.
 */
function validateTrip(body) {
  const text = (name) => (typeof body[name] === 'string' ? body[name] : '');
  const errors = {};
  const title = cleanText(text('title'), LIMITS.title);
  if (!title) errors.title = 'Vul een titel in.';
  const tripCode = cleanText(text('trip_code'), LIMITS.trip_code);
  const slug = text('slug').trim().toLowerCase() || slugify(title);
  if (!isValidSlug(slug)) errors.slug = 'Gebruik alleen kleine letters, cijfers en streepjes (maximaal 80 tekens).';
  const departure = text('departure_date').trim();
  if (!isDate(departure)) errors.departure_date = 'Vul een geldige vertrekdatum in.';
  const offerUntil = text('offer_until').trim();
  if (offerUntil && !isDate(offerUntil)) errors.offer_until = 'Vul een geldige datum in, of laat het leeg.';
  const money = {};
  for (const [field, key] of Object.entries(MONEY_FIELDS)) {
    const parsed = parseEuros(text(field));
    if (!parsed.ok) errors[field] = `Vul een bedrag in euro's in (bijvoorbeeld 1849 of 1849,50; maximaal ${MAX_EUROS}).`;
    money[key] = parsed.cents;
  }
  const integer = (name, min, max) => {
    const value = text(name).trim();
    if (!value) return null;
    if (!/^\d{1,5}$/.test(value) || Number(value) < min || Number(value) > max) {
      errors[name] = `Vul een heel getal in van ${min} tot en met ${max}, of laat het leeg.`;
      return null;
    }
    return Number(value);
  };
  const durationDays = integer('duration_days', 1, 400);
  const capacity = integer('capacity', 0, 10000);
  const multiline = (name) => text(name).replace(/\r\n/g, '\n').trim();
  const tagline = cleanText(text('tagline'), LIMITS.tagline);
  const summary = multiline('summary');
  if (summary.length > LIMITS.summary) errors.summary = `Maximaal ${LIMITS.summary} tekens.`;
  const rawBody = text('body_html');
  if (rawBody.length > LIMITS.body) errors.body_html = 'De tekst is te lang.';
  const guideIds = [];
  for (let index = 1; index <= MAX_GUIDES; index++) {
    const [id] = idList(body[`reisleider_${index}`]);
    if (id && !guideIds.includes(id)) guideIds.push(id);
  }
  return {
    values: {
      title,
      slug,
      tripCode,
      departureDate: departure,
      offerUntil: offerUntil || null,
      ...money,
      durationLabel: cleanText(text('duration_label'), LIMITS.duration_label),
      durationDays,
      capacity,
      priceNote: cleanText(text('price_note'), LIMITS.price_note),
      statusLabel: cleanText(text('status_label'), LIMITS.status_label),
      tagline,
      summary,
      bodyHtml: errors.body_html ? '' : sanitizeHtml(rawBody),
      guaranteed: body.guaranteed === '1',
      fullyBooked: body.fully_booked === '1',
      isNew: body.is_new === '1',
      published: body.published === '1',
      categoryIds: idList(body.categorie),
      guideIds,
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
 * Maakt de functies voor reizen.
 * @param {{db: object}} options Database.
 * @returns {object} Functies.
 */
function createTrips(options) {
  const { db } = options;

  /**
   * Een pagina reizen voor de lijst in het CRM.
   * @param {{status: ('komend'|'vertrokken'|'concept'|'alle'), patterns: string[], limit: number, offset: number}} filter Filter.
   * @returns {Promise<object[]>} Reizen met landen en reisleiders als tekst.
   */
  const list = (filter) => db.query(
    `SELECT t.id, t.slug, t.title, t.trip_code, t.departure_date, t.published, t.fully_booked, t.capacity, t.managed_in_crm,
            ARRAY(SELECT c.name FROM trip_category_links l JOIN trip_categories c ON c.id = l.category_id
                   WHERE l.trip_id = t.id AND c.kind = 'bestemming' ORDER BY c.sort_order, c.name) AS countries,
            ARRAY(SELECT g.name FROM trip_guides tg JOIN guides g ON g.id = tg.guide_id WHERE tg.trip_id = t.id ORDER BY tg.sort_order, g.name) AS guides
       FROM trips t
      WHERE CASE $1::text
              WHEN 'komend' THEN t.departure_date >= (now() AT TIME ZONE 'Europe/Amsterdam')::date
              WHEN 'vertrokken' THEN t.departure_date < (now() AT TIME ZONE 'Europe/Amsterdam')::date
              WHEN 'concept' THEN NOT t.published
              ELSE true END
        AND NOT EXISTS (SELECT 1 FROM unnest($2::text[]) AS term WHERE lower(t.title || ' ' || coalesce(t.trip_code, '') || ' ' || t.slug) NOT LIKE term)
      ORDER BY CASE WHEN $1::text = 'vertrokken' THEN NULL ELSE t.departure_date END ASC NULLS LAST,
               t.departure_date DESC NULLS LAST, t.title, t.id
      LIMIT $3 OFFSET $4`,
    [filter.status, filter.patterns, filter.limit, filter.offset],
  );

  /**
   * Eén reis met de id's van zijn categorieën en reisleiders (op volgorde).
   * @param {(number|string)} id Id.
   * @returns {Promise<(object|null)>} Reis of null.
   */
  const get = async (id) => {
    const [trip] = await db.query(
      `SELECT ${TRIP_COLUMNS},
              ARRAY(SELECT l.category_id FROM trip_category_links l WHERE l.trip_id = t.id ORDER BY l.category_id) AS category_ids,
              ARRAY(SELECT tg.guide_id FROM trip_guides tg WHERE tg.trip_id = t.id ORDER BY tg.sort_order, tg.guide_id) AS guide_ids,
              u.name AS updated_by_name
         FROM trips t LEFT JOIN users u ON u.id = t.updated_by
        WHERE t.id = $1`,
      [Number(id)],
    );
    return trip || null;
  };

  /**
   * De keuzelijsten: alle categorieën (per soort) en alle reisleiders.
   * @returns {Promise<{categories: object[], guides: object[]}>} Keuzes.
   */
  const choices = async () => {
    const [categories, guides] = await Promise.all([
      db.query('SELECT id, name, kind FROM trip_categories ORDER BY kind, sort_order, name, id'),
      db.query('SELECT id, name, published FROM guides ORDER BY name, id'),
    ]);
    return { categories, guides };
  };

  /**
   * Schrijft de categorieën en reisleiders van een reis opnieuw (alleen bestaande id's).
   * @param {{query: Function}} client Transactie-client.
   * @param {number} tripId Id van de reis.
   * @param {object} values Waarden uit `validateTrip`.
   * @returns {Promise<void>}
   */
  const writeLinks = async (client, tripId, values) => {
    await client.query('DELETE FROM trip_category_links WHERE trip_id = $1', [tripId]);
    await client.query(
      'INSERT INTO trip_category_links (trip_id, category_id) SELECT $1, c.id FROM trip_categories c WHERE c.id = ANY($2::int[])',
      [tripId, values.categoryIds],
    );
    await client.query('DELETE FROM trip_guides WHERE trip_id = $1', [tripId]);
    await client.query(
      `INSERT INTO trip_guides (trip_id, guide_id, sort_order)
         SELECT $1, g.id, chosen.position FROM unnest($2::int[]) WITH ORDINALITY AS chosen(id, position) JOIN guides g ON g.id = chosen.id`,
      [tripId, values.guideIds],
    );
  };

  /** De waarden van een reis in de volgorde van de kolommen in `create` en `update` ($2 t/m $23). */
  const columnValues = (values) => [values.slug, values.title, values.tagline, values.summary, values.bodyHtml, values.tripCode || null,
    values.departureDate, values.durationLabel, values.durationDays, values.priceCents, values.oldPriceCents, values.offerUntil,
    values.extraCostsCents, values.depositCents, values.priceNote, values.statusLabel, values.guaranteed, values.fullyBooked,
    values.isNew, values.capacity, values.published, values.userId];

  /**
   * Maakt een nieuwe reis.
   * @param {object} values Waarden uit `validateTrip`.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit (`(client, id) => Promise`).
   * @returns {Promise<{id?: number, errors?: object}>} Het nieuwe id, of fouten.
   */
  const create = async (values, context) => {
    try {
      return await db.transaction(async (client) => {
        const [row] = await client.query(
          `INSERT INTO trips (slug, title, tagline, summary, body_html, trip_code, departure_date, duration_label, duration_days,
             price_cents, old_price_cents, offer_until, extra_costs_cents, deposit_cents, price_note, status_label, guaranteed,
             fully_booked, is_new, capacity, published, updated_by, managed_in_crm)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22, true) RETURNING id`,
          columnValues({ ...values, userId: context.userId }),
        );
        await writeLinks(client, row.id, values);
        await client.query('DELETE FROM redirects WHERE from_path = $1', [tripPath(values.slug)]);
        await context.audit(client, row.id);
        return { id: row.id };
      });
    } catch (error) {
      if (isDuplicateSlug(error)) return { errors: { slug: 'Deze slug is al in gebruik door een andere reis.' } };
      throw error;
    }
  };

  /**
   * Wijzigt een reis; bij een andere slug komt er een 301 van het oude adres.
   * @param {(number|string)} id Id.
   * @param {object} values Waarden uit `validateTrip`.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit (`(client) => Promise`).
   * @returns {Promise<{status: ('ok'|'weg'|'fout'), errors?: object, moved?: boolean}>} Uitkomst.
   */
  const update = async (id, values, context) => {
    try {
      return await db.transaction(async (client) => {
        const [current] = await client.query('SELECT id, slug FROM trips WHERE id = $1 FOR UPDATE', [Number(id)]);
        if (!current) return { status: 'weg' };
        await client.query(
          `UPDATE trips SET slug = $2, title = $3, tagline = $4, summary = $5, body_html = $6, trip_code = $7, departure_date = $8,
             duration_label = $9, duration_days = $10, price_cents = $11, old_price_cents = $12, offer_until = $13,
             extra_costs_cents = $14, deposit_cents = $15, price_note = $16, status_label = $17, guaranteed = $18,
             fully_booked = $19, is_new = $20, capacity = $21, published = $22, updated_by = $23, managed_in_crm = true,
             updated_at = now()
           WHERE id = $1`,
          [current.id, ...columnValues({ ...values, userId: context.userId })],
        );
        await writeLinks(client, current.id, values);
        // Altijd een 301, ook bij een concept: een reis kan eerder gepubliceerd zijn geweest (en dat staat nergens vast).
        const moved = current.slug !== values.slug;
        if (moved) await recordMove(client, { fromPath: tripPath(current.slug), toPath: tripPath(values.slug), userId: context.userId, note: 'Automatisch: slug van reis gewijzigd' });
        await context.audit(client);
        return { status: 'ok', moved };
      });
    } catch (error) {
      if (isDuplicateSlug(error)) return { status: 'fout', errors: { slug: 'Deze slug is al in gebruik door een andere reis.' } };
      throw error;
    }
  };

  return { list, get, choices, create, update };
}

module.exports = { createTrips, validateTrip, parseEuros, eurosText, isDate, LIMITS, MAX_GUIDES };
