/**
 * Pagina's beheren in het CRM (`/app/paginas/`, recht `content`, CMS-pakket H1 en H3): lijst met zoeken, nieuwe pagina,
 * adres wijzigen (met 301), offline/online, verwijderen, SEO-velden, een pagina bewerken
 * als concept (titel, bovenkop, inleiding, kopfoto en blokken: toevoegen, wijzigen, verplaatsen, kopiëren,
 * verwijderen), een voorbeeld van het concept in de opmaak van de site, publiceren, concept weggooien en eerdere versies
 * terugzetten. Werkt zonder JavaScript: elke actie is een eigen formulier met CSRF-token en de versie van het concept.
 * Elke wijziging in de auditlog.
 */
const express = require('express');
const { routePath } = require('../route-path');
const { html, raw } = require('../site/html');
const { renderCrmPage, renderAlert, formatDateTime } = require('../crm/layout');
const ui = require('../crm/ui');
const { renderPage, renderPageHeader } = require('../site/layout');
const { addCspSources } = require('../security/csp');
const { YOUTUBE_ORIGIN, normalizeHomepage } = require('../site/homepage');
const { searchPatterns } = require('../persons/person-routes');
const { createMediaLibrary } = require('../media/library');
const { BLOCK_TYPES, BLOCK_ID_PATTERN } = require('./blocks');
const { createBlockEditor, fieldRow, invalidAttributes, renderDraftStatus, renderRevisions, renderVisibilityActions } = require('./block-editor');
const { createPages, validatePageFields, editableState, imageFromMedia, PAGE_LIMITS } = require('./pages');
const { slugify, MAX_SLUG_LENGTH } = require('../trips/slugs');
const { renderPageArticle } = require('./page-render');
const { createContent } = require('../site/content');

/** Basispad van het scherm. */
const BASE = '/app/paginas/';

/** Acties voor het auditlog (zie `ACTION_LABELS` in `crm/users.js`). */
const PAGE_ACTION_LABELS = {
  'pagina.concept': 'Concept van een pagina gewijzigd',
  'pagina.gepubliceerd': 'Pagina gepubliceerd',
  'pagina.concept-weg': 'Concept van een pagina weggegooid',
  'pagina.versie-terug': 'Eerdere versie van een pagina teruggezet als concept',
  'pagina.nieuw': 'Nieuwe pagina gemaakt',
  'pagina.verplaatst': 'Adres van een pagina gewijzigd',
  'pagina.offline': 'Pagina offline gehaald',
  'pagina.online': 'Pagina weer online gezet',
  'pagina.verwijderd': 'Pagina verwijderd',
};

/** Meldingen na een geslaagde actie (`?opgeslagen=<n>`). */
const NOTICES = {
  1: 'Opgeslagen in het concept. Bekijk het voorbeeld en publiceer als het klaar is.',
  2: 'Gepubliceerd. De pagina staat zo op de site.',
  3: 'Het concept is weggegooid; je ziet weer de gepubliceerde pagina.',
  4: 'De versie staat klaar als concept. Publiceer om hem terug op de site te zetten.',
  5: 'Blok toegevoegd aan het concept.',
  6: 'Blok verwijderd uit het concept.',
  7: 'De pagina is gemaakt en staat offline. Voeg blokken toe en publiceer om hem online te zetten.',
  8: 'Het adres is gewijzigd. Het oude adres verwijst automatisch door (ook voor de pagina\'s eronder) en het menu is bijgewerkt.',
  9: 'De pagina staat offline; bezoekers krijgen een 404.',
  10: 'De pagina staat weer online.',
  11: 'De homepage staat klaar als blokpagina, met de huidige inhoud. Tot je publiceert toont de site de vaste homepage met de standaardteksten.',
};

/** Meldingen op de lijst (`?melding=<n>`). */
const LIST_NOTICES = { 1: 'De pagina is verwijderd.' };

/** Melding als het formulier van een oudere stand van het concept uitging. */
const STALE_MESSAGE = 'De pagina is intussen gewijzigd (in een ander tabblad of door een collega). Je wijziging is niet opgeslagen; bekijk de nieuwe stand en probeer het opnieuw.';

/**
 * Velden voor het adres van een pagina: bovenliggende pagina en het laatste deel van het adres.
 * @param {{path: string, title: string}[]} parents Mogelijke bovenliggende pagina's.
 * @param {{slug: string, parentPath: string}} placement Ingevulde waarden.
 * @param {object} errors Fouten (`slug`, `parent`).
 * @param {string} prefix Voorvoegsel voor de id's.
 * @returns {object} HTML.
 */
function renderPlacementFields(parents, placement, errors, prefix) {
  return html`${fieldRow({
    id: `${prefix}-parent`,
    label: 'Onder pagina',
    error: errors.parent,
    control: html`<select id="${prefix}-parent" name="parent"${invalidAttributes(`${prefix}-parent`, errors.parent)}>
      <option value="/">Geen (hoofdniveau)</option>
      ${parents.map((parent) => html`<option value="${parent.path}"${parent.path === placement.parentPath ? raw(' selected') : ''}>${parent.title} (${parent.path})</option>`)}
    </select>`,
  })}
  ${fieldRow({
    id: `${prefix}-slug`,
    label: 'Laatste deel van het adres',
    error: errors.slug,
    help: 'Kleine letters, cijfers en streepjes, bijv. onze-reizen. Het adres wordt dan /onder-pagina/onze-reizen/.',
    control: html`<input id="${prefix}-slug" name="slug" type="text" value="${placement.slug}" maxlength="${MAX_SLUG_LENGTH}" pattern="[a-z0-9]+(-[a-z0-9]+)*"${invalidAttributes(`${prefix}-slug`, errors.slug)}>`,
  })}`;
}

/**
 * Het tabblad *Inhoud* van een pagina: titel, bovenkop, inleiding, vindbaarheid en de kopfoto.
 * @param {{page: object, pageUrl: string, hiddenFields: object, values: object, errors: object, imageUrl: string}} panel
 *   Pagina, adres van het bewerkscherm, verborgen velden, ingevulde waarden, fouten en de huidige kopfoto.
 * @returns {object} HTML.
 */
function renderPageContentPanel({ page, pageUrl, hiddenFields, values, errors, imageUrl }) {
  const isHomepage = page.path === '/';
  const field = (name, label, control, help) => fieldRow({ id: `pagina-${name}`, label, control, help, error: errors[name] });
  return html`<section class="crm-block" id="gegevens">
          <h2>Gegevens</h2>
          <form class="form crm-narrow" method="post" action="${pageUrl}gegevens/">
            ${hiddenFields}
            ${isHomepage ? html`<p class="field__help">Op de homepage staan titel, bovenkop, inleiding en kopfoto niet in beeld; de titel is alleen de naam in deze lijst. De hoofdkop (h1) is de titel van het blok "Over Avanta met stempel".</p>` : ''}
            ${field('title', 'Titel', html`<input id="pagina-title" name="title" type="text" value="${values.title}" maxlength="${PAGE_LIMITS.title}" required${invalidAttributes('pagina-title', errors.title)}>`)}
            ${field('pretitle', 'Bovenkop (kleine tekst boven de titel)', html`<input id="pagina-pretitle" name="pretitle" type="text" value="${values.pretitle}" maxlength="${PAGE_LIMITS.pretitle}"${invalidAttributes('pagina-pretitle', errors.pretitle)}>`)}
            ${field('intro', 'Inleiding (grote tekst bovenaan)', html`<textarea id="pagina-intro" name="intro" rows="4" maxlength="${PAGE_LIMITS.intro}"${invalidAttributes('pagina-intro', errors.intro)}>${values.intro}</textarea>`)}
            <details class="cms-style"${errors.seo_title || errors.seo_description || values.seoTitle || values.seoDescription ? raw(' open') : ''}><summary>Vindbaarheid (zoekmachines)</summary>
              ${field('seo_title', 'Titel voor zoekmachines', html`<input id="pagina-seo_title" name="seo_title" type="text" value="${values.seoTitle}" maxlength="${PAGE_LIMITS.seoTitle}"${invalidAttributes('pagina-seo_title', errors.seo_title)}>`, `Leeg = de titel van de pagina. Hoogstens ${PAGE_LIMITS.seoTitle} tekens; de naam van de site komt er vanzelf achter.`)}
              ${field('seo_description', 'Omschrijving voor zoekmachines', html`<textarea id="pagina-seo_description" name="seo_description" rows="3" maxlength="${PAGE_LIMITS.seoDescription}"${invalidAttributes('pagina-seo_description', errors.seo_description)}>${values.seoDescription}</textarea>`, `Leeg = de inleiding. Ongeveer 150 tekens werkt het best (hoogstens ${PAGE_LIMITS.seoDescription}).`)}
            </details>
            ${ui.renderSaveBar({ label: 'Opslaan in concept', note: 'Wijzigingen komen in het concept. Publiceren doe je bovenaan.' })}
          </form>
        </section>

        <section class="crm-block" id="kopfoto">
          <h2>Kopfoto</h2>
          ${imageUrl ? html`<img class="media-preview media-preview--small" src="${imageUrl}" alt="" width="400" height="300">` : html`<p>Geen kopfoto: de kop van de pagina is dan een effen vlak.</p>`}
          <p><a class="btn btn--small btn--outline" href="${pageUrl}kopfoto/">${imageUrl ? 'Andere kopfoto kiezen' : 'Kopfoto kiezen'}</a></p>
        </section>`;
}

/**
 * Het tabblad *Adres en zichtbaarheid* van een pagina (op de homepage alleen *Zichtbaarheid*): adres wijzigen,
 * offline of online, en verwijderen als dat mag.
 * @param {{page: object, pageUrl: string, hiddenFields: object, parents: object[], placement: object, errors: object, canDelete: boolean}} panel
 *   Pagina, adres van het bewerkscherm, verborgen velden, mogelijke bovenliggende pagina's, het ingevulde adres,
 *   fouten en of verwijderen mag.
 * @returns {object} HTML.
 */
function renderPageAddressPanel({ page, pageUrl, hiddenFields, parents, placement, errors, canDelete }) {
  const isHomepage = page.path === '/';
  return html`<section class="crm-block" id="adres">
          <h2>${isHomepage ? 'Zichtbaarheid' : 'Adres en zichtbaarheid'}</h2>
          ${isHomepage ? html`<p class="field__help">Staat de homepage offline (of is hij nog nooit gepubliceerd), dan toont de site de vaste homepage met de standaardteksten en foto's van reizen.</p>` : html`<form class="form crm-narrow" method="post" action="${pageUrl}adres/">
            ${hiddenFields}
            ${renderPlacementFields(parents, placement, errors, 'adres')}
            <p class="field__help">Wijzig je het adres, dan verwijst het oude adres automatisch door (ook voor de pagina's eronder) en gaan menu-items mee.</p>
            <div><button class="btn btn--small btn--outline" type="submit">Adres wijzigen</button></div>
          </form>`}
          ${renderVisibilityActions({ item: page, url: pageUrl, hiddenFields: hiddenFields, canDelete, deleteLabel: 'deze pagina' })}
          ${!page.published && page.legacy_id !== null ? html`<p class="field__help">Een pagina van de oude site kun je alleen offline halen (bij een nieuwe import zou hij anders terugkomen).</p>` : ''}
        </section>`;
}

/**
 * Maakt de routes voor pagina's.
 * @param {{db: object, auth: object, library?: object, mediaDir?: string, redirects?: object, menus?: object}} options
 *   Database, sessie- en rechtenlaag, de fotobibliotheek en doorverwijzingen en menu's (opnieuw laden na verplaatsen).
 * @returns {express.Router} Router.
 */
function createPageRoutes(options) {
  const { db, auth } = options;
  const pages = createPages({ db });
  const content = createContent(db);
  const library = options.library || createMediaLibrary({ db, mediaDir: options.mediaDir || '' });
  const router = express.Router();
  const guard = auth.requireRight('content');

  /**
   * Het uitgelichte blogbericht (voor het blogblok van de homepage in het voorbeeld).
   * @returns {string} Slug, of leeg.
   */
  const featuredSlug = async () => (await content.blogHighlights()).featuredSlug || '';

  /**
   * 404-pagina binnen het CRM.
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @returns {void}
   */
  const notFound = (req, res) => {
    res.status(404).send(renderCrmPage({
      title: 'Niet gevonden', user: req.user, csrf: req.session.csrf, path: BASE, body: html`<p>Deze pagina of dit blok bestaat niet. <a href="${BASE}">Naar pagina's</a></p>`,
    }));
  };

  /**
   * Audit voor een actie op een pagina.
   * @param {object} req Express-verzoek.
   * @param {string} action Actie.
   * @returns {Function} `(client) => Promise`.
   */
  const auditFor = (req, action) => (client) => auth.audit(req, { userId: req.user.id, action, entity: 'pages', entityId: req.params.id }, client);

  /**
   * Context voor een wijziging van het concept.
   * @param {object} req Express-verzoek.
   * @param {string} [action] Actie in de auditlog.
   * @returns {{userId: number, audit: Function}} Context.
   */
  const contextFor = (req, action = 'pagina.concept') => ({ userId: req.user.id, audit: auditFor(req, action) });

  /**
   * Verborgen velden van elk formulier op het bewerkscherm.
   * @param {object} req Express-verzoek.
   * @param {object} page Pagina.
   * @returns {object} HTML.
   */
  const hidden = (req, page) => html`<input type="hidden" name="_csrf" value="${req.session.csrf}"><input type="hidden" name="versie" value="${page.draft_version}">`;

  router.get('/paginas/', guard, async (req, res, next) => {
    try {
      const { text, patterns } = searchPatterns(req.query.q);
      const rows = await pages.list({ patterns });
      return res.send(renderCrmPage({
        title: 'Pagina\'s',
        user: req.user,
        csrf: req.session.csrf,
        path: BASE,
        body: html`${LIST_NOTICES[req.query.melding] ? html`<p class="notice" role="status">${LIST_NOTICES[req.query.melding]}</p>` : ''}
          <div class="crm-actions"><a class="btn btn--small" href="${BASE}nieuw/">Nieuwe pagina</a>
            ${rows.some((row) => row.path === '/') ? '' : html`<form method="post" action="${BASE}homepage/"><input type="hidden" name="_csrf" value="${req.session.csrf}"><button class="btn btn--small btn--outline" type="submit">Homepage als blokpagina opzetten</button></form>`}</div>
          <form class="crm-search" method="get" action="${BASE}" role="search">
            <label for="pagina-q">Zoek op titel of adres</label>
            <input id="pagina-q" name="q" type="search" value="${text}" maxlength="100">
            <button class="btn btn--small" type="submit">Zoeken</button>
          </form>
          ${rows.length ? html`<div class="crm-table-wrap"><table class="crm-table">
            <thead><tr><th>Titel</th><th>Adres</th><th>Status</th><th>Versies</th><th>Laatst gewijzigd</th></tr></thead>
            <tbody>${rows.map((row) => html`<tr>
              <td><a href="${BASE}${row.id}/">${row.title}</a></td>
              <td><code>${row.path}</code></td>
              <td>${row.published ? 'Online' : 'Offline'}${row.has_draft ? html` · <strong>concept</strong>` : ''}</td>
              <td>${String(row.revision_count)}</td>
              <td>${formatDateTime(row.updated_at)}</td>
            </tr>`)}</tbody>
          </table></div>` : html`<p>${text ? 'Geen pagina\'s gevonden.' : 'Er zijn nog geen pagina\'s.'}</p>`}`,
      }));
    } catch (error) {
      return next(error);
    }
  });

  /**
   * Het bewerkscherm van een pagina.
   * @param {object} req Express-verzoek.
   * @param {object} page Pagina uit `pages.get`.
   * @param {{notice?: string, error?: string, values?: object, errors?: object, blockErrors?: {id: string, block: object, errors: object}}} [state]
   *   Meldingen, ingevulde gegevens met fouten, of een blok met fouten.
   * @returns {Promise<string>} HTML.
   */
  const renderEditor = async (req, page, state = {}) => {
    const current = editableState(page);
    const [revisionRows, options, parents] = await Promise.all([pages.revisions(page.id), pages.sourceOptions(), pages.parentOptions(page.path)]);
    const segments = page.path.split('/').filter(Boolean);
    const placement = state.placement || { slug: segments[segments.length - 1] || '', parentPath: segments.length > 1 ? `/${segments.slice(0, -1).join('/')}/` : '/' };
    const canDelete = !page.published && page.legacy_id === null;
    const pageUrl = `${BASE}${page.id}/`;
    const values = state.values || current;
    const errors = state.errors || {};
    const openBlock = state.blockErrors ? state.blockErrors.id : (typeof req.query.blok === 'string' ? req.query.blok : '');
    const isHomepage = page.path === '/';
    const option = ([type, definition]) => html`<option value="${type}">${definition.label}</option>`;
    const entries = Object.entries(BLOCK_TYPES);
    // Homepage-secties alleen op de homepage, daar in een eigen groep bovenaan.
    const typeOptions = isHomepage
      ? html`<optgroup label="Homepage-secties">${entries.filter(([, definition]) => definition.homeOnly).map(option)}</optgroup><optgroup label="Overige blokken">${entries.filter(([, definition]) => !definition.homeOnly).map(option)}</optgroup>`
      : entries.filter(([, definition]) => !definition.homeOnly).map(option);
    return renderCrmPage({
      title: current.title,
      user: req.user,
      csrf: req.session.csrf,
      path: BASE,
      actions: ui.renderActions([{ label: `Voorbeeld van ${page.draft ? 'het concept' : 'de pagina'}`, href: `${pageUrl}voorbeeld/` }, { label: 'Bekijk op de site', href: page.path }]),
      body: html`${state.notice ? html`<p class="notice" role="status">${state.notice}</p>` : ''}
        ${renderAlert(state.error)}
        ${renderDraftStatus({
          item: page,
          url: pageUrl,
          hiddenFields: hidden(req, page),
          draftNote: '',
          publishedText: 'staat op de site',
          facts: [
            ['Adres', html`<code>${page.path}</code>`],
            ['Op de site', page.published ? 'online' : 'offline'],
            ['Laatst gewijzigd', html`${formatDateTime(page.updated_at)}${page.updated_by_name ? html` door ${page.updated_by_name}` : ''}`],
          ],
        })}

        <div class="crm-tabbed" data-tabs>
          ${ui.renderTabNav([{ key: 'inhoud', label: 'Inhoud' }, { key: 'blokken', label: 'Blokken' }, { key: 'instellingen', label: isHomepage ? 'Zichtbaarheid' : 'Adres en zichtbaarheid' }, { key: 'versies', label: 'Versies', count: revisionRows.length }])}
          ${ui.renderTabPanel('inhoud', renderPageContentPanel({ page, pageUrl, hiddenFields: hidden(req, page), values, errors, imageUrl: current.imageUrl }))}
          ${ui.renderTabPanel('blokken', html`${editor.renderBlocksSection({ item: page, hidden: hidden(req, page), options, state, openBlock, typeOptions, homeTypes: isHomepage })}`)}
          ${ui.renderTabPanel('instellingen', renderPageAddressPanel({ page, pageUrl, hiddenFields: hidden(req, page), parents, placement, errors, canDelete }))}
          ${ui.renderTabPanel('versies', renderRevisions(revisionRows, pageUrl, hidden(req, page)))}
        </div>`,
    });
  };

  /**
   * Haalt de pagina uit de URL op, of stuurt een 404.
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @returns {Promise<(object|null)>} Pagina, of null als de 404 al verstuurd is.
   */
  const loadOr404 = async (req, res) => {
    const page = await pages.get(req.params.id);
    if (!page) notFound(req, res);
    return page;
  };

  /**
   * Verwerkt de uitkomst van een wijziging: doorsturen bij succes, anders het scherm met de melding.
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @param {object} outcome Uitkomst van `pages.*`.
   * @param {{notice: number, anchor?: string, onError?: (page: object) => Promise<string>}} next Melding en anker bij
   *   succes; eigen scherm bij een fout (standaard het bewerkscherm met de melding).
   * @returns {Promise<void>}
   */
  const finish = async (req, res, outcome, next) => {
    if (outcome.status === 'weg') return notFound(req, res);
    if (outcome.status === 'ok') {
      const query = new URLSearchParams({ opgeslagen: String(next.notice), ...(next.block ? { blok: next.block } : {}) });
      return res.redirect(303, `${BASE}${Number(req.params.id)}/?${query}${next.anchor ? `#${next.anchor}` : ''}`);
    }
    const page = await loadOr404(req, res);
    if (!page) return undefined;
    const messages = {
      verouderd: [409, STALE_MESSAGE],
      'geen-concept': [409, 'Er is geen concept (meer); misschien is het al gepubliceerd of weggegooid.'],
      'foto-weg': [409, 'Een foto in het concept bestaat niet meer in de fotobibliotheek. Kies een andere foto en publiceer opnieuw.'],
      'blok-weg': [404, 'Dit blok bestaat niet (meer) in het concept.'],
      'versie-weg': [404, 'Deze versie bestaat niet.'],
    };
    if (outcome.errors && next.onError) return res.status(422).send(await next.onError(page));
    const [status, message] = messages[outcome.status] || [422, outcome.message || 'Controleer de velden.'];
    return res.status(status).send(await renderEditor(req, page, { error: message }));
  };

  const editor = createBlockEditor({
    base: BASE,
    route: '/paginas/',
    guard,
    auth,
    library,
    store: pages,
    editableState,
    imageFromMedia,
    load: loadOr404,
    notFound,
    contextFor: (req) => contextFor(req),
    finish,
    renderEditor: (req, page, state) => renderEditor(req, page, state),
    allowType: (type, page) => (BLOCK_TYPES[type].homeOnly && page.path !== '/' ? 'Dit blok is alleen voor de homepage.' : ''),
  });
  editor.addRoutes(router);

  router.get(routePath('/paginas/:id(\\d{1,9})/'), guard, async (req, res, next) => {
    try {
      const page = await loadOr404(req, res);
      if (!page) return undefined;
      return res.send(await renderEditor(req, page, { notice: NOTICES[req.query.opgeslagen] || '' }));
    } catch (error) {
      return next(error);
    }
  });

  router.post(routePath('/paginas/:id(\\d{1,9})/gegevens/'), guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const { values, errors } = validatePageFields(req.body);
      if (Object.keys(errors).length) {
        const page = await loadOr404(req, res);
        if (!page) return undefined;
        return res.status(422).send(await renderEditor(req, page, { error: 'Controleer de velden.', values, errors }));
      }
      const outcome = await pages.changeDraft(req.params.id, req.body.versie, async (state) => {
        Object.assign(state, values);
      }, contextFor(req));
      return await finish(req, res, outcome, { notice: 1, anchor: 'gegevens' });
    } catch (error) {
      return next(error);
    }
  });

  router.get(routePath('/paginas/:id(\\d{1,9})/voorbeeld/'), guard, async (req, res, next) => {
    try {
      const page = await loadOr404(req, res);
      if (!page) return undefined;
      const current = editableState(page);
      const isHomepage = page.path === '/';
      const article = await renderPageArticle({ title: current.title, path: page.path, intro: current.intro, blocks: current.blocks }, content, { featuredSlug: await featuredSlug() });
      if (article.hasVideo) res.set('Content-Security-Policy', addCspSources(res.get('Content-Security-Policy'), { 'frame-src': [YOUTUBE_ORIGIN] }));
      const bar = html`<div class="cms-preview-bar" role="status">Voorbeeld van ${page.draft ? 'het concept' : 'de gepubliceerde pagina'}, niet zichtbaar voor bezoekers. <a href="${BASE}${page.id}/">Terug naar bewerken</a></div>`;
      return res.send(renderPage({
        title: `Voorbeeld: ${current.title}`,
        path: page.path,
        indexable: false,
        site: res.locals.site,
        bodyClass: isHomepage ? 'home' : '',
        header: isHomepage ? bar : html`${bar}${renderPageHeader({ title: current.title, pretitle: current.pretitle, imageUrl: current.imageUrl })}`,
        body: isHomepage ? article.body : html`<div class="content-main">${article.body}</div>`,
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.post(routePath('/paginas/:id(\\d{1,9})/publiceren/'), guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const outcome = await pages.publish(req.params.id, req.body.versie, contextFor(req, 'pagina.gepubliceerd'));
      return await finish(req, res, outcome, { notice: 2 });
    } catch (error) {
      return next(error);
    }
  });

  router.post(routePath('/paginas/:id(\\d{1,9})/concept-weggooien/'), guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const outcome = await pages.discardDraft(req.params.id, req.body.versie, contextFor(req, 'pagina.concept-weg'));
      return await finish(req, res, outcome, { notice: 3 });
    } catch (error) {
      return next(error);
    }
  });

  router.post(routePath('/paginas/:id(\\d{1,9})/versies/:version(\\d{1,9})/terugzetten/'), guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const outcome = await pages.restoreRevision(req.params.id, req.params.version, req.body.versie, contextFor(req, 'pagina.versie-terug'));
      return await finish(req, res, outcome, { notice: 4, anchor: 'blokken' });
    } catch (error) {
      return next(error);
    }
  });

  /**
   * Laadt doorverwijzingen en menu's opnieuw na een verplaatsing (een fout daarin breekt de actie niet af).
   * @returns {Promise<void>}
   */
  const reloadAfterMove = async () => {
    if (options.redirects) await options.redirects.reload().catch(() => {});
    if (options.menus) await options.menus.reload().catch(() => {});
  };

  /**
   * Het formulier voor een nieuwe pagina.
   * @param {object} req Express-verzoek.
   * @param {{title: string, slug: string, parentPath: string}} values Ingevulde waarden.
   * @param {object} [errors] Fouten.
   * @returns {Promise<string>} HTML.
   */
  const renderNewPage = async (req, values, errors = {}) => {
    const parents = await pages.parentOptions();
    return renderCrmPage({
      title: 'Nieuwe pagina',
      user: req.user,
      csrf: req.session.csrf,
      path: BASE,
      body: html`<p><a href="${BASE}">Naar pagina's</a></p>
        ${renderAlert(Object.keys(errors).length ? 'Controleer de velden.' : '')}
        <form class="form crm-narrow crm-block" method="post" action="${BASE}nieuw/">
          <input type="hidden" name="_csrf" value="${req.session.csrf}">
          ${fieldRow({ id: 'nieuw-title', label: 'Titel', error: errors.title, control: html`<input id="nieuw-title" name="title" type="text" value="${values.title}" maxlength="${PAGE_LIMITS.title}" required${invalidAttributes('nieuw-title', errors.title)}>` })}
          ${renderPlacementFields(parents, values, errors, 'nieuw')}
          <p class="field__help">Laat het adres leeg om het uit de titel te maken. De pagina staat offline tot je hem publiceert.</p>
          <div><button class="btn" type="submit">Pagina maken</button></div>
        </form>`,
    });
  };

  router.post('/paginas/homepage/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const outcome = await pages.createHomepage(normalizeHomepage(null), {
        userId: req.user.id,
        audit: (client, id) => auth.audit(req, { userId: req.user.id, action: 'pagina.nieuw', entity: 'pages', entityId: id }, client),
      });
      return res.redirect(303, `${BASE}${outcome.id}/${outcome.created ? '?opgeslagen=11' : ''}`);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/paginas/nieuw/', guard, async (req, res, next) => {
    try {
      return res.send(await renderNewPage(req, { title: '', slug: '', parentPath: '/' }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/paginas/nieuw/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const text = (name) => (typeof req.body[name] === 'string' ? req.body[name].trim() : '');
      const values = { title: text('title'), slug: text('slug') || slugify(text('title')), parentPath: text('parent') || '/' };
      const outcome = await pages.create(values, {
        userId: req.user.id,
        audit: (client, id) => auth.audit(req, { userId: req.user.id, action: 'pagina.nieuw', entity: 'pages', entityId: id }, client),
      });
      if (outcome.errors) return res.status(422).send(await renderNewPage(req, values, outcome.errors));
      return res.redirect(303, `${BASE}${outcome.id}/?opgeslagen=7`);
    } catch (error) {
      return next(error);
    }
  });

  router.post(routePath('/paginas/:id(\\d{1,9})/adres/'), guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const text = (name) => (typeof req.body[name] === 'string' ? req.body[name].trim() : '');
      const placement = { slug: text('slug'), parentPath: text('parent') || '/' };
      const outcome = await pages.move(req.params.id, placement, contextFor(req, 'pagina.verplaatst'));
      if (outcome.status === 'weg') return notFound(req, res);
      if (outcome.status === 'gelijk') return res.redirect(303, `${BASE}${Number(req.params.id)}/#adres`);
      if (outcome.status === 'fout') {
        const page = await loadOr404(req, res);
        if (!page) return undefined;
        return res.status(422).send(await renderEditor(req, page, { error: `Het adres is niet gewijzigd: ${Object.values(outcome.errors)[0]}`, errors: outcome.errors, placement }));
      }
      await reloadAfterMove();
      return res.redirect(303, `${BASE}${Number(req.params.id)}/?opgeslagen=8#adres`);
    } catch (error) {
      return next(error);
    }
  });

  router.post(routePath('/paginas/:id(\\d{1,9})/online/'), guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const online = req.body.stand === 'online';
      if (!online && req.body.stand !== 'offline') return await finish(req, res, { status: 'fout', message: 'Onbekende actie.' }, { notice: 1 });
      const outcome = await pages.setOnline(req.params.id, online, contextFor(req, online ? 'pagina.online' : 'pagina.offline'));
      if (outcome.status === 'nooit-gepubliceerd') {
        return await finish(req, res, { status: 'fout', message: 'Deze pagina is nog nooit gepubliceerd; gebruik Publiceren om hem online te zetten.' }, { notice: 1 });
      }
      return await finish(req, res, outcome, { notice: online ? 10 : 9, anchor: 'adres' });
    } catch (error) {
      return next(error);
    }
  });

  router.post(routePath('/paginas/:id(\\d{1,9})/verwijderen/'), guard, auth.checkCsrf, async (req, res, next) => {
    try {
      if (req.body.zeker !== 'ja') return await finish(req, res, { status: 'fout', message: 'Vink aan dat je de pagina wilt verwijderen.' }, { notice: 1 });
      const outcome = await pages.remove(req.params.id, { audit: auditFor(req, 'pagina.verwijderd') });
      const messages = {
        online: 'Haal de pagina eerst offline.',
        import: 'Een pagina van de oude site kun je alleen offline halen.',
        onderliggend: 'Er staan nog pagina\'s onder deze pagina; verplaats of verwijder die eerst.',
        'in-menu': 'Deze pagina staat nog in een menu; haal hem eerst uit het menu (Menu\'s).',
      };
      if (messages[outcome.status]) return await finish(req, res, { status: 'fout', message: messages[outcome.status] }, { notice: 1 });
      if (outcome.status === 'weg') return notFound(req, res);
      return res.redirect(303, `${BASE}?melding=1`);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createPageRoutes, PAGE_ACTION_LABELS, BASE, BLOCK_ID_PATTERN };
