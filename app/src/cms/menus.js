/**
 * Menu's van de website (CMS-pakket H3, migratie 18): het hoofdmenu (met één niveau submenu) en het menu in de
 * voettekst, in de tabel `menu_items`. De site leest ze uit het geheugen (`current()`); na elke wijziging in het CRM
 * worden ze opnieuw geladen. Alle vragen met gebonden parameters; elke wijziging met audit in dezelfde transactie.
 */
const { cleanText } = require('../media/library');
const { isSafeUrl } = require('../../tools/import/sanitize');

/** De menu's met hun naam voor het scherm. */
const MENUS = { hoofd: 'Hoofdmenu', voet: 'Menu in de voettekst' };

/** Maximaal aantal items per menu (inclusief submenu's). */
const MAX_ITEMS = 40;

/** Maximale lengtes. */
const MENU_LIMITS = { label: 60, href: 300 };

/**
 * Of een menu-adres mag: een pad op de eigen site (begint met één /) of https.
 * @param {string} href Adres.
 * @returns {boolean} Waar als het mag.
 */
function isMenuHref(href) {
  return typeof href === 'string' && href.length <= MENU_LIMITS.href && isSafeUrl(href) && /^(\/(?!\/)[^\s"<>\\]*|https:\/\/[^\s"<>\\/][^\s"<>\\]*)$/.test(href);
}

/**
 * Leest en controleert de velden van een menu-item.
 * @param {object} body Ingezonden velden.
 * @returns {{values: {menu: string, parentId: (number|null), label: string, href: string, sortOrder: number}, errors: object}} Waarden en fouten.
 */
function validateMenuItem(body) {
  const text = (name) => (typeof body[name] === 'string' ? body[name] : '');
  const errors = {};
  const menu = text('menu');
  if (!Object.hasOwn(MENUS, menu)) errors.menu = 'Kies een menu.';
  const label = cleanText(text('label'), MENU_LIMITS.label + 1);
  if (!label) errors.label = 'Vul de tekst in.';
  else if (label.length > MENU_LIMITS.label) errors.label = `Maximaal ${MENU_LIMITS.label} tekens.`;
  const href = text('href').trim();
  if (!isMenuHref(href)) errors.href = 'Gebruik een adres op deze site (begint met /) of https://.';
  const parentText = text('parent_id');
  const parentId = /^\d{1,9}$/.test(parentText) ? Number(parentText) : null;
  if (parentText && parentId === null) errors.parent_id = 'Kies een bovenliggend item uit de lijst.';
  if (parentId !== null && menu !== 'hoofd') errors.parent_id = 'Alleen het hoofdmenu heeft een submenu.';
  const sortText = text('sort_order').trim() || '0';
  if (!/^-?\d{1,4}$/.test(sortText)) errors.sort_order = 'Vul een heel getal in tussen -9999 en 9999.';
  return { values: { menu, parentId, label: label.slice(0, MENU_LIMITS.label), href, sortOrder: Number(sortText) || 0 }, errors };
}

/**
 * Bouwt de menu's uit de rijen: per menu de items op volgorde, met `children` voor het hoofdmenu.
 * @param {object[]} rows Rijen uit `menu_items`.
 * @returns {{hoofd: object[], voet: object[]}} Menu's in de vorm die `site/layout.js` verwacht.
 */
function buildMenus(rows) {
  const result = { hoofd: [], voet: [] };
  const byParent = new Map();
  for (const row of rows) {
    if (row.parent_id) byParent.set(row.parent_id, [...(byParent.get(row.parent_id) || []), row]);
  }
  for (const row of rows) {
    if (row.parent_id || !result[row.menu]) continue;
    const children = (byParent.get(row.id) || []).map((child) => ({ label: child.label, href: child.href }));
    result[row.menu].push({ label: row.label, href: row.href, ...(children.length ? { children } : {}) });
  }
  return result;
}

/**
 * Maakt de functies voor menu's.
 * @param {{db: object}} options Database.
 * @returns {object} Functies: `ready`, `reload`, `current`, `list`, `create`, `update`, `remove`.
 */
function createMenus(options) {
  const { db } = options;
  let menus = null;
  let loading = null;
  let reloadCounter = 0;

  /**
   * Alle items op menu, ouder en volgorde.
   * @returns {Promise<object[]>} Rijen.
   */
  const list = () => db.query(
    `SELECT m.id, m.menu, m.parent_id, m.label, m.href, m.sort_order
       FROM menu_items m LEFT JOIN menu_items p ON p.id = m.parent_id
      ORDER BY m.menu, coalesce(p.sort_order, m.sort_order), coalesce(p.id, m.id), m.parent_id NULLS FIRST, m.sort_order, m.id`,
  );

  /**
   * Leest de menu's opnieuw in het geheugen (alleen de nieuwste aanroep schrijft het resultaat weg).
   * @returns {Promise<void>}
   */
  const reload = async () => {
    // Volgnummer: bij twee gelijktijdige herlaadacties wint de laatst gestarte, ook als een oudere later klaar is.
    reloadCounter += 1;
    const ticket = reloadCounter;
    const rows = await list();
    if (ticket === reloadCounter) menus = buildMenus(rows);
  };

  /**
   * Wacht tot de menu's één keer zijn geladen; bij een fout probeert het volgende verzoek het opnieuw.
   * @returns {Promise<void>}
   */
  const ready = () => {
    if (!loading) loading = reload().catch((error) => { loading = null; throw error; });
    return loading;
  };

  /**
   * De menu's uit het geheugen (null als ze nog niet geladen zijn: dan toont de site de vaste standaard).
   * @returns {({hoofd: object[], voet: object[]}|null)} Menu's.
   */
  const current = () => menus;

  /**
   * Controleert het bovenliggende item (bestaat, zelf geen submenu-item, in het hoofdmenu, niet het item zelf) en het
   * maximum aantal items. Binnen de transactie, met een slot op de items van het menu.
   * @param {object} client Transactie-client.
   * @param {object} values Waarden uit `validateMenuItem`.
   * @param {(number|null)} selfId Id van het item dat je wijzigt (of null bij een nieuw item).
   * @returns {Promise<(object|null)>} Fouten, of null als het klopt.
   */
  const checkPlacement = async (client, values, selfId) => {
    // Slot per menu: FOR UPDATE vergrendelt alleen bestaande rijen, dus zonder dit slot zien twee gelijktijdige
    // toevoegingen allebei 39 items en komt het menu op 41.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`menu:${values.menu}`]);
    const rows = await client.query('SELECT id, parent_id FROM menu_items WHERE menu = $1 ORDER BY id FOR UPDATE', [values.menu]);
    // Tel de andere items van dit menu: zo telt ook een item dat uit een ander menu hierheen verhuist mee.
    if (rows.filter((row) => row.id !== selfId).length >= MAX_ITEMS) return { label: `Een menu heeft hoogstens ${MAX_ITEMS} items.` };
    if (values.parentId === null) return null;
    const parent = rows.find((row) => row.id === values.parentId);
    if (!parent || parent.parent_id !== null || parent.id === selfId) return { parent_id: 'Kies een hoofditem uit het hoofdmenu.' };
    if (selfId !== null && rows.some((row) => row.parent_id === selfId)) return { parent_id: 'Dit item heeft zelf een submenu; het kan niet onder een ander item.' };
    return null;
  };

  /**
   * Maakt een menu-item.
   * @param {object} values Waarden uit `validateMenuItem`.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit (`(client, id) => Promise`).
   * @returns {Promise<{id?: number, errors?: object}>} Nieuw id of fouten.
   */
  const create = async (values, context) => {
    const outcome = await db.transaction(async (client) => {
      const errors = await checkPlacement(client, values, null);
      if (errors) return { errors };
      const [row] = await client.query(
        'INSERT INTO menu_items (menu, parent_id, label, href, sort_order, updated_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [values.menu, values.parentId, values.label, values.href, values.sortOrder, context.userId],
      );
      await context.audit(client, row.id);
      return { id: row.id };
    });
    if (outcome.id) await reload();
    return outcome;
  };

  /**
   * Wijzigt een menu-item (een item met een submenu blijft in zijn menu).
   * @param {(number|string)} id Id.
   * @param {object} values Waarden uit `validateMenuItem`.
   * @param {{userId: number, audit: Function}} context Gebruiker en audit (`(client) => Promise`).
   * @returns {Promise<{status: ('ok'|'weg'|'fout'), errors?: object}>} Uitkomst.
   */
  const update = async (id, values, context) => {
    if (!/^\d{1,9}$/.test(String(id))) return { status: 'weg' };
    const outcome = await db.transaction(async (client) => {
      const [existing] = await client.query('SELECT id, menu FROM menu_items WHERE id = $1 FOR UPDATE', [Number(id)]);
      if (!existing) return { status: 'weg' };
      if (existing.menu !== values.menu) {
        const [child] = await client.query('SELECT id FROM menu_items WHERE parent_id = $1 LIMIT 1', [existing.id]);
        if (child) return { status: 'fout', errors: { menu: 'Dit item heeft een submenu en blijft in het hoofdmenu.' } };
      }
      const errors = await checkPlacement(client, values, existing.id);
      if (errors) return { status: 'fout', errors };
      await client.query(
        'UPDATE menu_items SET menu = $2, parent_id = $3, label = $4, href = $5, sort_order = $6, updated_at = now(), updated_by = $7 WHERE id = $1',
        [existing.id, values.menu, values.parentId, values.label, values.href, values.sortOrder, context.userId],
      );
      await context.audit(client);
      return { status: 'ok' };
    });
    if (outcome.status === 'ok') await reload();
    return outcome;
  };

  /**
   * Verwijdert een menu-item (met zijn submenu).
   * @param {(number|string)} id Id.
   * @param {Function} audit Audit (`(client) => Promise`).
   * @returns {Promise<('ok'|'weg')>} Uitkomst.
   */
  const remove = async (id, audit) => {
    if (!/^\d{1,9}$/.test(String(id))) return 'weg';
    const outcome = await db.transaction(async (client) => {
      const [row] = await client.query('DELETE FROM menu_items WHERE id = $1 RETURNING id', [Number(id)]);
      if (!row) return 'weg';
      await audit(client);
      return 'ok';
    });
    if (outcome === 'ok') await reload();
    return outcome;
  };

  return { ready, reload, current, list, create, update, remove };
}

module.exports = { createMenus, validateMenuItem, buildMenus, isMenuHref, MENUS, MAX_ITEMS, MENU_LIMITS };
