// @ts-check
/**
 * Migratie 21: website: veelgestelde vragen beheren.
 * Staat deze migratie op main, dan verandert hij nooit meer; een wijziging is een nieuwe migratie.
 */
module.exports = {
  id: 21,
  name: "website: veelgestelde vragen beheren",
  sql: `
      -- FAQ beheren in het CRM (CMS-pakket I3). Categorieën krijgen een eigen tabel met volgorde; faqs.category blijft
      -- als afgeleide kopie van de naam (site, FAQ-blok). managed_in_crm: de WordPress-import laat de vraag staan.
      CREATE TABLE faq_categories (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE UNIQUE INDEX faq_categories_name_idx ON faq_categories ((lower(name)));
      ALTER TABLE faqs
        ADD COLUMN category_id INTEGER REFERENCES faq_categories(id) ON DELETE RESTRICT,
        ADD COLUMN managed_in_crm BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ADD COLUMN updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
      CREATE INDEX faqs_category_idx ON faqs (category_id);
      -- Bestaande categorieën (tekst in faqs.category) worden categorieën, alfabetisch zoals de site ze nu toont.
      INSERT INTO faq_categories (name, sort_order)
      SELECT category_name, (row_number() OVER (ORDER BY category_name)) * 10
        FROM (SELECT DISTINCT ON (lower(category_name)) category_name
                FROM (SELECT left(COALESCE(NULLIF(trim(regexp_replace(category, '[<>]', '', 'g')), ''), 'Algemeen'), 120) AS category_name FROM faqs) named
               ORDER BY lower(category_name), category_name COLLATE "C") unique_names;
      UPDATE faqs SET category = c.name, category_id = c.id
        FROM faq_categories c
       WHERE lower(c.name) = lower(left(COALESCE(NULLIF(trim(regexp_replace(faqs.category, '[<>]', '', 'g')), ''), 'Algemeen'), 120));
    `,
};
