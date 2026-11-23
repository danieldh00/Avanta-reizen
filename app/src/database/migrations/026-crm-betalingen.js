/**
 * Migratie 26: CRM: betalingen.
 * Staat deze migratie op main, dan verandert hij nooit meer; een wijziging is een nieuwe migratie.
 */
module.exports = {
  id: 26,
  name: "CRM: betalingen",
  sql: `
      -- Betalingen handmatig (OPZET-CRM §2 F, §3): per aanmelding de verwachte bedragen (booking_charges) en de ontvangen
      -- betalingen (payments). Saldo en betaalstatus worden berekend (crm/payments.js), nooit opgeslagen. Bedragen in centen.
      -- deposit_cents: de aanbetaling van de reis op het moment van aanmelden.
      ALTER TABLE bookings ADD COLUMN deposit_cents INTEGER CHECK (deposit_cents IS NULL OR deposit_cents >= 0);
      CREATE TABLE booking_charges (
        id SERIAL PRIMARY KEY,
        booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('reissom', 'boekingskosten', 'sgr', 'korting', 'annulering', 'overig')),
        description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 200),
        amount_cents INTEGER NOT NULL CHECK (amount_cents BETWEEN -100000000 AND 100000000),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        -- Weghalen is nooit echt verwijderen: de regel blijft zichtbaar als weggehaald en telt niet meer mee.
        removed_at TIMESTAMPTZ,
        removed_by INTEGER REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX booking_charges_booking_idx ON booking_charges (booking_id);
      -- Een betaling wordt nooit gewijzigd of verwijderd; een vergissing herstelt kantoor met een correctie (method
      -- 'correctie', ook negatief, met toelichting). provider_ref: kenmerk van een betaalprovider (later), uniek.
      CREATE TABLE payments (
        id SERIAL PRIMARY KEY,
        booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        amount_cents INTEGER NOT NULL CHECK (amount_cents <> 0 AND amount_cents BETWEEN -100000000 AND 100000000),
        method TEXT NOT NULL CHECK (method IN ('bank', 'ideal', 'contant', 'correctie')),
        received_on DATE NOT NULL,
        note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
        provider_ref TEXT UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX payments_booking_idx ON payments (booking_id);
      -- Bestaande aanmeldingen: aanbetaling van de reis en de standaardbedragen zoals het formulier ze toonde
      -- (reissom, SGR-garantie € 5, boekingskosten € 15 behalve bij betaling van het totaalbedrag).
      UPDATE bookings b SET deposit_cents = t.deposit_cents FROM trips t WHERE t.id = b.trip_id AND t.deposit_cents >= 0;
      INSERT INTO booking_charges (booking_id, kind, amount_cents)
        SELECT id, 'reissom', price_cents FROM bookings WHERE price_cents > 0;
      INSERT INTO booking_charges (booking_id, kind, amount_cents) SELECT id, 'sgr', 500 FROM bookings;
      INSERT INTO booking_charges (booking_id, kind, amount_cents)
        SELECT id, 'boekingskosten', 1500 FROM bookings WHERE payment_choice = 'aanbetaling';
    `,
};
