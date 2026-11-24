/**
 * Tests voor de eigen databaserol van de app (P7.4, `deploy/apps01/app-rol.sql`): in een eigen database met objecten
 * van de beheerder (zoals op een bestaande installatie) maakt het script `avanta_app` aan, draagt alles over en is het
 * herhaalbaar. Daarna kan de app als die rol migreren, maar geen rollen maken of superuser-functies gebruiken.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { createDatabase } = require('../src/database/db');

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const ROLE_SQL = fs.readFileSync(path.resolve(__dirname, '../../deploy/apps01/app-rol.sql'), 'utf8');
// Eigen database en eigen rolnaam per run: rollen zijn clusterbreed, dus nooit de echte avanta_app aanraken.
const SUFFIX = crypto.randomBytes(4).toString('hex');
const DATABASE = `avanta_rol_test_${SUFFIX}`;
const ROLE = `avanta_app_test_${SUFFIX}`;

/**
 * Verbindings-URL naar een andere database en eventueel een andere gebruiker op dezelfde server.
 * @param {string} database Naam van de database.
 * @param {{user: string, password: string}} [login] Andere gebruiker.
 * @returns {string} De URL.
 */
function urlFor(database, login) {
  const url = new URL(DATABASE_URL || 'postgres://localhost/postgres');
  url.pathname = `/${database}`;
  if (login) {
    url.username = login.user;
    url.password = login.password;
  }
  return url.toString();
}

/**
 * Voert een opdracht uit met een losse verbinding en sluit die daarna.
 * @param {string} url Verbindings-URL.
 * @param {(client: Client) => Promise<*>} work Het werk.
 * @returns {Promise<*>} Wat het werk teruggeeft.
 */
async function withClient(url, work) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/**
 * Draait app-rol.sql zoals install.sh dat doet: eerst het wachtwoord via set_config, dan het script.
 * @param {string} password Wachtwoord voor avanta_app.
 * @returns {Promise<void>}
 */
function applyRole(password) {
  return withClient(urlFor(DATABASE), async (client) => {
    await client.query("SELECT set_config('avanta.app_password', $1, false), set_config('avanta.app_role', $2, false)", [password, ROLE]);
    await client.query(ROLE_SQL);
  });
}

test('databaserol avanta_app: overdracht, herhaalbaar en beperkte rechten', { skip: !DATABASE_URL && 'TEST_DATABASE_URL ontbreekt' }, async (t) => {
  const admin = urlFor(new URL(DATABASE_URL).pathname.slice(1));
  // Opruimen eerst registreren, zodat het ook gebeurt als het aanmaken halverwege mislukt.
  t.after(() => withClient(admin, async (client) => {
    await client.query(`DROP DATABASE IF EXISTS ${DATABASE}`);
    await client.query(`DROP ROLE IF EXISTS ${ROLE}`);
  }));
  await withClient(admin, (client) => client.query(`CREATE DATABASE ${DATABASE}`));

  // Een bestaande installatie: alles is van de beheerder.
  await withClient(urlFor(DATABASE), (client) => client.query(`
    CREATE TYPE stand AS ENUM ('open', 'dicht');
    CREATE DOMAIN positief AS integer CHECK (VALUE > 0);
    CREATE TABLE proef (id SERIAL PRIMARY KEY, stand stand NOT NULL DEFAULT 'open', aantal positief);
    CREATE SEQUENCE losse_reeks;
    CREATE VIEW proef_open AS SELECT id FROM proef WHERE stand = 'open';
    CREATE FUNCTION dubbel(waarde integer) RETURNS integer LANGUAGE sql AS 'SELECT waarde * 2';
    INSERT INTO proef (aantal) VALUES (3);
  `));

  await assert.rejects(applyRole('kort'), /avanta.app_password/);
  await assert.rejects(withClient(urlFor(DATABASE), async (client) => {
    await client.query("SELECT set_config('avanta.app_password', $1, false), set_config('avanta.app_role', 'postgres', false)", ['a'.repeat(48)]);
    await client.query(ROLE_SQL);
  }), /avanta.app_role/, 'alleen rolnamen die met avanta_app beginnen');
  const password = crypto.randomBytes(24).toString('hex');
  await applyRole(password);
  await applyRole(password);

  await withClient(urlFor(DATABASE), async (client) => {
    const role = (await client.query("SELECT rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = $1", [ROLE])).rows[0];
    assert.deepEqual(role, { rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false, rolbypassrls: false, rolcanlogin: true });
    const foreign = (await client.query(`
      SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND pg_get_userbyid(c.relowner) <> $1
      UNION ALL SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND pg_get_userbyid(p.proowner) <> $1
      UNION ALL SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND pg_get_userbyid(t.typowner) <> $1`, [ROLE])).rows;
    assert.deepEqual(foreign, []);
    const owners = (await client.query("SELECT pg_get_userbyid(datdba) AS database, (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'public') AS schema FROM pg_database WHERE datname = current_database()")).rows[0];
    assert.deepEqual(owners, { database: ROLE, schema: ROLE });
  });

  // Als de app: migreren en gewoon werken mag, rollen maken en de server aanspreken niet.
  const db = createDatabase(urlFor(DATABASE, { user: ROLE, password }));
  t.after(() => db.close());
  assert.ok((await db.migrate()).length > 0, 'migraties draaien als de app-rol');
  assert.deepEqual(await db.query('SELECT dubbel(aantal) AS uitkomst FROM proef'), [{ uitkomst: 6 }]);
  await db.query('INSERT INTO proef (stand) VALUES ($1)', ['dicht']);
  await assert.rejects(db.query('CREATE ROLE kwaadwillend'), /permission denied/);
  await assert.rejects(db.query("COPY (SELECT 1) TO PROGRAM 'true'"), /permission denied|must be superuser/);
  await assert.rejects(db.query("SELECT pg_read_file('/etc/hostname')"), /permission denied/);

  // Een nieuw wachtwoord na een nieuwe run; het oude werkt dan niet meer.
  const newPassword = crypto.randomBytes(24).toString('hex');
  await applyRole(newPassword);
  await assert.rejects(withClient(urlFor(DATABASE, { user: ROLE, password }), (client) => client.query('SELECT 1')), /password authentication failed/);
});
