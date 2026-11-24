// @ts-check
/**
 * Migratie 2: aanmeldingen voor reizen.
 * Staat deze migratie op main, dan verandert hij nooit meer; een wijziging is een nieuwe migratie.
 */
module.exports = {
  id: 2,
  name: "aanmeldingen voor reizen",
  sql: `
      CREATE TABLE bookings (
        id SERIAL PRIMARY KEY,
        reference TEXT NOT NULL UNIQUE,
        trip_id INTEGER REFERENCES trips(id) ON DELETE SET NULL,
        trip_code TEXT,
        trip_title TEXT NOT NULL,
        departure_date DATE,
        status TEXT NOT NULL DEFAULT 'nieuw',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        gender TEXT NOT NULL,
        first_names TEXT NOT NULL,
        call_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT NOT NULL,
        mobile TEXT NOT NULL,
        phone TEXT NOT NULL DEFAULT '',
        street TEXT NOT NULL,
        postal_code TEXT NOT NULL,
        city TEXT NOT NULL,
        occupation TEXT NOT NULL DEFAULT '',
        travel_with TEXT NOT NULL DEFAULT '',
        earlier_trip BOOLEAN NOT NULL,
        credit_card BOOLEAN NOT NULL,
        driver_interest BOOLEAN NOT NULL,
        driver_before BOOLEAN NOT NULL,
        driver_when TEXT NOT NULL DEFAULT '',
        payment_method TEXT NOT NULL,
        payment_choice TEXT NOT NULL,
        price_cents INTEGER,
        sensitive_data TEXT NOT NULL,
        consent_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX bookings_trip_idx ON bookings (trip_id, created_at);
      CREATE INDEX bookings_email_idx ON bookings (lower(email));
      ALTER TABLE trips ADD COLUMN deposit_cents INTEGER;
    `,
};
