// @ts-check
/**
 * Het auditlog lezen: filters uit de querystring, een pagina regels (nieuwste eerst, bladeren op id), de regels voor de
 * Excel-export en het Excel-bestand zelf. Alleen de logica en de queries; het scherm staat in `audit-routes.js`.
 * Het auditlog bevat nooit waarden of persoonsgegevens, alleen wie, wat, welk record en de ingekorte IP-reeks.
 */
const { createXlsx } = require('../export/xlsx');
const { isValidDate } = require('../booking/fields');

/** Aantal regels per pagina. */
const AUDIT_PAGE_SIZE = 100;

/** Hoogstens zoveel regels in één export; daarboven eerst de periode of het filter verkleinen. */
const AUDIT_EXPORT_MAX = 50000;

/**
 * Naam van een soort record op het scherm en het adres van zo'n record in het CRM; `href` ontbreekt als het record geen
 * eigen pagina heeft. Deze lijst is ook de keuzelijst *Soort record* (vast, zodat het scherm niet het hele log leest); een
 * nieuwe soort in `auth.audit` krijgt hier een regel. Een soort die hier niet staat, verschijnt met zijn technische naam.
 */
const ENTITIES = {
  bookings: { label: 'Aanmelding', href: (id) => `/app/aanmeldingen/${id}/` },
  persons: { label: 'Deelnemer', href: (id) => `/app/deelnemers/${id}/` },
  contact_messages: { label: 'Bericht', href: (id) => `/app/berichten/${id}/` },
  infobrieven: { label: 'Infobrief', href: (id) => `/app/infobrieven/${id}/` },
  trips: { label: 'Reis', href: (id) => `/app/reizen/${id}/` },
  guides: { label: 'Reisleider', href: (id) => `/app/reisleiders/${id}/` },
  pages: { label: 'Pagina', href: (id) => `/app/paginas/${id}/` },
  posts: { label: 'Blogbericht', href: (id) => `/app/blog/${id}/` },
  faqs: { label: 'Veelgestelde vraag', href: (id) => `/app/faq/${id}/` },
  list_headers: { label: 'Kop van een lijstpagina', href: (id) => `/app/lijstpaginas/${id}/` },
  users: { label: 'Gebruiker', href: (id) => `/app/gebruikers/${id}/` },
  media: { label: 'Foto', href: (id) => `/app/fotobibliotheek/${id}/` },
  trip_categories: { label: 'Reistype of land', href: (id) => `/app/reistypes-en-landen/${id}/` },
  customer_accounts: { label: 'Reizigersaccount' },
  backup: { label: 'Back-up' },
  settings: { label: 'Instelling' },
  redirects: { label: 'Doorverwijzing' },
  testdata: { label: 'Testdata' },
  menu_items: { label: 'Menu-item' },
  post_terms: { label: 'Categorie of tag' },
  retention_runs: { label: 'AVG-opschoning' },
  not_found_log: { label: '404-lijst' },
  servertaak: { label: 'Servertaak' },
  bewaking: { label: 'Bewaking' },
  systeem: { label: 'Systeem' },
};

/**
 * De gegevens van een soort record, alleen als die echt in `ENTITIES` staat (geen eigenschappen als `constructor`).
 * @param {string} name Soort record.
 * @returns {({label: string, href?: Function}|null)} Gegevens of null.
 */
function entityInfo(name) {
  return typeof name === 'string' && Object.hasOwn(ENTITIES, name) ? ENTITIES[name] : null;
}

/**
 * De naam van een soort record op het scherm; een onbekende soort houdt zijn technische naam.
 * @param {string} name Soort record.
 * @returns {string} Naam.
 */
function entityLabel(name) {
  const info = entityInfo(name);
  return info ? info.label : name;
}

/**
 * De omschrijving van een actie, alleen uit de eigen sleutels van `labels`; anders de actiecode zelf.
 * @param {Record<string, string>} labels Omschrijving per actie.
 * @param {string} action Actiecode.
 * @returns {string} Omschrijving.
 */
function actionLabel(labels, action) {
  return Object.hasOwn(labels, action) ? labels[action] : action;
}

/** Waarde van het gebruikersfilter voor regels zonder gebruiker (systeem, mislukte inlogpogingen). */
const SYSTEM_USER = 'systeem';

/**
 * Leest de filters uit de querystring; alles wat niet klopt, valt weg.
 * @param {any} query Querystring.
 * @returns {{user: string, action: string, entity: string, record: string, from: string, to: string}} Filters
 *   (lege tekst = geen filter); `user` is een id of `systeem`, `from` en `to` zijn datums (jjjj-mm-dd).
 */
function readAuditFilter(query) {
  const text = (value) => (typeof value === 'string' ? value.trim() : '');
  const user = text(query.gebruiker);
  const action = text(query.actie);
  const entity = text(query.soort);
  const record = text(query.record);
  const from = text(query.van);
  const to = text(query.tot);
  return {
    user: /^\d{1,9}$/.test(user) || user === SYSTEM_USER ? user : '',
    action: /^[a-z0-9._-]{1,80}$/.test(action) ? action : '',
    entity: /^[a-z_]{1,40}$/.test(entity) ? entity : '',
    record: /^[A-Za-z0-9_-]{1,40}$/.test(record) ? record : '',
    from: isValidDate(from) ? from : '',
    to: isValidDate(to) ? to : '',
  };
}

/**
 * De filters als querystring-parameters (voor links en het formulier).
 * @param {any} filter Uitkomst van `readAuditFilter`.
 * @returns {Record<string, string>} Parameters.
 */
function auditFilterParams(filter) {
  return { gebruiker: filter.user, actie: filter.action, soort: filter.entity, record: filter.record, van: filter.from, tot: filter.to };
}

/**
 * Of er een filter actief is.
 * @param {any} filter Uitkomst van `readAuditFilter`.
 * @returns {boolean} Waar als minstens één filter gevuld is.
 */
function hasAuditFilter(filter) {
  return Object.values(filter).some(Boolean);
}

/**
 * De WHERE-voorwaarden en parameters voor een filter. Datums zijn hele dagen in Nederlandse tijd (tot en met `tot`).
 * @param {any} filter Uitkomst van `readAuditFilter`.
 * @returns {{where: string, params: Array}} SQL zonder invoer (alleen `$n`) en de parameters.
 */
function auditWhere(filter) {
  const conditions = [];
  const params = [];
  /**
   * Voegt een voorwaarde toe met één parameter.
   * @param {string} sql Voorwaarde met `?` voor de parameter.
   * @param {*} value Waarde.
   * @returns {void}
   */
  const add = (sql, value) => {
    params.push(value);
    conditions.push(sql.replace('?', `$${params.length}`));
  };
  if (filter.user === SYSTEM_USER) conditions.push('a.user_id IS NULL');
  else if (filter.user) add('a.user_id = ?', Number(filter.user));
  if (filter.action) add('a.action = ?', filter.action);
  if (filter.entity) add('a.entity = ?', filter.entity);
  if (filter.record) add('a.entity_id = ?', filter.record);
  if (filter.from) add("a.created_at >= (?::date)::timestamp AT TIME ZONE 'Europe/Amsterdam'", filter.from);
  if (filter.to) add("a.created_at < (?::date + 1)::timestamp AT TIME ZONE 'Europe/Amsterdam'", filter.to);
  return { where: conditions.length ? conditions.join(' AND ') : 'true', params };
}

/**
 * Een pagina regels, nieuwste eerst; bladeren met het id van de laatste regel (`before`).
 * @param {{query: Function}} db Database.
 * @param {any} filter Uitkomst van `readAuditFilter`.
 * @param {(string|null)} before Alleen regels met een lager id (de volgende pagina), of null.
 * @returns {Promise<{rows: any[], older: (string|null)}>} De regels en het id voor de volgende pagina.
 */
async function loadAuditPage(db, filter, before) {
  const { where, params } = auditWhere(filter);
  const rows = await db.query(
    `SELECT a.id, a.created_at, a.action, a.entity, a.entity_id, a.ip_prefix, u.name AS user_name
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE ${where} AND ($${params.length + 1}::bigint IS NULL OR a.id < $${params.length + 1}::bigint)
      ORDER BY a.id DESC
      LIMIT $${params.length + 2}`,
    [...params, before, AUDIT_PAGE_SIZE + 1],
  );
  const page = rows.slice(0, AUDIT_PAGE_SIZE);
  return { rows: page, older: rows.length > AUDIT_PAGE_SIZE ? String(page[page.length - 1].id) : null };
}

/**
 * De regels voor de export, nieuwste eerst; één regel meer dan het maximum om te zien of het past.
 * @param {{query: Function}} db Database.
 * @param {any} filter Uitkomst van `readAuditFilter`.
 * @param {number} [max] Maximum (tests).
 * @returns {Promise<{rows: any[], tooMany: boolean}>} De regels, of `tooMany` als het er meer zijn dan het maximum.
 */
async function loadAuditExport(db, filter, max = AUDIT_EXPORT_MAX) {
  const { where, params } = auditWhere(filter);
  const rows = await db.query(
    `SELECT a.id, a.created_at, a.action, a.entity, a.entity_id, a.ip_prefix, u.name AS user_name
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE ${where}
      ORDER BY a.id DESC
      LIMIT $${params.length + 1}`,
    [...params, max + 1],
  );
  return rows.length > max ? { rows: [], tooMany: true } : { rows, tooMany: false };
}

/**
 * Een tijdstip als tekst in Nederlandse tijd, tot op de seconde (dd-mm-jjjj uu:mm:ss).
 * @param {(Date|string)} value Tijdstip.
 * @returns {string} Tekst.
 */
function auditTime(value) {
  return new Date(value).toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(',', '');
}

/**
 * Maakt het Excel-bestand van de export.
 * @param {{rows: any[], labels: Record<string, string>, filterLines: Array<[string, string]>, userName: string, now: Date}} input
 *   De regels, de omschrijving per actie, de gebruikte filters (als tekst), wie en wanneer.
 * @returns {Buffer} Het .xlsx-bestand.
 */
function buildAuditWorkbook(input) {
  const header = ['Tijdstip', 'Gebruiker', 'Actie', 'Actiecode', 'Soort record', 'Record', 'IP-reeks'];
  const rows = input.rows.map((row) => [
    auditTime(row.created_at), row.user_name || 'Systeem of onbekend', actionLabel(input.labels, row.action), row.action,
    row.entity ? entityLabel(row.entity) : '', row.entity_id || '', row.ip_prefix || '',
  ]);
  const about = [
    ['Over deze export', ''],
    ...input.filterLines,
    ['Aantal regels', input.rows.length],
    ['Gemaakt door', input.userName],
    ['Gemaakt op', auditTime(input.now)],
    ['Let op', 'Het auditlog bevat geen waarden of persoonsgegevens; het IP-adres alleen ingekort.'],
  ];
  return createXlsx([{ name: 'Auditlog', rows: [header, ...rows] }, { name: 'Over deze export', rows: about }]);
}

module.exports = {
  AUDIT_PAGE_SIZE,
  AUDIT_EXPORT_MAX,
  ENTITIES,
  SYSTEM_USER,
  entityInfo,
  entityLabel,
  actionLabel,
  readAuditFilter,
  auditFilterParams,
  hasAuditFilter,
  auditWhere,
  loadAuditPage,
  loadAuditExport,
  auditTime,
  buildAuditWorkbook,
};
