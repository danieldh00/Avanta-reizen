/**
 * Blogberichten beheren in het CRM (`/app/blog/`, recht `content`, CMS-pakket I1): lijst met zoeken en filter op status,
 * nieuw bericht, adres wijzigen (met 301), offline/online, verwijderen, en een bericht bewerken als concept (titel,
 * publicatiedatum, inleiding, samenvatting, SEO-velden, uitgelichte afbeelding en blokken uit de blokeditor van de
 * pagina's), een voorbeeld in de opmaak van de site, publiceren of inplannen, concept weggooien en eerdere versies
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
const { YOUTUBE_ORIGIN } = require('../site/homepage');
const { searchPatterns } = require('../persons/person-routes');
const { createMediaLibrary } = require('../media/library');
const { BLOCK_TYPES } = require('./blocks');
const { createBlockEditor, fieldRow, invalidAttributes, renderDraftStatus, renderRevisions, renderVisibilityActions } = require('./block-editor');
const { imageFromMedia } = require('./pages');
const { createPostTerms, TERM_KINDS } = require('./post-terms');
const { createPosts, validatePostFields, editablePostState, postStatus, toLocalDateTime, fromLocalDateTime, POST_LIMITS } = require('./posts');
const { slugify, MAX_SLUG_LENGTH } = require('../trips/slugs');
const { renderPageArticle } = require('./page-render');
const { createContent } = require('../site/content');

/** Basispad van het scherm. */
const BASE = '/app/blog/';

/** Acties voor het auditlog (zie `ACTION_LABELS` in `crm/users.js`). */
const POST_ACTION_LABELS = {
  'blog.concept': 'Concept van een blogbericht gewijzigd',
  'blog.gepubliceerd': 'Blogbericht gepubliceerd of ingepland',
  'blog.concept-weg': 'Concept van een blogbericht weggegooid',
  'blog.versie-terug': 'Eerdere versie van een blogbericht teruggezet als concept',
  'blog.nieuw': 'Nieuw blogbericht gemaakt',
  'blog.adres': 'Adres van een blogbericht gewijzigd',
  'blog.offline': 'Blogbericht offline gehaald',
  'blog.online': 'Blogbericht weer online gezet',
  'blog.verwijderd': 'Blogbericht verwijderd',
};

/** Meldingen na een geslaagde actie (`?opgeslagen=<n>`). */
const NOTICES = {
  1: 'Opgeslagen in het concept. Bekijk het voorbeeld en publiceer als het klaar is.',
  2: 'Gepubliceerd. Het bericht staat zo op de site.',
  3: 'Het concept is weggegooid; je ziet weer het gepubliceerde bericht.',
  4: 'De versie staat klaar als concept. Publiceer om hem terug op de site te zetten.',
  5: 'Blok toegevoegd aan het concept.',
  6: 'Blok verwijderd uit het concept.',
  7: 'Het bericht is gemaakt en staat offline. Voeg blokken toe en publiceer om het online te zetten.',
  8: 'Het adres is gewijzigd. Het oude adres verwijst automatisch door en het menu is bijgewerkt.',
  9: 'Het bericht staat offline; bezoekers krijgen een 404.',
  10: 'Het bericht staat weer online.',
  12: 'Ingepland. Het bericht verschijnt vanzelf op de site op de publicatiedatum.',
  13: 'Categorieën, tags en uitgelicht zijn opgeslagen (meteen op de site).',
};

/** Meldingen op de lijst (`?melding=<n>`). */
const LIST_NOTICES = { 1: 'Het bericht is verwijderd.' };

/** Keuzes van het statusfilter op de lijst. */
const STATUS_FILTERS = { '': 'Alle', online: 'Online', ingepland: 'Ingepland', offline: 'Offline', concept: 'Met concept' };

/** Naam van een status. */
const STATUS_LABELS = { online: 'Online', ingepland: 'Ingepland', offline: 'Offline' };

/** Melding als het formulier van een oudere stand van het concept uitging. */
const STALE_MESSAGE = 'Het bericht is intussen gewijzigd (in een ander tabblad of door een collega). Je wijziging is niet opgeslagen; bekijk de nieuwe stand en probeer het opnieuw.';

/**
 * Het tabblad *Inhoud* van een bericht: titel, publicatiedatum, inleiding, samenvatting, vindbaarheid en de
 * uitgelichte afbeelding.
 * @param {{postUrl: string, hiddenFields: object, values: object, errors: object, imageUrl: string}} panel Adres van het
 *   bewerkscherm, verborgen velden, ingevulde waarden, fouten en de huidige afbeelding.
 * @returns {object} HTML.
 */
function renderPostContentPanel({ postUrl, hiddenFields, values, errors, imageUrl }) {
  const field = (name, label, control, help) => fieldRow({ id: `blog-${name}`, label, control, help, error: errors[name] });
  return html`<section class="crm-block" id="gegevens">
          <h2>Gegevens</h2>
          <form class="form crm-narrow" method="post" action="${postUrl}gegevens/">
            ${hiddenFields}
            ${field('title', 'Titel', html`<input id="blog-title" name="title" type="text" value="${values.title}" maxlength="${POST_LIMITS.title}" required${invalidAttributes('blog-title', errors.title)}>`)}
            ${field('post_date', 'Publicatiedatum', html`<input id="blog-post_date" name="post_date" type="datetime-local" value="${values.postDate}"${invalidAttributes('blog-post_date', errors.post_date)}>`, 'Tijd in Nederland. Leeg = het moment van publiceren. Een datum in de toekomst plant het bericht in: het verschijnt dan vanzelf.')}
            ${field('intro', 'Inleiding (grote tekst bovenaan)', html`<textarea id="blog-intro" name="intro" rows="4" maxlength="${POST_LIMITS.intro}"${invalidAttributes('blog-intro', errors.intro)}>${values.intro}</textarea>`)}
            ${field('excerpt', 'Samenvatting (in de lijst van het blog)', html`<textarea id="blog-excerpt" name="excerpt" rows="3" maxlength="${POST_LIMITS.excerpt}"${invalidAttributes('blog-excerpt', errors.excerpt)}>${values.excerpt}</textarea>`, 'Leeg = bij publiceren het begin van de tekst.')}
            <details class="cms-style"${errors.seo_title || errors.seo_description || values.seoTitle || values.seoDescription ? raw(' open') : ''}><summary>Vindbaarheid (zoekmachines)</summary>
              ${field('seo_title', 'Titel voor zoekmachines', html`<input id="blog-seo_title" name="seo_title" type="text" value="${values.seoTitle}" maxlength="${POST_LIMITS.seoTitle}"${invalidAttributes('blog-seo_title', errors.seo_title)}>`, `Leeg = de titel van het bericht. Hoogstens ${POST_LIMITS.seoTitle} tekens; de naam van de site komt er vanzelf achter.`)}
              ${field('seo_description', 'Omschrijving voor zoekmachines', html`<textarea id="blog-seo_description" name="seo_description" rows="3" maxlength="${POST_LIMITS.seoDescription}"${invalidAttributes('blog-seo_description', errors.seo_description)}>${values.seoDescription}</textarea>`, `Leeg = de samenvatting. Ongeveer 150 tekens werkt het best (hoogstens ${POST_LIMITS.seoDescription}).`)}
            </details>
            ${ui.renderSaveBar({ label: 'Opslaan in concept', note: 'Wijzigingen komen in het concept. Publiceren doe je bovenaan.' })}
          </form>
        </section>

        <section class="crm-block" id="kopfoto">
          <h2>Uitgelichte afbeelding</h2>
          ${imageUrl ? html`<img class="media-preview media-preview--small" src="${imageUrl}" alt="" width="400" height="300">` : html`<p>Geen uitgelichte afbeelding: in de lijst van het blog en bovenaan het bericht staat dan een effen vlak.</p>`}
          <p><a class="btn btn--small btn--outline" href="${postUrl}kopfoto/">${imageUrl ? 'Andere afbeelding kiezen' : 'Afbeelding kiezen'}</a></p>
        </section>`;
}

/**
 * Het tabblad *Categorieën en tags* van een bericht, met het vinkje Uitgelicht (wordt meteen opgeslagen).
 * @param {{post: object, postUrl: string, csrf: string, termRows: object[], chosenTerms: number[]}} panel Bericht, adres van
 *   het bewerkscherm, CSRF-token, alle categorieën en tags en de gekozen id's.
 * @returns {object} HTML.
 */
function renderPostTermsPanel({ post, postUrl, csrf, termRows, chosenTerms }) {
  return html`<section class="crm-block" id="indeling">
          <h2>Categorieën, tags en uitgelicht</h2>
          <form class="form" method="post" action="${postUrl}indeling/">
            <input type="hidden" name="_csrf" value="${csrf}">
            ${Object.entries(TERM_KINDS).map(([kind, definition]) => {
              const own = termRows.filter((row) => row.kind === kind);
              return html`<fieldset class="cms-repeat"><legend>${definition.plural}</legend>
                ${own.length ? own.map((row) => html`<label class="checkbox"><input type="checkbox" name="term" value="${row.id}"${chosenTerms.includes(row.id) ? raw(' checked') : ''}> ${row.name}</label>`) : html`<p>Nog geen ${definition.plural.toLowerCase()}.</p>`}
              </fieldset>`;
            })}
            <label class="checkbox"><input type="checkbox" name="uitgelicht" value="ja"${post.featured ? raw(' checked') : ''}> Uitgelicht bericht (groot op het blog en de homepage; een ander uitgelicht bericht wordt dan gewoon)</label>
            <p class="field__help">Dit wordt meteen opgeslagen, zonder concept. <a href="${BASE}categorieen-en-tags/">Categorieën en tags beheren</a></p>
            <div><button class="btn btn--small" type="submit">Opslaan</button></div>
          </form>
        </section>`;
}

/**
 * Maakt de routes voor blogberichten.
 * @param {{db: object, auth: object, library?: object, mediaDir?: string, redirects?: object, menus?: object}} options
 *   Database, sessie- en rechtenlaag, de fotobibliotheek en doorverwijzingen en menu's (opnieuw laden na een nieuw adres).
 * @returns {express.Router} Router.
 */
function createPostRoutes(options) {
  const { db, auth } = options;
  const posts = createPosts({ db });
  const terms = createPostTerms({ db });
  const content = createContent(db);
  const library = options.library || createMediaLibrary({ db, mediaDir: options.mediaDir || '' });
  const router = express.Router();
  const guard = auth.requireRight('content');

  /**
   * 404-pagina binnen het CRM.
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @returns {void}
   */
  const notFound = (req, res) => {
    res.status(404).send(renderCrmPage({
      title: 'Niet gevonden', user: req.user, csrf: req.session.csrf, path: BASE, body: html`<p>Dit bericht of dit blok bestaat niet. <a href="${BASE}">Naar het blog</a></p>`,
    }));
  };

  /**
   * Audit voor een actie op een bericht.
   * @param {object} req Express-verzoek.
   * @param {string} action Actie.
   * @returns {Function} `(client) => Promise`.
   */
  const auditFor = (req, action) => (client) => auth.audit(req, { userId: req.user.id, action, entity: 'posts', entityId: req.params.id }, client);

  /**
   * Context voor een wijziging.
   * @param {object} req Express-verzoek.
   * @param {string} [action] Actie in de auditlog.
   * @returns {{userId: number, audit: Function}} Context.
   */
  const contextFor = (req, action = 'blog.concept') => ({ userId: req.user.id, audit: auditFor(req, action) });

  /**
   * Verborgen velden van elk formulier op het bewerkscherm.
   * @param {object} req Express-verzoek.
   * @param {object} post Bericht.
   * @returns {object} HTML.
   */
  const hidden = (req, post) => html`<input type="hidden" name="_csrf" value="${req.session.csrf}"><input type="hidden" name="versie" value="${post.draft_version}">`;

  router.get('/blog/', guard, async (req, res, next) => {
    try {
      const { text, patterns } = searchPatterns(req.query.q);
      const status = typeof req.query.status === 'string' && Object.hasOwn(STATUS_FILTERS, req.query.status) ? req.query.status : '';
      const rows = await posts.list({ patterns, status });
      return res.send(renderCrmPage({
        title: 'Blog',
        user: req.user,
        csrf: req.session.csrf,
        path: BASE,
        body: html`${LIST_NOTICES[req.query.melding] ? html`<p class="notice" role="status">${LIST_NOTICES[req.query.melding]}</p>` : ''}
          <div class="crm-actions"><a class="btn btn--small" href="${BASE}nieuw/">Nieuw bericht</a> <a class="btn btn--small btn--outline" href="${BASE}categorieen-en-tags/">Categorieën en tags</a></div>
          <form class="crm-search" method="get" action="${BASE}" role="search">
            <label for="blog-q">Zoek op titel of adres</label>
            <input id="blog-q" name="q" type="search" value="${text}" maxlength="100">
            <label for="blog-status">Status</label>
            <select id="blog-status" name="status">${Object.entries(STATUS_FILTERS).map(([key, label]) => html`<option value="${key}"${key === status ? raw(' selected') : ''}>${label}</option>`)}</select>
            <button class="btn btn--small" type="submit">Zoeken</button>
          </form>
          ${rows.length ? html`<div class="crm-table-wrap"><table class="crm-table">
            <thead><tr><th>Titel</th><th>Publicatiedatum</th><th>Status</th><th>Versies</th><th>Laatst gewijzigd</th></tr></thead>
            <tbody>${rows.map((row) => html`<tr>
              <td><a href="${BASE}${row.id}/">${row.title}</a><br><code>/${row.slug}/</code></td>
              <td>${row.published_at ? formatDateTime(row.published_at) : '–'}</td>
              <td>${STATUS_LABELS[postStatus(row)]}${row.has_draft ? html` · <strong>concept</strong>` : ''}</td>
              <td>${String(row.revision_count)}</td>
              <td>${formatDateTime(row.updated_at)}</td>
            </tr>`)}</tbody>
          </table></div>` : html`<p>${text || status ? 'Geen berichten gevonden.' : 'Er zijn nog geen berichten.'}</p>`}`,
      }));
    } catch (error) {
      return next(error);
    }
  });

  /**
   * Het bewerkscherm van een bericht.
   * @param {object} req Express-verzoek.
   * @param {object} post Bericht uit `posts.get`.
   * @param {{notice?: string, error?: string, values?: object, errors?: object, slug?: string, blockErrors?: object}} [state]
   *   Meldingen, ingevulde gegevens met fouten, een ingevuld adres of een blok met fouten.
   * @returns {Promise<string>} HTML.
   */
  const renderEditor = async (req, post, state = {}) => {
    const current = editablePostState(post);
    const [revisionRows, options, termRows, chosenTerms] = await Promise.all([posts.revisions(post.id), sourceOptions(), terms.list(), terms.termIdsOfPost(post.id)]);
    const status = postStatus(post);
    const canDelete = !post.published && post.legacy_id === null;
    const postUrl = `${BASE}${post.id}/`;
    const values = state.values || current;
    const errors = state.errors || {};
    const openBlock = state.blockErrors ? state.blockErrors.id : (typeof req.query.blok === 'string' ? req.query.blok : '');
    const typeOptions = Object.entries(BLOCK_TYPES).filter(([, definition]) => !definition.homeOnly).map(([type, definition]) => html`<option value="${type}">${definition.label}</option>`);
    return renderCrmPage({
      title: current.title,
      user: req.user,
      csrf: req.session.csrf,
      path: BASE,
      actions: ui.renderActions([{ label: `Voorbeeld van ${post.draft ? 'het concept' : 'het bericht'}`, href: `${postUrl}voorbeeld/` }, status === 'online' ? { label: 'Bekijk op de site', href: `/${post.slug}/` } : null]),
      body: html`${state.notice ? html`<p class="notice" role="status">${state.notice}</p>` : ''}
        ${renderAlert(state.error)}
        ${renderDraftStatus({
          item: post,
          url: postUrl,
          hiddenFields: hidden(req, post),
          draftNote: current.postDate && current.postDate > toLocalDateTime(new Date()) ? ' De publicatiedatum ligt in de toekomst: publiceren plant het bericht in.' : '',
          publishedText: 'is gepubliceerd',
          facts: [
            ['Adres', html`<code>/${post.slug}/</code>`],
            ['Op de site', status === 'ingepland' ? html`ingepland voor ${formatDateTime(post.published_at)}` : status],
            ['Laatst gewijzigd', html`${formatDateTime(post.updated_at)}${post.updated_by_name ? html` door ${post.updated_by_name}` : ''}`],
          ],
        })}

        <div class="crm-tabbed" data-tabs>
          ${ui.renderTabNav([{ key: 'inhoud', label: 'Inhoud' }, { key: 'blokken', label: 'Blokken' }, { key: 'indeling', label: 'Categorieën en tags' }, { key: 'instellingen', label: 'Adres en zichtbaarheid' }, { key: 'versies', label: 'Versies', count: revisionRows.length }])}
          ${ui.renderTabPanel('inhoud', renderPostContentPanel({ postUrl, hiddenFields: hidden(req, post), values, errors, imageUrl: current.imageUrl }))}
          ${ui.renderTabPanel('blokken', html`${editor.renderBlocksSection({ item: post, hidden: hidden(req, post), options, state, openBlock, typeOptions })}`)}
          ${ui.renderTabPanel('indeling', renderPostTermsPanel({ post, postUrl, csrf: req.session.csrf, termRows, chosenTerms }))}
          ${ui.renderTabPanel('instellingen', html`<section class="crm-block" id="adres">
          <h2>Adres en zichtbaarheid</h2>
          <form class="form crm-narrow" method="post" action="${postUrl}adres/">
            ${hidden(req, post)}
            ${fieldRow({
              id: 'adres-slug',
              label: 'Adres',
              error: errors.slug,
              help: 'Kleine letters, cijfers en streepjes, bijv. mijn-reisverslag. Het adres wordt dan /mijn-reisverslag/. Het oude adres verwijst automatisch door.',
              control: html`<input id="adres-slug" name="slug" type="text" value="${state.slug === undefined ? post.slug : state.slug}" maxlength="${MAX_SLUG_LENGTH}" pattern="[a-z0-9]+(-[a-z0-9]+)*" required${invalidAttributes('adres-slug', errors.slug)}>`,
            })}
            <div><button class="btn btn--small btn--outline" type="submit">Adres wijzigen</button></div>
          </form>
          ${renderVisibilityActions({ item: post, url: postUrl, hiddenFields: hidden(req, post), canDelete, deleteLabel: 'dit bericht' })}
          ${!post.published && post.legacy_id !== null ? html`<p class="field__help">Een bericht van de oude site kun je alleen offline halen (bij een nieuwe import zou het anders terugkomen).</p>` : ''}
        </section>`)}
          ${ui.renderTabPanel('versies', renderRevisions(revisionRows, postUrl, hidden(req, post)))}
        </div>`,
    });
  };

  /**
   * De keuzes voor velden met een bron in het bewerkscherm (reistypes, landen, FAQ-categorieën), zoals bij pagina's.
   * @returns {Promise<{types: string[][], countries: string[][], faq: string[][]}>} Paren `[waarde, naam]`.
   */
  const sourceOptions = async () => {
    const [categories, faqs] = await Promise.all([
      db.query("SELECT slug, name, kind FROM trip_categories WHERE kind IN ('type', 'bestemming') ORDER BY kind, sort_order, name"),
      db.query('SELECT DISTINCT category FROM faqs WHERE category <> $1 ORDER BY category', ['']),
    ]);
    return {
      types: categories.filter((row) => row.kind === 'type').map((row) => [row.slug, row.name]),
      countries: categories.filter((row) => row.kind === 'bestemming').map((row) => [row.slug, row.name]),
      faq: faqs.map((row) => [row.category, row.category]),
    };
  };

  /**
   * Haalt het bericht uit de URL op, of stuurt een 404.
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @returns {Promise<(object|null)>} Bericht, of null als de 404 al verstuurd is.
   */
  const loadOr404 = async (req, res) => {
    const post = await posts.get(req.params.id);
    if (!post) notFound(req, res);
    return post;
  };

  /**
   * Verwerkt de uitkomst van een wijziging: doorsturen bij succes, anders het scherm met de melding.
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @param {object} outcome Uitkomst van `posts.*`.
   * @param {{notice: number, anchor?: string, block?: string, onError?: (post: object) => Promise<string>}} next Melding en
   *   anker bij succes; eigen scherm bij een fout (standaard het bewerkscherm met de melding).
   * @returns {Promise<void>}
   */
  const finish = async (req, res, outcome, next) => {
    if (outcome.status === 'weg') return notFound(req, res);
    if (outcome.status === 'ok') {
      const query = new URLSearchParams({ opgeslagen: String(next.notice), ...(next.block ? { blok: next.block } : {}) });
      return res.redirect(303, `${BASE}${Number(req.params.id)}/?${query}${next.anchor ? `#${next.anchor}` : ''}`);
    }
    const post = await loadOr404(req, res);
    if (!post) return undefined;
    const messages = {
      verouderd: [409, STALE_MESSAGE],
      'geen-concept': [409, 'Er is geen concept (meer); misschien is het al gepubliceerd of weggegooid.'],
      'foto-weg': [409, 'Een foto in het concept bestaat niet meer in de fotobibliotheek. Kies een andere foto en publiceer opnieuw.'],
      'blok-weg': [404, 'Dit blok bestaat niet (meer) in het concept.'],
      'versie-weg': [404, 'Deze versie bestaat niet.'],
    };
    if (outcome.errors && next.onError) return res.status(422).send(await next.onError(post));
    const [status, message] = messages[outcome.status] || [422, outcome.message || 'Controleer de velden.'];
    return res.status(status).send(await renderEditor(req, post, { error: message }));
  };

  const editor = createBlockEditor({
    base: BASE,
    route: '/blog/',
    guard,
    auth,
    library,
    store: posts,
    editableState: editablePostState,
    imageFromMedia,
    load: loadOr404,
    notFound,
    contextFor: (req) => contextFor(req),
    finish,
    renderEditor: (req, post, state) => renderEditor(req, post, state),
    allowType: (type) => (BLOCK_TYPES[type].homeOnly ? 'Dit blok is alleen voor de homepage.' : ''),
    coverLabel: 'Uitgelichte afbeelding',
  });
  editor.addRoutes(router);

  router.get(routePath('/blog/:id(\\d{1,9})/'), guard, async (req, res, next) => {
    try {
      const post = await loadOr404(req, res);
      if (!post) return undefined;
      return res.send(await renderEditor(req, post, { notice: NOTICES[req.query.opgeslagen] || '' }));
    } catch (error) {
      return next(error);
    }
  });

  router.post(routePath('/blog/:id(\\d{1,9})/gegevens/'), guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const { values, errors } = validatePostFields(req.body);
      if (Object.keys(errors).length) {
        const post = await loadOr404(req, res);
        if (!post) return undefined;
        return res.status(422).send(await renderEditor(req, post, { error: 'Controleer de velden.', values: { ...values, postDate: typeof req.body.post_date === 'string' ? req.body.post_date.slice(0, 16) : '' }, errors }));
      }
      const outcome = await posts.changeDraft(req.params.id, req.body.versie, async (state) => {
        Object.assign(state, values);
      }, contextFor(req));
      return await finish(req, res, outcome, { notice: 1, anchor: 'gegevens' });
    } catch (error) {
      return next(error);
    }
  });

  router.post(routePath('/blog/:id(\\d{1,9})/indeling/'), guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const outcome = await terms.setPostTerms(req.params.id, { termIds: [].concat(req.body.term || []), featured: req.body.uitgelicht === 'ja' }, contextFor(req, 'blog.indeling'));
      if (outcome.status === 'weg') return notFound(req, res);
      if (outcome.status === 'fout') return await finish(req, res, outcome, { notice: 13 });
      return res.redirect(303, `${BASE}${Number(req.params.id)}/?opgeslagen=13#indeling`);
    } catch (error) {
      return next(error);
    }
  });

  router.get(routePath('/blog/:id(\\d{1,9})/voorbeeld/'), guard, async (req, res, next) => {
    try {
      const post = await loadOr404(req, res);
      if (!post) return undefined;
      const current = editablePostState(post);
      const article = await renderPageArticle({ title: current.title, intro: current.intro, blocks: current.blocks }, content);
      if (article.hasVideo) res.set('Content-Security-Policy', addCspSources(res.get('Content-Security-Policy'), { 'frame-src': [YOUTUBE_ORIGIN] }));
      const bar = html`<div class="cms-preview-bar" role="status">Voorbeeld van ${post.draft ? 'het concept' : 'het gepubliceerde bericht'}, niet zichtbaar voor bezoekers. <a href="${BASE}${post.id}/">Terug naar bewerken</a></div>`;
      const date = fromLocalDateTime(current.postDate) || (post.published_at ? new Date(post.published_at) : new Date());
      return res.send(renderPage({
        title: `Voorbeeld: ${current.title}`,
        path: '/blog/',
        indexable: false,
        site: res.locals.site,
        header: html`${bar}${renderPageHeader({ title: current.title, date, imageUrl: current.imageUrl, backLink: '/blog/', single: true })}`,
        body: html`<article class="content-main">${article.body}</article>`,
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.post(routePath('/blog/:id(\\d{1,9})/publiceren/'), guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const outcome = await posts.publish(req.params.id, req.body.versie, contextFor(req, 'blog.gepubliceerd'));
      return await finish(req, res, outcome, { notice: outcome.scheduled ? 12 : 2 });
    } catch (error) {
      return next(error);
    }
  });

  router.post(routePath('/blog/:id(\\d{1,9})/concept-weggooien/'), guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const outcome = await posts.discardDraft(req.params.id, req.body.versie, contextFor(req, 'blog.concept-weg'));
      return await finish(req, res, outcome, { notice: 3 });
    } catch (error) {
      return next(error);
    }
  });

  router.post(routePath('/blog/:id(\\d{1,9})/versies/:version(\\d{1,9})/terugzetten/'), guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const outcome = await posts.restoreRevision(req.params.id, req.params.version, req.body.versie, contextFor(req, 'blog.versie-terug'));
      return await finish(req, res, outcome, { notice: 4, anchor: 'blokken' });
    } catch (error) {
      return next(error);
    }
  });

  /**
   * Het formulier voor een nieuw bericht.
   * @param {object} req Express-verzoek.
   * @param {{title: string, slug: string}} values Ingevulde waarden.
   * @param {object} [errors] Fouten.
   * @returns {string} HTML.
   */
  const renderNewPost = (req, values, errors = {}) => renderCrmPage({
    title: 'Nieuw bericht',
    user: req.user,
    csrf: req.session.csrf,
    path: BASE,
    body: html`<p><a href="${BASE}">Naar het blog</a></p>
      ${renderAlert(Object.keys(errors).length ? 'Controleer de velden.' : '')}
      <form class="form crm-narrow crm-block" method="post" action="${BASE}nieuw/">
        <input type="hidden" name="_csrf" value="${req.session.csrf}">
        ${fieldRow({ id: 'nieuw-title', label: 'Titel', error: errors.title, control: html`<input id="nieuw-title" name="title" type="text" value="${values.title}" maxlength="${POST_LIMITS.title}" required${invalidAttributes('nieuw-title', errors.title)}>` })}
        ${fieldRow({
          id: 'nieuw-slug',
          label: 'Adres',
          error: errors.slug,
          help: 'Kleine letters, cijfers en streepjes, bijv. mijn-reisverslag. Leeg = gemaakt uit de titel.',
          control: html`<input id="nieuw-slug" name="slug" type="text" value="${values.slug}" maxlength="${MAX_SLUG_LENGTH}" pattern="[a-z0-9]+(-[a-z0-9]+)*"${invalidAttributes('nieuw-slug', errors.slug)}>`,
        })}
        <p class="field__help">Het bericht staat offline tot je het publiceert.</p>
        <div><button class="btn" type="submit">Bericht maken</button></div>
      </form>`,
  });

  router.get('/blog/nieuw/', guard, (req, res) => res.send(renderNewPost(req, { title: '', slug: '' })));

  router.post('/blog/nieuw/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const text = (name) => (typeof req.body[name] === 'string' ? req.body[name].trim() : '');
      const values = { title: text('title'), slug: text('slug') || slugify(text('title')) };
      const outcome = await posts.create(values, {
        userId: req.user.id,
        audit: (client, id) => auth.audit(req, { userId: req.user.id, action: 'blog.nieuw', entity: 'posts', entityId: id }, client),
      });
      if (outcome.errors) return res.status(422).send(renderNewPost(req, values, outcome.errors));
      return res.redirect(303, `${BASE}${outcome.id}/?opgeslagen=7`);
    } catch (error) {
      return next(error);
    }
  });

  router.post(routePath('/blog/:id(\\d{1,9})/adres/'), guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const slug = typeof req.body.slug === 'string' ? req.body.slug.trim() : '';
      const outcome = await posts.changeSlug(req.params.id, slug, contextFor(req, 'blog.adres'));
      if (outcome.status === 'weg') return notFound(req, res);
      if (outcome.status === 'gelijk') return res.redirect(303, `${BASE}${Number(req.params.id)}/#adres`);
      if (outcome.status === 'fout') {
        const post = await loadOr404(req, res);
        if (!post) return undefined;
        return res.status(422).send(await renderEditor(req, post, { error: `Het adres is niet gewijzigd: ${outcome.errors.slug}`, errors: outcome.errors, slug }));
      }
      if (options.redirects) await options.redirects.reload().catch(() => {});
      if (options.menus) await options.menus.reload().catch(() => {});
      return res.redirect(303, `${BASE}${Number(req.params.id)}/?opgeslagen=8#adres`);
    } catch (error) {
      return next(error);
    }
  });

  router.post(routePath('/blog/:id(\\d{1,9})/online/'), guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const online = req.body.stand === 'online';
      if (!online && req.body.stand !== 'offline') return await finish(req, res, { status: 'fout', message: 'Onbekende actie.' }, { notice: 1 });
      const outcome = await posts.setOnline(req.params.id, online, contextFor(req, online ? 'blog.online' : 'blog.offline'));
      if (outcome.status === 'nooit-gepubliceerd') {
        return await finish(req, res, { status: 'fout', message: 'Dit bericht is nog nooit gepubliceerd; gebruik Publiceren om het online te zetten.' }, { notice: 1 });
      }
      return await finish(req, res, outcome, { notice: online ? 10 : 9, anchor: 'adres' });
    } catch (error) {
      return next(error);
    }
  });

  router.post(routePath('/blog/:id(\\d{1,9})/verwijderen/'), guard, auth.checkCsrf, async (req, res, next) => {
    try {
      if (req.body.zeker !== 'ja') return await finish(req, res, { status: 'fout', message: 'Vink aan dat je het bericht wilt verwijderen.' }, { notice: 1 });
      const outcome = await posts.remove(req.params.id, { audit: auditFor(req, 'blog.verwijderd') });
      const messages = {
        online: 'Haal het bericht eerst offline.',
        import: 'Een bericht van de oude site kun je alleen offline halen.',
        'in-menu': 'Dit bericht staat nog in een menu; haal het eerst uit het menu (Menu\'s).',
      };
      if (messages[outcome.status]) return await finish(req, res, { status: 'fout', message: messages[outcome.status] }, { notice: 1 });
      if (outcome.status === 'weg') return notFound(req, res);
      if (options.redirects) await options.redirects.reload().catch(() => {});
      return res.redirect(303, `${BASE}?melding=1`);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createPostRoutes, POST_ACTION_LABELS, BASE };
