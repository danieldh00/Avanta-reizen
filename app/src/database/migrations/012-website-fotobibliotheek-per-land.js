// @ts-check
/**
 * Migratie 12: website: fotobibliotheek per land.
 * Staat deze migratie op main, dan verandert hij nooit meer; een wijziging is een nieuwe migratie.
 */
module.exports = {
  id: 12,
  name: "website: fotobibliotheek per land",
  sql: `
      -- Fotobibliotheek (CMS-pakket F): de bestaande tabel media (import) krijgt de gegevens van een foto en de bron.
      -- Een upload heeft geen original_url; variants is een object breedte → bestandsnaam (WebP, zonder EXIF/GPS).
      ALTER TABLE media
        ALTER COLUMN original_url DROP NOT NULL,
        ADD COLUMN source TEXT NOT NULL DEFAULT 'import' CHECK (source IN ('import', 'upload')),
        ADD COLUMN title TEXT NOT NULL DEFAULT '',
        ADD COLUMN alt_text TEXT NOT NULL DEFAULT '',
        ADD COLUMN caption TEXT NOT NULL DEFAULT '',
        ADD COLUMN photographer TEXT NOT NULL DEFAULT '',
        ADD COLUMN width INTEGER,
        ADD COLUMN height INTEGER,
        ADD COLUMN variants JSONB NOT NULL DEFAULT '{}',
        ADD COLUMN uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
      CREATE INDEX media_created_idx ON media (created_at DESC, id DESC);

      -- Een foto hoort bij nul of meer landen (trip_categories met kind 'bestemming').
      CREATE TABLE media_countries (
        media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        category_id INTEGER NOT NULL REFERENCES trip_categories(id) ON DELETE CASCADE,
        PRIMARY KEY (media_id, category_id)
      );
      CREATE INDEX media_countries_category_idx ON media_countries (category_id);

      -- Nieuwe rol Redacteur (alleen website: fotobibliotheek, later pagina's en blog).
      ALTER TABLE users DROP CONSTRAINT users_role_check;
      ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('beheerder', 'kantoor', 'reisleider', 'boekhouding', 'redacteur'));
    `,
};
