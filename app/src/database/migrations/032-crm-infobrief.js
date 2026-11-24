// @ts-check
/**
 * Migratie 32: CRM: de infobrief aan de deelnemers van een vertrek.
 * Staat deze migratie op main, dan verandert hij nooit meer; een wijziging is een nieuwe migratie.
 */
module.exports = {
  id: 32,
  name: "CRM: infobrief aan deelnemers",
  sql: `
      -- Een infobrief hoort bij één vertrek (reis). Kantoor stelt hem op als concept (onderwerp en opgemaakte tekst, al
      -- opgeschoond bij het opslaan), verstuurt hem één keer ('verzenden': de ontvangers staan in de wachtrij) en daarna
      -- is hij 'verzonden'. Na het versturen verandert de inhoud niet meer. Wie hem verstuurde en wanneer staat erbij;
      -- verdwijnt die gebruiker, dan blijft de brief staan zonder naam.
      CREATE TABLE infobrieven (
        id SERIAL PRIMARY KEY,
        trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
        subject TEXT NOT NULL DEFAULT '',
        body_html TEXT NOT NULL DEFAULT '',
        include_new BOOLEAN NOT NULL DEFAULT false,
        include_guardians BOOLEAN NOT NULL DEFAULT true,
        status TEXT NOT NULL DEFAULT 'concept' CHECK (status IN ('concept', 'verzenden', 'verzonden')),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        sent_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        send_started_at TIMESTAMPTZ,
        send_finished_at TIMESTAMPTZ
      );
      CREATE INDEX infobrieven_trip_idx ON infobrieven (trip_id, id);
      CREATE INDEX infobrieven_status_idx ON infobrieven (status) WHERE status = 'verzenden';

      -- De ontvangers van een verstuurde infobrief: één regel per aanmelding en rol (de deelnemer zelf of de ouder of
      -- voogd). Het e-mailadres staat hier niet: de verzender zoekt het pas bij het versturen op (persoon of formulier,
      -- de ouder uit het versleutelde blok), zodat er geen tweede kopie van adressen ontstaat. De unieke sleutel maakt
      -- dubbel in de wachtrij zetten onmogelijk; 'bezig' wordt gezet vóór het versturen, zodat een herstart nooit
      -- opnieuw verstuurt ('onzeker'). De opmerking bevat nooit een adres.
      CREATE TABLE infobrief_recipients (
        id SERIAL PRIMARY KEY,
        infobrief_id INTEGER NOT NULL REFERENCES infobrieven(id) ON DELETE CASCADE,
        booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
        role TEXT NOT NULL CHECK (role IN ('deelnemer', 'ouder_voogd')),
        status TEXT NOT NULL DEFAULT 'wachtrij' CHECK (status IN ('wachtrij', 'bezig', 'verzonden', 'mislukt', 'overgeslagen', 'onzeker')),
        note TEXT NOT NULL DEFAULT '',
        attempts INTEGER NOT NULL DEFAULT 0,
        sent_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (infobrief_id, booking_id, role)
      );
      CREATE INDEX infobrief_recipients_queue_idx ON infobrief_recipients (id) WHERE status IN ('wachtrij', 'bezig');
      CREATE INDEX infobrief_recipients_booking_idx ON infobrief_recipients (booking_id);
    `,
};
