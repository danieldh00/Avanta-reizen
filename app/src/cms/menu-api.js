// @ts-check
/**
 * JSON-API van de menu's van de website (`/app/api/menus/…`, recht `content`) voor de schermen in Vue (fase V3 van de
 * ombouw, `docs/VUE-OMBOUW.md`). Dezelfde logica als het oude scherm (`menus.js`): eerst de vorm met een schema
 * (`api/schema.js`, `.strict()`), daarna dezelfde veldcontrole als het formulier (`validateMenuItem`) en de controle
 * van plaats en aantal in de transactie. Na elke wijziging leest de site de menu's opnieuw. Elke wijziging schrijft de
 * audit in dezelfde transactie, met dezelfde acties als het oude scherm.
 *
 * Routes (binnen `/app/api`):
 * - `GET /menus/`: beide menu's met hun items (submenu-items direct onder hun hoofditem), de pagina's als suggestie
 *   voor het adres en de grenzen;
 * - `POST /menus/`: een nieuw item;
 * - `GET|PUT|DELETE /menus/:id/`: één item (verwijderen neemt het submenu mee).
 *
 * Schrijven heeft naast de algemene limiet van het CRM een eigen limiet per gebruiker (`WRITE_LIMIT`).
 */
const express = require('express');
const { routePath } = require('../route-path');
const { z } = require('../api/schema');
const { createWriteLimit, apiFieldNames } = require('../api/module-helpers');
const { createMenus, validateMenuItem, MENUS, MAX_ITEMS, MENU_LIMITS } = require('./menus');

/** Schrijvende verzoeken per gebruiker per minuut. */
const WRITE_LIMIT = 60;

/** Vaste paden die als suggestie bij het adres staan (net als in het oude scherm). */
const FIXED_PATHS = ['/reis/', '/reisleider/', '/blog/', '/faq/', '/contact/'];

/** Veldnamen van de formuliercontrole (`menus.js`) naar de veldnamen van de API. */
const FIELD_NAMES = { menu: 'menu', parent_id: 'ouderId', label: 'tekst', href: 'adres', sort_order: 'volgorde' };

/** Invoer van een menu-item. Lengte, adres en plaats controleren `validateMenuItem` en `menus.js`. */
const itemSchema = z.object({
  menu: z.string({ error: 'Kies een menu.' }).max(20, 'Kies een menu.'),
  ouderId: z.number({ error: 'Kies een bovenliggend item uit de lijst.' }).int('Kies een bovenliggend item uit de lijst.').positive('Kies een bovenliggend item uit de lijst.').max(999999999, 'Kies een bovenliggend item uit de lijst.').nullable().optional(),
  tekst: z.string({ error: 'Vul de tekst in.' }).max(MENU_LIMITS.label * 4, `Maximaal ${MENU_LIMITS.label} tekens.`),
  adres: z.string({ error: 'Gebruik een adres op deze site (begint met /) of https://.' }).max(MENU_LIMITS.href * 2, 'Gebruik een adres op deze site (begint met /) of https://.'),
  volgorde: z.number({ error: 'Vul een heel getal in tussen -9999 en 9999.' }).int('Vul een heel getal in tussen -9999 en 9999.').min(-9999, 'Vul een heel getal in tussen -9999 en 9999.').max(9999, 'Vul een heel getal in tussen -9999 en 9999.').optional(),
}).strict();

/**
 * Leest de vorm-gecontroleerde invoer als velden van het formulier en controleert die zoals het oude scherm.
 * @param {any} input Invoer uit `itemSchema`.
 * @returns {{values: any, errors: Record<string, string>}} Waarden en fouten.
 */
const checkItem = (input) => validateMenuItem({
  menu: input.menu, parent_id: input.ouderId ? String(input.ouderId) : '', label: input.tekst, href: input.adres,
  sort_order: input.volgorde === undefined ? '' : String(input.volgorde),
});

/**
 * Een item voor de API.
 * @param {any} row Rij uit `menu_items`.
 * @returns {{id: number, menu: string, ouderId: (number|null), tekst: string, adres: string, volgorde: number}} Item.
 */
const apiItem = (row) => ({ id: row.id, menu: row.menu, ouderId: row.parent_id, tekst: row.label, adres: row.href, volgorde: row.sort_order });

/**
 * Leesfuncties: dezelfde antwoorden als de GET-routes hieronder. Ook gebruikt door `menu-routes.js` om het eerste
 * scherm mee te sturen in de pagina (`renderMountPoint`, `preload`), zodat dat scherm niet op een extra verzoek wacht.
 * @param {{db: any, menus?: any}} options Database en eventueel de gedeelde menu's van de site.
 * @returns {{overview: () => Promise<any>, item: (id: number|string) => Promise<any|null>}} Antwoorden; null als het
 *   id niet bestaat.
 */
function createMenuReads(options) {
  const { db } = options;
  const menus = options.menus || createMenus({ db });
  return {
    overview: async () => {
      const [rows, pages] = await Promise.all([menus.list(), db.query('SELECT path, title FROM pages WHERE published ORDER BY path LIMIT 500')]);
      return {
        menus: Object.entries(MENUS).map(([menu, label]) => ({ menu, naam: label, items: rows.filter((row) => row.menu === menu).map(apiItem) })),
        suggesties: [...FIXED_PATHS.map((path) => ({ pad: path, titel: '' })), ...pages.map((page) => ({ pad: page.path, titel: page.title }))],
        grenzen: { tekst: MENU_LIMITS.label, adres: MENU_LIMITS.href, items: MAX_ITEMS },
      };
    },
    item: async (id) => {
      const [row] = await db.query('SELECT id, menu, parent_id, label, href, sort_order FROM menu_items WHERE id = $1', [Number(id)]);
      if (!row) return null;
      const [child] = await db.query('SELECT count(*)::int AS count FROM menu_items WHERE parent_id = $1', [row.id]);
      return { ...apiItem(row), aantalSubitems: child.count };
    },
  };
}

/**
 * Maakt de API-routes van de menu's.
 * @param {any} context Context van de API-router (`api/router.js`): `db`, `auth`, `requireRight`, `validate`,
 *   `sendApiError`, `menus` (de menu's van de site, die na een wijziging opnieuw laden) en eventueel `now` (tests).
 * @returns {express.Router} Router binnen `/app/api`.
 */
function createMenuApi(context) {
  const { db, auth, sendApiError } = context;
  const menus = context.menus || createMenus({ db });
  const reads = createMenuReads({ db, menus });
  const router = express.Router();
  const guard = context.requireRight('content');
  const write = [guard, createWriteLimit({ name: 'menus', limit: WRITE_LIMIT, now: context.now, sendApiError })];

  /**
   * Audit voor een menu-item, in de transactie van de wijziging.
   * @param {any} req Express-verzoek.
   * @param {string} action Actie (`MENU_ACTION_LABELS` in `menu-routes.js`).
   * @returns {Function} `(client, id?) => Promise`.
   */
  const auditFor = (req, action) => (client, id) => auth.audit(req, { userId: req.user.id, action, entity: 'menu_items', entityId: id || req.params.id || null }, client);

  /**
   * Stuurt `ongeldig` met de meldingen per veld.
   * @param {any} res Express-antwoord.
   * @param {Record<string, string>} errors Fouten met de namen van het formulier.
   * @returns {any} Het antwoord.
   */
  const invalid = (res, errors) => sendApiError(res, 'ongeldig', { fields: apiFieldNames(errors, FIELD_NAMES) });

  router.get('/menus/', guard, async (req, res) => {
    res.json(await reads.overview());
  });

  router.post('/menus/', write, context.validate(itemSchema), async (req, res) => {
    const { values, errors } = checkItem(req.input);
    if (Object.keys(errors).length) return invalid(res, errors);
    const outcome = await menus.create(values, { userId: req.user.id, audit: auditFor(req, 'menu.nieuw') });
    if (outcome.errors) return invalid(res, outcome.errors);
    return res.status(201).json({ id: outcome.id });
  });

  router.get(routePath('/menus/:id(\\d{1,9})/'), guard, async (req, res) => {
    const item = await reads.item(req.params.id);
    return item ? res.json(item) : sendApiError(res, 'niet-gevonden');
  });

  router.put(routePath('/menus/:id(\\d{1,9})/'), write, context.validate(itemSchema), async (req, res) => {
    const { values, errors } = checkItem(req.input);
    if (Object.keys(errors).length) return invalid(res, errors);
    const outcome = await menus.update(req.params.id, values, { userId: req.user.id, audit: auditFor(req, 'menu.gewijzigd') });
    if (outcome.status === 'weg') return sendApiError(res, 'niet-gevonden');
    if (outcome.status === 'fout') return invalid(res, outcome.errors);
    return res.json({ id: Number(req.params.id) });
  });

  router.delete(routePath('/menus/:id(\\d{1,9})/'), write, async (req, res) => {
    const outcome = await menus.remove(req.params.id, auditFor(req, 'menu.verwijderd'));
    if (outcome === 'weg') return sendApiError(res, 'niet-gevonden');
    return res.status(204).end();
  });

  return router;
}

module.exports = { createMenuApi, createMenuReads, WRITE_LIMIT };
