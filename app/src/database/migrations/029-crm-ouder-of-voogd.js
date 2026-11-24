// @ts-check
/**
 * Migratie 29: CRM: toestemming van ouder of voogd.
 * Staat deze migratie op main, dan verandert hij nooit meer; een wijziging is een nieuwe migratie.
 */
module.exports = {
  id: 29,
  name: "CRM: toestemming van ouder of voogd",
  sql: `
      -- Deelnemers jonger dan 16 (op de dag van aanmelden): een ouder of voogd geeft de toestemmingen (art. 8 AVG,
      -- art. 5 UAVG). Naam, relatie, e-mailadres en telefoon van die ouder staan versleuteld in een eigen blok bij de
      -- persoon (vault, AAD persons:guardian_data:<id>), net als de andere blokken.
      ALTER TABLE persons ADD COLUMN guardian_data TEXT;

      -- Wie de toestemming gaf: de deelnemer zelf of een ouder of voogd. De soort 'ouder_voogd' is de toestemming van
      -- de ouder voor de aanmelding zelf; de voorwaarden en art. 9 van die aanmelding krijgen given_by = 'ouder_voogd'.
      ALTER TABLE consents ADD COLUMN given_by TEXT NOT NULL DEFAULT 'deelnemer' CHECK (given_by IN ('deelnemer', 'ouder_voogd'));
      ALTER TABLE consents DROP CONSTRAINT consents_kind_check;
      ALTER TABLE consents ADD CONSTRAINT consents_kind_check CHECK (kind IN ('voorwaarden', 'art9_religie', 'art9_gezondheid', 'ouder_voogd'));
    `,
};
