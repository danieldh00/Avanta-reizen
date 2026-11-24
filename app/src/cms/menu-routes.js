// @ts-check
/**
 * Menu's van de website beheren in het CRM (`/app/menus/`, recht `content`, CMS-pakket H3): het hoofdmenu (met één
 * niveau submenu) en het menu in de voettekst. Items toevoegen, wijzigen (tekst, adres, plaats, volgorde) en
 * verwijderen. Werkt zonder JavaScript; elke wijziging met CSRF-token en in de auditlog. Na elke wijziging leest de site
 * de menu's opnieuw (`cms/menus.js`).
 */
const express = require('express');
const { routePath } = require('../route-path');
const { html, raw } = require('../site/html');
const { renderCrmPage, renderAlert } = require('../crm/layout');
const { createMenus, validateMenuItem, MENUS, MAX_ITEMS, MENU_LIMITS } = require('./menus');

/** Basispad van het scherm. */
const BASE = '/app/menus/';

/** Acties voor het auditlog (zie `ACTION_LABELS` in `crm/users.js`). */
const MENU_ACTION_LABELS = {
  'menu.nieuw': 'Menu-item toegevoegd',
  'menu.gewijzigd': 'Menu-item gewijzigd',
  'menu.verwijderd': 'Menu-item verwijderd',
};

/** Meldingen na een geslaagde actie (`?melding=<n>`). */
const NOTICES = {
  1: 'Het item staat in het menu.',
  2: 'Het item is gewijzigd.',
  3: 'Het item is verwijderd (met zijn submenu).',
};

/**
 * Een veld met label, hulptekst en fout.
 * @param {{id: string, label: string, control: any, help?: string, error?: string}} field Veld.
 * @returns {any} HTML.
 */
function fieldRow(field) {
  return html`<div class="field"><span class="field__label"><label for="${field.id}">${field.label}</label></span>
    ${field.control}${field.error ? html`<span class="field__error" id="${field.id}-fout">${field.error}</span>` : ''}
    ${field.help ? html`<span class="field__help">${field.help}</span>` : ''}</div>`;
}

/**
 * Attributen voor een veld met een fout.
 * @param {string} id Id van het veld.
 * @param {string} [error] Fout.
 * @returns {(any|string)} Attributen.
 */
function invalidAttributes(id, error) {
  return error ? raw(` aria-invalid="true" aria-describedby="${id}-fout"`) : '';
}

/**
 * De velden van een menu-item.
 * @param {{menu: string, parentId: (number|null), label: string, href: string, sortOrder: number}} values Waarden.
 * @param {any} errors Fouten per veld.
 * @param {any[]} rows Alle items (voor de keuze van het bovenliggende item).
 * @param {(number|null)} selfId Id van het item zelf.
 * @param {{path: string, title: string}[]} pageRows Pagina's (suggesties voor het adres).
 * @returns {any} HTML.
 */
function renderItemFields(values, errors, rows, selfId, pageRows) {
  const parents = rows.filter((row) => row.menu === 'hoofd' && row.parent_id === null && row.id !== selfId);
  const prefix = selfId ? `menu-${selfId}` : 'menu-nieuw';
  return html`
    ${fieldRow({
      id: `${prefix}-menu`, label: 'Menu', error: errors.menu,
      control: html`<select id="${prefix}-menu" name="menu">${Object.entries(MENUS).map(([key, label]) => html`<option value="${key}"${values.menu === key ? raw(' selected') : ''}>${label}</option>`)}</select>`,
    })}
    ${fieldRow({
      id: `${prefix}-parent`, label: 'Onder item (submenu, alleen hoofdmenu)', error: errors.parent_id,
      control: html`<select id="${prefix}-parent" name="parent_id"${invalidAttributes(`${prefix}-parent`, errors.parent_id)}><option value="">Geen (hoofditem)</option>${parents.map((row) => html`<option value="${String(row.id)}"${values.parentId === row.id ? raw(' selected') : ''}>${row.label}</option>`)}</select>`,
    })}
    ${fieldRow({
      id: `${prefix}-label`, label: 'Tekst', error: errors.label,
      control: html`<input id="${prefix}-label" name="label" type="text" value="${values.label}" maxlength="${MENU_LIMITS.label}" required${invalidAttributes(`${prefix}-label`, errors.label)}>`,
    })}
    ${fieldRow({
      id: `${prefix}-href`, label: 'Adres', error: errors.href, help: 'Een pad op deze site (bijv. /reis/ of /avanta-reizen/voorpret/) of een https-adres.',
      control: html`<input id="${prefix}-href" name="href" type="text" value="${values.href}" maxlength="${MENU_LIMITS.href}" list="menu-paden" required${invalidAttributes(`${prefix}-href`, errors.href)}>
        <datalist id="menu-paden">${['/reis/', '/reisleider/', '/blog/', '/faq/', '/contact/'].map((path) => html`<option value="${path}"></option>`)}${pageRows.map((page) => html`<option value="${page.path}">${page.title}</option>`)}</datalist>`,
    })}
    ${fieldRow({
      id: `${prefix}-sort`, label: 'Volgorde', error: errors.sort_order, help: 'Lager staat eerder; bijv. 10, 20, 30.',
      control: html`<input id="${prefix}-sort" name="sort_order" type="number" min="-9999" max="9999" step="1" value="${String(values.sortOrder)}"${invalidAttributes(`${prefix}-sort`, errors.sort_order)}>`,
    })}`;
}

/**
 * Maakt de routes voor menu's.
 * @param {{db: any, auth: any, menus?: any}} options Database, sessie- en rechtenlaag en de menu's.
 * @returns {express.Router} Router.
 */
function createMenuRoutes(options) {
  const { db, auth } = options;
  const menus = options.menus || createMenus({ db });
  const router = express.Router();
  const guard = auth.requireRight('content');

  /**
   * Pagina's voor de suggesties bij het adres.
   * @returns {Promise<{path: string, title: string}[]>} Pagina's.
   */
  const pageOptions = () => db.query('SELECT path, title FROM pages WHERE published ORDER BY path LIMIT 500');

  /**
   * Audit voor een menu-item.
   * @param {any} req Express-verzoek.
   * @param {string} action Actie.
   * @param {any} client Transactie-client.
   * @param {(number|string)} [id] Id (anders uit de URL).
   * @returns {Promise<void>} Klaar.
   */
  const audit = (req, action, client, id) => auth.audit(req, { userId: req.user.id, action, entity: 'menu_items', entityId: id || req.params.id }, client);

  /**
   * Het overzicht met beide menu's en het formulier voor een nieuw item.
   * @param {any} req Express-verzoek.
   * @param {{notice?: string, error?: string, values?: any, errors?: any}} [state] Melding of ingevulde waarden met fouten.
   * @returns {Promise<string>} HTML.
   */
  const renderOverview = async (req, state = {}) => {
    const [rows, pageRows] = await Promise.all([menus.list(), pageOptions()]);
    const values = state.values || { menu: 'hoofd', parentId: null, label: '', href: '', sortOrder: 0 };
    const table = (menu) => {
      const items = rows.filter((row) => row.menu === menu);
      return items.length ? html`<div class="crm-table-wrap"><table class="crm-table">
        <thead><tr><th>Tekst</th><th>Adres</th><th>Volgorde</th><th></th></tr></thead>
        <tbody>${items.map((row) => html`<tr>
          <td>${row.parent_id ? html`<span aria-hidden="true">↳ </span>` : ''}<a href="${BASE}${String(row.id)}/">${row.label}</a></td>
          <td><code>${row.href}</code></td>
          <td>${String(row.sort_order)}</td>
          <td><form method="post" action="${BASE}${String(row.id)}/verwijderen/"><input type="hidden" name="_csrf" value="${req.session.csrf}"><button class="btn btn--small btn--outline" type="submit">Verwijderen</button></form></td>
        </tr>`)}</tbody>
      </table></div>` : html`<p>Dit menu is leeg; de site toont dan het vaste standaardmenu.</p>`;
    };
    return renderCrmPage({
      title: 'Menu\'s',
      user: req.user,
      csrf: req.session.csrf,
      path: BASE,
      body: html`${state.notice ? html`<p class="notice" role="status">${state.notice}</p>` : ''}
        ${renderAlert(state.error)}
        ${Object.entries(MENUS).map(([menu, label]) => html`<section class="crm-block"><h2>${label}</h2>${table(menu)}</section>`)}
        <section class="crm-block" id="nieuw">
          <h2>Item toevoegen</h2>
          <form class="form crm-narrow" method="post" action="${BASE}nieuw/">
            <input type="hidden" name="_csrf" value="${req.session.csrf}">
            ${renderItemFields(values, state.errors || {}, rows, null, pageRows)}
            <p class="field__help">Een menu heeft hoogstens ${MAX_ITEMS} items. Verwijder je een hoofditem, dan gaat zijn submenu mee.</p>
            <div><button class="btn" type="submit">Toevoegen</button></div>
          </form>
        </section>`,
    });
  };

  /**
   * Het bewerkscherm van één item.
   * @param {any} req Express-verzoek.
   * @param {any} row Het item.
   * @param {{error?: string, values?: any, errors?: any}} [state] Ingevulde waarden met fouten.
   * @returns {Promise<string>} HTML.
   */
  const renderItem = async (req, row, state = {}) => {
    const [rows, pageRows] = await Promise.all([menus.list(), pageOptions()]);
    const values = state.values || { menu: row.menu, parentId: row.parent_id, label: row.label, href: row.href, sortOrder: row.sort_order };
    return renderCrmPage({
      title: `Menu-item: ${row.label}`,
      user: req.user,
      csrf: req.session.csrf,
      path: BASE,
      body: html`<p><a href="${BASE}">Naar menu's</a></p>
        ${renderAlert(state.error)}
        <form class="form crm-narrow crm-block" method="post" action="${BASE}${String(row.id)}/">
          <input type="hidden" name="_csrf" value="${req.session.csrf}">
          ${renderItemFields(values, state.errors || {}, rows, row.id, pageRows)}
          <div><button class="btn" type="submit">Opslaan</button></div>
        </form>`,
    });
  };

  /**
   * Zoekt een item op id.
   * @param {string} id Id uit de URL.
   * @returns {Promise<(any|null)>} Item.
   */
  const findItem = async (id) => {
    const [row] = await db.query('SELECT id, menu, parent_id, label, href, sort_order FROM menu_items WHERE id = $1', [Number(id)]);
    return row || null;
  };

  /**
   * 404 binnen het CRM.
   * @param {any} req Express-verzoek.
   * @param {any} res Express-antwoord.
   * @returns {void}
   */
  const notFound = (req, res) => {
    res.status(404).send(renderCrmPage({
      title: 'Niet gevonden', user: req.user, csrf: req.session.csrf, path: BASE, body: html`<p>Dit menu-item bestaat niet (meer). <a href="${BASE}">Naar menu's</a></p>`,
    }));
  };

  router.get('/menus/', guard, async (req, res, next) => {
    try {
      return res.send(await renderOverview(req, { notice: NOTICES[req.query.melding] || '' }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/menus/nieuw/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const { values, errors } = validateMenuItem(req.body);
      if (Object.keys(errors).length) return res.status(422).send(await renderOverview(req, { error: 'Controleer de velden.', values, errors }));
      const outcome = await menus.create(values, { userId: req.user.id, audit: (client, id) => audit(req, 'menu.nieuw', client, id) });
      if (outcome.errors) return res.status(422).send(await renderOverview(req, { error: 'Controleer de velden.', values, errors: outcome.errors }));
      return res.redirect(303, `${BASE}?melding=1`);
    } catch (error) {
      return next(error);
    }
  });

  router.get(routePath('/menus/:id(\\d{1,9})/'), guard, async (req, res, next) => {
    try {
      const row = await findItem(req.params.id);
      if (!row) return notFound(req, res);
      return res.send(await renderItem(req, row));
    } catch (error) {
      return next(error);
    }
  });

  router.post(routePath('/menus/:id(\\d{1,9})/'), guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const { values, errors } = validateMenuItem(req.body);
      const fail = async (fieldErrors) => {
        const row = await findItem(req.params.id);
        if (!row) return notFound(req, res);
        return res.status(422).send(await renderItem(req, row, { error: 'Controleer de velden.', values, errors: fieldErrors }));
      };
      if (Object.keys(errors).length) return await fail(errors);
      const outcome = await menus.update(req.params.id, values, { userId: req.user.id, audit: (client) => audit(req, 'menu.gewijzigd', client) });
      if (outcome.status === 'weg') return notFound(req, res);
      if (outcome.status === 'fout') return await fail(outcome.errors);
      return res.redirect(303, `${BASE}?melding=2`);
    } catch (error) {
      return next(error);
    }
  });

  router.post(routePath('/menus/:id(\\d{1,9})/verwijderen/'), guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const outcome = await menus.remove(req.params.id, (client) => audit(req, 'menu.verwijderd', client));
      if (outcome === 'weg') return notFound(req, res);
      return res.redirect(303, `${BASE}?melding=3`);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createMenuRoutes, MENU_ACTION_LABELS };
