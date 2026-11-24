/**
 * Reisleiders beheren in het CRM (`/app/reisleiders/`, recht `reizen`, CMS-pakket I4): lijst met zoeken, nieuwe
 * reisleider (offline), profiel wijzigen (adres met 301, volgorde op de site), portret en tweede foto uit de
 * fotobibliotheek, de galerij onderaan de pagina (W28), online/offline en verwijderen. Elke wijziging in de auditlog.
 */
const express = require('express');
const { routePath } = require('../route-path');
const { html, raw } = require('../site/html');
const { renderCrmPage, renderAlert } = require('../crm/layout');
const ui = require('../crm/ui');
const { guidePath } = require('../site/format');
const { createMediaLibrary } = require('../media/library');
const { pickerFilter, pickerPhotos, renderPhotoPicker } = require('../media/picker');
const { searchPatterns } = require('../persons/person-routes');
const { fieldRow, invalidAttributes, RICHTEXT_HELP } = require('../cms/block-editor');
const { MAX_SLUG_LENGTH, slugify, isValidSlug } = require('./slugs');
const { createGuides, validateGuideFields, galleryFingerprint, GUIDE_LIMITS, PHOTO_FIELDS } = require('./guides');

/** Basispad van het scherm. */
const BASE = '/app/reisleiders/';

/** Acties voor het auditlog (zie `ACTION_LABELS` in `crm/users.js`). */
const GUIDE_ACTION_LABELS = {
  'reisleider.nieuw': 'Reisleider aangemaakt',
  'reisleider.gewijzigd': 'Profiel van een reisleider gewijzigd',
  'reisleider.online': 'Reisleider online of offline gezet',
  'reisleider.foto': 'Foto van een reisleider gewijzigd',
  'reisleider.galerij': 'Galerij van een reisleider gewijzigd',
  'reisleider.verwijderd': 'Reisleider verwijderd',
};

/** Meldingen op het bewerkscherm (`?opgeslagen=<n>`). */
const NOTICES = {
  1: 'Opgeslagen.',
  2: 'Opgeslagen. Het oude adres verwijst automatisch door naar het nieuwe.',
  3: 'De foto is opgeslagen.',
  4: 'De reisleider staat online.',
  5: 'De reisleider staat offline.',
  6: 'De reisleider is aangemaakt en staat offline. Vul het profiel in en zet hem online.',
  7: 'De galerij is opgeslagen.',
};

/**
 * De ingevulde waarden van het profielformulier.
 * @param {object} guide Rij uit `guides`.
 * @returns {object} Waarden per veld.
 */
function guideFormValues(guide) {
  return {
    name: guide.name,
    surname: guide.surname,
    slug: guide.slug,
    city: guide.city,
    since: guide.since,
    quote: guide.quote,
    intro: guide.intro,
    bodyInput: guide.body_html,
    sortOrder: guide.sort_order,
  };
}

/**
 * De galerij van een reisleider.
 * @param {object} guide Rij uit `guides`.
 * @returns {{title: string, subtitle: string, items: Array<{url: string, alt?: string}>}} Galerij.
 */
function guideGallery(guide) {
  return { title: guide.gallery_title || '', subtitle: guide.gallery_subtitle || '', items: Array.isArray(guide.gallery) ? guide.gallery : [] };
}

/**
 * Het blok *Status* van een reisleider: online of offline, aantal reizen en de knop om dat om te zetten.
 * @param {object} guide Rij uit `guides`.
 * @param {string} csrf CSRF-token.
 * @returns {object} HTML.
 */
function renderGuideStatus(guide, csrf) {
  return html`<section class="crm-block" id="status">
        <h2>Status</h2>
        <p>${guide.published ? 'Online' : 'Offline'} · ${String(guide.trip_count)} ${guide.trip_count === 1 ? 'reis' : 'reizen'}</p>
        <form method="post" action="${BASE}${guide.id}/online/">
          <input type="hidden" name="_csrf" value="${csrf}">
          <input type="hidden" name="stand" value="${guide.published ? 'offline' : 'online'}">
          <button class="btn btn--small${guide.published ? ' btn--outline' : ''}" type="submit">${guide.published ? 'Offline halen' : 'Online zetten'}</button>
        </form>
      </section>`;
}

/**
 * Het blok *Galerij* van een reisleider: titel en subtitel, de foto's met volgnummer en weghalen, en foto's toevoegen.
 * @param {object} guide Rij uit `guides`.
 * @param {{title: string, subtitle: string, items: Array<{url: string, alt?: string}>}} gallery Galerij zoals de site hem toont.
 * @param {string} csrf CSRF-token.
 * @returns {object} HTML.
 */
function renderGallerySection(guide, gallery, csrf) {
  const action = `${BASE}${guide.id}/galerij/`;
  return html`<section class="crm-block" id="galerij">
        <h2>Galerij (${String(gallery.items.length)} van maximaal ${String(GUIDE_LIMITS.gallery)})</h2>
        <p class="field__help">De strook met foto's onderaan de pagina van de reisleider.</p>
        <form class="form crm-narrow" method="post" action="${action}tekst/">
          <input type="hidden" name="_csrf" value="${csrf}">
          ${fieldRow({ id: 'galerij-title', label: 'Titel van de galerij', control: html`<input id="galerij-title" name="gallery_title" type="text" value="${gallery.title}" maxlength="${GUIDE_LIMITS.galleryText}">` })}
          ${fieldRow({ id: 'galerij-subtitle', label: 'Subtitel', control: html`<input id="galerij-subtitle" name="gallery_subtitle" type="text" value="${gallery.subtitle}" maxlength="${GUIDE_LIMITS.galleryText}">` })}
          <div><button class="btn btn--small" type="submit">Tekst opslaan</button></div>
        </form>
        ${gallery.items.length ? html`<form method="post" action="${action}">
          <input type="hidden" name="_csrf" value="${csrf}">
          <input type="hidden" name="galerij" value="${galleryFingerprint(gallery.items)}">
          <ul class="cms-photo-list">${gallery.items.map((item, index) => html`<li class="cms-photo-list__item">
            <img src="${item.url}" alt="${item.alt || ''}" width="120" height="90" loading="lazy">
            <label>Volgorde <input type="number" name="volgorde_${String(index)}" value="${String(index + 1)}" min="1" max="${String(GUIDE_LIMITS.gallery)}" step="1"></label>
            <label><input type="checkbox" name="weg" value="${String(index)}"> Weghalen</label>
          </li>`)}</ul>
          <p class="field__help">Wijzig de volgorde met de nummers of vink foto's aan om weg te halen, en sla op.</p>
          <div><button class="btn btn--small" type="submit">Galerij opslaan</button></div>
        </form>` : html`<p>Nog geen foto's in de galerij.</p>`}
        ${gallery.items.length < GUIDE_LIMITS.gallery ? html`<p><a class="btn btn--small btn--outline" href="${action}toevoegen/">Foto's toevoegen</a></p>` : ''}
      </section>`;
}

/**
 * Maakt de routes voor reisleiders.
 * @param {{db: object, auth: object, redirects?: object, library?: object, mediaDir?: string}} options
 *   Database, sessie- en rechtenlaag, doorverwijzingen (opnieuw laden na een nieuw adres) en de fotobibliotheek.
 * @returns {express.Router} Router.
 */
function createGuideRoutes(options) {
  const { db, auth } = options;
  const guides = createGuides({ db });
  const library = options.library || createMediaLibrary({ db, mediaDir: options.mediaDir || '' });
  const router = express.Router();
  const guard = auth.requireRight('reizen');

  /**
   * Context voor een wijziging: gebruiker en audit.
   * @param {object} req Express-verzoek.
   * @param {object} guide Rij.
   * @param {string} action Actie.
   * @returns {{userId: number, audit: Function}} Context.
   */
  const contextFor = (req, guide, action) => ({
    userId: req.user.id,
    audit: (client) => auth.audit(req, { userId: req.user.id, action, entity: 'guides', entityId: guide.id }, client),
  });

  /**
   * Een CRM-pagina binnen reisleiders.
   * @param {object} req Express-verzoek.
   * @param {string} title Titel.
   * @param {object} body HTML.
   * @param {object} [actions] Knoppen naast de titel (zie `renderActions` in `crm/ui.js`).
   * @returns {string} HTML.
   */
  const page = (req, title, body, actions) => renderCrmPage({ title, user: req.user, csrf: req.session.csrf, path: BASE, body, actions });

  /**
   * 404 binnen het CRM.
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @returns {void}
   */
  const notFound = (req, res) => {
    res.status(404).send(page(req, 'Niet gevonden', html`<p>Deze reisleider bestaat niet. <a href="${BASE}">Naar de reisleiders</a></p>`));
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

  /**
   * Laadt de reisleider uit de URL, of stuurt een 404.
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @returns {Promise<(object|null)>} Rij, of null als de 404 al is verstuurd.
   */
  const loadOr404 = async (req, res) => {
    const guide = await guides.get(req.params.id);
    if (!guide) notFound(req, res);
    return guide;
  };

  /**
   * De lijst met zoeken en een formulier voor een nieuwe reisleider.
   * @param {object} req Express-verzoek.
   * @param {{error?: string, values?: object, errors?: object}} [state] Fouten van het nieuw-formulier.
   * @returns {Promise<string>} HTML.
   */
  const renderList = async (req, state = {}) => {
    const { text, patterns } = searchPatterns(req.query.q);
    const rows = await guides.list({ patterns });
    const values = state.values || { name: '', slug: '' };
    const errors = state.errors || {};
    return page(req, 'Reisleiders', html`<p><a href="/reisleider/">Bekijk op de site</a></p>
      ${req.query.verwijderd === '1' ? html`<p class="notice" role="status">De reisleider is verwijderd. Het adres verwijst nu naar de lijst met reisleiders.</p>` : ''}
      ${renderAlert(state.error)}
      <form class="crm-search" method="get" action="${BASE}" role="search">
        <label for="reisleider-q">Zoek op naam</label>
        <input id="reisleider-q" name="q" type="search" value="${text}" maxlength="100">
        <button class="btn btn--small" type="submit">Zoeken</button>
      </form>
      ${rows.length ? html`<div class="crm-table-wrap"><table class="crm-table">
        <thead><tr><th>Naam</th><th>Status</th><th>Reizen</th><th>Volgorde</th></tr></thead>
        <tbody>${rows.map((row) => html`<tr>
          <td><a href="${BASE}${row.id}/">${row.name}${row.surname ? ` ${row.surname}` : ''}</a></td>
          <td>${row.published ? 'Online' : 'Offline'}</td>
          <td>${String(row.trip_count)}</td>
          <td>${String(row.sort_order)}</td>
        </tr>`)}</tbody>
      </table></div>` : html`<p>Geen reisleiders gevonden.</p>`}
      <section class="crm-block">
        <details class="cms-style"${state.errors ? raw(' open') : ''}><summary>Nieuwe reisleider</summary>
          <form class="form crm-narrow" method="post" action="${BASE}nieuw/">
            <input type="hidden" name="_csrf" value="${req.session.csrf}">
            ${fieldRow({ id: 'nieuw-name', label: 'Voornaam', error: errors.name, control: html`<input id="nieuw-name" name="name" type="text" value="${values.name}" maxlength="${GUIDE_LIMITS.name}" required${invalidAttributes('nieuw-name', errors.name)}>` })}
            ${fieldRow({ id: 'nieuw-slug', label: 'Adres', error: errors.slug, help: 'Kleine letters, cijfers en streepjes. Leeg = gemaakt uit de naam.', control: html`<input id="nieuw-slug" name="slug" type="text" value="${values.slug}" maxlength="${MAX_SLUG_LENGTH}" pattern="[a-z0-9]+(-[a-z0-9]+)*"${invalidAttributes('nieuw-slug', errors.slug)}>` })}
            <div><button class="btn btn--small" type="submit">Aanmaken</button></div>
          </form>
        </details>
      </section>`);
  };

  /**
   * Het bewerkscherm van één reisleider.
   * @param {object} req Express-verzoek.
   * @param {object} guide Rij.
   * @param {{error?: string, values?: object, errors?: object}} [state] Fouten.
   * @returns {string} HTML.
   */
  const renderEdit = (req, guide, state = {}) => {
    const values = state.values || guideFormValues(guide);
    const errors = state.errors || {};
    const portrait = guide.photo_url;
    const image = guide.image_url;
    /**
     * Eén tekstveld.
     * @param {string} name Veldnaam.
     * @param {string} label Label.
     * @param {number} max Maximale lengte.
     * @param {string} [help] Uitleg.
     * @returns {object} HTML.
     */
    const input = (name, label, max, help) => fieldRow({ id: `reisleider-${name}`, label, help, error: errors[name], control: html`<input id="reisleider-${name}" name="${name}" type="text" value="${values[name]}" maxlength="${max}"${name === 'name' ? raw(' required') : ''}${invalidAttributes(`reisleider-${name}`, errors[name])}>` });
    const notice = NOTICES[req.query.opgeslagen];
    return page(req, `Reisleider: ${guide.name}`, html`${notice ? html`<p class="notice" role="status">${notice}</p>` : ''}
      ${renderAlert(state.error)}
      ${renderGuideStatus(guide, req.session.csrf)}
      <div class="crm-tabbed" data-tabs>
        ${ui.renderTabNav([{ key: 'profiel-tab', label: 'Profiel' }, { key: 'fotos-tab', label: 'Foto\'s' }, { key: 'verwijderen', label: 'Verwijderen' }])}
        ${ui.renderTabPanel('profiel-tab', html`<form class="form crm-block" method="post" action="${BASE}${guide.id}/" id="profiel">
        <h2>Profiel</h2>
        <input type="hidden" name="_csrf" value="${req.session.csrf}">
        ${input('name', 'Voornaam', GUIDE_LIMITS.name)}
        ${input('surname', 'Achternaam', GUIDE_LIMITS.surname)}
        ${input('slug', 'Adres', MAX_SLUG_LENGTH, `/reisleider/${values.slug || '…'}/ · wijzig je het adres, dan verwijst het oude automatisch door.`)}
        ${input('city', 'Woonplaats', GUIDE_LIMITS.city)}
        ${fieldRow({ id: 'reisleider-since', label: 'Bij Avanta sinds', error: errors.since, control: html`<input id="reisleider-since" name="since" type="text" inputmode="numeric" value="${values.since}" maxlength="4" pattern="(19|20)[0-9]{2}"${invalidAttributes('reisleider-since', errors.since)}>` })}
        ${input('quote', 'Citaat', GUIDE_LIMITS.quote)}
        ${fieldRow({ id: 'reisleider-sort_order', label: 'Volgorde', error: errors.sort_order, help: 'Lager staat eerder in de lijst met reisleiders op de site; bij gelijke nummers op naam.', control: html`<input id="reisleider-sort_order" name="sort_order" type="number" step="1" value="${values.sortOrder === null || values.sortOrder === undefined ? '' : String(values.sortOrder)}"${invalidAttributes('reisleider-sort_order', errors.sort_order)}>` })}
        ${fieldRow({ id: 'reisleider-intro', label: 'Korte inleiding (zoekmachines en delen)', error: errors.intro, control: html`<textarea id="reisleider-intro" name="intro" rows="3" maxlength="${GUIDE_LIMITS.intro}"${invalidAttributes('reisleider-intro', errors.intro)}>${values.intro}</textarea>` })}
        ${fieldRow({ id: 'reisleider-body', label: 'Over deze reisleider', error: errors.body, help: RICHTEXT_HELP, control: html`<textarea id="reisleider-body" name="body" rows="14" class="cms-richtext" maxlength="${GUIDE_LIMITS.body}"${invalidAttributes('reisleider-body', errors.body)}>${values.bodyInput}</textarea>` })}
        ${ui.renderSaveBar({ label: 'Opslaan' })}
      </form>`)}
        ${ui.renderTabPanel('fotos-tab', html`<section class="crm-block" id="fotos">
        <h2>Foto's</h2>
        ${Object.entries(PHOTO_FIELDS).map(([kind, field]) => {
          const url = kind === 'portret' ? portrait : image;
          return html`<div class="crm-block">
            <h3>${field.label}</h3>
            ${url ? html`<img class="media-preview media-preview--small" src="${url}" alt="" width="400" height="300">` : html`<p>Nog geen foto.</p>`}
            <p><a href="${BASE}${guide.id}/foto/${kind}/">${url ? 'Andere foto kiezen' : 'Foto kiezen'}</a></p>
          </div>`;
        })}
        <p class="field__help">Het portret staat in de lijst met reisleiders en op de eigen pagina; de tweede foto staat op de pagina naast het portret.</p>
      </section>
      ${renderGallerySection(guide, guideGallery(guide), req.session.csrf)}`)}
        ${ui.renderTabPanel('verwijderen', html`<form class="crm-block crm-actions" method="post" action="${BASE}${guide.id}/verwijderen/">
        <input type="hidden" name="_csrf" value="${req.session.csrf}">
        <p class="field__help">Verwijderen kan alleen bij een reisleider die offline staat, niet van de huidige site komt en aan geen reis hangt. Anders: offline halen.</p>
        <label class="checkbox"><input type="checkbox" name="zeker" value="ja" required> Ja, verwijder deze reisleider</label>
        <button class="btn btn--small btn--outline" type="submit">Verwijderen</button>
      </form>`)}
      </div>`, ui.renderActions([guide.published ? { label: 'Bekijk op de site', href: guidePath(guide.slug) } : null]));
  };

  /**
   * De fotokiezer voor het portret of de tweede foto.
   * @param {object} req Express-verzoek.
   * @param {object} guide Rij.
   * @param {string} kind `portret` of `kopfoto`.
   * @param {{error?: string}} [state] Fout.
   * @returns {Promise<string>} HTML.
   */
  const renderPhoto = async (req, guide, kind, state = {}) => {
    const countries = await library.countries();
    const filter = pickerFilter(req.query, countries);
    const { photos, hasMore } = await pickerPhotos(library, filter);
    const pageUrl = `${BASE}${guide.id}/foto/${kind}/`;
    return page(req, `${PHOTO_FIELDS[kind].label}: ${guide.name}`, html`<p><a href="${BASE}${guide.id}/#fotos">Terug naar ${guide.name}</a></p>
      ${renderAlert(state.error)}
      <section class="crm-block" id="foto">
        ${renderPhotoPicker({ pageUrl, action: pageUrl, csrf: req.session.csrf, countries, filter, photos, hasMore, allowNone: true, button: 'Deze foto gebruiken' })}
      </section>`);
  };

  router.get('/reisleiders/', guard, handle(async (req, res) => res.send(await renderList(req))));

  router.post('/reisleiders/nieuw/', guard, auth.checkCsrf, handle(async (req, res) => {
    const name = typeof req.body.name === 'string' ? req.body.name.replace(/\s+/g, ' ').trim().slice(0, GUIDE_LIMITS.name + 1) : '';
    const slug = (typeof req.body.slug === 'string' ? req.body.slug.trim() : '') || slugify(name);
    const errors = {};
    if (!name) errors.name = 'Vul een voornaam in.';
    else if (name.length > GUIDE_LIMITS.name || /[<>]/.test(name)) errors.name = `Maximaal ${GUIDE_LIMITS.name} tekens, zonder < of >.`;
    if (!isValidSlug(slug)) errors.slug = 'Gebruik kleine letters, cijfers en streepjes (bijv. martijn).';
    const values = { name, slug };
    const outcome = Object.keys(errors).length ? { errors } : await guides.create(values, {
      userId: req.user.id,
      audit: (client, id) => auth.audit(req, { userId: req.user.id, action: 'reisleider.nieuw', entity: 'guides', entityId: id }, client),
    });
    if (outcome.errors) return res.status(422).send(await renderList(req, { error: 'Controleer de velden.', values, errors: outcome.errors }));
    if (outcome.cleared && options.redirects) await options.redirects.reload().catch(() => {});
    return res.redirect(303, `${BASE}${outcome.id}/?opgeslagen=6`);
  }));

  router.get(routePath('/reisleiders/:id(\\d{1,9})/'), guard, handle(async (req, res) => {
    const guide = await loadOr404(req, res);
    return guide ? res.send(renderEdit(req, guide)) : undefined;
  }));

  router.post(routePath('/reisleiders/:id(\\d{1,9})/'), guard, auth.checkCsrf, handle(async (req, res) => {
    const guide = await loadOr404(req, res);
    if (!guide) return undefined;
    const { values, errors } = validateGuideFields(req.body);
    const outcome = Object.keys(errors).length ? { status: 'fout', errors } : await guides.update(guide.id, values, contextFor(req, guide, 'reisleider.gewijzigd'));
    if (outcome.status === 'weg') return notFound(req, res);
    if (outcome.status === 'fout') return res.status(422).send(renderEdit(req, guide, { error: 'Controleer de velden.', values, errors: outcome.errors }));
    if (outcome.moved && options.redirects) await options.redirects.reload().catch(() => {});
    return res.redirect(303, `${BASE}${guide.id}/?opgeslagen=${outcome.moved ? 2 : 1}#profiel`);
  }));

  router.post(routePath('/reisleiders/:id(\\d{1,9})/online/'), guard, auth.checkCsrf, handle(async (req, res) => {
    const guide = await loadOr404(req, res);
    if (!guide) return undefined;
    const online = req.body.stand === 'online';
    if (!online && req.body.stand !== 'offline') return res.status(422).send(renderEdit(req, guide, { error: 'Kies online of offline.' }));
    const outcome = await guides.setOnline(guide.id, online, contextFor(req, guide, 'reisleider.online'));
    if (outcome.status === 'weg') return notFound(req, res);
    return res.redirect(303, `${BASE}${guide.id}/?opgeslagen=${online ? 4 : 5}#status`);
  }));

  router.get(routePath('/reisleiders/:id(\\d{1,9})/foto/:kind(portret|kopfoto)/'), guard, handle(async (req, res) => {
    const guide = await loadOr404(req, res);
    return guide ? res.send(await renderPhoto(req, guide, req.params.kind)) : undefined;
  }));

  router.post(routePath('/reisleiders/:id(\\d{1,9})/foto/:kind(portret|kopfoto)/'), guard, auth.checkCsrf, handle(async (req, res) => {
    const guide = await loadOr404(req, res);
    if (!guide) return undefined;
    const none = req.body.geen === '1';
    const mediaId = none ? null : req.body.media_id;
    if (!none && (typeof mediaId !== 'string' || !/^\d{1,9}$/.test(mediaId))) return res.status(422).send(await renderPhoto(req, guide, req.params.kind, { error: 'Kies een foto.' }));
    const outcome = await guides.setPhoto(guide.id, req.params.kind, none ? null : Number(mediaId), contextFor(req, guide, 'reisleider.foto'));
    if (outcome === 'weg') return notFound(req, res);
    if (outcome === 'foto-weg') return res.status(409).send(await renderPhoto(req, guide, req.params.kind, { error: 'Deze foto bestaat niet meer. Kies een andere.' }));
    return res.redirect(303, `${BASE}${guide.id}/?opgeslagen=3#fotos`);
  }));

  /**
   * De fotokiezer om foto's aan de galerij toe te voegen (meerdere tegelijk).
   * @param {object} req Express-verzoek.
   * @param {object} guide Rij.
   * @param {{error?: string}} [state] Fout.
   * @returns {Promise<string>} HTML.
   */
  const renderGalleryPicker = async (req, guide, state = {}) => {
    const countries = await library.countries();
    const filter = pickerFilter(req.query, countries);
    const { photos, hasMore } = await pickerPhotos(library, filter);
    const pageUrl = `${BASE}${guide.id}/galerij/toevoegen/`;
    return page(req, `Galerij: ${guide.name}`, html`<p><a href="${BASE}${guide.id}/#galerij">Terug naar ${guide.name}</a></p>
      ${renderAlert(state.error)}
      <section class="crm-block" id="foto">
        ${renderPhotoPicker({ pageUrl, action: pageUrl, csrf: req.session.csrf, countries, filter, photos, hasMore, multiple: true, button: 'Toevoegen aan de galerij' })}
      </section>`);
  };

  router.get(routePath('/reisleiders/:id(\\d{1,9})/galerij/toevoegen/'), guard, handle(async (req, res) => {
    const guide = await loadOr404(req, res);
    return guide ? res.send(await renderGalleryPicker(req, guide)) : undefined;
  }));

  router.post(routePath('/reisleiders/:id(\\d{1,9})/galerij/toevoegen/'), guard, auth.checkCsrf, handle(async (req, res) => {
    const guide = await loadOr404(req, res);
    if (!guide) return undefined;
    const ids = [].concat(req.body.media_id || []);
    const valid = ids.length > 0 && ids.length <= GUIDE_LIMITS.gallery && ids.every((id) => typeof id === 'string' && /^\d{1,9}$/.test(id));
    if (!valid) return res.status(422).send(await renderGalleryPicker(req, guide, { error: 'Kies een of meer foto\'s.' }));
    const outcome = await guides.addGalleryPhotos(guide.id, ids.map(Number), contextFor(req, guide, 'reisleider.galerij'));
    if (outcome === 'weg') return notFound(req, res);
    if (outcome === 'foto-weg') return res.status(409).send(await renderGalleryPicker(req, guide, { error: 'Een van deze foto\'s bestaat niet meer. Kies opnieuw.' }));
    if (outcome === 'te-veel') return res.status(422).send(await renderGalleryPicker(req, guide, { error: `De galerij heeft hoogstens ${GUIDE_LIMITS.gallery} foto's.` }));
    return res.redirect(303, `${BASE}${guide.id}/?opgeslagen=7#galerij`);
  }));

  router.post(routePath('/reisleiders/:id(\\d{1,9})/galerij/'), guard, auth.checkCsrf, handle(async (req, res) => {
    const guide = await loadOr404(req, res);
    if (!guide) return undefined;
    const fingerprint = typeof req.body.galerij === 'string' ? req.body.galerij : '';
    const outcome = await guides.arrangeGallery(guide.id, { fingerprint, body: req.body }, contextFor(req, guide, 'reisleider.galerij'));
    if (outcome === 'weg') return notFound(req, res);
    if (outcome === 'gewijzigd') return res.status(409).send(renderEdit(req, await guides.get(guide.id), { error: 'De galerij is intussen gewijzigd. Controleer de foto\'s en probeer het opnieuw.' }));
    return res.redirect(303, `${BASE}${guide.id}/?opgeslagen=7#galerij`);
  }));

  router.post(routePath('/reisleiders/:id(\\d{1,9})/galerij/tekst/'), guard, auth.checkCsrf, handle(async (req, res) => {
    const guide = await loadOr404(req, res);
    if (!guide) return undefined;
    const outcome = await guides.setGalleryText(guide.id, { title: req.body.gallery_title, subtitle: req.body.gallery_subtitle }, contextFor(req, guide, 'reisleider.galerij'));
    if (outcome === 'weg') return notFound(req, res);
    return res.redirect(303, `${BASE}${guide.id}/?opgeslagen=7#galerij`);
  }));

  router.post(routePath('/reisleiders/:id(\\d{1,9})/verwijderen/'), guard, auth.checkCsrf, handle(async (req, res) => {
    const guide = await loadOr404(req, res);
    if (!guide) return undefined;
    if (req.body.zeker !== 'ja') return res.status(422).send(renderEdit(req, guide, { error: 'Vink aan dat je wilt verwijderen.' }));
    const outcome = await guides.remove(guide.id, { userId: req.user.id, audit: contextFor(req, guide, 'reisleider.verwijderd').audit });
    if (outcome.status === 'weg') return notFound(req, res);
    const refusals = {
      online: 'Haal de reisleider eerst offline.',
      import: 'Deze reisleider komt van de huidige site en zou bij een nieuwe import terugkomen. Haal hem offline.',
      reizen: 'Deze reisleider hangt nog aan een reis. Haal hem daar eerst weg, of haal hem offline.',
    };
    if (refusals[outcome.status]) return res.status(409).send(renderEdit(req, guide, { error: refusals[outcome.status] }));
    if (options.redirects) await options.redirects.reload().catch(() => {});
    return res.redirect(303, `${BASE}?verwijderd=1`);
  }));

  return router;
}

module.exports = { createGuideRoutes, GUIDE_ACTION_LABELS, BASE };
