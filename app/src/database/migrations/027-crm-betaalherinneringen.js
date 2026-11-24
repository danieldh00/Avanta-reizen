// @ts-check
/**
 * Migratie 27: CRM: betaalherinneringen.
 * Staat deze migratie op main, dan verandert hij nooit meer; een wijziging is een nieuwe migratie.
 */
module.exports = {
  id: 27,
  name: "CRM: betaalherinneringen",
  sql: `
      -- Betaalherinneringen aan de reiziger (handmatig vanaf de betaalpagina of automatisch dagelijks): welke termijn,
      -- wanneer, door wie of door de planner, en of de mail is verstuurd. Nooit het adres of de inhoud van de mail.
      CREATE TABLE payment_reminders (
        id SERIAL PRIMARY KEY,
        booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('aanbetaling', 'restant')),
        trigger TEXT NOT NULL CHECK (trigger IN ('handmatig', 'automatisch')),
        sent BOOLEAN NOT NULL,
        error TEXT NOT NULL DEFAULT '' CHECK (length(error) <= 200),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX payment_reminders_booking_idx ON payment_reminders (booking_id, kind, created_at);
      CREATE INDEX payment_reminders_sent_idx ON payment_reminders (booking_id, created_at) WHERE sent;
    `,
};
