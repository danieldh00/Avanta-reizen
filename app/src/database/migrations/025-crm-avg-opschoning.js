// @ts-check
/**
 * Migratie 25: CRM: AVG-opschoning.
 * Staat deze migratie op main, dan verandert hij nooit meer; een wijziging is een nieuwe migratie.
 */
module.exports = {
  id: 25,
  name: "CRM: AVG-opschoning",
  sql: `
      -- Bewaartermijnen (OPZET-CRM §5): bijzondere en paspoortgegevens wissen na terugkomst (blocks_purged_at), personen en
      -- hun aanmeldingen anonimiseren na de bewaartermijn (anonymized_at). Elke ronde komt met aantallen in retention_runs,
      -- zodat in Beheer te zien is wat er is gewist; nooit welke persoon.
      ALTER TABLE persons
        ADD COLUMN blocks_purged_at TIMESTAMPTZ,
        ADD COLUMN anonymized_at TIMESTAMPTZ;
      ALTER TABLE bookings ADD COLUMN anonymized_at TIMESTAMPTZ;
      CREATE INDEX persons_active_idx ON persons (last_activity_at) WHERE anonymized_at IS NULL;
      CREATE INDEX bookings_cancelled_idx ON bookings (cancelled_at) WHERE status = 'geannuleerd';
      CREATE INDEX bookings_unlinked_active_idx ON bookings (created_at) WHERE person_id IS NULL AND anonymized_at IS NULL;
      CREATE INDEX contact_messages_created_idx ON contact_messages (created_at);
      CREATE TABLE retention_runs (
        id SERIAL PRIMARY KEY,
        started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        finished_at TIMESTAMPTZ,
        trigger TEXT NOT NULL CHECK (trigger IN ('dagelijks', 'handmatig')),
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        counts JSONB NOT NULL DEFAULT '{}'::jsonb,
        failed INTEGER NOT NULL DEFAULT 0,
        error TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX retention_runs_started_idx ON retention_runs (started_at);
    `,
};
