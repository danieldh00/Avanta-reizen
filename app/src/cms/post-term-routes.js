/**
 * Categorieën en tags van het blog beheren in het CRM (`/app/blog/categorieen-en-tags/`, recht `content`, CMS-pakket
 * I2): lijst per soort met het aantal berichten, nieuw, wijzigen (naam, adres met 301, inleiding, volgorde),
 * verwijderen en de tags van de huidige site overnemen uit `site-content.json`. Elke wijziging in de auditlog.
 */
const express = require('express');
const { routePath } = require('../route-path');
const { html, raw } = require('../site/html');
const { renderCrmPage, renderAlert } = require('../crm/layout');
const { fieldRow, invalidAttributes } = require('./block-editor');
const { createPostTerms, validateTermFields, TERM_KINDS, TERM_LIMITS } = require('./post-terms');
const { MAX_SLUG_LENGTH } = require('../trips/slugs');
const { createSiteContentStore } = require('../site/site-content');
const { DATA_DIR } = require('../paths');

/** Basispad van het scherm. */
const BASE = '/app/blog/categorieen-en-tags/';

/** Acties voor het auditlog (zie `ACTION_LABELS` in `crm/users.js`). */
const TERM_ACTION_LABELS = {
  'blog-indeling.nieuw': 'Categorie of tag van het blog gemaakt',
  'blog-indeling.gewijzigd': 'Categorie of tag van het blog gewijzigd',
  'blog-indeling.verwijderd': 'Categorie of tag van het blog verwijderd',
  'blog-indeling.overgenomen': 'Tags van de huidige site overgenomen',
  'blog.indeling': 'Categorieën, tags of uitgelicht van een blogbericht gewijzigd',
};

/** Meldingen op de lijst (`?melding=<n>`). */
const NOTICES = {
  1: 'Opgeslagen.',
  2: 'Verwijderd. Het adres verwijst nu naar het blog.',
  3: 'Het adres is gewijzigd; het oude adres verwijst automatisch door.',
  4: 'De tags van de huidige site zijn overgenomen, met hun berichten en het uitgelichte bericht.',
  5: 'Er zijn al tags; er is niets overgenomen.',
};

/**
 * De velden van een categorie of tag.
 * @param {object} values Ingevulde waarden (`name`, `slug`, `intro`, `sortOrder`).
 * @param {object} errors Fouten.
 * @param {string} prefix Voorvoegsel voor de id's.
 * @returns {object} HTML.
 */
function termFields(values, errors, prefix) {
  const row = (name, label, control, help) => fieldRow({ id: `${prefix}-${name}`, label, control, help, error: errors[name] });
  return html`${row('name', 'Naam', html`<input id="${prefix}-name" name="name" type="text" value="${values.name}" maxlength="${TERM_LIMITS.name}" required${invalidAttributes(`${prefix}-name`, errors.name)}>`)}
    ${row('slug', 'Adres', html`<input id="${prefix}-slug" name="slug" type="text" value="${values.slug}" maxlength="${MAX_SLUG_LENGTH}" pattern="[a-z0-9]+(-[a-z0-9]+)*"${invalidAttributes(`${prefix}-slug`, errors.slug)}>`, 'Kleine letters, cijfers en streepjes. Leeg = gemaakt uit de naam.')}
    ${row('intro', 'Inleiding (boven de lijst met berichten)', html`<textarea id="${prefix}-intro" name="intro" rows="3" maxlength="${TERM_LIMITS.intro}"${invalidAttributes(`${prefix}-intro`, errors.intro)}>${values.intro}</textarea>`)}
    ${row('sort_order', 'Volgorde', html`<input id="${prefix}-sort_order" name="sort_order" type="number" step="1" value="${String(values.sortOrder)}"${invalidAttributes(`${prefix}-sort_order`, errors.sort_order)}>`, 'Lager staat eerder (bij tags: in de balk boven het blog).')}`;
}

/**
 * Maakt de routes voor categorieën en tags.
 * @param {{db: object, auth: object, redirects?: object, siteContent?: object}} options Database, sessie- en rechtenlaag,
 *   doorverwijzingen (opnieuw laden na een nieuw adres) en `site-content.json` (tags overnemen).
 * @returns {express.Router} Router.
 */
function createPostTermRoutes(options) {
  const { db, auth } = options;
  const terms = createPostTerms({ db });
  const router = express.Router();
  const guard = auth.requireRight('content');
  const siteContent = options.siteContent || createSiteContentStore(DATA_DIR);

  /**
   * Audit voor een actie.
   * @param {object} req Express-verzoek.
   * @param {string} action Actie.
   * @param {(number|string|null)} [entityId] Id.
   * @returns {Function} `(client, id?) => Promise`.
   */
  const auditFor = (req, action, entityId = req.params.id) => (client, id) => auth.audit(req, { userId: req.user.id, action, entity: 'post_terms', entityId: id || entityId || null }, client);

  /**
   * Het overzicht met per soort de lijst en een formulier voor een nieuwe.
   * @param {object} req Express-verzoek.
   * @param {{notice?: string, error?: string, kind?: string, values?: object, errors?: object}} [state] Meldingen en een
   *   nieuw formulier met fouten.
   * @returns {Promise<string>} HTML.
   */
  const renderList = async (req, state = {}) => {
    const rows = await terms.list();
    const hasTags = rows.some((row) => row.kind === 'tag');
    const oldTags = siteContent.load().blogTags;
    return renderCrmPage({
      title: 'Categorieën en tags',
      user: req.user,
      csrf: req.session.csrf,
      path: '/app/blog/',
      body: html`<p><a href="/app/blog/">Naar het blog</a></p>
        ${state.notice ? html`<p class="notice" role="status">${state.notice}</p>` : ''}
        ${renderAlert(state.error)}
        ${!hasTags && oldTags.length ? html`<section class="crm-block">
          <p>De huidige site heeft ${String(oldTags.length)} tags (met hun berichten). Neem ze over om ze hier te beheren; tot dan toont de site die tags zoals nu.</p>
          <form method="post" action="${BASE}overnemen/"><input type="hidden" name="_csrf" value="${req.session.csrf}"><button class="btn btn--small" type="submit">Tags van de huidige site overnemen</button></form>
        </section>` : ''}
        ${Object.entries(TERM_KINDS).map(([kind, definition]) => {
          const own = rows.filter((row) => row.kind === kind);
          const values = state.kind === kind ? state.values : { name: '', slug: '', intro: '', sortOrder: 0 };
          const errors = state.kind === kind ? state.errors : {};
          return html`<section class="crm-block" id="${kind}">
            <h2>${definition.plural}</h2>
            ${own.length ? html`<div class="crm-table-wrap"><table class="crm-table">
              <thead><tr><th>Naam</th><th>Adres</th><th>Berichten</th><th>Volgorde</th></tr></thead>
              <tbody>${own.map((row) => html`<tr>
                <td><a href="${BASE}${row.id}/">${row.name}</a></td>
                <td><code>${definition.prefix}${row.slug}/</code></td>
                <td>${String(row.post_count)}</td>
                <td>${String(row.sort_order)}</td>
              </tr>`)}</tbody>
            </table></div>` : html`<p>Nog geen ${definition.plural.toLowerCase()}.</p>`}
            <details class="cms-style"${state.kind === kind ? raw(' open') : ''}><summary>${definition.label} toevoegen</summary>
              <form class="form crm-narrow" method="post" action="${BASE}nieuw/">
                <input type="hidden" name="_csrf" value="${req.session.csrf}"><input type="hidden" name="kind" value="${kind}">
                ${termFields(values, errors, `nieuw-${kind}`)}
                <div><button class="btn btn--small" type="submit">Toevoegen</button></div>
              </form>
            </details>
          </section>`;
        })}`,
    });
  };

  /**
   * Het bewerkscherm van één categorie of tag.
   * @param {object} req Express-verzoek.
   * @param {object} term Rij.
   * @param {{error?: string, values?: object, errors?: object}} [state] Fouten.
   * @returns {string} HTML.
   */
  const renderEdit = (req, term, state = {}) => {
    const definition = TERM_KINDS[term.kind];
    const values = state.values || { name: term.name, slug: term.slug, intro: term.intro, sortOrder: term.sort_order };
    return renderCrmPage({
      title: `${definition.label}: ${term.name}`,
      user: req.user,
      csrf: req.session.csrf,
      path: '/app/blog/',
      body: html`<p><a href="${BASE}">Naar categorieën en tags</a> · <a href="${definition.prefix}${term.slug}/">Bekijk op de site</a></p>
        ${renderAlert(state.error)}
        <form class="form crm-narrow crm-block" method="post" action="${BASE}${term.id}/">
          <input type="hidden" name="_csrf" value="${req.session.csrf}">
          ${termFields(values, state.errors || {}, 'term')}
          <p class="field__help">Wijzig je het adres, dan verwijst het oude adres automatisch door.</p>
          <div><button class="btn" type="submit">Opslaan</button></div>
        </form>
        <form class="crm-block crm-actions" method="post" action="${BASE}${term.id}/verwijderen/">
          <input type="hidden" name="_csrf" value="${req.session.csrf}">
          <label class="checkbox"><input type="checkbox" name="zeker" value="ja" required> Ja, verwijder deze ${definition.label.toLowerCase()} (de berichten blijven)</label>
          <button class="btn btn--small btn--outline" type="submit">Verwijderen</button>
        </form>`,
    });
  };

  /**
   * 404 binnen het CRM.
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @returns {void}
   */
  const notFound = (req, res) => {
    res.status(404).send(renderCrmPage({ title: 'Niet gevonden', user: req.user, csrf: req.session.csrf, path: '/app/blog/', body: html`<p>Deze categorie of tag bestaat niet. <a href="${BASE}">Naar categorieën en tags</a></p>` }));
  };

  router.get('/blog/categorieen-en-tags/', guard, async (req, res, next) => {
    try {
      return res.send(await renderList(req, { notice: NOTICES[req.query.melding] || '' }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/blog/categorieen-en-tags/nieuw/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const kind = typeof req.body.kind === 'string' && Object.hasOwn(TERM_KINDS, req.body.kind) ? req.body.kind : 'categorie';
      const { values, errors } = validateTermFields(req.body);
      const outcome = Object.keys(errors).length ? { errors } : await terms.create(kind, values, { userId: req.user.id, audit: auditFor(req, 'blog-indeling.nieuw', null) });
      if (outcome.errors) return res.status(422).send(await renderList(req, { error: 'Controleer de velden.', kind, values, errors: outcome.errors }));
      return res.redirect(303, `${BASE}?melding=1#${kind}`);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/blog/categorieen-en-tags/overnemen/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const outcome = await terms.importSiteTags(siteContent.load(), { userId: req.user.id, audit: auditFor(req, 'blog-indeling.overgenomen', null) });
      return res.redirect(303, `${BASE}?melding=${outcome.status === 'ok' ? 4 : 5}`);
    } catch (error) {
      return next(error);
    }
  });

  router.get(routePath('/blog/categorieen-en-tags/:id(\\d{1,9})/'), guard, async (req, res, next) => {
    try {
      const term = await terms.get(req.params.id);
      if (!term) return notFound(req, res);
      return res.send(renderEdit(req, term));
    } catch (error) {
      return next(error);
    }
  });

  router.post(routePath('/blog/categorieen-en-tags/:id(\\d{1,9})/'), guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const term = await terms.get(req.params.id);
      if (!term) return notFound(req, res);
      const { values, errors } = validateTermFields(req.body);
      const outcome = Object.keys(errors).length ? { status: 'fout', errors } : await terms.update(term.id, values, { userId: req.user.id, audit: auditFor(req, 'blog-indeling.gewijzigd') });
      if (outcome.status === 'weg') return notFound(req, res);
      if (outcome.status === 'fout') return res.status(422).send(renderEdit(req, term, { error: 'Controleer de velden.', values, errors: outcome.errors }));
      if (outcome.moved && options.redirects) await options.redirects.reload().catch(() => {});
      return res.redirect(303, `${BASE}?melding=${outcome.moved ? 3 : 1}#${term.kind}`);
    } catch (error) {
      return next(error);
    }
  });

  router.post(routePath('/blog/categorieen-en-tags/:id(\\d{1,9})/verwijderen/'), guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const term = await terms.get(req.params.id);
      if (!term) return notFound(req, res);
      if (req.body.zeker !== 'ja') return res.status(422).send(renderEdit(req, term, { error: 'Vink aan dat je wilt verwijderen.' }));
      const outcome = await terms.remove(term.id, { audit: auditFor(req, 'blog-indeling.verwijderd') });
      if (outcome.status === 'weg') return notFound(req, res);
      return res.redirect(303, `${BASE}?melding=2`);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createPostTermRoutes, TERM_ACTION_LABELS, BASE };
