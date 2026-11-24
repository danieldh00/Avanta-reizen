// @ts-check
/**
 * Veelgestelde vragen beheren in het CRM (`/app/faq/`, recht `content`, CMS-pakket I3): overzicht per categorie, vraag
 * toevoegen, wijzigen (vraag, categorie, opgemaakt antwoord, volgorde) en verwijderen, en categorieën toevoegen,
 * hernoemen, ordenen en (leeg) verwijderen. Elke wijziging in de auditlog.
 */
const express = require('express');
const { routePath } = require('../route-path');
const { html, raw } = require('../site/html');
const { renderCrmPage, renderAlert } = require('../crm/layout');
const { fieldRow, invalidAttributes, RICHTEXT_HELP } = require('./block-editor');
const { createFaqs, validateCategoryFields, validateQuestionFields, FAQ_LIMITS } = require('./faqs');

/** Basispad van het scherm. */
const BASE = '/app/faq/';

/** Acties voor het auditlog (zie `ACTION_LABELS` in `crm/users.js`). */
const FAQ_ACTION_LABELS = {
  'faq.vraag-nieuw': 'Veelgestelde vraag toegevoegd',
  'faq.vraag-gewijzigd': 'Veelgestelde vraag gewijzigd',
  'faq.vraag-verwijderd': 'Veelgestelde vraag verwijderd',
  'faq.categorie-nieuw': 'FAQ-categorie toegevoegd',
  'faq.categorie-gewijzigd': 'FAQ-categorie gewijzigd',
  'faq.categorie-verwijderd': 'FAQ-categorie verwijderd',
};

/** Meldingen op het overzicht (`?melding=<n>`). */
const NOTICES = {
  1: 'Opgeslagen.',
  2: 'De vraag is verwijderd.',
  3: 'De categorie is verwijderd.',
  4: 'De categorie heeft een nieuwe naam. Een FAQ-blok op een pagina dat alleen deze categorie toonde, kies je opnieuw.',
};

/**
 * De velden van een categorie.
 * @param {{name: string, sortOrder: number}} values Waarden.
 * @param {any} errors Fouten.
 * @param {string} prefix Voorvoegsel voor de id's.
 * @returns {any} HTML.
 */
function categoryFields(values, errors, prefix) {
  return html`${fieldRow({ id: `${prefix}-name`, label: 'Naam', error: errors.name, control: html`<input id="${prefix}-name" name="name" type="text" value="${values.name}" maxlength="${FAQ_LIMITS.category}" required${invalidAttributes(`${prefix}-name`, errors.name)}>` })}
    ${fieldRow({ id: `${prefix}-sort_order`, label: 'Volgorde', error: errors.sort_order, help: 'Lager staat eerder op de FAQ-pagina.', control: html`<input id="${prefix}-sort_order" name="sort_order" type="number" step="1" value="${String(values.sortOrder)}"${invalidAttributes(`${prefix}-sort_order`, errors.sort_order)}>` })}`;
}

/**
 * Het formulier van een vraag.
 * @param {{action: string, csrf: string, values: any, errors: any, categories: any[], submit: string}} form Gegevens.
 * @returns {any} HTML.
 */
function questionForm(form) {
  const { values, errors } = form;
  return html`<form class="form crm-block" method="post" action="${form.action}">
    <input type="hidden" name="_csrf" value="${form.csrf}">
    ${fieldRow({ id: 'faq-question', label: 'Vraag', error: errors.question, control: html`<input id="faq-question" name="question" type="text" value="${values.question}" maxlength="${FAQ_LIMITS.question}" required${invalidAttributes('faq-question', errors.question)}>` })}
    ${fieldRow({ id: 'faq-category', label: 'Categorie', error: errors.category_id, control: html`<select id="faq-category" name="category_id" required${invalidAttributes('faq-category', errors.category_id)}>
      <option value="">Kies…</option>
      ${form.categories.map((category) => html`<option value="${String(category.id)}"${String(category.id) === String(values.categoryId) ? raw(' selected') : ''}>${category.name}</option>`)}
    </select>` })}
    ${fieldRow({ id: 'faq-answer', label: 'Antwoord', error: errors.answer, help: RICHTEXT_HELP, control: html`<textarea id="faq-answer" name="answer" rows="12" class="cms-richtext" maxlength="${FAQ_LIMITS.answer}"${invalidAttributes('faq-answer', errors.answer)}>${values.answerInput}</textarea>` })}
    ${fieldRow({ id: 'faq-sort_order', label: 'Volgorde', error: errors.sort_order, help: 'Lager staat eerder binnen de categorie.', control: html`<input id="faq-sort_order" name="sort_order" type="number" step="1" value="${String(values.sortOrder)}"${invalidAttributes('faq-sort_order', errors.sort_order)}>` })}
    <div><button class="btn" type="submit">${form.submit}</button></div>
  </form>`;
}

/**
 * Maakt de routes voor de FAQ.
 * @param {{db: any, auth: any}} options Database en sessie- en rechtenlaag.
 * @returns {express.Router} Router.
 */
function createFaqRoutes(options) {
  const { db, auth } = options;
  const faqs = createFaqs({ db });
  const router = express.Router();
  const guard = auth.requireRight('content');

  /**
   * Audit voor een actie.
   * @param {any} req Express-verzoek.
   * @param {string} action Actie.
   * @param {string} entity Tabel.
   * @param {(number|string|null)} [entityId] Id.
   * @returns {Function} `(client, id?) => Promise`.
   */
  const auditFor = (req, action, entity, entityId = req.params.id) => (client, id) => auth.audit(req, { userId: req.user.id, action, entity, entityId: id || entityId || null }, client);

  /**
   * Een CRM-pagina binnen de FAQ.
   * @param {any} req Express-verzoek.
   * @param {string} title Titel.
   * @param {any} body HTML.
   * @returns {string} HTML.
   */
  const page = (req, title, body) => renderCrmPage({ title, user: req.user, csrf: req.session.csrf, path: BASE, body });

  /**
   * Het overzicht: per categorie de vragen, en een formulier voor een nieuwe categorie.
   * @param {any} req Express-verzoek.
   * @param {{notice?: string, error?: string, values?: any, errors?: any}} [state] Meldingen en een nieuw
   *   categorieformulier met fouten.
   * @returns {Promise<string>} HTML.
   */
  const renderOverview = async (req, state = {}) => {
    const { categories, loose } = await faqs.overview();
    const values = state.values || { name: '', sortOrder: 0 };
    /**
     * Tabel met vragen.
     * @param {any[]} questions Vragen.
     * @returns {any} HTML.
     */
    const table = (questions) => (questions.length ? html`<div class="crm-table-wrap"><table class="crm-table">
      <thead><tr><th>Vraag</th><th>Volgorde</th></tr></thead>
      <tbody>${questions.map((question) => html`<tr><td><a href="${BASE}${question.id}/">${question.question}</a></td><td>${String(question.sort_order)}</td></tr>`)}</tbody>
    </table></div>` : html`<p>Nog geen vragen.</p>`);
    return page(req, 'Veelgestelde vragen', html`<p><a href="/faq/">Bekijk op de site</a></p>
      ${state.notice ? html`<p class="notice" role="status">${state.notice}</p>` : ''}
      ${renderAlert(state.error)}
      ${categories.length ? html`<p><a class="btn btn--small" href="${BASE}nieuw/">Vraag toevoegen</a></p>` : html`<p>Maak eerst een categorie; daarna voeg je vragen toe.</p>`}
      ${categories.map((category) => html`<section class="crm-block" id="categorie-${String(category.id)}">
        <h2>${category.name}</h2>
        <p><a href="${BASE}categorieen/${category.id}/">Categorie wijzigen</a> · <a href="${BASE}nieuw/?categorie=${category.id}">Vraag toevoegen</a> · volgorde ${String(category.sort_order)}</p>
        ${table(category.questions)}
      </section>`)}
      ${loose.length ? html`<section class="crm-block"><h2>Zonder categorie</h2><p>Deze vragen komen uit de import; kies een categorie om ze te ordenen.</p>${table(loose)}</section>` : ''}
      <section class="crm-block">
        <details class="cms-style"${state.errors ? raw(' open') : ''}><summary>Categorie toevoegen</summary>
          <form class="form crm-narrow" method="post" action="${BASE}categorieen/nieuw/">
            <input type="hidden" name="_csrf" value="${req.session.csrf}">
            ${categoryFields(values, state.errors || {}, 'nieuw')}
            <div><button class="btn btn--small" type="submit">Toevoegen</button></div>
          </form>
        </details>
      </section>`);
  };

  /**
   * Het scherm voor een nieuwe of bestaande vraag.
   * @param {any} req Express-verzoek.
   * @param {(any|null)} question Bestaande vraag, of null voor nieuw.
   * @param {{error?: string, values?: any, errors?: any}} [state] Fouten.
   * @returns {Promise<string>} HTML.
   */
  const renderQuestion = async (req, question, state = {}) => {
    const { categories } = await faqs.overview();
    const preset = typeof req.query.categorie === 'string' ? req.query.categorie : '';
    const values = state.values || (question
      ? { question: question.question, categoryId: question.category_id || '', answerInput: question.answer_html, sortOrder: question.sort_order }
      : { question: '', categoryId: preset, answerInput: '', sortOrder: 0 });
    const form = questionForm({
      action: question ? `${BASE}${question.id}/` : `${BASE}nieuw/`,
      csrf: req.session.csrf,
      values,
      errors: state.errors || {},
      categories,
      submit: question ? 'Opslaan' : 'Toevoegen',
    });
    return page(req, question ? 'Vraag wijzigen' : 'Vraag toevoegen', html`<p><a href="${BASE}">Naar de veelgestelde vragen</a></p>
      ${renderAlert(state.error)}
      ${form}
      ${question ? html`<form class="crm-block crm-actions" method="post" action="${BASE}${question.id}/verwijderen/">
        <input type="hidden" name="_csrf" value="${req.session.csrf}">
        <label class="checkbox"><input type="checkbox" name="zeker" value="ja" required> Ja, verwijder deze vraag</label>
        <button class="btn btn--small btn--outline" type="submit">Verwijderen</button>
      </form>` : ''}`);
  };

  /**
   * Het bewerkscherm van een categorie.
   * @param {any} req Express-verzoek.
   * @param {any} category Rij (met `question_count`).
   * @param {{error?: string, values?: any, errors?: any}} [state] Fouten.
   * @returns {string} HTML.
   */
  const renderCategory = (req, category, state = {}) => {
    const values = state.values || { name: category.name, sortOrder: category.sort_order };
    return page(req, `Categorie: ${category.name}`, html`<p><a href="${BASE}">Naar de veelgestelde vragen</a></p>
      ${renderAlert(state.error)}
      <form class="form crm-narrow crm-block" method="post" action="${BASE}categorieen/${category.id}/">
        <input type="hidden" name="_csrf" value="${req.session.csrf}">
        ${categoryFields(values, state.errors || {}, 'categorie')}
        <p class="field__help">Een FAQ-blok op een pagina kiest een categorie op naam: wijzig je de naam, kies de categorie in dat blok dan opnieuw.</p>
        <div><button class="btn" type="submit">Opslaan</button></div>
      </form>
      ${category.question_count ? html`<p class="crm-block">Deze categorie heeft ${String(category.question_count)} ${category.question_count === 1 ? 'vraag' : 'vragen'}. Verplaats of verwijder ze om de categorie te kunnen verwijderen.</p>`
        : html`<form class="crm-block crm-actions" method="post" action="${BASE}categorieen/${category.id}/verwijderen/">
        <input type="hidden" name="_csrf" value="${req.session.csrf}">
        <label class="checkbox"><input type="checkbox" name="zeker" value="ja" required> Ja, verwijder deze categorie</label>
        <button class="btn btn--small btn--outline" type="submit">Verwijderen</button>
      </form>`}`);
  };

  /**
   * 404 binnen het CRM.
   * @param {any} req Express-verzoek.
   * @param {any} res Express-antwoord.
   * @returns {void}
   */
  const notFound = (req, res) => {
    res.status(404).send(page(req, 'Niet gevonden', html`<p>Deze vraag of categorie bestaat niet. <a href="${BASE}">Naar de veelgestelde vragen</a></p>`));
  };

  /**
   * Zet een asynchrone handler om in Express-middleware met foutafhandeling.
   * @param {Function} handler `(req, res) => Promise`.
   * @returns {Function} Middleware.
   */
  const handle = (handler) => async (req, res, next) => {
    try {
      return await handler(req, res);
    } catch (error) {
      return next(error);
    }
  };

  router.get('/faq/', guard, handle(async (req, res) => res.send(await renderOverview(req, { notice: NOTICES[req.query.melding] || '' }))));

  router.get('/faq/nieuw/', guard, handle(async (req, res) => res.send(await renderQuestion(req, null))));

  router.post('/faq/nieuw/', guard, auth.checkCsrf, handle(async (req, res) => {
    const { values, errors } = validateQuestionFields(req.body);
    const outcome = Object.keys(errors).length ? { errors } : await faqs.createQuestion(values, { userId: req.user.id, audit: auditFor(req, 'faq.vraag-nieuw', 'faqs', null) });
    if (outcome.errors) return res.status(422).send(await renderQuestion(req, null, { error: 'Controleer de velden.', values, errors: outcome.errors }));
    return res.redirect(303, `${BASE}?melding=1#categorie-${Number(values.categoryId)}`);
  }));

  router.get(routePath('/faq/:id(\\d{1,9})/'), guard, handle(async (req, res) => {
    const question = await faqs.getQuestion(req.params.id);
    if (!question) return notFound(req, res);
    return res.send(await renderQuestion(req, question));
  }));

  router.post(routePath('/faq/:id(\\d{1,9})/'), guard, auth.checkCsrf, handle(async (req, res) => {
    const question = await faqs.getQuestion(req.params.id);
    if (!question) return notFound(req, res);
    const { values, errors } = validateQuestionFields(req.body);
    const outcome = Object.keys(errors).length ? { status: 'fout', errors } : await faqs.updateQuestion(question.id, values, { userId: req.user.id, audit: auditFor(req, 'faq.vraag-gewijzigd', 'faqs') });
    if (outcome.status === 'weg') return notFound(req, res);
    if (outcome.status === 'fout') return res.status(422).send(await renderQuestion(req, question, { error: 'Controleer de velden.', values, errors: outcome.errors }));
    return res.redirect(303, `${BASE}?melding=1#categorie-${Number(values.categoryId)}`);
  }));

  router.post(routePath('/faq/:id(\\d{1,9})/verwijderen/'), guard, auth.checkCsrf, handle(async (req, res) => {
    const question = await faqs.getQuestion(req.params.id);
    if (!question) return notFound(req, res);
    if (req.body.zeker !== 'ja') return res.status(422).send(await renderQuestion(req, question, { error: 'Vink aan dat je wilt verwijderen.' }));
    const outcome = await faqs.removeQuestion(question.id, { audit: auditFor(req, 'faq.vraag-verwijderd', 'faqs') });
    if (outcome.status === 'weg') return notFound(req, res);
    return res.redirect(303, `${BASE}?melding=2`);
  }));

  router.post('/faq/categorieen/nieuw/', guard, auth.checkCsrf, handle(async (req, res) => {
    const { values, errors } = validateCategoryFields(req.body);
    const outcome = Object.keys(errors).length ? { errors } : await faqs.createCategory(values, { userId: req.user.id, audit: auditFor(req, 'faq.categorie-nieuw', 'faq_categories', null) });
    if (outcome.errors) return res.status(422).send(await renderOverview(req, { error: 'Controleer de velden.', values, errors: outcome.errors }));
    return res.redirect(303, `${BASE}?melding=1#categorie-${outcome.id}`);
  }));

  router.get(routePath('/faq/categorieen/:id(\\d{1,9})/'), guard, handle(async (req, res) => {
    const category = await faqs.getCategory(req.params.id);
    if (!category) return notFound(req, res);
    return res.send(renderCategory(req, category));
  }));

  router.post(routePath('/faq/categorieen/:id(\\d{1,9})/'), guard, auth.checkCsrf, handle(async (req, res) => {
    const category = await faqs.getCategory(req.params.id);
    if (!category) return notFound(req, res);
    const { values, errors } = validateCategoryFields(req.body);
    const outcome = Object.keys(errors).length ? { status: 'fout', errors } : await faqs.updateCategory(category.id, values, { userId: req.user.id, audit: auditFor(req, 'faq.categorie-gewijzigd', 'faq_categories') });
    if (outcome.status === 'weg') return notFound(req, res);
    if (outcome.status === 'fout') return res.status(422).send(renderCategory(req, category, { error: 'Controleer de velden.', values, errors: outcome.errors }));
    return res.redirect(303, `${BASE}?melding=${outcome.renamed ? 4 : 1}#categorie-${category.id}`);
  }));

  router.post(routePath('/faq/categorieen/:id(\\d{1,9})/verwijderen/'), guard, auth.checkCsrf, handle(async (req, res) => {
    const category = await faqs.getCategory(req.params.id);
    if (!category) return notFound(req, res);
    if (req.body.zeker !== 'ja') return res.status(422).send(renderCategory(req, category, { error: 'Vink aan dat je wilt verwijderen.' }));
    const outcome = await faqs.removeCategory(category.id, { audit: auditFor(req, 'faq.categorie-verwijderd', 'faq_categories') });
    if (outcome.status === 'weg') return notFound(req, res);
    if (outcome.status === 'vol') return res.status(422).send(renderCategory(req, await faqs.getCategory(category.id) || category, { error: 'Er staan nog vragen in deze categorie.' }));
    return res.redirect(303, `${BASE}?melding=3`);
  }));

  return router;
}

module.exports = { createFaqRoutes, FAQ_ACTION_LABELS, BASE };
