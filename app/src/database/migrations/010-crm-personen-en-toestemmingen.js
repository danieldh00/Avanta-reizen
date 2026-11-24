// @ts-check
/**
 * Migratie 10: CRM: personen en toestemmingen.
 * Staat deze migratie op main, dan verandert hij nooit meer; een wijziging is een nieuwe migratie.
 */
module.exports = {
  id: 10,
  name: "CRM: personen en toestemmingen",
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
};
