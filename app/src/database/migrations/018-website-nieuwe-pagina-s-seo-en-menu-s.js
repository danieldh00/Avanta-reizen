/**
 * Migratie 18: website: nieuwe pagina's, SEO en menu's.
 * Staat deze migratie op main, dan verandert hij nooit meer; een wijziging is een nieuwe migratie.
 */
module.exports = {
  id: 18,
  name: "website: nieuwe pagina's, SEO en menu's",
  sql: `
      -- Nieuwe pagina's en SEO per pagina (CMS-pakket H3). seo_title en seo_description vervangen (als ze gevuld zijn)
      -- de titel en de inleiding in <title> en de omschrijving voor zoekmachines; ze staan ook in het concept en in elke
      -- versie. Een nieuwe pagina staat offline (published = false) tot de eerste publicatie.
      ALTER TABLE pages
        ADD COLUMN seo_title TEXT NOT NULL DEFAULT '',
        ADD COLUMN seo_description TEXT NOT NULL DEFAULT '';
      ALTER TABLE page_revisions
        ADD COLUMN seo_title TEXT NOT NULL DEFAULT '',
        ADD COLUMN seo_description TEXT NOT NULL DEFAULT '';
      -- Menu's van de site: hoofdmenu (één niveau submenu) en voettekst, op volgorde. Begint met de vaste menu's die
      -- tot nu toe in site/layout.js stonden.
      CREATE TABLE menu_items (
        id SERIAL PRIMARY KEY,
        menu TEXT NOT NULL CHECK (menu IN ('hoofd', 'voet')),
        parent_id INTEGER REFERENCES menu_items(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        href TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX menu_items_menu_idx ON menu_items (menu, parent_id, sort_order);
      INSERT INTO menu_items (menu, label, href, sort_order) VALUES
        ('hoofd', 'Reizen', '/reis/', 10), ('hoofd', 'Over Avanta', '/avanta-reizen/', 20), ('hoofd', 'Reisleiders', '/reisleider/', 30),
        ('hoofd', 'Weblog', '/blog/', 40), ('hoofd', 'Contact', '/contact/', 50),
        ('voet', 'Het Avantateam', '/avanta-reizen/', 10), ('voet', 'Weblog', '/blog/', 20), ('voet', 'Contact', '/contact/', 30);
      INSERT INTO menu_items (menu, parent_id, label, href, sort_order)
      SELECT 'hoofd', parent.id, child.label, child.href, child.sort_order
        FROM menu_items parent,
             (VALUES ('Onze manier van reizen', '/avanta-reizen/onzemaniervanreizen/', 10), ('Het Avantateam', '/avanta-reizen/', 20),
                     ('Voorpret', '/avanta-reizen/voorpret/', 30), ('Veelgestelde vragen', '/faq/', 40),
                     ('Algemene voorwaarden', '/algemene-voorwaarden/', 50)) AS child(label, href, sort_order)
       WHERE parent.menu = 'hoofd' AND parent.label = 'Over Avanta' AND parent.parent_id IS NULL;
    `,
};
