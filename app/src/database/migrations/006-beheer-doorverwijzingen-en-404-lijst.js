// @ts-check
/**
 * Migratie 6: beheer: doorverwijzingen en 404-lijst.
 * Staat deze migratie op main, dan verandert hij nooit meer; een wijziging is een nieuwe migratie.
 */
module.exports = {
  id: 6,
  name: "beheer: doorverwijzingen en 404-lijst",
  sql: `
      CREATE TABLE redirects (
        id SERIAL PRIMARY KEY,
        from_path TEXT NOT NULL UNIQUE,
        to_url TEXT NOT NULL,
        status SMALLINT NOT NULL DEFAULT 301 CHECK (status IN (301, 302)),
        note TEXT NOT NULL DEFAULT '',
        hits INTEGER NOT NULL DEFAULT 0,
        last_hit_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE TABLE not_found_log (
        path TEXT PRIMARY KEY,
        hits INTEGER NOT NULL DEFAULT 1,
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        referrer_host TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX not_found_log_last_seen_idx ON not_found_log (last_seen_at);
      CREATE INDEX not_found_log_hits_idx ON not_found_log (hits DESC);
    `,
};
