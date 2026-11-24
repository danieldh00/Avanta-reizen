/**
 * Zoeken over het hele CRM (`/app/zoeken/`, het zoekveld in de kopbalk): één zoekterm in aanmeldingen, deelnemers,
 * berichten, reizen, reisleiders, pagina's, blog, veelgestelde vragen en gebruikers. Elke bron telt alleen mee als de
 * gebruiker het recht heeft (dezelfde rechten als het scherm zelf), dus wie iets niet mag zien, vindt het ook niet.
 * Per bron hoogstens `SEARCH_LIMIT` treffers, met een link naar de lijst van die bron als die zelf kan zoeken.
 * Alleen de logica en de queries; het scherm staat in `search-routes.js`.
 */
const { roleHasRight, roleHasGlobalRight } = require('./rights');
const { formatDate } = require('../site/format');

/** Treffers per bron op de resultatenpagina. */
const SEARCH_LIMIT = 5;

/** Kortste zoekterm (in tekens, zonder spaties). */
const MIN_LENGTH = 2;

/**
 * De bronnen. `global`: het recht moet voor alle records gelden (niet tot eigen vertrekken beperkt). `columns`, `from`,
 * `where`, `text` en `order` zijn vaste SQL zonder invoer; de zoekwoorden gaan als parameter mee. `href` en `label`
 * maken de link, `detail` een korte toelichting, `listHref` de lijst van die bron met dezelfde zoekterm (of null).
 */
const SEARCH_SOURCES = [
  {
    key: 'aanmeldingen',
    title: 'Aanmeldingen',
    right: 'aanmeldingen',
    global: true,
    columns: 'id, reference, first_names, call_name, last_name, trip_title, departure_date',
    from: 'bookings',
    text: "lower(reference || ' ' || last_name || ' ' || first_names || ' ' || call_name || ' ' || email || ' ' || coalesce(trip_code, ''))",
    order: 'created_at DESC, id DESC',
    href: (row) => `/app/aanmeldingen/${row.id}/`,
    label: (row) => `${row.reference} · ${row.last_name}, ${row.call_name || row.first_names}`,
    detail: (row) => `${row.trip_title}, ${formatDate(row.departure_date)}`,
    listHref: (text) => `/app/aanmeldingen/?q=${encodeURIComponent(text)}`,
  },
  {
    key: 'deelnemers',
    title: 'Deelnemers',
    right: 'deelnemers',
    global: true,
    columns: 'id, first_names, call_name, last_name, email, city',
    from: 'persons',
    where: 'anonymized_at IS NULL',
    text: "lower(last_name || ' ' || first_names || ' ' || call_name || ' ' || email || ' ' || mobile || ' ' || city)",
    order: 'lower(last_name), lower(first_names), id',
    href: (row) => `/app/deelnemers/${row.id}/`,
    label: (row) => `${row.last_name}, ${row.call_name || row.first_names}`,
    detail: (row) => [row.email, row.city].filter(Boolean).join(' · '),
    listHref: (text) => `/app/deelnemers/?q=${encodeURIComponent(text)}`,
  },
  {
    key: 'berichten',
    title: 'Berichten',
    right: 'berichten',
    global: true,
    columns: 'id, name, subject, status, created_at',
    from: 'contact_messages',
    text: "lower(name || ' ' || email || ' ' || phone || ' ' || subject || ' ' || message)",
    order: 'created_at DESC, id DESC',
    href: (row) => `/app/berichten/${row.id}/`,
    label: (row) => row.name,
    detail: (row) => [row.subject, row.status === 'nieuw' ? 'nieuw' : 'afgehandeld', formatDate(row.created_at)].filter(Boolean).join(' · '),
    listHref: (text) => `/app/berichten/?status=alle&q=${encodeURIComponent(text)}`,
  },
  {
    key: 'reizen',
    title: 'Reizen',
    right: 'reizen',
    columns: 'id, title, trip_code, departure_date, published',
    from: 'trips',
    text: "lower(title || ' ' || coalesce(trip_code, '') || ' ' || slug)",
    order: 'departure_date DESC NULLS LAST, id DESC',
    href: (row) => `/app/reizen/${row.id}/`,
    label: (row) => `${row.title}${row.trip_code ? ` (${row.trip_code})` : ''}`,
    detail: (row) => [row.departure_date ? formatDate(row.departure_date) : '', row.published ? '' : 'concept'].filter(Boolean).join(' · '),
    listHref: (text) => `/app/reizen/?q=${encodeURIComponent(text)}`,
  },
  {
    key: 'reisleiders',
    title: 'Reisleiders',
    right: 'reizen',
    columns: 'id, name',
    from: 'guides',
    text: "lower(name || ' ' || slug)",
    order: 'lower(name), id',
    href: (row) => `/app/reisleiders/${row.id}/`,
    label: (row) => row.name,
    detail: () => '',
    listHref: (text) => `/app/reisleiders/?q=${encodeURIComponent(text)}`,
  },
  {
    key: 'paginas',
    title: 'Pagina\'s',
    right: 'content',
    columns: 'id, title, path',
    from: 'pages',
    text: "lower(title || ' ' || path)",
    order: 'lower(title), id',
    href: (row) => `/app/paginas/${row.id}/`,
    label: (row) => row.title,
    detail: (row) => row.path,
    listHref: (text) => `/app/paginas/?q=${encodeURIComponent(text)}`,
  },
  {
    key: 'blog',
    title: 'Blog',
    right: 'content',
    columns: 'id, title, slug',
    from: 'posts',
    text: "lower(title || ' ' || slug)",
    order: 'id DESC',
    href: (row) => `/app/blog/${row.id}/`,
    label: (row) => row.title,
    detail: (row) => `/${row.slug}/`,
    listHref: (text) => `/app/blog/?q=${encodeURIComponent(text)}`,
  },
  {
    key: 'faq',
    title: 'Veelgestelde vragen',
    right: 'content',
    columns: 'id, question, category',
    from: 'faqs',
    text: "lower(question || ' ' || category)",
    order: 'lower(category), sort_order, id',
    href: (row) => `/app/faq/${row.id}/`,
    label: (row) => row.question,
    detail: (row) => row.category,
    listHref: null,
  },
  {
    key: 'gebruikers',
    title: 'Gebruikers',
    right: 'gebruikers',
    columns: 'id, name, email',
    from: 'users',
    text: "lower(name || ' ' || email)",
    order: 'lower(name), id',
    href: (row) => `/app/gebruikers/${row.id}/`,
    label: (row) => row.name,
    detail: (row) => row.email,
    listHref: null,
  },
];

/**
 * De bronnen waarin een rol mag zoeken.
 * @param {string} role Rol.
 * @returns {object[]} Bronnen uit `SEARCH_SOURCES`.
 */
function sourcesFor(role) {
  return SEARCH_SOURCES.filter((source) => (source.global ? roleHasGlobalRight : roleHasRight)(role, source.right));
}

/**
 * Of een rol het zoekveld krijgt (minstens één bron).
 * @param {string} role Rol.
 * @returns {boolean} Waar als er iets te doorzoeken is.
 */
function canSearch(role) {
  return sourcesFor(role).length > 0;
}

/**
 * Zoekt in alle bronnen die de rol mag zien.
 * @param {{query: Function}} db Database.
 * @param {string} role Rol van de gebruiker.
 * @param {*} value Zoekterm uit de querystring.
 * @returns {Promise<{text: string, tooShort: boolean, groups: {source: object, rows: object[], more: boolean}[]}>}
 *   De gebruikte zoekterm, of die te kort is, en per bron met treffers de rijen (hoogstens `SEARCH_LIMIT`) en of er meer
 *   zijn.
 */
async function searchCrm(db, role, value) {
  // Pas hier laden: `persons/person-routes.js` laadt `crm/layout.js`, en die laadt dit bestand voor het zoekveld.
  // eslint-disable-next-line global-require
  const { searchPatterns } = require('../persons/person-routes');
  const { text, patterns } = searchPatterns(value);
  if (text.replace(/\s/g, '').length < MIN_LENGTH || !patterns.length) return { text, tooShort: Boolean(text), groups: [] };
  const sources = sourcesFor(role);
  const results = await Promise.all(sources.map((source) => db.query(
    `SELECT ${source.columns} FROM ${source.from}
      WHERE ${source.where ? `${source.where} AND ` : ''}NOT EXISTS (SELECT 1 FROM unnest($1::text[]) AS term WHERE ${source.text} NOT LIKE term)
      ORDER BY ${source.order}
      LIMIT $2`,
    [patterns, SEARCH_LIMIT + 1],
  )));
  const groups = sources
    .map((source, index) => ({ source, rows: results[index].slice(0, SEARCH_LIMIT), more: results[index].length > SEARCH_LIMIT }))
    .filter((group) => group.rows.length);
  return { text, tooShort: false, groups };
}

module.exports = { SEARCH_SOURCES, SEARCH_LIMIT, MIN_LENGTH, sourcesFor, canSearch, searchCrm };
