/**
 * Migratie 14: website: reistypes en landen beheren.
 * Staat deze migratie op main, dan verandert hij nooit meer; een wijziging is een nieuwe migratie.
 */
module.exports = {
  id: 14,
  name: "website: reistypes en landen beheren",
  sql: `
      -- Reistypes en landen (CMS-pakket G1): icoon uit de vaste set (leeg = op de slug), volgorde, tonen op de homepage.
      -- De foto blijft in image_url (een adres uit de fotobibliotheek), zodat "gebruikt in" en de site hem al kennen.
      ALTER TABLE trip_categories
        ADD COLUMN icon TEXT NOT NULL DEFAULT '',
        ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN show_on_home BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
      CREATE INDEX trip_categories_kind_idx ON trip_categories (kind, sort_order, name);
    `,
};
