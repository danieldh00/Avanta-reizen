// @ts-check
/**
 * Migratie 23: reizigersaccounts.
 * Staat deze migratie op main, dan verandert hij nooit meer; een wijziging is een nieuwe migratie.
 */
module.exports = {
  id: 23,
  name: "reizigersaccounts",
  sql: `
      -- Reizigersaccount (CMS-pakket J2): inloggen met e-mailadres en wachtwoord, los van de medewerkers (users).
      -- Een account is pas bruikbaar na bevestigen via de link in de mail (verified_at). Mijn reizen (J3) zoekt de
      -- aanmeldingen op het bevestigde e-mailadres.
      CREATE TABLE customer_accounts (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL CHECK (email = lower(email) AND length(email) <= 200),
        password_hash TEXT NOT NULL,
        verified_at TIMESTAMPTZ,
        last_login_at TIMESTAMPTZ,
        password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX customer_accounts_email_idx ON customer_accounts (email);
      CREATE INDEX customer_accounts_unverified_idx ON customer_accounts (created_at) WHERE verified_at IS NULL;
      -- Sessies: alleen de SHA-256 van het token. step_up_until: tot wanneer een code per e-mail gevoelige acties toestaat (J3).
      CREATE TABLE customer_sessions (
        token_hash TEXT PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        step_up_until TIMESTAMPTZ
      );
      CREATE INDEX customer_sessions_account_idx ON customer_sessions (account_id);
      CREATE INDEX customer_sessions_expires_idx ON customer_sessions (expires_at);
      -- Eenmalige links en codes per e-mail: bevestigen, wachtwoord herstellen en de code voor gevoelige acties (J3);
      -- 'melding' telt alleen mails zonder link (bijv. "je hebt al een account") voor de limiet per uur.
      CREATE TABLE customer_tokens (
        token_hash TEXT PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
        purpose TEXT NOT NULL CHECK (purpose IN ('bevestigen', 'herstellen', 'code', 'melding')),
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ
      );
      CREATE INDEX customer_tokens_account_idx ON customer_tokens (account_id, purpose, created_at);
      CREATE INDEX customer_tokens_expires_idx ON customer_tokens (expires_at);
    `,
};
