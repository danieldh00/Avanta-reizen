// @ts-check
/**
 * Migratie 11: CRM: aanmeldingen met status en historie.
 * Staat deze migratie op main, dan verandert hij nooit meer; een wijziging is een nieuwe migratie.
 */
module.exports = {
  id: 11,
  name: "CRM: aanmeldingen met status en historie",
  sql: `
      -- Status van een aanmelding: nieuw → bevestigd → aanbetaald → betaald, zijtak geannuleerd (geen wachtlijst, besluit
      -- 21-11-2026). Elke wijziging en notitie komt in booking_events; de tijdstippen van bevestigen en annuleren op de aanmelding.
      ALTER TABLE bookings
        ADD COLUMN confirmed_at TIMESTAMPTZ,
        ADD COLUMN cancelled_at TIMESTAMPTZ,
        ADD COLUMN cancel_reason TEXT NOT NULL DEFAULT '',
        ADD COLUMN status_changed_at TIMESTAMPTZ;
      UPDATE bookings SET status = 'nieuw' WHERE status NOT IN ('nieuw', 'bevestigd', 'aanbetaald', 'betaald', 'geannuleerd');
      ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
        CHECK (status IN ('nieuw', 'bevestigd', 'aanbetaald', 'betaald', 'geannuleerd'));
      CREATE INDEX bookings_status_idx ON bookings (status, created_at);

      CREATE TABLE booking_events (
        id SERIAL PRIMARY KEY,
        booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        from_status TEXT,
        to_status TEXT,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        note TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX booking_events_booking_idx ON booking_events (booking_id, created_at);
    `,
};
