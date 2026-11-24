// @ts-check
/**
 * Migratie 4: CRM: gebruikers, sessies en auditlog.
 * Staat deze migratie op main, dan verandert hij nooit meer; een wijziging is een nieuwe migratie.
 */
module.exports = {
  id: 4,
  name: "CRM: gebruikers, sessies en auditlog",
  sql: `
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('beheerder', 'kantoor', 'reisleider', 'boekhouding')),
        password_hash TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT true,
        guide_id INTEGER REFERENCES guides(id) ON DELETE SET NULL,
        last_login_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX users_email_key ON users (lower(email));
      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        mfa_ok BOOLEAN NOT NULL DEFAULT false
      );
      CREATE INDEX sessions_user_idx ON sessions (user_id);
      CREATE INDEX sessions_expires_idx ON sessions (expires_at);
      CREATE TABLE audit_log (
        id BIGSERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        entity TEXT,
        entity_id TEXT,
        ip_prefix TEXT
      );
      CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id);
      CREATE INDEX audit_log_created_idx ON audit_log (created_at);
    `,
};
