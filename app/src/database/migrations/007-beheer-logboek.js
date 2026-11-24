// @ts-check
/**
 * Migratie 7: beheer: logboek.
 * Staat deze migratie op main, dan verandert hij nooit meer; een wijziging is een nieuwe migratie.
 */
module.exports = {
  id: 7,
  name: "beheer: logboek",
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
};
