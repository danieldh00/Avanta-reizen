// @ts-check
/**
 * Migratie 1: content van de website.
 * Staat deze migratie op main, dan verandert hij nooit meer; een wijziging is een nieuwe migratie.
 */
module.exports = {
  id: 1,
  name: "content van de website",
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
};
