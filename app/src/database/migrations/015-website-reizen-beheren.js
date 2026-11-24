// @ts-check
/**
 * Migratie 15: website: reizen beheren.
 * Staat deze migratie op main, dan verandert hij nooit meer; een wijziging is een nieuwe migratie.
 */
module.exports = {
  id: 15,
  name: "website: reizen beheren",
  sql: `
      -- Reizen beheren in het CRM (CMS-pakket G2). Een reis kan meer reisleiders hebben (trip_guides, op volgorde);
      -- trips.guide_id gaat daarin op. De landen komen uit trip_category_links, dus trips.destinations vervalt.
      CREATE TABLE trip_guides (
        trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
        guide_id INTEGER NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (trip_id, guide_id)
      );
      CREATE INDEX trip_guides_guide_idx ON trip_guides (guide_id);
      INSERT INTO trip_guides (trip_id, guide_id) SELECT id, guide_id FROM trips WHERE guide_id IS NOT NULL;
      ALTER TABLE trips DROP COLUMN guide_id, DROP COLUMN destinations;
      -- capacity: aantal plaatsen (leeg = onbekend). managed_in_crm: in het CRM gewijzigd, de WordPress-import slaat de
      -- reis dan over. Wie en wanneer voor het overzicht; de details staan in de auditlog.
      ALTER TABLE trips
        ADD COLUMN capacity INTEGER CHECK (capacity IS NULL OR capacity BETWEEN 0 AND 10000),
        ADD COLUMN managed_in_crm BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ADD COLUMN updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
      CREATE INDEX trips_code_idx ON trips (lower(trip_code));
    `,
};
