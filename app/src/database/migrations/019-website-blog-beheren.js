/**
 * Migratie 19: website: blog beheren.
 * Staat deze migratie op main, dan verandert hij nooit meer; een wijziging is een nieuwe migratie.
 */
module.exports = {
  id: 19,
  name: "website: blog beheren",
  sql: `
      -- Blogberichten in het CMS (pakket I1), zoals pagina's (M17/M18): blocks (gepubliceerde blokken; leeg bij een
      -- bericht uit de import, dan geldt body_html als één tekstblok, zie publishedBlocks), draft (concept) met
      -- draft_version tegen overschrijven, managed_in_crm (de import laat het bericht dan staan) en SEO-velden.
      -- Inplannen: een bericht met published = true en published_at in de toekomst verschijnt pas op dat moment.
      ALTER TABLE posts
        ADD COLUMN blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN draft JSONB,
        ADD COLUMN draft_version INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN managed_in_crm BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN seo_title TEXT NOT NULL DEFAULT '',
        ADD COLUMN seo_description TEXT NOT NULL DEFAULT '',
        ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ADD COLUMN updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
      -- Elke publicatie als versie (terugzetten als concept); versie 1 van een geïmporteerd bericht is de stand van de import.
      CREATE TABLE post_revisions (
        id SERIAL PRIMARY KEY,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        title TEXT NOT NULL,
        intro TEXT NOT NULL DEFAULT '',
        excerpt TEXT NOT NULL DEFAULT '',
        image_url TEXT,
        blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
        seo_title TEXT NOT NULL DEFAULT '',
        seo_description TEXT NOT NULL DEFAULT '',
        post_date TIMESTAMPTZ,
        note TEXT NOT NULL DEFAULT '',
        published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        published_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        UNIQUE (post_id, version)
      );
    `,
};
