/**
 * Databaseverbinding (PostgreSQL) en het uitvoeren van de migraties.
 */
const { Pool } = require('pg');
const { MIGRATIONS } = require('./migrations');

/**
 * Maakt een verbinding met PostgreSQL.
 * @param {string} connectionString Verbindings-URL (DATABASE_URL).
 * @returns {{query: Function, transaction: Function, migrate: Function, close: Function, pool: Pool}} De database.
 */
function createDatabase(connectionString) {
  if (!connectionString) throw new Error('DATABASE_URL ontbreekt');
  const pool = new Pool({ connectionString, max: Number(process.env.DATABASE_POOL_SIZE) || 10 });

  /**
   * Voert één query uit met gebonden parameters.
   * @param {string} sql SQL met $1, $2, ...
   * @param {Array} [params] Parameters.
   * @returns {Promise<object[]>} De rijen.
   */
  const query = async (sql, params = []) => (await pool.query(sql, params)).rows;

  /**
   * Voert een functie uit binnen één transactie; bij een fout wordt alles teruggedraaid.
   * @param {(client: {query: Function}) => Promise<*>} work Het werk, krijgt een client met query().
   * @returns {Promise<*>} Wat het werk teruggeeft.
   */
  const transaction = async (work) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work({ query: async (sql, params = []) => (await client.query(sql, params)).rows });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };

  /**
   * Voert de migraties uit die nog niet zijn gedraaid (met een advisory lock tegen gelijktijdig starten).
   * @returns {Promise<number[]>} De nummers van de uitgevoerde migraties.
   */
  const migrate = async () => {
    const client = await pool.connect();
    const applied = [];
    try {
      await client.query('SELECT pg_advisory_lock(727001)');
      await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
      const done = new Set((await client.query('SELECT id FROM schema_migrations')).rows.map((row) => row.id));
      for (const migration of MIGRATIONS) {
        if (done.has(migration.id)) continue;
        await client.query('BEGIN');
        try {
          await client.query(migration.sql);
          await client.query('INSERT INTO schema_migrations (id, name) VALUES ($1, $2)', [migration.id, migration.name]);
          await client.query('COMMIT');
          applied.push(migration.id);
        } catch (error) {
          await client.query('ROLLBACK');
          throw new Error(`migratie ${migration.id} (${migration.name}) mislukt: ${error.message}`);
        }
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock(727001)').catch(() => {});
      client.release();
    }
    return applied;
  };

  /**
   * Sluit alle verbindingen.
   * @returns {Promise<void>}
   */
  const close = () => pool.end();

  return { query, transaction, migrate, close, pool };
}

module.exports = { createDatabase };
