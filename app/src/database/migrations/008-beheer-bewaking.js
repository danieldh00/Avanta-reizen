// @ts-check
/**
 * Migratie 8: beheer: bewaking.
 * Staat deze migratie op main, dan verandert hij nooit meer; een wijziging is een nieuwe migratie.
 */
module.exports = {
  id: 8,
  name: "beheer: bewaking",
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
};
