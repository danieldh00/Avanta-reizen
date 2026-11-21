/**
 * Pagina's beheren in het CRM (`/app/paginas/`, recht `content`, CMS-pakket H1): lijst met zoeken, een pagina bewerken
 * als concept (titel, bovenkop, inleiding, kopfoto en blokken: toevoegen, wijzigen, verplaatsen, kopiëren,
 * verwijderen), een voorbeeld van het concept in de opmaak van de site, publiceren, concept weggooien en eerdere versies
 * terugzetten. Werkt zonder JavaScript: elke actie is een eigen formulier met CSRF-token en de versie van het concept.
 * Elke wijziging in de auditlog.
 */
const express = require('express');
const { html, raw } = require('../site/html');
const { renderCrmPage, renderAlert, formatDateTime } = require('../crm/layout');
const { renderPage, renderPageHeader } = require('../site/layout');
const { addCspSources } = require('../security/csp');
const { YOUTUBE_ORIGIN } = require('../site/homepage');
const { searchPatterns } = require('../crm/person-routes');
const { createMediaLibrary, lockMediaForUse } = require('../media/library');
const { pickerFilter, pickerPhotos, renderPhotoPicker } = require('../media/picker');
const {
  BLOCK_TYPES, STYLE_OPTIONS, BLOCK_ID_PATTERN, MAX_BLOCKS, newBlock, newBlockId, validateBlockForm, blockSummary, isDefaultStyle,
} = require('./blocks');
const { createPages, validatePageFields, editableState, imageFromMedia, PAGE_LIMITS } = require('./pages');
const { renderPageArticle } = require('./page-render');

/** Basispad van het scherm. */
const BASE = '/app/paginas/';

/** Acties voor het auditlog (zie `ACTION_LABELS` in `crm/users.js`). */
const PAGE_ACTION_LABELS = {
  'pagina.concept': 'Concept van een pagina gewijzigd',
  'pagina.gepubliceerd': 'Pagina gepubliceerd',
  'pagina.concept-weg': 'Concept van een pagina weggegooid',
  'pagina.versie-terug': 'Eerdere versie van een pagina teruggezet als concept',
};

/** Meldingen na een geslaagde actie (`?opgeslagen=<n>`). */
const NOTICES = {
  1: 'Opgeslagen in het concept. Bekijk het voorbeeld en publiceer als het klaar is.',
  2: 'Gepubliceerd. De pagina staat zo op de site.',
  3: 'Het concept is weggegooid; je ziet weer de gepubliceerde pagina.',
  4: 'De versie staat klaar als concept. Publiceer om hem terug op de site te zetten.',
  5: 'Blok toegevoegd aan het concept.',
  6: 'Blok verwijderd uit het concept.',
};

/** Melding als het formulier van een oudere stand van het concept uitging. */
const STALE_MESSAGE = 'De pagina is intussen gewijzigd (in een ander tabblad of door een collega). Je wijziging is niet opgeslagen; bekijk de nieuwe stand en probeer het opnieuw.';

/**
 * Een veld met label, hulptekst en fout.
 * @param {{id: string, label: string, control: object, help?: string, error?: string}} field Veld.
 * @returns {object} HTML.
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
 * @returns {object} HTML-attributen.
 */
function invalidAttributes(id, error) {
  return error ? html` aria-invalid="true" aria-describedby="${id}-fout"` : '';
}

/**
 * Het invoerelement van één blokveld.
 * @param {object} field Velddefinitie uit `BLOCK_TYPES`.
 * @param {string} name Naam in het formulier.
 * @param {string} id Id.
 * @param {*} value Huidige waarde.
 * @param {string} [error] Fout.
 * @returns {object} HTML.
 */
function fieldControl(field, name, id, value, error) {
  const invalid = invalidAttributes(id, error);
  if (field.kind === 'select') {
    return html`<select id="${id}" name="${name}"${invalid}>${Object.entries(field.choices).map(([key, label]) => html`<option value="${key}"${value === key ? raw(' selected') : ''}>${label}</option>`)}</select>`;
  }
  if (field.kind === 'richtext') {
    return html`<textarea id="${id}" name="${name}" rows="14" class="cms-richtext"${invalid}>${value}</textarea>`;
  }
  if (field.kind === 'textarea') {
    return html`<textarea id="${id}" name="${name}" rows="4" maxlength="${field.max}"${field.required ? raw(' required') : ''}${invalid}>${value}</textarea>`;
  }
  return html`<input id="${id}" name="${name}" type="text" value="${value}" maxlength="${field.max}"${field.required ? raw(' required') : ''}${invalid}>`;
}

/** Uitleg bij opgemaakte tekst. */
const RICHTEXT_HELP = 'Opmaak met HTML: <p>, <h2>, <h3>, <strong>, <em>, <a href="…">, <ul>/<ol> met <li>, <blockquote>, tabellen en <img>. Andere opmaak, scripts en stijlen verdwijnen bij het opslaan.';

/**
 * De velden en stijlopties van een blok in het formulier.
 * @param {object} block Blok.
 * @param {object} errors Fouten per veldnaam.
 * @param {string} photoUrl Adres van het fotoscherm van dit blok.
 * @returns {object} HTML.
 */
function blockFields(block, errors, photoUrl) {
  const definition = BLOCK_TYPES[block.type];
  const prefix = `blok-${block.id}`;
  const rows = definition.fields.map((field) => {
    if (field.kind === 'image') {
      const photo = block.data[field.name];
      return html`<div class="field"><span class="field__label">${field.label}</span>
        ${photo ? html`<img class="media-preview media-preview--small" src="${photo.url}" alt="${photo.alt}" width="400" height="300">` : html`<p>Nog geen foto gekozen.</p>`}
        <a class="btn btn--small btn--outline" href="${photoUrl}">${photo ? 'Andere foto kiezen' : 'Foto kiezen'}</a></div>`;
    }
    if (field.kind === 'repeat') {
      const values = block.data[field.name] || [];
      return html`${Array.from({ length: field.count }, (_, index) => html`<fieldset class="cms-repeat"><legend>${field.label} ${index + 1}</legend>
        ${field.fields.map((sub) => {
          const name = `f_${field.name}_${index}_${sub.name}`;
          const value = values[index] ? values[index][sub.name] : (sub.kind === 'select' ? Object.keys(sub.choices)[0] : '');
          return fieldRow({ id: `${prefix}-${name}`, label: sub.label, error: errors[name], control: fieldControl(sub, name, `${prefix}-${name}`, value, errors[name]) });
        })}
      </fieldset>`)}`;
    }
    const name = `f_${field.name}`;
    return fieldRow({
      id: `${prefix}-${name}`,
      label: field.label,
      error: errors[name],
      help: field.kind === 'richtext' ? RICHTEXT_HELP : (field.kind === 'link' ? 'Een adres op deze site (bijv. /contact/), https://…, mailto: of tel:.' : ''),
      control: fieldControl(field, name, `${prefix}-${name}`, block.data[field.name], errors[name]),
    });
  });
  const styleRows = Object.entries(STYLE_OPTIONS).map(([name, option]) => fieldRow({
    id: `${prefix}-s_${name}`,
    label: option.label,
    control: html`<select id="${prefix}-s_${name}" name="s_${name}">${Object.entries(option.choices).map(([key, label]) => html`<option value="${key}"${block.style[name] === key ? raw(' selected') : ''}>${label}</option>`)}</select>`,
  }));
  return html`${rows}
    <details class="cms-style"${isDefaultStyle(block.style) ? '' : raw(' open')}><summary>Opmaak (huisstijl)</summary><div class="cms-style__grid">${styleRows}</div></details>`;
}

/**
 * Maakt de routes voor pagina's.
 * @param {{db: object, auth: object, library?: object, mediaDir?: string}} options Database, sessie- en rechtenlaag en
 *   de fotobibliotheek.
 * @returns {express.Router} Router.
 */
function createPageRoutes(options) {
  const { db, auth } = options;
  const pages = createPages({ db });
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
        body: html`<form class="crm-search" method="get" action="${BASE}" role="search">
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
    const revisionRows = await pages.revisions(page.id);
    const pageUrl = `${BASE}${page.id}/`;
    const values = state.values || current;
    const errors = state.errors || {};
    const openBlock = state.blockErrors ? state.blockErrors.id : (typeof req.query.blok === 'string' ? req.query.blok : '');
    const field = (name, label, control, help) => fieldRow({ id: `pagina-${name}`, label, control, help, error: errors[name] });
    const typeOptions = Object.entries(BLOCK_TYPES).map(([type, definition]) => html`<option value="${type}">${definition.label}</option>`);
    const positionOptions = (selectedAfter) => html`<option value="">Aan het eind</option><option value="begin"${selectedAfter === 'begin' ? raw(' selected') : ''}>Bovenaan</option>${current.blocks.map((block, index) => html`<option value="${block.id}"${selectedAfter === block.id ? raw(' selected') : ''}>Na blok ${index + 1} (${BLOCK_TYPES[block.type].label})</option>`)}`;
    return renderCrmPage({
      title: current.title,
      user: req.user,
      csrf: req.session.csrf,
      path: BASE,
      body: html`<p><a href="${BASE}">Naar pagina's</a> · <a href="${page.path}">Bekijk op de site</a> · <a href="${pageUrl}voorbeeld/">Voorbeeld van ${page.draft ? 'het concept' : 'de pagina'}</a></p>
        ${state.notice ? html`<p class="notice" role="status">${state.notice}</p>` : ''}
        ${renderAlert(state.error)}
        <section class="crm-block cms-status">
          ${page.draft ? html`<p><strong>Concept met wijzigingen</strong> die nog niet op de site staan.</p>
            <div class="crm-actions">
              <form method="post" action="${pageUrl}publiceren/">${hidden(req, page)}<button class="btn btn--small" type="submit">Publiceren</button></form>
              <form method="post" action="${pageUrl}concept-weggooien/">${hidden(req, page)}<button class="btn btn--small btn--outline" type="submit">Concept weggooien</button></form>
            </div>` : html`<p>Geen openstaande wijzigingen: wat je hier ziet staat op de site. Een wijziging komt eerst in een concept.</p>`}
          <dl class="crm-facts">
            <dt>Adres</dt><dd><code>${page.path}</code></dd>
            <dt>Op de site</dt><dd>${page.published ? 'online' : 'offline'}</dd>
            <dt>Laatst gewijzigd</dt><dd>${formatDateTime(page.updated_at)}${page.updated_by_name ? html` door ${page.updated_by_name}` : ''}</dd>
          </dl>
        </section>

        <section class="crm-block" id="gegevens">
          <h2>Gegevens</h2>
          <form class="form crm-narrow" method="post" action="${pageUrl}gegevens/">
            ${hidden(req, page)}
            ${field('title', 'Titel', html`<input id="pagina-title" name="title" type="text" value="${values.title}" maxlength="${PAGE_LIMITS.title}" required${invalidAttributes('pagina-title', errors.title)}>`)}
            ${field('pretitle', 'Bovenkop (kleine tekst boven de titel)', html`<input id="pagina-pretitle" name="pretitle" type="text" value="${values.pretitle}" maxlength="${PAGE_LIMITS.pretitle}"${invalidAttributes('pagina-pretitle', errors.pretitle)}>`)}
            ${field('intro', 'Inleiding (grote tekst bovenaan; ook de omschrijving voor zoekmachines)', html`<textarea id="pagina-intro" name="intro" rows="4" maxlength="${PAGE_LIMITS.intro}"${invalidAttributes('pagina-intro', errors.intro)}>${values.intro}</textarea>`)}
            <div><button class="btn" type="submit">Opslaan in concept</button></div>
          </form>
        </section>

        <section class="crm-block" id="kopfoto">
          <h2>Kopfoto</h2>
          ${current.imageUrl ? html`<img class="media-preview media-preview--small" src="${current.imageUrl}" alt="" width="400" height="300">` : html`<p>Geen kopfoto: de kop van de pagina is dan een effen vlak.</p>`}
          <p><a class="btn btn--small btn--outline" href="${pageUrl}kopfoto/">${current.imageUrl ? 'Andere kopfoto kiezen' : 'Kopfoto kiezen'}</a></p>
        </section>

        <section id="blokken">
          <h2>Blokken</h2>
          ${current.blocks.length ? '' : html`<p>Nog geen blokken. Voeg hieronder het eerste blok toe.</p>`}
          ${current.blocks.map((stored, index) => {
            const failed = state.blockErrors && state.blockErrors.id === stored.id;
            const block = failed ? state.blockErrors.block : stored;
            const blockUrl = `${pageUrl}blokken/${block.id}/`;
            return html`<details class="crm-block cms-block-edit" id="blok-${block.id}"${openBlock === block.id || current.blocks.length === 1 ? raw(' open') : ''}>
              <summary><strong>${String(index + 1)}. ${BLOCK_TYPES[block.type].label}</strong> <span class="cms-block-edit__summary">${blockSummary(stored)}</span></summary>
              <form class="form" method="post" action="${blockUrl}">
                ${hidden(req, page)}
                ${blockFields(block, failed ? state.blockErrors.errors : {}, `${blockUrl}foto/`)}
                <div><button class="btn btn--small" type="submit">Blok opslaan in concept</button></div>
              </form>
              <form class="crm-actions cms-block-edit__actions" method="post" action="${blockUrl}actie/">
                ${hidden(req, page)}
                ${index > 0 ? html`<button class="btn btn--small btn--outline" type="submit" name="actie" value="omhoog">Omhoog</button>` : ''}
                ${index < current.blocks.length - 1 ? html`<button class="btn btn--small btn--outline" type="submit" name="actie" value="omlaag">Omlaag</button>` : ''}
                ${current.blocks.length < MAX_BLOCKS ? html`<button class="btn btn--small btn--outline" type="submit" name="actie" value="kopieren">Kopiëren</button>` : ''}
                <button class="btn btn--small btn--outline" type="submit" name="actie" value="verwijderen">Verwijderen</button>
              </form>
            </details>`;
          })}
          ${current.blocks.length < MAX_BLOCKS ? html`<form class="crm-block form cms-add-block" method="post" action="${pageUrl}blokken/nieuw/">
            ${hidden(req, page)}
            <h3>Blok toevoegen</h3>
            <div class="cms-add-block__fields">
              ${fieldRow({ id: 'nieuw-type', label: 'Soort blok', control: html`<select id="nieuw-type" name="type">${typeOptions}</select>` })}
              ${fieldRow({ id: 'nieuw-na', label: 'Plaats', control: html`<select id="nieuw-na" name="na">${positionOptions('')}</select>` })}
            </div>
            <ul class="cms-type-help">${Object.values(BLOCK_TYPES).map((definition) => html`<li><strong>${definition.label}</strong>: ${definition.help}</li>`)}</ul>
            <div><button class="btn btn--small" type="submit">Toevoegen</button></div>
          </form>` : html`<p class="field__help">Deze pagina heeft het maximum van ${MAX_BLOCKS} blokken.</p>`}
        </section>

        <section class="crm-block" id="versies">
          <h2>Versies</h2>
          ${revisionRows.length ? html`<div class="crm-table-wrap"><table class="crm-table">
            <thead><tr><th>Versie</th><th>Gepubliceerd</th><th>Door</th><th></th></tr></thead>
            <tbody>${revisionRows.map((row) => html`<tr>
              <td>${String(row.version)}${row.note ? html` <span class="field__help">(${row.note})</span>` : ''}</td>
              <td>${formatDateTime(row.published_at)}</td>
              <td>${row.published_by_name || '–'}</td>
              <td><form method="post" action="${pageUrl}versies/${row.version}/terugzetten/">${hidden(req, page)}<button class="btn btn--small btn--outline" type="submit">Terugzetten als concept</button></form></td>
            </tr>`)}</tbody>
          </table></div>` : html`<p>Nog geen versies. Bij de eerste publicatie wordt ook de huidige stand bewaard.</p>`}
        </section>`,
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

  router.get('/paginas/:id(\\d{1,9})/', guard, async (req, res, next) => {
    try {
      const page = await loadOr404(req, res);
      if (!page) return undefined;
      return res.send(await renderEditor(req, page, { notice: NOTICES[req.query.opgeslagen] || '' }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/paginas/:id(\\d{1,9})/gegevens/', guard, auth.checkCsrf, async (req, res, next) => {
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

  router.post('/paginas/:id(\\d{1,9})/blokken/nieuw/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const block = newBlock(typeof req.body.type === 'string' ? req.body.type : '');
      let addedId = '';
      const outcome = block ? await pages.changeDraft(req.params.id, req.body.versie, async (state) => {
        const after = typeof req.body.na === 'string' ? req.body.na : '';
        let index = state.blocks.length;
        if (after === 'begin') index = 0;
        else if (after) {
          const position = state.blocks.findIndex((item) => item.id === after);
          if (position < 0) return { status: 'blok-weg' };
          index = position + 1;
        }
        state.blocks.splice(index, 0, block);
        addedId = block.id;
        return undefined;
      }, contextFor(req)) : { status: 'fout', message: 'Kies een soort blok.' };
      return await finish(req, res, outcome, { notice: 5, block: addedId, anchor: `blok-${addedId}` });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/paginas/:id(\\d{1,9})/blokken/:blockId(b[0-9a-f]{12})/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      let failed = null;
      const outcome = await pages.changeDraft(req.params.id, req.body.versie, async (state) => {
        const index = state.blocks.findIndex((item) => item.id === req.params.blockId);
        if (index < 0) return { status: 'blok-weg' };
        const { block, errors } = validateBlockForm(state.blocks[index], req.body);
        if (Object.keys(errors).length) {
          failed = { id: block.id, block, errors };
          return { errors };
        }
        state.blocks[index] = block;
        return undefined;
      }, contextFor(req));
      return await finish(req, res, outcome, {
        notice: 1,
        block: req.params.blockId,
        anchor: `blok-${req.params.blockId}`,
        onError: (page) => renderEditor(req, page, { error: 'Controleer de velden van het blok.', blockErrors: failed }),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/paginas/:id(\\d{1,9})/blokken/:blockId(b[0-9a-f]{12})/actie/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const action = typeof req.body.actie === 'string' ? req.body.actie : '';
      if (!['omhoog', 'omlaag', 'kopieren', 'verwijderen'].includes(action)) {
        return await finish(req, res, { status: 'fout', message: 'Onbekende actie.' }, { notice: 1 });
      }
      let focus = req.params.blockId;
      const outcome = await pages.changeDraft(req.params.id, req.body.versie, async (state) => {
        const index = state.blocks.findIndex((item) => item.id === req.params.blockId);
        if (index < 0) return { status: 'blok-weg' };
        const [block] = state.blocks.splice(index, 1);
        if (action === 'omhoog') state.blocks.splice(Math.max(0, index - 1), 0, block);
        if (action === 'omlaag') state.blocks.splice(Math.min(state.blocks.length, index + 1), 0, block);
        if (action === 'kopieren') {
          const copy = { ...structuredClone(block), id: newBlockId() };
          state.blocks.splice(index, 0, block, copy);
          focus = copy.id;
        }
        return undefined;
      }, contextFor(req));
      if (action === 'verwijderen') return await finish(req, res, outcome, { notice: 6, anchor: 'blokken' });
      return await finish(req, res, outcome, { notice: action === 'kopieren' ? 5 : 1, block: focus, anchor: `blok-${focus}` });
    } catch (error) {
      return next(error);
    }
  });

  /**
   * Het scherm om een foto te kiezen (voor een afbeeldingsblok of de kopfoto).
   * @param {object} req Express-verzoek.
   * @param {object} page Pagina.
   * @param {{title: string, pageUrl: string, current: (object|null), allowNone: boolean, error?: string}} screen Titel,
   *   adres van het scherm, huidige foto en of "geen foto" mag.
   * @returns {Promise<string>} HTML.
   */
  const renderPhotoScreen = async (req, page, screen) => {
    const countries = await library.countries();
    const filter = pickerFilter(req.query, countries, null);
    const { photos, hasMore } = await pickerPhotos(library, filter);
    return renderCrmPage({
      title: screen.title,
      user: req.user,
      csrf: req.session.csrf,
      path: BASE,
      body: html`<p><a href="${BASE}${page.id}/">Terug naar ${editableState(page).title}</a></p>
        ${renderAlert(screen.error)}
        ${screen.current ? html`<p>Nu gekozen:</p><img class="media-preview media-preview--small" src="${screen.current.url}" alt="${screen.current.alt || ''}" width="400" height="300">` : ''}
        <section class="crm-block" id="foto">
          ${renderPhotoPicker({
            pageUrl: screen.pageUrl, action: screen.pageUrl, csrf: req.session.csrf, countries, filter, photos, hasMore, allowNone: screen.allowNone, button: 'Deze foto gebruiken',
            extraFields: html`<input type="hidden" name="versie" value="${page.draft_version}">`,
          })}
        </section>`,
    });
  };

  /**
   * Leest de gekozen foto uit het formulier van de kiezer.
   * @param {object} body Ingezonden velden.
   * @returns {{none: boolean, mediaId: (string|null), valid: boolean}} Keuze.
   */
  const chosenPhoto = (body) => {
    const none = body.geen === '1';
    const mediaId = none ? null : body.media_id;
    return { none, mediaId, valid: none || (typeof mediaId === 'string' && /^\d{1,9}$/.test(mediaId)) };
  };

  router.get('/paginas/:id(\\d{1,9})/kopfoto/', guard, async (req, res, next) => {
    try {
      const page = await loadOr404(req, res);
      if (!page) return undefined;
      const current = editableState(page);
      return res.send(await renderPhotoScreen(req, page, {
        title: 'Kopfoto kiezen', pageUrl: `${BASE}${page.id}/kopfoto/`, current: current.imageUrl ? { url: current.imageUrl } : null, allowNone: Boolean(current.imageUrl),
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/paginas/:id(\\d{1,9})/kopfoto/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const choice = chosenPhoto(req.body);
      const outcome = choice.valid ? await pages.changeDraft(req.params.id, req.body.versie, async (state, client) => {
        if (choice.none) {
          state.imageUrl = null;
          state.imageMediaId = null;
          return undefined;
        }
        const media = await lockMediaForUse(client, choice.mediaId);
        if (!media) return { status: 'foto-weg' };
        const image = imageFromMedia(media);
        state.imageUrl = image.url;
        state.imageMediaId = media.id;
        return undefined;
      }, contextFor(req)) : { status: 'fout', message: 'Kies een foto.' };
      return await finish(req, res, outcome, { notice: 1, anchor: 'kopfoto' });
    } catch (error) {
      return next(error);
    }
  });

  /**
   * Zoekt het afbeeldingsblok uit de URL in de stand die je bewerkt.
   * @param {object} page Pagina.
   * @param {string} blockId Id van het blok.
   * @returns {(object|null)} Blok, of null als het geen afbeeldingsveld heeft.
   */
  const imageBlockOf = (page, blockId) => {
    const block = editableState(page).blocks.find((item) => item.id === blockId);
    return block && BLOCK_TYPES[block.type].fields.some((field) => field.kind === 'image') ? block : null;
  };

  router.get('/paginas/:id(\\d{1,9})/blokken/:blockId(b[0-9a-f]{12})/foto/', guard, async (req, res, next) => {
    try {
      const page = await loadOr404(req, res);
      if (!page) return undefined;
      const block = imageBlockOf(page, req.params.blockId);
      if (!block) return notFound(req, res);
      return res.send(await renderPhotoScreen(req, page, {
        title: 'Foto voor het blok kiezen', pageUrl: `${BASE}${page.id}/blokken/${block.id}/foto/`, current: block.data.foto, allowNone: Boolean(block.data.foto),
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/paginas/:id(\\d{1,9})/blokken/:blockId(b[0-9a-f]{12})/foto/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const choice = chosenPhoto(req.body);
      const outcome = choice.valid ? await pages.changeDraft(req.params.id, req.body.versie, async (state, client) => {
        const block = state.blocks.find((item) => item.id === req.params.blockId);
        const imageField = block && BLOCK_TYPES[block.type].fields.find((field) => field.kind === 'image');
        if (!imageField) return { status: 'blok-weg' };
        if (choice.none) {
          block.data[imageField.name] = null;
          return undefined;
        }
        const media = await lockMediaForUse(client, choice.mediaId);
        if (!media) return { status: 'foto-weg' };
        block.data[imageField.name] = imageFromMedia(media);
        return undefined;
      }, contextFor(req)) : { status: 'fout', message: 'Kies een foto.' };
      return await finish(req, res, outcome, { notice: 1, block: req.params.blockId, anchor: `blok-${req.params.blockId}` });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/paginas/:id(\\d{1,9})/voorbeeld/', guard, async (req, res, next) => {
    try {
      const page = await loadOr404(req, res);
      if (!page) return undefined;
      const current = editableState(page);
      const article = renderPageArticle({ title: current.title, intro: current.intro, blocks: current.blocks });
      if (article.hasVideo) res.set('Content-Security-Policy', addCspSources(res.get('Content-Security-Policy'), { 'frame-src': [YOUTUBE_ORIGIN] }));
      return res.send(renderPage({
        title: `Voorbeeld: ${current.title}`,
        path: page.path,
        indexable: false,
        site: res.locals.site,
        header: html`<div class="cms-preview-bar" role="status">Voorbeeld van ${page.draft ? 'het concept' : 'de gepubliceerde pagina'}, niet zichtbaar voor bezoekers. <a href="${BASE}${page.id}/">Terug naar bewerken</a></div>
          ${renderPageHeader({ title: current.title, pretitle: current.pretitle, imageUrl: current.imageUrl })}`,
        body: html`<div class="content-main">${article.body}</div>`,
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/paginas/:id(\\d{1,9})/publiceren/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const outcome = await pages.publish(req.params.id, req.body.versie, contextFor(req, 'pagina.gepubliceerd'));
      return await finish(req, res, outcome, { notice: 2 });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/paginas/:id(\\d{1,9})/concept-weggooien/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const outcome = await pages.discardDraft(req.params.id, req.body.versie, contextFor(req, 'pagina.concept-weg'));
      return await finish(req, res, outcome, { notice: 3 });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/paginas/:id(\\d{1,9})/versies/:version(\\d{1,9})/terugzetten/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const outcome = await pages.restoreRevision(req.params.id, req.params.version, req.body.versie, contextFor(req, 'pagina.versie-terug'));
      return await finish(req, res, outcome, { notice: 4, anchor: 'blokken' });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createPageRoutes, PAGE_ACTION_LABELS, BASE, BLOCK_ID_PATTERN };
