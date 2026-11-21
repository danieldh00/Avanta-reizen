/**
 * Slugs van reizen, reistypes en landen (CMS-pakket G): een slug maken uit een naam, controleren, en bij een gewijzigde
 * of samengevoegde slug automatisch een 301 van het oude naar het nieuwe adres (tabel `redirects` uit beheer A3).
 * Zo blijven oude links en zoekmachineresultaten werken. Alle vragen met gebonden parameters.
 */

/** Toegestane vorm van een slug: kleine letters, cijfers en losse streepjes. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Maximale lengte van een slug. */
const MAX_SLUG_LENGTH = 80;

/**
 * Maakt een slug uit een naam: accenten weg (ë → e), kleine letters, alles behalve letters en cijfers wordt een streepje.
 * @param {string} name Naam of titel.
 * @returns {string} Slug (kan leeg zijn).
 */
function slugify(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '');
}

/**
 * Of een slug geldig is.
 * @param {string} slug Slug.
 * @returns {boolean} Waar als de vorm en lengte kloppen.
 */
function isValidSlug(slug) {
  return typeof slug === 'string' && slug.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(slug);
}

/**
 * Legt een 301 vast van een oud naar een nieuw adres op de eigen site, zonder lus of keten: doorverwijzingen die naar
 * het oude adres wezen gaan voortaan rechtstreeks naar het nieuwe, en een doorverwijzing vanaf het nieuwe adres (dat nu
 * weer bestaat) vervalt. Aanroepen binnen de transactie van de wijziging; daarna `redirects.reload()`.
 * @param {{query: Function}} client Transactie-client.
 * @param {{fromPath: string, toPath: string, userId: (number|null), note: string}} move Oud en nieuw pad (met slash aan
 *   beide kanten), de gebruiker en een korte notitie voor de lijst in Beheer.
 * @returns {Promise<void>}
 */
async function recordMove(client, move) {
  if (move.fromPath === move.toPath) return;
  await client.query('DELETE FROM redirects WHERE from_path = $1', [move.toPath]);
  await client.query('UPDATE redirects SET to_url = $2 WHERE to_url = $1', [move.fromPath, move.toPath]);
  await client.query(
    `INSERT INTO redirects (from_path, to_url, status, note, created_by) VALUES ($1, $2, 301, $3, $4)
     ON CONFLICT (from_path) DO UPDATE SET to_url = EXCLUDED.to_url, status = 301, note = EXCLUDED.note`,
    [move.fromPath, move.toPath, move.note.slice(0, 200), move.userId],
  );
  // Een oud adres dat nu doorverwijst hoort niet meer in de 404-lijst.
  await client.query('DELETE FROM not_found_log WHERE path = $1', [move.fromPath]);
}

module.exports = { slugify, isValidSlug, recordMove, SLUG_PATTERN, MAX_SLUG_LENGTH };
