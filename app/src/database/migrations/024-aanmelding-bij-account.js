// @ts-check
/**
 * Migratie 24: aanmelding-bij-account.
 * Staat deze migratie op main, dan verandert hij nooit meer; een wijziging is een nieuwe migratie.
 */
module.exports = {
  id: 24,
  name: "aanmelding-bij-account",
  sql: `
      -- Opnieuw boeken (CMS-pakket J4): een aanmelding die een ingelogde reiziger doet met het e-mailadres van zijn account
      -- krijgt het account-id. Alleen zulke aanmeldingen vullen het formulier een volgende keer alvast in; op e-mailadres
      -- alleen nooit, want het aanmeldformulier bevestigt dat adres niet.
      ALTER TABLE bookings ADD COLUMN customer_account_id INTEGER REFERENCES customer_accounts(id) ON DELETE SET NULL;
      CREATE INDEX bookings_customer_account_idx ON bookings (customer_account_id, created_at) WHERE customer_account_id IS NOT NULL;
    `,
};
