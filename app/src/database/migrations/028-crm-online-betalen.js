// @ts-check
/**
 * Migratie 28: CRM: online betalen.
 * Staat deze migratie op main, dan verandert hij nooit meer; een wijziging is een nieuwe migratie.
 */
module.exports = {
  id: 28,
  name: "CRM: online betalen",
  sql: `
      -- Online betalingen via Mollie: per aangemaakte betaling het Mollie-id, de termijn, het bedrag en de laatste
      -- stand. Een geslaagde betaling komt daarnaast één keer in payments (provider_ref = Mollie-id). Geen persoonsgegevens.
      CREATE TABLE online_payments (
        id SERIAL PRIMARY KEY,
        booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        provider_ref TEXT NOT NULL UNIQUE CHECK (provider_ref ~ '^tr_[A-Za-z0-9]{4,40}$'),
        kind TEXT NOT NULL CHECK (kind IN ('aanbetaling', 'restant')),
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        checkout_url TEXT NOT NULL DEFAULT '' CHECK (length(checkout_url) <= 500),
        status TEXT NOT NULL DEFAULT 'open' CHECK (length(status) <= 20),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        paid_at TIMESTAMPTZ
      );
      CREATE INDEX online_payments_booking_idx ON online_payments (booking_id, created_at);
    `,
};
