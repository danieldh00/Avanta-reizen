/**
 * Databasemigraties (PostgreSQL), positioneel: een nieuwe migratie komt achteraan met het eerstvolgende nummer.
 * Een bestaande migratie verandert nooit meer nadat hij op main staat.
 */

const MIGRATIONS = [
  {
    id: 1,
    name: 'content van de website',
    sql: `
      CREATE TABLE guides (
        id SERIAL PRIMARY KEY,
        legacy_id INTEGER UNIQUE,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        intro TEXT NOT NULL DEFAULT '',
        body_html TEXT NOT NULL DEFAULT '',
        photo_url TEXT,
        published BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE trip_categories (
        id SERIAL PRIMARY KEY,
        legacy_id INTEGER UNIQUE,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'overig',
        body_html TEXT NOT NULL DEFAULT '',
        image_url TEXT,
        intro TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE trips (
        id SERIAL PRIMARY KEY,
        legacy_id INTEGER UNIQUE,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        tagline TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        body_html TEXT NOT NULL DEFAULT '',
        trip_code TEXT,
        departure_date DATE,
        duration_label TEXT NOT NULL DEFAULT '',
        duration_days INTEGER,
        price_cents INTEGER,
        old_price_cents INTEGER,
        offer_until DATE,
        extra_costs_cents INTEGER,
        price_note TEXT NOT NULL DEFAULT '',
        destinations TEXT[] NOT NULL DEFAULT '{}',
        status_label TEXT NOT NULL DEFAULT '',
        guaranteed BOOLEAN NOT NULL DEFAULT FALSE,
        fully_booked BOOLEAN NOT NULL DEFAULT FALSE,
        is_new BOOLEAN NOT NULL DEFAULT FALSE,
        guide_id INTEGER REFERENCES guides(id) ON DELETE SET NULL,
        hero_image_url TEXT,
        card_image_url TEXT,
        gallery JSONB NOT NULL DEFAULT '[]',
        gallery_title TEXT NOT NULL DEFAULT '',
        gallery_subtitle TEXT NOT NULL DEFAULT '',
        published BOOLEAN NOT NULL DEFAULT TRUE
      );
      CREATE INDEX trips_departure_idx ON trips (published, departure_date);

      CREATE TABLE trip_category_links (
        trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
        category_id INTEGER NOT NULL REFERENCES trip_categories(id) ON DELETE CASCADE,
        PRIMARY KEY (trip_id, category_id)
      );
      CREATE INDEX trip_category_links_category_idx ON trip_category_links (category_id);

      CREATE TABLE posts (
        id SERIAL PRIMARY KEY,
        legacy_id INTEGER UNIQUE,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        intro TEXT NOT NULL DEFAULT '',
        excerpt TEXT NOT NULL DEFAULT '',
        body_html TEXT NOT NULL DEFAULT '',
        image_url TEXT,
        categories TEXT[] NOT NULL DEFAULT '{}',
        published_at TIMESTAMPTZ,
        published BOOLEAN NOT NULL DEFAULT TRUE
      );
      CREATE INDEX posts_published_idx ON posts (published, published_at DESC);

      CREATE TABLE pages (
        id SERIAL PRIMARY KEY,
        legacy_id INTEGER UNIQUE,
        path TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        pretitle TEXT NOT NULL DEFAULT '',
        intro TEXT NOT NULL DEFAULT '',
        body_html TEXT NOT NULL DEFAULT '',
        image_url TEXT,
        published BOOLEAN NOT NULL DEFAULT TRUE
      );

      CREATE TABLE faqs (
        id SERIAL PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        question TEXT NOT NULL,
        answer_html TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE media (
        id SERIAL PRIMARY KEY,
        original_url TEXT NOT NULL UNIQUE,
        local_name TEXT NOT NULL UNIQUE,
        content_type TEXT NOT NULL,
        bytes INTEGER NOT NULL
      );
    `,
  },
  {
    id: 2,
    name: 'aanmeldingen voor reizen',
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
  },
  {
    id: 3,
    name: 'berichten via het contactformulier',
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
  },
  {
    id: 4,
    name: 'CRM: gebruikers, sessies en auditlog',
    sql: `
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('beheerder', 'kantoor', 'reisleider', 'boekhouding')),
        password_hash TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT true,
        guide_id INTEGER REFERENCES guides(id) ON DELETE SET NULL,
        last_login_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX users_email_key ON users (lower(email));
      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        mfa_ok BOOLEAN NOT NULL DEFAULT false
      );
      CREATE INDEX sessions_user_idx ON sessions (user_id);
      CREATE INDEX sessions_expires_idx ON sessions (expires_at);
      CREATE TABLE audit_log (
        id BIGSERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        entity TEXT,
        entity_id TEXT,
        ip_prefix TEXT
      );
      CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id);
      CREATE INDEX audit_log_created_idx ON audit_log (created_at);
    `,
  },
  {
    id: 5,
    name: 'beheer: instellingen',
    sql: `
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
      );
    `,
  },
  {
    id: 6,
    name: 'beheer: doorverwijzingen en 404-lijst',
    sql: `
      CREATE TABLE redirects (
        id SERIAL PRIMARY KEY,
        from_path TEXT NOT NULL UNIQUE,
        to_url TEXT NOT NULL,
        status SMALLINT NOT NULL DEFAULT 301 CHECK (status IN (301, 302)),
        note TEXT NOT NULL DEFAULT '',
        hits INTEGER NOT NULL DEFAULT 0,
        last_hit_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE TABLE not_found_log (
        path TEXT PRIMARY KEY,
        hits INTEGER NOT NULL DEFAULT 1,
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        referrer_host TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX not_found_log_last_seen_idx ON not_found_log (last_seen_at);
      CREATE INDEX not_found_log_hits_idx ON not_found_log (hits DESC);
    `,
  },
  {
    id: 7,
    name: 'beheer: logboek',
    sql: `
      CREATE TABLE app_logs (
        id BIGSERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        first_at TIMESTAMPTZ,
        level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
        source TEXT NOT NULL,
        request_id TEXT NOT NULL DEFAULT '',
        error_code TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL,
        data JSONB NOT NULL DEFAULT '{}',
        duration_ms INTEGER NOT NULL DEFAULT 0,
        repeat_count INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX app_logs_created_idx ON app_logs (created_at DESC);
      CREATE INDEX app_logs_level_idx ON app_logs (level, id DESC);
      CREATE INDEX app_logs_source_idx ON app_logs (source, id DESC);
      CREATE INDEX app_logs_error_code_idx ON app_logs (error_code) WHERE error_code <> '';
      CREATE INDEX app_logs_request_idx ON app_logs (request_id) WHERE request_id <> '';
      -- Dagelijkse opschoning van IP-voorvoegsels in het auditlog (pakket B3): alleen rijen die nog een IP hebben.
      CREATE INDEX audit_log_ip_idx ON audit_log (created_at) WHERE ip_prefix IS NOT NULL;
    `,
  },
  {
    id: 8,
    name: 'beheer: bewaking',
    sql: `
      CREATE TABLE monitor_incidents (
        id BIGSERIAL PRIMARY KEY,
        check_key TEXT NOT NULL,
        severity TEXT NOT NULL CHECK (severity IN ('warn', 'error')),
        message TEXT NOT NULL,
        opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        resolved_at TIMESTAMPTZ,
        notified_at TIMESTAMPTZ,
        notify_count INTEGER NOT NULL DEFAULT 0
      );
      -- Hoogstens één open incident per controle (ook bij twee gelijktijdige rondes).
      CREATE UNIQUE INDEX monitor_incidents_open_idx ON monitor_incidents (check_key) WHERE resolved_at IS NULL;
      CREATE INDEX monitor_incidents_opened_idx ON monitor_incidents (opened_at DESC);
    `,
  },
  {
    id: 9,
    name: 'CRM: tweestapsverificatie',
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
  },
  {
    id: 10,
    name: 'CRM: personen en toestemmingen',
    sql: `
      -- Eén persoon, meerdere aanmeldingen. Bijzondere en identiteitsgegevens per categorie versleuteld (vault, AAD
      -- persons:<blok>:<id>), zodat rechten per categorie kunnen. match_key = HMAC over e-mail + geboortedatum
      -- (ontdubbelen zonder de geboortedatum leesbaar op te slaan). duplicate_of: mogelijk dezelfde persoon, kantoor beslist.
      CREATE TABLE persons (
        id SERIAL PRIMARY KEY,
        gender TEXT NOT NULL DEFAULT '',
        first_names TEXT NOT NULL,
        call_name TEXT NOT NULL DEFAULT '',
        last_name TEXT NOT NULL,
        email TEXT NOT NULL,
        mobile TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        street TEXT NOT NULL DEFAULT '',
        postal_code TEXT NOT NULL DEFAULT '',
        city TEXT NOT NULL DEFAULT '',
        occupation TEXT NOT NULL DEFAULT '',
        match_key TEXT NOT NULL,
        identity_data TEXT,
        special_data TEXT,
        health_data TEXT,
        emergency_data TEXT,
        duplicate_of INTEGER REFERENCES persons(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX persons_email_idx ON persons (lower(email));
      CREATE INDEX persons_match_key_idx ON persons (match_key);
      CREATE INDEX persons_duplicate_idx ON persons (duplicate_of) WHERE duplicate_of IS NOT NULL;
      CREATE INDEX persons_name_idx ON persons (lower(last_name), lower(first_names));

      -- Toestemmingen met de versie van de tekst; art. 9 (religie, gezondheid) apart van de voorwaarden.
      CREATE TABLE consents (
        id SERIAL PRIMARY KEY,
        person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
        booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
        kind TEXT NOT NULL CHECK (kind IN ('voorwaarden', 'art9_religie', 'art9_gezondheid')),
        text_version TEXT NOT NULL,
        given_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        withdrawn_at TIMESTAMPTZ
      );
      CREATE INDEX consents_person_idx ON consents (person_id);
      CREATE INDEX consents_booking_idx ON consents (booking_id);

      -- Aanmeldingen verwijzen naar de persoon; de bijzondere gegevens staan voortaan alleen bij de persoon.
      -- Bestaande aanmeldingen zet de app bij het starten om (crm/persons.js, backfillPersons).
      ALTER TABLE bookings ADD COLUMN person_id INTEGER REFERENCES persons(id) ON DELETE SET NULL;
      ALTER TABLE bookings ALTER COLUMN sensitive_data DROP NOT NULL;
      CREATE INDEX bookings_person_idx ON bookings (person_id);
      CREATE INDEX bookings_unlinked_idx ON bookings (id) WHERE person_id IS NULL AND sensitive_data IS NOT NULL;
    `,
  },
  {
    id: 11,
    name: 'CRM: aanmeldingen met status en historie',
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
  },
  {
    id: 12,
    name: 'website: fotobibliotheek per land',
    sql: `
      -- Fotobibliotheek (CMS-pakket F): de bestaande tabel media (import) krijgt de gegevens van een foto en de bron.
      -- Een upload heeft geen original_url; variants is een object breedte → bestandsnaam (WebP, zonder EXIF/GPS).
      ALTER TABLE media
        ALTER COLUMN original_url DROP NOT NULL,
        ADD COLUMN source TEXT NOT NULL DEFAULT 'import' CHECK (source IN ('import', 'upload')),
        ADD COLUMN title TEXT NOT NULL DEFAULT '',
        ADD COLUMN alt_text TEXT NOT NULL DEFAULT '',
        ADD COLUMN caption TEXT NOT NULL DEFAULT '',
        ADD COLUMN photographer TEXT NOT NULL DEFAULT '',
        ADD COLUMN width INTEGER,
        ADD COLUMN height INTEGER,
        ADD COLUMN variants JSONB NOT NULL DEFAULT '{}',
        ADD COLUMN uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
      CREATE INDEX media_created_idx ON media (created_at DESC, id DESC);

      -- Een foto hoort bij nul of meer landen (trip_categories met kind 'bestemming').
      CREATE TABLE media_countries (
        media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        category_id INTEGER NOT NULL REFERENCES trip_categories(id) ON DELETE CASCADE,
        PRIMARY KEY (media_id, category_id)
      );
      CREATE INDEX media_countries_category_idx ON media_countries (category_id);

      -- Nieuwe rol Redacteur (alleen website: fotobibliotheek, later pagina's en blog).
      ALTER TABLE users DROP CONSTRAINT users_role_check;
      ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('beheerder', 'kantoor', 'reisleider', 'boekhouding', 'redacteur'));
    `,
  },
  {
    id: 13,
    name: 'website: geüploade foto\'s in de database (back-up)',
    sql: `
      -- De grootste WebP-variant van elke geüploade foto staat ook in de database, zodat hij in elke back-up (pg_dump),
      -- de kopie op Google Drive en de hersteltest zit. De bestanden in DATA_DIR/media zijn daarvan een kopie die de app
      -- bij het starten herstelt als hij ontbreekt (ook de kleinere varianten). WebP is al gecomprimeerd: geen TOAST-compressie.
      CREATE TABLE media_files (
        media_id INTEGER PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
        width INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        data BYTEA NOT NULL
      );
      ALTER TABLE media_files ALTER COLUMN data SET STORAGE EXTERNAL;
    `,
  },
  {
    id: 14,
    name: 'website: reistypes en landen beheren',
    sql: `
      -- Reistypes en landen (CMS-pakket G1): icoon uit de vaste set (leeg = op de slug), volgorde, tonen op de homepage.
      -- De foto blijft in image_url (een adres uit de fotobibliotheek), zodat "gebruikt in" en de site hem al kennen.
      ALTER TABLE trip_categories
        ADD COLUMN icon TEXT NOT NULL DEFAULT '',
        ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN show_on_home BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
      CREATE INDEX trip_categories_kind_idx ON trip_categories (kind, sort_order, name);
    `,
  },
];

module.exports = { MIGRATIONS };
