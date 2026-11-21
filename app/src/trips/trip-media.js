/**
 * Foto's bij een reis (CMS-pakket G3, migratie 16): kopfoto, kaartfoto en galerij op volgorde, gekozen uit de
 * fotobibliotheek (tabel `trip_media`). Bij elke wijziging schrijft dit de afgeleide kolommen van de reis opnieuw
 * (`hero_image_url`, `card_image_url`, `gallery`), zodat de site en "gebruikt in" ongewijzigd werken, en zet de reis op
 * `managed_in_crm`. Een gekozen foto wordt bij het opslaan vergrendeld (`lockMediaForUse`). Gebonden parameters.
 */
const { cleanText, lockMediaForUse, mediaUrl } = require('../media/library');

/** De rollen van een foto bij een reis. */
const ROLES = { kop: 'Kopfoto', kaart: 'Kaartfoto (in de lijsten)', galerij: 'Galerij' };

/** Breedte van de opgeslagen adressen per rol. */
const ROLE_WIDTHS = { kop: 2400, kaart: 800, galerij: 1600 };

/** Hoogste aantal foto's in de galerij van één reis. */
const MAX_GALLERY = 60;

/** Maximale lengte van galerijtitel en -subtitel. */
const GALLERY_TEXT_LIMIT = 120;

/**
 * Schrijft de afgeleide fotokolommen van een reis opnieuw uit `trip_media`.
 * @param {{query: Function}} client Transactie-client.
 * @param {number} tripId Id van de reis.
 * @param {(number|null)} userId Gebruiker die de wijziging deed.
 * @returns {Promise<void>}
 */
async function syncTripImages(client, tripId, userId) {
  const rows = await client.query(
    `SELECT tm.role, m.local_name, m.variants, m.alt_text FROM trip_media tm JOIN media m ON m.id = tm.media_id
      WHERE tm.trip_id = $1 ORDER BY tm.role, tm.sort_order, tm.id`,
    [tripId],
  );
  const first = (role) => rows.find((row) => row.role === role);
  const hero = first('kop');
  const card = first('kaart');
  const gallery = rows.filter((row) => row.role === 'galerij').map((row) => ({ url: mediaUrl(row, ROLE_WIDTHS.galerij), alt: row.alt_text }));
  await client.query(
    `UPDATE trips SET hero_image_url = $2, card_image_url = $3, gallery = $4::jsonb, managed_in_crm = true, updated_at = now(), updated_by = $5
      WHERE id = $1`,
    [tripId, hero ? mediaUrl(hero, ROLE_WIDTHS.kop) : null, card ? mediaUrl(card, ROLE_WIDTHS.kaart) : null, JSON.stringify(gallery), userId],
  );
}

/**
 * Maakt de functies voor foto's bij reizen.
 * @param {{db: object}} options Database.
 * @returns {object} Functies.
 */
function createTripMedia(options) {
  const { db } = options;

  /**
   * De foto's van een reis, per rol op volgorde.
   * @param {(number|string)} tripId Id van de reis.
   * @returns {Promise<object[]>} Rijen met `id` (koppeling), `media_id`, `role`, `sort_order` en de gegevens van de foto.
   */
  const list = (tripId) => db.query(
    `SELECT tm.id, tm.media_id, tm.role, tm.sort_order, m.local_name, m.variants, m.alt_text, m.title, m.width, m.height
       FROM trip_media tm JOIN media m ON m.id = tm.media_id
      WHERE tm.trip_id = $1 ORDER BY tm.role, tm.sort_order, tm.id`,
    [Number(tripId)],
  );

  /**
   * Voert een wijziging aan de foto's van een reis uit in een transactie: reis vergrendelen, wijziging, afgeleide
   * kolommen en audit.
   * @param {(number|string)} tripId Id van de reis.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit (`(client) => Promise`).
   * @param {Function} change `(client, tripId) => Promise<string>`: geeft 'ok' of een andere uitkomst.
   * @returns {Promise<string>} 'ok', 'weg' (geen reis) of de uitkomst van de wijziging.
   */
  const withTrip = (tripId, context, change) => db.transaction(async (client) => {
    const [trip] = await client.query('SELECT id FROM trips WHERE id = $1 FOR UPDATE', [Number(tripId)]);
    if (!trip) return 'weg';
    const outcome = await change(client, trip.id);
    if (outcome !== 'ok') return outcome;
    await syncTripImages(client, trip.id, context.userId);
    await context.audit(client);
    return 'ok';
  });

  /**
   * Voegt foto's toe: als kop- of kaartfoto (de eerste gekozen foto vervangt de huidige) of achteraan in de galerij.
   * @param {(number|string)} tripId Id van de reis.
   * @param {number[]} mediaIds Gekozen foto's.
   * @param {string} role 'kop', 'kaart' of 'galerij'.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit.
   * @returns {Promise<('ok'|'weg'|'foto-weg'|'te-veel')>} Uitkomst.
   */
  const add = (tripId, mediaIds, role, context) => withTrip(tripId, context, async (client, id) => {
    const wanted = role === 'galerij' ? mediaIds : mediaIds.slice(0, 1);
    const photos = [];
    for (const mediaId of wanted) {
      const photo = await lockMediaForUse(client, mediaId);
      if (!photo) return 'foto-weg';
      photos.push(photo);
    }
    if (role !== 'galerij') {
      await client.query('DELETE FROM trip_media WHERE trip_id = $1 AND role = $2', [id, role]);
      await client.query('INSERT INTO trip_media (trip_id, media_id, role, sort_order) VALUES ($1, $2, $3, 0)', [id, photos[0].id, role]);
      return 'ok';
    }
    const [current] = await client.query(
      "SELECT count(*)::int AS count, coalesce(max(sort_order), 0) AS last FROM trip_media WHERE trip_id = $1 AND role = 'galerij'",
      [id],
    );
    const fresh = await client.query(
      "SELECT chosen.id FROM unnest($2::int[]) AS chosen(id) WHERE NOT EXISTS (SELECT 1 FROM trip_media WHERE trip_id = $1 AND role = 'galerij' AND media_id = chosen.id)",
      [id, photos.map((photo) => photo.id)],
    );
    if (current.count + fresh.length > MAX_GALLERY) return 'te-veel';
    await client.query(
      `INSERT INTO trip_media (trip_id, media_id, role, sort_order)
         SELECT $1, chosen.id, 'galerij', $3 + chosen.position FROM unnest($2::int[]) WITH ORDINALITY AS chosen(id, position)
       ON CONFLICT DO NOTHING`,
      [id, fresh.map((row) => row.id), current.last],
    );
    return 'ok';
  });

  /**
   * Verschuift een galerijfoto één plaats naar voren of naar achteren.
   * @param {(number|string)} tripId Id van de reis.
   * @param {(number|string)} linkId Id van de koppeling (`trip_media.id`).
   * @param {('omhoog'|'omlaag')} direction Richting.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit.
   * @returns {Promise<('ok'|'weg'|'foto-weg'|'rand')>} Uitkomst ('rand': staat al vooraan of achteraan).
   */
  const move = (tripId, linkId, direction, context) => withTrip(tripId, context, async (client, id) => {
    const gallery = await client.query("SELECT id, sort_order FROM trip_media WHERE trip_id = $1 AND role = 'galerij' ORDER BY sort_order, id", [id]);
    const index = gallery.findIndex((row) => row.id === Number(linkId));
    if (index < 0) return 'foto-weg';
    const other = direction === 'omhoog' ? index - 1 : index + 1;
    if (other < 0 || other >= gallery.length) return 'rand';
    [gallery[index], gallery[other]] = [gallery[other], gallery[index]];
    // Volgorde opnieuw nummeren (1, 2, 3 …), zodat gelijke nummers uit de import geen rol meer spelen.
    await client.query(
      `UPDATE trip_media tm SET sort_order = ordered.position FROM unnest($2::int[]) WITH ORDINALITY AS ordered(id, position)
        WHERE tm.id = ordered.id AND tm.trip_id = $1`,
      [id, gallery.map((row) => row.id)],
    );
    return 'ok';
  });

  /**
   * Haalt een foto bij een reis weg (de foto blijft in de bibliotheek).
   * @param {(number|string)} tripId Id van de reis.
   * @param {(number|string)} linkId Id van de koppeling.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit.
   * @returns {Promise<('ok'|'weg'|'foto-weg')>} Uitkomst.
   */
  const remove = (tripId, linkId, context) => withTrip(tripId, context, async (client, id) => {
    const deleted = await client.query('DELETE FROM trip_media WHERE id = $1 AND trip_id = $2 RETURNING id', [Number(linkId), id]);
    return deleted.length ? 'ok' : 'foto-weg';
  });

  /**
   * Zet titel en subtitel van de galerij.
   * @param {(number|string)} tripId Id van de reis.
   * @param {{title: string, subtitle: string}} texts Teksten.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit.
   * @returns {Promise<('ok'|'weg')>} Uitkomst.
   */
  const setGalleryText = (tripId, texts, context) => withTrip(tripId, context, async (client, id) => {
    await client.query('UPDATE trips SET gallery_title = $2, gallery_subtitle = $3 WHERE id = $1', [
      id, cleanText(texts.title, GALLERY_TEXT_LIMIT), cleanText(texts.subtitle, GALLERY_TEXT_LIMIT),
    ]);
    return 'ok';
  });

  return { list, add, move, remove, setGalleryText };
}

module.exports = { createTripMedia, syncTripImages, ROLES, MAX_GALLERY, GALLERY_TEXT_LIMIT };
