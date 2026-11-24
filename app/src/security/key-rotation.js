// @ts-check
/**
 * Sleutelrotatie van de hoofdsleutel (P7.5, bevinding A13): versleutelt alle gegevens die met een vorige hoofdsleutel
 * zijn versleuteld opnieuw met de huidige, en berekent de `match_key` van personen opnieuw (een HMAC met een van de
 * hoofdsleutel afgeleide sleutel).
 *
 * Waar versleutelde gegevens staan (AAD tussen haakjes):
 * - `persons`: de blokken uit `BLOCKS` (`persons:<blok>:<id>`) en de `match_key`;
 * - `bookings.sensitive_data`: oude aanmeldingen van vóór de personen-tabel (geen AAD);
 * - `users.totp_secret`: geheimen van de tweestapsverificatie (`users:totp:<id>`);
 * - `settings`: instellingen van het type `secret` als `{"enc": …}` (geen AAD; de naam zit in de versleutelde waarde).
 *
 * Werkwijze: in porties op id, per rij in een eigen transactie (`FOR UPDATE`) of met een voorwaardelijke UPDATE op de
 * oude waarde, zodat een gelijktijdige wijziging door de app nooit wordt overschreven. De ronde is idempotent: wat al
 * met de huidige sleutel is versleuteld, wordt overgeslagen. Een waarde die met geen enkele bekende sleutel te openen
 * is, telt als `failed` en blijft staan. Er komen nooit waarden of sleutels in de uitvoer, alleen aantallen.
 *
 * Draaien: `node src/security/key-rotation-cli.js herversleutelen` (op apps01 via `servertaken.sh sleutel-roteren`).
 * Procedure: `docs/DRAAIBOEK-VPS-VERHUIZING.md`, *Hoofdsleutel roteren*.
 */
const { BLOCKS } = require('../persons/persons');

/** Rijen per portie. */
const DEFAULT_BATCH_SIZE = 200;
/** Prefix van een `match_key` van een geanonimiseerde persoon (`persons/retention.js`): niet herberekenen. */
const ANONYMIZED_PREFIX = 'verwijderd:';

/**
 * @typedef {object} RotationCounts
 * @property {number} persons Personen waarvan blokken of match_key zijn bijgewerkt.
 * @property {number} bookings Oude aanmeldingen opnieuw versleuteld.
 * @property {number} users Geheimen van de tweestapsverificatie opnieuw versleuteld.
 * @property {number} settings Geheime instellingen opnieuw versleuteld.
 * @property {number} failed Waarden die met geen enkele bekende sleutel te openen waren (blijven staan).
 */

/**
 * Maakt de sleutelrotatie.
 * @param {{db: {query: Function, transaction: Function}, vault: {seal: Function, open: Function, isCurrent: Function, keyId: string}, persons: {matchKey: Function, sealBlock: Function}, batchSize?: number}} options
 *   Database, kluis met de huidige en de vorige sleutels, het hulpmiddel voor personen (met dezelfde kluis) en de
 *   portiegrootte.
 * @returns {{status: () => Promise<{keyId: string, pending: Record<string, number>}>, run: () => Promise<RotationCounts>}} Stand en uitvoeren.
 */
function createKeyRotation(options) {
  const { db, vault, persons } = options;
  const batchSize = options.batchSize || DEFAULT_BATCH_SIZE;
  /** Een waarde in het huidige formaat begint hiermee (LIKE-patroon; het id bestaat alleen uit hex-tekens). */
  const currentPrefix = `v2.${vault.keyId}.%`;
  const blockColumns = Object.keys(BLOCKS);

  /**
   * Telt wat nog met een vorige sleutel of in het oude formaat is versleuteld. De `match_key` is zo niet te tellen
   * (een HMAC); die rekent `run` altijd opnieuw uit.
   * @returns {Promise<{keyId: string, pending: Record<string, number>}>} Id van de huidige sleutel en aantallen per bron.
   */
  const status = async () => {
    const stale = blockColumns.map((column) => `(${column} IS NOT NULL AND ${column} NOT LIKE $1)`).join(' OR ');
    const [personCount] = await db.query(`SELECT count(*)::int AS n FROM persons WHERE ${stale}`, [currentPrefix]);
    const [bookingCount] = await db.query('SELECT count(*)::int AS n FROM bookings WHERE sensitive_data IS NOT NULL AND sensitive_data NOT LIKE $1', [currentPrefix]);
    const [userCount] = await db.query('SELECT count(*)::int AS n FROM users WHERE totp_secret IS NOT NULL AND totp_secret NOT LIKE $1', [currentPrefix]);
    const settingRows = await db.query("SELECT value FROM settings WHERE value LIKE '{\"enc\":%'");
    const settingCount = settingRows.filter((row) => !vault.isCurrent(encryptedSetting(row.value))).length;
    return { keyId: vault.keyId, pending: { persons: personCount.n, bookings: bookingCount.n, users: userCount.n, settings: settingCount } };
  };

  /**
   * Haalt de versleutelde tekst uit een opgeslagen geheime instelling.
   * @param {string} text JSON-tekst uit `settings.value`.
   * @returns {string} De waarde van `enc`, of leeg.
   */
  const encryptedSetting = (text) => {
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed.enc === 'string' ? parsed.enc : '';
    } catch {
      return '';
    }
  };

  /**
   * Werkt één persoon bij: blokken die niet met de huidige sleutel zijn versleuteld opnieuw versleutelen en de
   * match_key opnieuw berekenen.
   * @param {number} personId Id.
   * @returns {Promise<('bijgewerkt'|'gelijk'|'mislukt')>} Uitkomst.
   */
  const rotatePerson = (personId) => db.transaction(async (client) => {
    const [person] = await client.query(`SELECT id, email, match_key, ${blockColumns.join(', ')} FROM persons WHERE id = $1 FOR UPDATE`, [personId]);
    if (!person) return 'gelijk';
    const updates = {};
    let identity = {};
    for (const column of blockColumns) {
      if (!person[column]) continue;
      let opened;
      try {
        opened = vault.open(person[column], `persons:${column}:${person.id}`);
      } catch {
        return 'mislukt';
      }
      if (column === 'identity_data') identity = opened;
      if (!vault.isCurrent(person[column])) updates[column] = persons.sealBlock(column, person.id, opened);
    }
    if (!String(person.match_key).startsWith(ANONYMIZED_PREFIX)) {
      const key = persons.matchKey(person.email, identity.birth_date);
      if (key !== person.match_key) updates.match_key = key;
    }
    const columns = Object.keys(updates);
    if (!columns.length) return 'gelijk';
    // Kolomnamen alleen uit de vaste lijst BLOCKS plus match_key, nooit uit invoer.
    const assignments = columns.map((column, index) => `${column} = $${index + 2}`).join(', ');
    await client.query(`UPDATE persons SET ${assignments} WHERE id = $1`, [person.id, ...columns.map((column) => updates[column])]);
    return 'bijgewerkt';
  });

  /**
   * Versleutelt één kolom van een tabel opnieuw, in porties, met een voorwaardelijke UPDATE op de oude waarde.
   * @param {{table: string, column: string, context: (id: number) => string}} source Vaste tabel en kolom, met de AAD per rij.
   * @param {RotationCounts} counts Tellers (worden bijgewerkt).
   * @param {'bookings'|'users'} counter Welke teller.
   * @returns {Promise<void>}
   */
  const rotateColumn = async (source, counts, counter) => {
    let afterId = 0;
    for (;;) {
      // Tabel- en kolomnamen komen uit de vaste aanroepen hieronder, nooit uit invoer.
      const rows = await db.query(
        `SELECT id, ${source.column} AS sealed FROM ${source.table}
          WHERE ${source.column} IS NOT NULL AND ${source.column} NOT LIKE $1 AND id > $2 ORDER BY id LIMIT $3`,
        [currentPrefix, afterId, batchSize],
      );
      if (!rows.length) return;
      for (const row of rows) {
        afterId = row.id;
        let value;
        try {
          value = vault.open(row.sealed, source.context(row.id));
        } catch {
          counts.failed++;
          continue;
        }
        const updated = await db.query(
          `UPDATE ${source.table} SET ${source.column} = $2 WHERE id = $1 AND ${source.column} = $3 RETURNING id`,
          [row.id, vault.seal(value, source.context(row.id)), row.sealed],
        );
        if (updated.length) counts[counter]++;
      }
    }
  };

  /**
   * Versleutelt de geheime instellingen opnieuw (zelfde waarde, nieuwe sleutel). Gebeurt rechtstreeks in de tabel:
   * de waarde verandert niet, dus er is geen wijziging van een instelling om te auditen; `run` legt de ronde als geheel
   * vast.
   * @param {RotationCounts} counts Tellers.
   * @returns {Promise<void>}
   */
  const rotateSettings = async (counts) => {
    const rows = await db.query("SELECT key, value FROM settings WHERE value LIKE '{\"enc\":%' ORDER BY key");
    for (const row of rows) {
      const sealed = encryptedSetting(row.value);
      if (!sealed || vault.isCurrent(sealed)) continue;
      let opened;
      try {
        opened = vault.open(sealed);
      } catch {
        counts.failed++;
        continue;
      }
      const updated = await db.query(
        'UPDATE settings SET value = $2 WHERE key = $1 AND value = $3 RETURNING key',
        [row.key, JSON.stringify({ enc: vault.seal(opened) }), row.value],
      );
      if (updated.length) counts.settings++;
    }
  };

  /**
   * Voert de rotatie uit en legt hem vast in het auditlog (actie `sleutel.geroteerd`, met het id van de huidige sleutel).
   * @returns {Promise<RotationCounts>} Aantallen per bron.
   */
  const run = async () => {
    /** @type {RotationCounts} */
    const counts = { persons: 0, bookings: 0, users: 0, settings: 0, failed: 0 };
    let afterId = 0;
    for (;;) {
      const rows = await db.query('SELECT id FROM persons WHERE id > $1 ORDER BY id LIMIT $2', [afterId, batchSize]);
      if (!rows.length) break;
      for (const row of rows) {
        afterId = row.id;
        const outcome = await rotatePerson(row.id);
        if (outcome === 'bijgewerkt') counts.persons++;
        if (outcome === 'mislukt') counts.failed++;
      }
    }
    await rotateColumn({ table: 'bookings', column: 'sensitive_data', context: () => '' }, counts, 'bookings');
    await rotateColumn({ table: 'users', column: 'totp_secret', context: (id) => `users:totp:${id}` }, counts, 'users');
    await rotateSettings(counts);
    // Alleen als er echt iets opnieuw is versleuteld (een herhaalde, lege ronde is geen rotatie). Zonder gebruiker en
    // IP-adres: de opdracht komt van de server zelf. Het record is het id van de nieuwe sleutel.
    if (counts.persons + counts.bookings + counts.users + counts.settings === 0) return counts;
    await db.query(
      "INSERT INTO audit_log (user_id, action, entity, entity_id, ip_prefix) VALUES (NULL, 'sleutel.geroteerd', 'systeem', $1, NULL)",
      [vault.keyId],
    );
    return counts;
  };

  return { status, run };
}

module.exports = { createKeyRotation, DEFAULT_BATCH_SIZE };
