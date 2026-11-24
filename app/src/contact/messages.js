/**
 * Berichten via het contactformulier in het CRM (tabel `contact_messages`, migraties 3 en 30): lijst met filter en
 * zoeken, één bericht, afhandelen, weer openen en verwijderen, en het aantal nieuwe berichten voor de teller in het menu.
 * Alleen de logica en de queries; de schermen staan in `message-routes.js`.
 */
const { searchPatterns } = require('../persons/person-routes');

/** De statussen van een bericht met hun naam op het scherm. */
const MESSAGE_STATUSES = {
  nieuw: 'Nieuw',
  afgehandeld: 'Afgehandeld',
};

/** Aantal berichten per pagina. */
const MESSAGE_PAGE_SIZE = 50;

/** Maximale lengte van de notitie bij het afhandelen. */
const MESSAGE_NOTE_MAX = 1000;

/** Kolommen van één bericht (nooit `SELECT *`). */
const MESSAGE_COLUMNS = `m.id, m.created_at, m.name, m.email, m.phone, m.subject, m.message, m.trip_slug, m.status, m.consent_at,
  m.handled_at, m.note, u.name AS handled_by_name, t.id AS trip_id, t.title AS trip_title, t.trip_code`;

/** De tekst waarin de zoekwoorden moeten voorkomen. */
const SEARCH_TEXT = "lower(m.name || ' ' || m.email || ' ' || m.phone || ' ' || m.subject || ' ' || m.message)";

/**
 * Leest de notitie bij het afhandelen: stuurtekens weg, regeleinden behouden, ingekort.
 * @param {*} value Invoer.
 * @returns {string} Tekst.
 */
function messageNote(value) {
  // eslint-disable-next-line no-control-regex
  return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n/g, '\n').trim().slice(0, MESSAGE_NOTE_MAX) : '';
}

/**
 * Een pagina berichten, met de aantallen per status voor de filterknoppen.
 * @param {{query: Function}} db Database.
 * @param {{status?: string, q?: string, page?: number}} filter Status (leeg = alle), zoektekst en paginanummer.
 * @returns {Promise<{rows: object[], hasNext: boolean, counts: Record<string, number>, text: string}>} De berichten,
 *   of er een volgende pagina is, het aantal per status (binnen de zoektekst) en de gebruikte zoektekst.
 */
async function listMessages(db, filter) {
  const status = Object.hasOwn(MESSAGE_STATUSES, filter.status) ? filter.status : '';
  const page = Math.min(Math.max(Number.parseInt(filter.page, 10) || 1, 1), 10000);
  const { text, patterns } = searchPatterns(filter.q);
  const matches = `NOT EXISTS (SELECT 1 FROM unnest($1::text[]) AS term WHERE ${SEARCH_TEXT} NOT LIKE term)`;
  const [rows, counts] = await Promise.all([
    db.query(
      `SELECT m.id, m.created_at, m.name, m.email, m.subject, m.status, m.trip_slug
         FROM contact_messages m
        WHERE ${matches} AND ($2 = '' OR m.status = $2)
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT $3 OFFSET $4`,
      [patterns, status, MESSAGE_PAGE_SIZE + 1, (page - 1) * MESSAGE_PAGE_SIZE],
    ),
    db.query(`SELECT m.status, count(*)::int AS total FROM contact_messages m WHERE ${matches} GROUP BY m.status`, [patterns]),
  ]);
  return {
    rows: rows.slice(0, MESSAGE_PAGE_SIZE),
    hasNext: rows.length > MESSAGE_PAGE_SIZE,
    counts: Object.fromEntries(counts.map((row) => [row.status, row.total])),
    text,
  };
}

/**
 * Zoekt één bericht op id, met de naam van wie het afhandelde en de reis waar het over gaat.
 * @param {{query: Function}} client Database of transactie-client.
 * @param {(string|number)} id Id uit de URL (alleen cijfers).
 * @returns {Promise<(object|null)>} Het bericht, of null.
 */
async function findMessage(client, id) {
  const [message] = await client.query(
    `SELECT ${MESSAGE_COLUMNS}
       FROM contact_messages m
       LEFT JOIN users u ON u.id = m.handled_by
       LEFT JOIN trips t ON t.slug = m.trip_slug
      WHERE m.id = $1`,
    [Number(id)],
  );
  return message || null;
}

/**
 * Zet een bericht op afgehandeld, met wie en wanneer en een optionele notitie. Een bericht dat al afgehandeld is,
 * verandert niet (twee mensen die tegelijk op de knop drukken).
 * @param {{query: Function}} client Transactie-client.
 * @param {number} id Id van het bericht.
 * @param {{userId: number, note: string}} handling Wie het afhandelt en de notitie.
 * @returns {Promise<boolean>} Waar als het bericht nu is afgehandeld door deze aanroep.
 */
async function markHandled(client, id, handling) {
  const rows = await client.query(
    `UPDATE contact_messages SET status = 'afgehandeld', handled_at = now(), handled_by = $2, note = $3
      WHERE id = $1 AND status = 'nieuw' RETURNING id`,
    [id, handling.userId, handling.note],
  );
  return rows.length === 1;
}

/**
 * Zet een afgehandeld bericht terug op nieuw; wie het afhandelde en de notitie blijven staan als geschiedenis tot het
 * opnieuw wordt afgehandeld.
 * @param {{query: Function}} client Transactie-client.
 * @param {number} id Id van het bericht.
 * @returns {Promise<boolean>} Waar als het bericht nu weer nieuw is door deze aanroep.
 */
async function reopenMessage(client, id) {
  const rows = await client.query("UPDATE contact_messages SET status = 'nieuw' WHERE id = $1 AND status = 'afgehandeld' RETURNING id", [id]);
  return rows.length === 1;
}

/**
 * Verwijdert een bericht (bijvoorbeeld spam).
 * @param {{query: Function}} client Transactie-client.
 * @param {number} id Id van het bericht.
 * @returns {Promise<boolean>} Waar als er een bericht is verwijderd.
 */
async function deleteMessage(client, id) {
  const rows = await client.query('DELETE FROM contact_messages WHERE id = $1 RETURNING id', [id]);
  return rows.length === 1;
}

/**
 * Het aantal nieuwe berichten, voor de teller in het menu (index `contact_messages_status_idx`).
 * @param {{query: Function}} db Database.
 * @returns {Promise<number>} Aantal.
 */
async function countNewMessages(db) {
  const [row] = await db.query("SELECT count(*)::int AS total FROM contact_messages WHERE status = 'nieuw'");
  return row.total;
}

module.exports = {
  MESSAGE_STATUSES,
  MESSAGE_PAGE_SIZE,
  MESSAGE_NOTE_MAX,
  messageNote,
  listMessages,
  findMessage,
  markHandled,
  reopenMessage,
  deleteMessage,
  countNewMessages,
};
