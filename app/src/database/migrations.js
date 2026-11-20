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
        failed_logins INTEGER NOT NULL DEFAULT 0,
        locked_until TIMESTAMPTZ,
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
];

module.exports = { MIGRATIONS };
