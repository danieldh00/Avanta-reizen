// @ts-check
/**
 * Migratie 3: berichten via het contactformulier.
 * Staat deze migratie op main, dan verandert hij nooit meer; een wijziging is een nieuwe migratie.
 */
module.exports = {
  id: 3,
  name: "berichten via het contactformulier",
  sql: `
      CREATE TABLE contact_messages (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT NOT NULL DEFAULT '',
        subject TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL,
        trip_slug TEXT,
        status TEXT NOT NULL DEFAULT 'nieuw',
        consent_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX contact_messages_status_idx ON contact_messages (status, created_at);
    `,
};
