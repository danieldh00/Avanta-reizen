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
  {
    id: 15,
    name: 'website: reizen beheren',
    sql: `
      -- Reizen beheren in het CRM (CMS-pakket G2). Een reis kan meer reisleiders hebben (trip_guides, op volgorde);
      -- trips.guide_id gaat daarin op. De landen komen uit trip_category_links, dus trips.destinations vervalt.
      CREATE TABLE trip_guides (
        trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
        guide_id INTEGER NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (trip_id, guide_id)
      );
      CREATE INDEX trip_guides_guide_idx ON trip_guides (guide_id);
      INSERT INTO trip_guides (trip_id, guide_id) SELECT id, guide_id FROM trips WHERE guide_id IS NOT NULL;
      ALTER TABLE trips DROP COLUMN guide_id, DROP COLUMN destinations;
      -- capacity: aantal plaatsen (leeg = onbekend). managed_in_crm: in het CRM gewijzigd, de WordPress-import slaat de
      -- reis dan over. Wie en wanneer voor het overzicht; de details staan in de auditlog.
      ALTER TABLE trips
        ADD COLUMN capacity INTEGER CHECK (capacity IS NULL OR capacity BETWEEN 0 AND 10000),
        ADD COLUMN managed_in_crm BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ADD COLUMN updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
      CREATE INDEX trips_code_idx ON trips (lower(trip_code));
    `,
  },
  {
    id: 16,
    name: 'website: foto\'s bij reizen',
    sql: `
      -- Foto's bij een reis (CMS-pakket G3): kopfoto, kaartfoto (hoogstens één per reis) en galerij op volgorde, uit de
      -- fotobibliotheek. Een gebruikte foto kan niet weg (RESTRICT). trips.hero_image_url, card_image_url en gallery
      -- blijven bestaan als afgeleide kopie voor de site; het CRM schrijft ze bij elke wijziging opnieuw.
      CREATE TABLE trip_media (
        id SERIAL PRIMARY KEY,
        trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
        media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE RESTRICT,
        role TEXT NOT NULL CHECK (role IN ('kop', 'kaart', 'galerij')),
        sort_order INTEGER NOT NULL DEFAULT 0,
        UNIQUE (trip_id, role, media_id)
      );
      CREATE UNIQUE INDEX trip_media_cover_idx ON trip_media (trip_id, role) WHERE role IN ('kop', 'kaart');
      CREATE INDEX trip_media_trip_idx ON trip_media (trip_id, role, sort_order);
      CREATE INDEX trip_media_media_idx ON trip_media (media_id);
      -- Bestaande reizen: de foto's uit de import (of bibliotheek) die bij een rij in media horen, overnemen.
      WITH urls AS (
        SELECT t.id AS trip_id, 'kop' AS role, t.hero_image_url AS url, 0 AS position FROM trips t WHERE t.hero_image_url IS NOT NULL
        UNION ALL
        SELECT t.id, 'kaart', t.card_image_url, 0 FROM trips t WHERE t.card_image_url IS NOT NULL
        UNION ALL
        SELECT t.id, 'galerij', item.value ->> 'url', item.position::int
          FROM trips t, jsonb_array_elements(CASE WHEN jsonb_typeof(t.gallery) = 'array' THEN t.gallery ELSE '[]'::jsonb END)
               WITH ORDINALITY AS item(value, position)
      )
      INSERT INTO trip_media (trip_id, media_id, role, sort_order)
      SELECT DISTINCT ON (u.trip_id, u.role, m.id) u.trip_id, m.id, u.role, u.position
        FROM urls u
        JOIN media m ON m.content_type LIKE 'image/%'
         AND (u.url = '/media/' || m.local_name
              OR EXISTS (SELECT 1 FROM jsonb_each_text(m.variants) AS variant WHERE u.url = '/media/' || variant.value))
       ORDER BY u.trip_id, u.role, m.id, u.position
      ON CONFLICT DO NOTHING;
    `,
  },
  {
    id: 17,
    name: 'website: pagina\'s in blokken',
    sql: `
      -- Pagina's opbouwen uit blokken (CMS-pakket H1). blocks: de gepubliceerde blokken (JSON-lijst, zie cms/blocks.js);
      -- draft: het concept ({title, pretitle, intro, image_url, image_media_id, blocks}) of NULL als er niets openstaat;
      -- draft_version: telt bij elke wijziging van het concept op, zodat twee tabbladen elkaar niet overschrijven.
      -- managed_in_crm: in het CRM gepubliceerd, de WordPress-import laat de pagina dan staan. body_html blijft als bron
      -- van de import; de site toont alleen nog blocks.
      ALTER TABLE pages
        ADD COLUMN blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN draft JSONB,
        ADD COLUMN draft_version INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN managed_in_crm BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ADD COLUMN updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
      -- Bestaande inhoud wordt één tekstblok met de opgeschoonde HTML uit de import.
      UPDATE pages SET blocks = jsonb_build_array(jsonb_build_object(
          'id', 'b' || substr(md5('pagina-' || id::text), 1, 12), 'type', 'tekst',
          'data', jsonb_build_object('html', body_html), 'style', '{}'::jsonb))
       WHERE body_html <> '';
      -- Elke publicatie als versie (terugzetten als concept). Versie 1 van een geïmporteerde pagina is de stand van de
      -- import, zodat die altijd terug te halen is.
      CREATE TABLE page_revisions (
        id SERIAL PRIMARY KEY,
        page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        title TEXT NOT NULL,
        pretitle TEXT NOT NULL DEFAULT '',
        intro TEXT NOT NULL DEFAULT '',
        image_url TEXT,
        blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
        note TEXT NOT NULL DEFAULT '',
        published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        published_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        UNIQUE (page_id, version)
      );
    `,
  },
  {
    id: 18,
    name: 'website: nieuwe pagina\'s, SEO en menu\'s',
    sql: `
      -- Nieuwe pagina's en SEO per pagina (CMS-pakket H3). seo_title en seo_description vervangen (als ze gevuld zijn)
      -- de titel en de inleiding in <title> en de omschrijving voor zoekmachines; ze staan ook in het concept en in elke
      -- versie. Een nieuwe pagina staat offline (published = false) tot de eerste publicatie.
      ALTER TABLE pages
        ADD COLUMN seo_title TEXT NOT NULL DEFAULT '',
        ADD COLUMN seo_description TEXT NOT NULL DEFAULT '';
      ALTER TABLE page_revisions
        ADD COLUMN seo_title TEXT NOT NULL DEFAULT '',
        ADD COLUMN seo_description TEXT NOT NULL DEFAULT '';
      -- Menu's van de site: hoofdmenu (één niveau submenu) en voettekst, op volgorde. Begint met de vaste menu's die
      -- tot nu toe in site/layout.js stonden.
      CREATE TABLE menu_items (
        id SERIAL PRIMARY KEY,
        menu TEXT NOT NULL CHECK (menu IN ('hoofd', 'voet')),
        parent_id INTEGER REFERENCES menu_items(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        href TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX menu_items_menu_idx ON menu_items (menu, parent_id, sort_order);
      INSERT INTO menu_items (menu, label, href, sort_order) VALUES
        ('hoofd', 'Reizen', '/reis/', 10), ('hoofd', 'Over Avanta', '/avanta-reizen/', 20), ('hoofd', 'Reisleiders', '/reisleider/', 30),
        ('hoofd', 'Weblog', '/blog/', 40), ('hoofd', 'Contact', '/contact/', 50),
        ('voet', 'Het Avantateam', '/avanta-reizen/', 10), ('voet', 'Weblog', '/blog/', 20), ('voet', 'Contact', '/contact/', 30);
      INSERT INTO menu_items (menu, parent_id, label, href, sort_order)
      SELECT 'hoofd', parent.id, child.label, child.href, child.sort_order
        FROM menu_items parent,
             (VALUES ('Onze manier van reizen', '/avanta-reizen/onzemaniervanreizen/', 10), ('Het Avantateam', '/avanta-reizen/', 20),
                     ('Voorpret', '/avanta-reizen/voorpret/', 30), ('Veelgestelde vragen', '/faq/', 40),
                     ('Algemene voorwaarden', '/algemene-voorwaarden/', 50)) AS child(label, href, sort_order)
       WHERE parent.menu = 'hoofd' AND parent.label = 'Over Avanta' AND parent.parent_id IS NULL;
    `,
  },
  {
    id: 19,
    name: 'website: blog beheren',
    sql: `
      -- Blogberichten in het CMS (pakket I1), zoals pagina's (M17/M18): blocks (gepubliceerde blokken; leeg bij een
      -- bericht uit de import, dan geldt body_html als één tekstblok, zie publishedBlocks), draft (concept) met
      -- draft_version tegen overschrijven, managed_in_crm (de import laat het bericht dan staan) en SEO-velden.
      -- Inplannen: een bericht met published = true en published_at in de toekomst verschijnt pas op dat moment.
      ALTER TABLE posts
        ADD COLUMN blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN draft JSONB,
        ADD COLUMN draft_version INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN managed_in_crm BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN seo_title TEXT NOT NULL DEFAULT '',
        ADD COLUMN seo_description TEXT NOT NULL DEFAULT '',
        ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ADD COLUMN updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
      -- Elke publicatie als versie (terugzetten als concept); versie 1 van een geïmporteerd bericht is de stand van de import.
      CREATE TABLE post_revisions (
        id SERIAL PRIMARY KEY,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        title TEXT NOT NULL,
        intro TEXT NOT NULL DEFAULT '',
        excerpt TEXT NOT NULL DEFAULT '',
        image_url TEXT,
        blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
        seo_title TEXT NOT NULL DEFAULT '',
        seo_description TEXT NOT NULL DEFAULT '',
        post_date TIMESTAMPTZ,
        note TEXT NOT NULL DEFAULT '',
        published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        published_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        UNIQUE (post_id, version)
      );
    `,
  },
  {
    id: 20,
    name: 'website: categorieën en tags van het blog',
    sql: `
      -- Categorieën en tags van het blog (CMS-pakket I2): post_terms (soort, slug uniek per soort, naam, inleiding,
      -- kopfoto, volgorde) en de koppeling post_term_links. Categorieën staan op /category/<slug>/, tags op
      -- /tag/<slug>/. posts.featured: het uitgelichte bericht (hoogstens één), groot op het blog en de homepage.
      CREATE TABLE post_terms (
        id SERIAL PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('categorie', 'tag')),
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        intro TEXT NOT NULL DEFAULT '',
        image_url TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        UNIQUE (kind, slug)
      );
      CREATE TABLE post_term_links (
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        term_id INTEGER NOT NULL REFERENCES post_terms(id) ON DELETE CASCADE,
        PRIMARY KEY (post_id, term_id)
      );
      CREATE INDEX post_term_links_term_idx ON post_term_links (term_id);
      ALTER TABLE posts ADD COLUMN featured BOOLEAN NOT NULL DEFAULT false;
      CREATE UNIQUE INDEX posts_featured_idx ON posts (featured) WHERE featured;
      -- Bestaande categorieën uit de import (namen in posts.categories) worden categorieën met een slug uit de naam.
      WITH names AS (
        SELECT DISTINCT trim(name) AS name FROM posts, unnest(categories) AS name WHERE trim(name) <> ''
      ), slugged AS (
        SELECT name, trim(both '-' from regexp_replace(lower(translate(name,
                 'ÀÁÂÄÃÈÉÊËÌÍÎÏÒÓÔÖÕÙÚÛÜÇÑàáâäãèéêëìíîïòóôöõùúûüçñ', 'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')),
                 '[^a-z0-9]+', '-', 'g')) AS slug
          FROM names
      )
      INSERT INTO post_terms (kind, slug, name)
      SELECT DISTINCT ON (slug) 'categorie', left(slug, 80), name FROM slugged WHERE slug <> '' ORDER BY slug, name
      ON CONFLICT DO NOTHING;
      INSERT INTO post_term_links (post_id, term_id)
      SELECT DISTINCT p.id, t.id FROM posts p, unnest(p.categories) AS category(category_name)
        JOIN post_terms t ON t.kind = 'categorie' AND t.slug = left(trim(both '-' from regexp_replace(lower(translate(trim(category.category_name),
                 'ÀÁÂÄÃÈÉÊËÌÍÎÏÒÓÔÖÕÙÚÛÜÇÑàáâäãèéêëìíîïòóôöõùúûüçñ', 'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')),
                 '[^a-z0-9]+', '-', 'g')), 80)
      ON CONFLICT DO NOTHING;
    `,
  },
  {
    id: 21,
    name: 'website: veelgestelde vragen beheren',
    sql: `
      -- FAQ beheren in het CRM (CMS-pakket I3). Categorieën krijgen een eigen tabel met volgorde; faqs.category blijft
      -- als afgeleide kopie van de naam (site, FAQ-blok). managed_in_crm: de WordPress-import laat de vraag staan.
      CREATE TABLE faq_categories (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE UNIQUE INDEX faq_categories_name_idx ON faq_categories ((lower(name)));
      ALTER TABLE faqs
        ADD COLUMN category_id INTEGER REFERENCES faq_categories(id) ON DELETE RESTRICT,
        ADD COLUMN managed_in_crm BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ADD COLUMN updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
      CREATE INDEX faqs_category_idx ON faqs (category_id);
      -- Bestaande categorieën (tekst in faqs.category) worden categorieën, alfabetisch zoals de site ze nu toont.
      INSERT INTO faq_categories (name, sort_order)
      SELECT category_name, (row_number() OVER (ORDER BY category_name)) * 10
        FROM (SELECT DISTINCT ON (lower(category_name)) category_name
                FROM (SELECT left(COALESCE(NULLIF(trim(regexp_replace(category, '[<>]', '', 'g')), ''), 'Algemeen'), 120) AS category_name FROM faqs) named
               ORDER BY lower(category_name), category_name COLLATE "C") unique_names;
      UPDATE faqs SET category = c.name, category_id = c.id
        FROM faq_categories c
       WHERE lower(c.name) = lower(left(COALESCE(NULLIF(trim(regexp_replace(faqs.category, '[<>]', '', 'g')), ''), 'Algemeen'), 120));
    `,
  },
  {
    id: 22,
    name: 'website: reisleiders beheren',
    sql: `
      -- Reisleiders beheren in het CRM (CMS-pakket I4). De gegevens die nu in site-content.json staan krijgen een kolom;
      -- managed_in_crm: de site toont de database in plaats van het bestand en de WordPress-import laat hem staan.
      ALTER TABLE guides
        ADD COLUMN surname TEXT NOT NULL DEFAULT '',
        ADD COLUMN city TEXT NOT NULL DEFAULT '',
        ADD COLUMN since TEXT NOT NULL DEFAULT '' CHECK (since = '' OR since ~ '^(19|20)[0-9]{2}$'),
        ADD COLUMN quote TEXT NOT NULL DEFAULT '',
        ADD COLUMN image_url TEXT,
        ADD COLUMN managed_in_crm BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ADD COLUMN updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
    `,
  },
  {
    id: 23,
    name: 'reizigersaccounts',
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
  },
  {
    id: 24,
    name: 'aanmelding-bij-account',
    sql: `
      -- Opnieuw boeken (CMS-pakket J4): een aanmelding die een ingelogde reiziger doet met het e-mailadres van zijn account
      -- krijgt het account-id. Alleen zulke aanmeldingen vullen het formulier een volgende keer alvast in; op e-mailadres
      -- alleen nooit, want het aanmeldformulier bevestigt dat adres niet.
      ALTER TABLE bookings ADD COLUMN customer_account_id INTEGER REFERENCES customer_accounts(id) ON DELETE SET NULL;
      CREATE INDEX bookings_customer_account_idx ON bookings (customer_account_id, created_at) WHERE customer_account_id IS NOT NULL;
    `,
  },
  {
    id: 25,
    name: 'CRM: AVG-opschoning',
    sql: `
      -- Bewaartermijnen (OPZET-CRM §5): bijzondere en paspoortgegevens wissen na terugkomst (blocks_purged_at), personen en
      -- hun aanmeldingen anonimiseren na de bewaartermijn (anonymized_at). Elke ronde komt met aantallen in retention_runs,
      -- zodat in Beheer te zien is wat er is gewist; nooit welke persoon.
      ALTER TABLE persons
        ADD COLUMN blocks_purged_at TIMESTAMPTZ,
        ADD COLUMN anonymized_at TIMESTAMPTZ;
      ALTER TABLE bookings ADD COLUMN anonymized_at TIMESTAMPTZ;
      CREATE INDEX persons_active_idx ON persons (last_activity_at) WHERE anonymized_at IS NULL;
      CREATE INDEX bookings_cancelled_idx ON bookings (cancelled_at) WHERE status = 'geannuleerd';
      CREATE INDEX bookings_unlinked_active_idx ON bookings (created_at) WHERE person_id IS NULL AND anonymized_at IS NULL;
      CREATE INDEX contact_messages_created_idx ON contact_messages (created_at);
      CREATE TABLE retention_runs (
        id SERIAL PRIMARY KEY,
        started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        finished_at TIMESTAMPTZ,
        trigger TEXT NOT NULL CHECK (trigger IN ('dagelijks', 'handmatig')),
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        counts JSONB NOT NULL DEFAULT '{}'::jsonb,
        failed INTEGER NOT NULL DEFAULT 0,
        error TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX retention_runs_started_idx ON retention_runs (started_at);
    `,
  },
  {
    id: 26,
    name: 'CRM: betalingen',
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
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
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
  },
];

module.exports = { MIGRATIONS };
