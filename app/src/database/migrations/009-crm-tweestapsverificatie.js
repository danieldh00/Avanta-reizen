/**
 * Migratie 9: CRM: tweestapsverificatie.
 * Staat deze migratie op main, dan verandert hij nooit meer; een wijziging is een nieuwe migratie.
 */
module.exports = {
  id: 9,
  name: "CRM: tweestapsverificatie",
  sql: `
      -- Geheim versleuteld (vault, AAD users:totp:<id>); zolang totp_enabled_at leeg is, is het een nog niet
      -- bevestigde instelling. totp_last_step: elke code werkt één keer. totp_recovery: alleen SHA-256 van de herstelcodes.
      ALTER TABLE users
        ADD COLUMN totp_secret TEXT,
        ADD COLUMN totp_enabled_at TIMESTAMPTZ,
        ADD COLUMN totp_last_step BIGINT,
        ADD COLUMN totp_recovery TEXT[] NOT NULL DEFAULT '{}',
        -- Eenmalige activatiecode van de beheerder (alleen SHA-256): zonder die code kan niemand met alleen het
        -- wachtwoord een eigen authenticator koppelen.
        ADD COLUMN totp_activation_hash TEXT,
        ADD COLUMN totp_activation_expires_at TIMESTAMPTZ,
        -- Verkeerde codes bij het inloggen, per account en in de database (een herstart wist de teller dus niet).
        ADD COLUMN totp_failures INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN totp_failures_reset_at TIMESTAMPTZ;
      -- Of de halve sessie de activatiecode al heeft gegeven (dan mag zij 2FA instellen).
      ALTER TABLE sessions ADD COLUMN mfa_setup_ok BOOLEAN NOT NULL DEFAULT false;
      -- Bestaande sessies zijn zonder tweede stap gemaakt: iedereen logt opnieuw in.
      DELETE FROM sessions;
    `,
};
