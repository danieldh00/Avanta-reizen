/**
 * Reistypes en landen beheren in het CRM (`/app/reistypes-en-landen/`, recht `reizen`, CMS-pakket G1): lijst per
 * soort met het aantal reizen en foto's, nieuw aanmaken, wijzigen (naam, slug, soort, icoon, inleiding, tekst,
 * volgorde, tonen op de homepage), een foto uit de fotobibliotheek kiezen, dubbelingen samenvoegen en een ongebruikte
 * categorie verwijderen. Een gewijzigde of samengevoegde slug krijgt automatisch een 301. Elke wijziging in de auditlog.
 */
const express = require('express');
const { html, raw } = require('../site/html');
const { renderCrmPage, renderAlert } = require('../crm/layout');
const { categoryPath } = require('../site/format');
const { icon, categoryIconName } = require('../site/icons');
const { createMediaLibrary } = require('../media/library');
const { pickerFilter, pickerPhotos, renderPhotoPicker } = require('../media/picker');
const { createCategories, validateCategory, KINDS, ICON_CHOICES, LIMITS } = require('./categories');
const { RICHTEXT_HELP } = require('../cms/block-editor');

/** Basispad van het scherm. */
const BASE = '/app/reistypes-en-landen/';

/** Acties voor het auditlog (zie `ACTION_LABELS` in `crm/users.js`). */
const CATEGORY_ACTION_LABELS = {
  'categorie.aangemaakt': 'Reistype of land aangemaakt',
  'categorie.gewijzigd': 'Reistype of land gewijzigd',
  'categorie.foto': 'Foto van reistype of land gewijzigd',
  'categorie.samengevoegd': 'Reistype of land samengevoegd met een ander',
  'categorie.verwijderd': 'Reistype of land verwijderd',
};

/** Meervoud van de soorten voor de koppen van de lijst. */
const KIND_TITLES = { type: 'Reistypes', bestemming: 'Landen', overig: 'Overige categorieën' };

/**
 * Maakt de routes voor reistypes en landen.
 * @param {{db: object, auth: object, redirects?: object, library?: object}} options Database, sessie- en rechtenlaag,
 *   doorverwijzingen (om na een nieuwe 301 opnieuw te laden) en de fotobibliotheek.
 * @returns {express.Router} Router.
 */
function createCategoryRoutes(options) {
  const { db, auth } = options;
  const categories = createCategories({ db });
  const library = options.library || createMediaLibrary({ db, mediaDir: options.mediaDir || '' });
  const router = express.Router();
  const guard = auth.requireRight('reizen');

  /**
   * Laadt de doorverwijzingen opnieuw na een nieuwe 301 (een fout daarin laat de wijziging zelf staan).
   * @returns {Promise<void>}
   */
  const reloadRedirects = async () => {
    if (options.redirects) await options.redirects.reload().catch(() => {});
  };

  /**
   * 404-pagina binnen het CRM.
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @returns {void}
   */
  const notFound = (req, res) => res.status(404).send(renderCrmPage({
    title: 'Niet gevonden', user: req.user, csrf: req.session.csrf, path: BASE, body: html`<p>Dit reistype of land bestaat niet. <a href="${BASE}">Naar reistypes en landen</a></p>`,
  }));

  /**
   * De velden van het formulier (nieuw en wijzigen).
   * @param {object} values Huidige waarden (kolomnamen van de tabel).
   * @param {object} errors Fouten per veld.
   * @returns {object} HTML.
   */
  const fields = (values, errors) => {
    const error = (name) => (errors[name] ? html`<span class="field__error" id="veld-${name}-fout">${errors[name]}</span>` : '');
    const invalid = (name) => (errors[name] ? raw(` aria-invalid="true" aria-describedby="veld-${name}-fout"`) : '');
    return html`<div class="field"><span class="field__label"><label for="veld-name">Naam</label></span>
        <input id="veld-name" name="name" type="text" value="${values.name || ''}" maxlength="${LIMITS.name}" required${invalid('name')}>${error('name')}</div>
      <div class="field"><span class="field__label"><label for="veld-slug">Slug (deel van het adres; leeg = uit de naam)</label></span>
        <input id="veld-slug" name="slug" type="text" value="${values.slug || ''}" maxlength="80" pattern="[a-z0-9]+(-[a-z0-9]+)*"${invalid('slug')}>${error('slug')}
        <span class="field__help">Wijzig je de slug, dan verwijst het oude adres automatisch door (301).</span></div>
      <div class="field"><span class="field__label"><label for="veld-kind">Soort</label></span>
        <select id="veld-kind" name="kind"${invalid('kind')}>${Object.entries(KINDS).map(([kind, label]) => html`<option value="${kind}"${values.kind === kind ? raw(' selected') : ''}>${label}</option>`)}</select>${error('kind')}</div>
      <div class="field"><span class="field__label"><label for="veld-icon">Icoon (voor reistypes)</label></span>
        <select id="veld-icon" name="icon"${invalid('icon')}><option value="">Automatisch (op de slug)</option>${ICON_CHOICES.map((name) => html`<option value="${name}"${values.icon === name ? raw(' selected') : ''}>${name}</option>`)}</select>${error('icon')}</div>
      <div class="field"><span class="field__label"><label for="veld-intro">Inleiding</label></span>
        <textarea id="veld-intro" name="intro" rows="3" maxlength="${LIMITS.intro}"${invalid('intro')}>${values.intro || ''}</textarea>${error('intro')}</div>
      <div class="field"><span class="field__label"><label for="veld-body_html">Tekst</label></span>
        <textarea id="veld-body_html" name="body_html" rows="10" class="cms-richtext"${invalid('body_html')}>${values.body_html || ''}</textarea>${error('body_html')}
        <span class="field__help">${RICHTEXT_HELP}</span></div>
      <div class="field"><span class="field__label"><label for="veld-sort_order">Volgorde (laag eerst)</label></span>
        <input id="veld-sort_order" name="sort_order" type="number" min="-9999" max="9999" step="1" value="${String(values.sort_order ?? 0)}"${invalid('sort_order')}>${error('sort_order')}</div>
      <div class="field field--checkbox"><label><input type="checkbox" name="show_on_home" value="1"${values.show_on_home ? raw(' checked') : ''}> Tonen op de homepage</label>
        <span class="field__help">Reistypes: staat er minstens één aan, dan toont de homepage alleen die, op volgorde. Landen: idem voor de bestemmingen.</span></div>`;
  };

  /**
   * De lijst met alle reistypes en landen, en het formulier voor een nieuwe.
   * @param {object} req Express-verzoek.
   * @param {{notice?: string, error?: string, values?: object, errors?: object, open?: boolean}} [state] Meldingen en ingevulde waarden.
   * @returns {Promise<string>} HTML.
   */
  const renderList = async (req, state = {}) => {
    const rows = await categories.list();
    const groups = Object.keys(KINDS).map((kind) => ({ kind, rows: rows.filter((row) => row.kind === kind) }));
    return renderCrmPage({
      title: 'Reistypes en landen',
      user: req.user,
      csrf: req.session.csrf,
      path: BASE,
      body: html`${state.notice ? html`<p class="notice" role="status">${state.notice}</p>` : ''}
        ${renderAlert(state.error)}
        <details class="crm-block"${state.open ? raw(' open') : ''}>
          <summary><strong>Nieuw reistype of land</strong></summary>
          <form class="form crm-narrow" method="post" action="${BASE}nieuw/">
            <input type="hidden" name="_csrf" value="${req.session.csrf}">
            ${fields(state.values || { kind: 'bestemming' }, state.errors || {})}
            <div><button class="btn" type="submit">Aanmaken</button></div>
          </form>
        </details>
        <nav class="media-folders" aria-label="Soorten"><ul>${groups.map((group) => html`<li><a href="#soort-${group.kind}">${KIND_TITLES[group.kind]} <span class="media-folders__count">${group.rows.length}</span></a></li>`)}</ul></nav>
        ${groups.map((group) => html`<h2 id="soort-${group.kind}">${KIND_TITLES[group.kind]}</h2>
          ${group.rows.length ? html`<div class="crm-table-wrap"><table class="crm-table">
            <thead><tr><th>Naam</th><th>Slug</th>${group.kind === 'type' ? html`<th>Icoon</th>` : ''}<th>Volgorde</th><th>Homepage</th><th>Reizen (komend)</th><th>Foto's</th></tr></thead>
            <tbody>${group.rows.map((row) => html`<tr>
              <td><a href="${BASE}${row.id}/">${row.name}</a></td>
              <td>${row.slug}</td>
              ${group.kind === 'type' ? html`<td><span class="crm-icon" title="${categoryIconName(row)}">${icon(categoryIconName(row))}</span></td>` : ''}
              <td>${String(row.sort_order)}</td>
              <td>${row.show_on_home ? 'ja' : '–'}</td>
              <td>${String(row.trip_count)} (${String(row.upcoming_count)})</td>
              <td>${String(row.photo_count)}</td>
            </tr>`)}</tbody>
          </table></div>` : html`<p>Nog niets in deze soort.</p>`}`)}`,
    });
  };

  router.get('/reistypes-en-landen/', guard, async (req, res, next) => {
    try {
      return res.send(await renderList(req, { notice: req.query.klaar === '1' ? 'Verwijderd.' : '' }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/reistypes-en-landen/nieuw/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const { values, errors } = validateCategory(req.body);
      if (Object.keys(errors).length) return res.status(422).send(await renderList(req, { error: 'Controleer de velden.', values: { ...req.body, show_on_home: values.showOnHome }, errors, open: true }));
      const result = await categories.create(values, {
        userId: req.user.id,
        audit: (client, id) => auth.audit(req, { userId: req.user.id, action: 'categorie.aangemaakt', entity: 'trip_categories', entityId: id }, client),
      });
      if (result.errors) return res.status(422).send(await renderList(req, { error: 'Controleer de velden.', values: { ...req.body, show_on_home: values.showOnHome }, errors: result.errors, open: true }));
      await reloadRedirects();
      return res.redirect(303, `${BASE}${result.id}/?opgeslagen=1`);
    } catch (error) {
      return next(error);
    }
  });

  /**
   * De pagina van één reistype of land: wijzigen, foto, samenvoegen en verwijderen.
   * @param {object} req Express-verzoek.
   * @param {object} category Categorie uit `categories.get`.
   * @param {{notice?: string, error?: string, values?: object, errors?: object, status?: number}} [state] Meldingen en ingevulde waarden.
   * @returns {Promise<string>} HTML.
   */
  const renderItem = async (req, category, state = {}) => {
    const [all, countries] = await Promise.all([categories.list(), library.countries()]);
    const filter = pickerFilter(req.query, countries, category.kind === 'bestemming' ? category.id : null);
    const { photos, hasMore } = await pickerPhotos(library, filter);
    const pageUrl = `${BASE}${category.id}/`;
    const others = all.filter((row) => row.id !== category.id);
    const used = category.trip_count > 0 || category.photo_count > 0;
    return renderCrmPage({
      title: category.name,
      user: req.user,
      csrf: req.session.csrf,
      path: BASE,
      body: html`<p><a href="${BASE}">Naar reistypes en landen</a> · <a href="${categoryPath(category.slug)}">Bekijk op de site</a></p>
        ${state.notice ? html`<p class="notice" role="status">${state.notice}</p>` : ''}
        ${renderAlert(state.error)}
        <div class="crm-columns">
          <section>
            <form class="form crm-narrow" method="post" action="${pageUrl}">
              <input type="hidden" name="_csrf" value="${req.session.csrf}">
              ${fields(state.values || category, state.errors || {})}
              <div><button class="btn" type="submit">Opslaan</button></div>
            </form>
          </section>
          <section>
            <h2>Gebruik</h2>
            <dl class="crm-facts">
              <dt>Soort</dt><dd>${KINDS[category.kind] || category.kind}</dd>
              <dt>Reizen</dt><dd>${String(category.trip_count)}</dd>
              <dt>Foto's in de bibliotheek</dt><dd>${category.kind === 'bestemming' && category.photo_count ? html`<a href="/app/fotobibliotheek/?land=${category.id}">${String(category.photo_count)}</a>` : String(category.photo_count)}</dd>
              <dt>Adres</dt><dd><code>${categoryPath(category.slug)}</code></dd>
            </dl>
            <h2>Samenvoegen</h2>
            <form class="form crm-block" method="post" action="${pageUrl}samenvoegen/">
              <input type="hidden" name="_csrf" value="${req.session.csrf}">
              <p>Is dit een dubbeling? Dan gaan de reizen en foto's naar een categorie van dezelfde soort, verdwijnt deze en verwijst het adres <code>${categoryPath(category.slug)}</code> door.</p>
              <div class="field"><span class="field__label"><label for="veld-doel">Samenvoegen met</label></span>
                <select id="veld-doel" name="doel" required><option value="">Kies…</option>${others.filter((row) => row.kind === category.kind).map((row) => html`<option value="${row.id}">${row.name} (${row.slug})</option>`)}</select></div>
              <div><button class="btn btn--small btn--outline" type="submit">Samenvoegen</button></div>
            </form>
            <h2>Verwijderen</h2>
            ${used ? html`<p class="field__help">Verwijderen kan alleen als er geen reizen en foto's aan hangen. Voeg een dubbeling samen in plaats van te verwijderen.</p>`
              : html`<form method="post" action="${pageUrl}verwijderen/">
                <input type="hidden" name="_csrf" value="${req.session.csrf}">
                <button class="btn btn--small btn--outline" type="submit">Verwijderen</button>
              </form>`}
          </section>
        </div>
        <section class="crm-block" id="foto">
          <h2>Foto</h2>
          ${category.image_url ? html`<img class="media-preview media-preview--small" src="${category.image_url}" alt="" width="400" height="300">` : html`<p>Nog geen foto gekozen.</p>`}
          <p class="field__help">Kies een foto uit de fotobibliotheek${category.kind === 'bestemming' ? ' (standaard de foto\'s van dit land)' : ''}. Deze foto staat bovenaan de pagina van ${category.name} en op de homepage.</p>
          ${renderPhotoPicker({ pageUrl, action: `${pageUrl}foto/`, csrf: req.session.csrf, countries, filter, photos, hasMore, allowNone: Boolean(category.image_url), button: 'Deze foto gebruiken' })}
        </section>`,
    });
  };

  /**
   * Haalt de categorie uit de URL op, of stuurt een 404.
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @returns {Promise<(object|null)>} Categorie, of null als de 404 al verstuurd is.
   */
  const loadOr404 = async (req, res) => {
    const category = await categories.get(req.params.id);
    if (!category) notFound(req, res);
    return category;
  };

  router.get('/reistypes-en-landen/:id(\\d{1,9})/', guard, async (req, res, next) => {
    try {
      const category = await loadOr404(req, res);
      if (!category) return undefined;
      const notices = { 1: 'Opgeslagen.', 2: 'Opgeslagen. Het oude adres verwijst automatisch door naar het nieuwe.', 3: 'De foto is opgeslagen.', 4: 'Samengevoegd. Het oude adres verwijst automatisch door naar deze categorie.' };
      return res.send(await renderItem(req, category, { notice: notices[req.query.opgeslagen] || '' }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/reistypes-en-landen/:id(\\d{1,9})/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const { values, errors } = validateCategory(req.body);
      const filled = { ...req.body, show_on_home: values.showOnHome };
      if (Object.keys(errors).length) {
        const category = await loadOr404(req, res);
        if (!category) return undefined;
        return res.status(422).send(await renderItem(req, category, { error: 'Controleer de velden.', values: filled, errors }));
      }
      const result = await categories.update(req.params.id, values, {
        userId: req.user.id,
        audit: (client) => auth.audit(req, { userId: req.user.id, action: 'categorie.gewijzigd', entity: 'trip_categories', entityId: req.params.id }, client),
      });
      if (result.status === 'weg') return notFound(req, res);
      if (result.status === 'fout') {
        const category = await loadOr404(req, res);
        if (!category) return undefined;
        return res.status(422).send(await renderItem(req, category, { error: 'Controleer de velden.', values: filled, errors: result.errors }));
      }
      if (result.moved) await reloadRedirects();
      return res.redirect(303, `${BASE}${Number(req.params.id)}/?opgeslagen=${result.moved ? 2 : 1}`);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/reistypes-en-landen/:id(\\d{1,9})/foto/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const none = req.body.geen === '1';
      const mediaId = none ? null : req.body.media_id;
      if (!none && (typeof mediaId !== 'string' || !/^\d{1,9}$/.test(mediaId))) {
        const category = await loadOr404(req, res);
        if (!category) return undefined;
        return res.status(422).send(await renderItem(req, category, { error: 'Kies een foto.' }));
      }
      const outcome = await categories.setImage(req.params.id, none ? null : Number(mediaId), (client) => auth.audit(req, {
        userId: req.user.id, action: 'categorie.foto', entity: 'trip_categories', entityId: req.params.id,
      }, client));
      if (outcome === 'weg') return notFound(req, res);
      if (outcome === 'foto-weg') {
        const category = await loadOr404(req, res);
        if (!category) return undefined;
        return res.status(409).send(await renderItem(req, category, { error: 'Deze foto bestaat niet meer. Kies een andere.' }));
      }
      return res.redirect(303, `${BASE}${Number(req.params.id)}/?opgeslagen=3#foto`);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/reistypes-en-landen/:id(\\d{1,9})/samenvoegen/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const target = typeof req.body.doel === 'string' && /^\d{1,9}$/.test(req.body.doel) ? Number(req.body.doel) : null;
      const showError = async (status, message) => {
        const category = await loadOr404(req, res);
        if (!category) return undefined;
        return res.status(status).send(await renderItem(req, category, { error: message }));
      };
      if (!target) return await showError(422, 'Kies met welke categorie je wilt samenvoegen.');
      const outcome = await categories.merge(req.params.id, target, {
        userId: req.user.id,
        audit: (client) => auth.audit(req, { userId: req.user.id, action: 'categorie.samengevoegd', entity: 'trip_categories', entityId: req.params.id }, client),
      });
      if (outcome.status === 'weg') return notFound(req, res);
      if (outcome.status === 'zelfde') return await showError(422, 'Kies een andere categorie dan deze.');
      if (outcome.status === 'doel-weg') return await showError(409, 'De gekozen categorie bestaat niet meer.');
      if (outcome.status === 'andere-soort') return await showError(422, 'Samenvoegen kan alleen met een categorie van dezelfde soort. Wijzig eerst de soort.');
      await reloadRedirects();
      return res.redirect(303, `${BASE}${outcome.target.id}/?opgeslagen=4`);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/reistypes-en-landen/:id(\\d{1,9})/verwijderen/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const outcome = await categories.remove(req.params.id, (client) => auth.audit(req, {
        userId: req.user.id, action: 'categorie.verwijderd', entity: 'trip_categories', entityId: req.params.id,
      }, client));
      if (outcome === 'weg') return notFound(req, res);
      if (outcome === 'gebruikt') {
        const category = await loadOr404(req, res);
        if (!category) return undefined;
        return res.status(409).send(await renderItem(req, category, { error: 'Er hangen reizen of foto\'s aan. Voeg samen in plaats van te verwijderen.' }));
      }
      return res.redirect(303, `${BASE}?klaar=1`);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createCategoryRoutes, CATEGORY_ACTION_LABELS };
