/**
 * Migratie 31: CRM: het auditlog filteren op gebruiker en actie.
 * Staat deze migratie op main, dan verandert hij nooit meer; een wijziging is een nieuwe migratie.
 */
module.exports = {
  id: 31,
  name: "CRM: auditlog filteren",
  sql: `
      -- Het auditlog in Beheer filtert op gebruiker en op actie en bladert nieuwste eerst op id. Met id in de index kan
      -- PostgreSQL bij een filter direct de nieuwste regels lezen, ook als het log groot wordt. Soort record en record
      -- hebben al een index (migratie 4), de periode ook (created_at).
      CREATE INDEX audit_log_user_idx ON audit_log (user_id, id);
      CREATE INDEX audit_log_action_idx ON audit_log (action, id);
    `,
};
