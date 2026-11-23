/**
 * Migratie 22: website: reisleiders beheren.
 * Staat deze migratie op main, dan verandert hij nooit meer; een wijziging is een nieuwe migratie.
 */
module.exports = {
  id: 22,
  name: "website: reisleiders beheren",
  sql: `
      -- Reisleiders beheren in het CRM (CMS-pakket I4). De gegevens die nu in site-content.json staan krijgen een kolom;
      -- managed_in_crm: de site toont de database in plaats van het bestand en de WordPress-import laat hem staan.
      ALTER TABLE guides
        ADD COLUMN surname TEXT NOT NULL DEFAULT '',
        ADD COLUMN city TEXT NOT NULL DEFAULT '',
        ADD COLUMN since TEXT NOT NULL DEFAULT '' CHECK (since = '' OR since ~ '^(19|20)[0-9]{2}$'),
        ADD COLUMN quote TEXT NOT NULL DEFAULT '',
        ADD COLUMN image_url TEXT,
        ADD COLUMN managed_in_crm BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ADD COLUMN updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
    `,
};
