/**
 * Migratie 13: website: geüploade foto's in de database (back-up).
 * Staat deze migratie op main, dan verandert hij nooit meer; een wijziging is een nieuwe migratie.
 */
module.exports = {
  id: 13,
  name: "website: geüploade foto's in de database (back-up)",
  sql: `
      -- De grootste WebP-variant van elke geüploade foto staat ook in de database, zodat hij in elke back-up (pg_dump),
      -- de kopie op Google Drive en de hersteltest zit. De bestanden in DATA_DIR/media zijn daarvan een kopie die de app
      -- bij het starten herstelt als hij ontbreekt (ook de kleinere varianten). WebP is al gecomprimeerd: geen TOAST-compressie.
      CREATE TABLE media_files (
        media_id INTEGER PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
        width INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        data BYTEA NOT NULL
      );
      ALTER TABLE media_files ALTER COLUMN data SET STORAGE EXTERNAL;
    `,
};
