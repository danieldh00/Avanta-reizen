/**
 * Migratie 16: website: foto's bij reizen.
 * Staat deze migratie op main, dan verandert hij nooit meer; een wijziging is een nieuwe migratie.
 */
module.exports = {
  id: 16,
  name: "website: foto's bij reizen",
  sql: `
      -- Foto's bij een reis (CMS-pakket G3): kopfoto, kaartfoto (hoogstens één per reis) en galerij op volgorde, uit de
      -- fotobibliotheek. Een gebruikte foto kan niet weg (RESTRICT). trips.hero_image_url, card_image_url en gallery
      -- blijven bestaan als afgeleide kopie voor de site; het CRM schrijft ze bij elke wijziging opnieuw.
      CREATE TABLE trip_media (
        id SERIAL PRIMARY KEY,
        trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
        media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE RESTRICT,
        role TEXT NOT NULL CHECK (role IN ('kop', 'kaart', 'galerij')),
        sort_order INTEGER NOT NULL DEFAULT 0,
        UNIQUE (trip_id, role, media_id)
      );
      CREATE UNIQUE INDEX trip_media_cover_idx ON trip_media (trip_id, role) WHERE role IN ('kop', 'kaart');
      CREATE INDEX trip_media_trip_idx ON trip_media (trip_id, role, sort_order);
      CREATE INDEX trip_media_media_idx ON trip_media (media_id);
      -- Bestaande reizen: de foto's uit de import (of bibliotheek) die bij een rij in media horen, overnemen.
      WITH urls AS (
        SELECT t.id AS trip_id, 'kop' AS role, t.hero_image_url AS url, 0 AS position FROM trips t WHERE t.hero_image_url IS NOT NULL
        UNION ALL
        SELECT t.id, 'kaart', t.card_image_url, 0 FROM trips t WHERE t.card_image_url IS NOT NULL
        UNION ALL
        SELECT t.id, 'galerij', item.value ->> 'url', item.position::int
          FROM trips t, jsonb_array_elements(CASE WHEN jsonb_typeof(t.gallery) = 'array' THEN t.gallery ELSE '[]'::jsonb END)
               WITH ORDINALITY AS item(value, position)
      )
      INSERT INTO trip_media (trip_id, media_id, role, sort_order)
      SELECT DISTINCT ON (u.trip_id, u.role, m.id) u.trip_id, m.id, u.role, u.position
        FROM urls u
        JOIN media m ON m.content_type LIKE 'image/%'
         AND (u.url = '/media/' || m.local_name
              OR EXISTS (SELECT 1 FROM jsonb_each_text(m.variants) AS variant WHERE u.url = '/media/' || variant.value))
       ORDER BY u.trip_id, u.role, m.id, u.position
      ON CONFLICT DO NOTHING;
    `,
};
