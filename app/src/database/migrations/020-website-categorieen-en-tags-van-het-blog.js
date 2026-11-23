/**
 * Migratie 20: website: categorieën en tags van het blog.
 * Staat deze migratie op main, dan verandert hij nooit meer; een wijziging is een nieuwe migratie.
 */
module.exports = {
  id: 20,
  name: "website: categorieën en tags van het blog",
  sql: `
      -- Categorieën en tags van het blog (CMS-pakket I2): post_terms (soort, slug uniek per soort, naam, inleiding,
      -- kopfoto, volgorde) en de koppeling post_term_links. Categorieën staan op /category/<slug>/, tags op
      -- /tag/<slug>/. posts.featured: het uitgelichte bericht (hoogstens één), groot op het blog en de homepage.
      CREATE TABLE post_terms (
        id SERIAL PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('categorie', 'tag')),
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        intro TEXT NOT NULL DEFAULT '',
        image_url TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        UNIQUE (kind, slug)
      );
      CREATE TABLE post_term_links (
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        term_id INTEGER NOT NULL REFERENCES post_terms(id) ON DELETE CASCADE,
        PRIMARY KEY (post_id, term_id)
      );
      CREATE INDEX post_term_links_term_idx ON post_term_links (term_id);
      ALTER TABLE posts ADD COLUMN featured BOOLEAN NOT NULL DEFAULT false;
      CREATE UNIQUE INDEX posts_featured_idx ON posts (featured) WHERE featured;
      -- Bestaande categorieën uit de import (namen in posts.categories) worden categorieën met een slug uit de naam.
      WITH names AS (
        SELECT DISTINCT trim(name) AS name FROM posts, unnest(categories) AS name WHERE trim(name) <> ''
      ), slugged AS (
        SELECT name, trim(both '-' from regexp_replace(lower(translate(name,
                 'ÀÁÂÄÃÈÉÊËÌÍÎÏÒÓÔÖÕÙÚÛÜÇÑàáâäãèéêëìíîïòóôöõùúûüçñ', 'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')),
                 '[^a-z0-9]+', '-', 'g')) AS slug
          FROM names
      )
      INSERT INTO post_terms (kind, slug, name)
      SELECT DISTINCT ON (slug) 'categorie', left(slug, 80), name FROM slugged WHERE slug <> '' ORDER BY slug, name
      ON CONFLICT DO NOTHING;
      INSERT INTO post_term_links (post_id, term_id)
      SELECT DISTINCT p.id, t.id FROM posts p, unnest(p.categories) AS category(category_name)
        JOIN post_terms t ON t.kind = 'categorie' AND t.slug = left(trim(both '-' from regexp_replace(lower(translate(trim(category.category_name),
                 'ÀÁÂÄÃÈÉÊËÌÍÎÏÒÓÔÖÕÙÚÛÜÇÑàáâäãèéêëìíîïòóôöõùúûüçñ', 'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')),
                 '[^a-z0-9]+', '-', 'g')), 80)
      ON CONFLICT DO NOTHING;
    `,
};
