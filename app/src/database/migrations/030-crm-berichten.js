// @ts-check
/**
 * Migratie 30: CRM: berichten via het contactformulier afhandelen.
 * Staat deze migratie op main, dan verandert hij nooit meer; een wijziging is een nieuwe migratie.
 */
module.exports = {
  id: 30,
  name: "CRM: berichten afhandelen",
  sql: `
      -- Kantoor handelt een bericht af (status 'afgehandeld') of zet het terug op 'nieuw'. Wie het afhandelde en wanneer
      -- staat bij het bericht; een korte notitie (bijvoorbeeld "gebeld op 12-3") is optioneel. De gebruiker mag later
      -- verdwijnen: dan blijft het bericht staan zonder naam.
      ALTER TABLE contact_messages ADD COLUMN handled_at TIMESTAMPTZ;
      ALTER TABLE contact_messages ADD COLUMN handled_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE contact_messages ADD COLUMN note TEXT NOT NULL DEFAULT '';
      ALTER TABLE contact_messages ADD CONSTRAINT contact_messages_status_check CHECK (status IN ('nieuw', 'afgehandeld'));
    `,
};
