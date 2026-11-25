// @ts-check
/**
 * Koppen van de lijstpagina's beheren in het CRM (`/app/lijstpaginas/`, recht `content`, W28): overzicht van de vijf
 * koppen (Reizen, Reisleiders, Blog, Veelgestelde vragen en het aanmeldformulier), per kop pretitel, titel en
 * inleiding wijzigen en een foto uit de fotobibliotheek kiezen. Elke wijziging in de auditlog.
 */
const express = require('express');
const { routePath } = require('../route-path');
const { html } = require('../site/html');
const { renderCrmPage, renderAlert } = require('../crm/layout');
const { renderMountPoint } = require('../crm/web-bundle');
const ui = require('../crm/ui');
const { createMediaLibrary } = require('../media/library');
const { pickerFilter, pickerPhotos, renderPhotoPicker } = require('../media/picker');
const { fieldRow, invalidAttributes, chosenPhoto } = require('./block-editor');
const { createListHeaders, validateListHeaderFields, isListKey, LIST_HEADER_LIMITS } = require('./list-headers');
const { createListHeaderReads } = require('./list-header-api');

/** Basispad van het scherm. */
const BASE = '/app/lijstpaginas/';

/** Route-patroon van een kop: alleen de vaste sleutels. */
const KEY_PATTERN = ':key(reis|reisleider|blog|faq|aanmelden)';

/** Acties voor het auditlog (zie `ACTION_LABELS` in `crm/users.js`). */
const LIST_HEADER_ACTION_LABELS = {
  'lijstkop.gewijzigd': 'Kop van een lijstpagina gewijzigd',
  'lijstkop.foto': 'Foto van een lijstpagina gewijzigd',
};

/** Meldingen op het bewerkscherm (`?opgeslagen=<n>`). */
const NOTICES = { 1: 'Opgeslagen.', 2: 'De foto is opgeslagen.' };

/** Waar de kop vandaan komt, voor het overzicht. */
const SOURCE_LABELS = { standaard: 'Standaardtekst', bestand: 'Overgenomen van de huidige site', crm: 'Gewijzigd in het CRM' };

/**
 * Maakt de routes voor de koppen van de lijstpagina's. Is de bundel van de schermen in Vue er
 * (`app/web/src/modules/lijstpaginas/`, in het image altijd), dan geven de GET-routes de pagina met het koppelpunt en
 * praten de schermen met `list-header-api.js`; zonder bundel (lokaal zonder bouwstap, de tests) blijven de schermen van
 * de server werken. De oude schermen gaan weg na de overgang naar `main` (fase V3 van de ombouw, `docs/VUE-OMBOUW.md`).
 * @param {{db: any, auth: any, listHeaders?: any, library?: any, mediaDir?: string, webBundle?: {assetsFor: (name: string) => any}}} options
 *   Database, sessie- en rechtenlaag, de gedeelde koppen (`createListHeaders`, zodat de site meteen de nieuwe tekst
 *   toont), de fotobibliotheek en de lezer van het manifest van de bundels.
 * @returns {express.Router} Router.
 */
function createListHeaderRoutes(options) {
  const { db, auth } = options;
  const headers = options.listHeaders || createListHeaders({ db });
  const library = options.library || createMediaLibrary({ db, mediaDir: options.mediaDir || '' });
  const reads = createListHeaderReads({ db, listHeaders: headers, mediaLibrary: library });
  const router = express.Router();
  const guard = auth.requireRight('content');

  /**
   * Stuurt de pagina met het koppelpunt van de schermen in Vue, als de bundel er is.
   * @param {any} req Express-verzoek.
   * @param {any} res Express-antwoord.
   * @param {string} title Titel van de pagina (het scherm zet hem daarna zelf bij een wissel).
   * @param {() => Promise<Record<string, any>>} [preload] Antwoorden van de API voor het eerste scherm, per pad (alleen
   *   opgehaald als de bundel er is): het scherm tekent dan meteen, zonder extra verzoek.
   * @returns {Promise<boolean>} Waar als de pagina is gestuurd; onwaar zonder bundel.
   */
  const sendVuePage = async (req, res, title, preload) => {
    const bundle = options.webBundle ? options.webBundle.assetsFor('lijstpaginas') : null;
    if (!bundle) return false;
    res.send(renderCrmPage({ title, user: req.user, csrf: req.session.csrf, path: BASE, bundle, body: renderMountPoint({ name: 'lijstpaginas', base: BASE, available: true, preload: preload ? await preload() : undefined }) }));
    return true;
  };

  /**
   * Een CRM-pagina binnen de lijstpagina's.
   * @param {any} req Express-verzoek.
   * @param {string} title Titel.
   * @param {object} body HTML.
   * @param {any} [actions] Knoppen naast de titel.
   * @returns {string} HTML.
   */
  const page = (req, title, body, actions) => renderCrmPage({ title, user: req.user, csrf: req.session.csrf, path: BASE, body, actions });

  /**
   * Context voor een wijziging: gebruiker en audit.
   * @param {any} req Express-verzoek.
   * @param {string} action Actie.
   * @returns {{userId: number, audit: (client: object) => Promise<void>}} Context.
   */
  const contextFor = (req, action) => ({
    userId: req.user.id,
    audit: (client) => auth.audit(req, { userId: req.user.id, action, entity: 'list_headers', entityId: req.params.key }, client),
  });

  /**
   * Zet een asynchrone handler om in Express-middleware met foutafhandeling.
   * @param {(req: any, res: any) => Promise<*>} handler Handler.
   * @returns {(req: any, res: any, next: Function) => Promise<*>} Middleware.
   */
  const handle = (handler) => async (req, res, next) => {
    try {
      return await handler(req, res);
    } catch (error) {
      return next(error);
    }
  };

  /**
   * Eén kop uit het overzicht.
   * @param {string} key Sleutel.
   * @returns {Promise<any>} Kop met naam en adres.
   */
  const headerOf = async (/** @type {string} */ key) => (await headers.list()).find((/** @type {any} */ item) => item.key === key);

  /**
   * Het bewerkscherm van één kop.
   * @param {any} req Express-verzoek.
   * @param {{error?: string, values?: object, errors?: Record<string, string>}} [state] Fouten.
   * @returns {Promise<string>} HTML.
   */
  const renderEdit = async (req, state = {}) => {
    const header = await headerOf(req.params.key);
    const values = state.values || header;
    const errors = state.errors || {};
    /**
     * Eén tekstveld.
     * @param {('pretitle'|'title')} name Veld.
     * @param {string} label Label.
     * @param {string} [help] Uitleg.
     * @returns {object} HTML.
     */
    const input = (name, label, help) => fieldRow({ id: `kop-${name}`, label, help, error: errors[name], control: html`<input id="kop-${name}" name="${name}" type="text" value="${values[name]}" maxlength="${LIST_HEADER_LIMITS[name]}"${name === 'title' ? html` required` : ''}${invalidAttributes(`kop-${name}`, errors[name])}>` });
    const notice = NOTICES[/** @type {keyof typeof NOTICES} */ (req.query.opgeslagen)];
    return page(req, `Lijstpagina: ${header.label}`, html`<p><a href="${BASE}">Terug naar de lijstpagina's</a></p>
      ${notice ? html`<p class="notice" role="status">${notice}</p>` : ''}
      ${renderAlert(state.error)}
      <form class="form crm-block" method="post" action="${BASE}${header.key}/" id="kop">
        <h2>Kop</h2>
        <input type="hidden" name="_csrf" value="${req.session.csrf}">
        ${input('pretitle', 'Pretitel', 'Kleine regel boven de titel.')}
        ${input('title', 'Titel')}
        ${fieldRow({ id: 'kop-introduction', label: 'Inleiding', error: errors.introduction, help: header.key === 'reis' || header.key === 'faq' ? 'Deze pagina toont geen inleiding; de tekst wordt wel bewaard.' : '', control: html`<textarea id="kop-introduction" name="introduction" rows="3" maxlength="${LIST_HEADER_LIMITS.introduction}"${invalidAttributes('kop-introduction', errors.introduction)}>${values.introduction}</textarea>` })}
        ${ui.renderSaveBar({ label: 'Opslaan' })}
      </form>
      <section class="crm-block" id="foto">
        <h2>Foto</h2>
        ${header.image ? html`<img class="media-preview media-preview--small" src="${header.image}" alt="" width="400" height="300">` : html`<p>Nog geen foto; de kop toont dan alleen de tekst.</p>`}
        <p><a href="${BASE}${header.key}/foto/">${header.image ? 'Andere foto kiezen' : 'Foto kiezen'}</a></p>
      </section>`, ui.renderActions([header.path ? { label: 'Bekijk op de site', href: header.path } : null]));
  };

  /**
   * De fotokiezer voor een kop.
   * @param {any} req Express-verzoek.
   * @param {{error?: string}} [state] Fout.
   * @returns {Promise<string>} HTML.
   */
  const renderPhoto = async (req, state = {}) => {
    const header = await headerOf(req.params.key);
    const countries = await library.countries();
    const filter = pickerFilter(req.query, countries);
    const { photos, hasMore } = await pickerPhotos(library, filter);
    const pageUrl = `${BASE}${header.key}/foto/`;
    return page(req, `Foto: ${header.label}`, html`<p><a href="${BASE}${header.key}/#foto">Terug naar ${header.label}</a></p>
      ${renderAlert(state.error)}
      <section class="crm-block" id="foto">
        ${renderPhotoPicker({ pageUrl, action: pageUrl, csrf: req.session.csrf, countries, filter, photos, hasMore, allowNone: Boolean(header.image), button: 'Deze foto gebruiken' })}
      </section>`);
  };

  router.get('/lijstpaginas/', guard, handle(async (req, res) => {
    if (await sendVuePage(req, res, 'Lijstpagina\'s', async () => ({ '/lijstpaginas/': await reads.overview() }))) return undefined;
    const rows = await headers.list();
    return res.send(page(req, 'Lijstpagina\'s', html`<p>De kop bovenaan de pagina's met reizen, reisleiders, blog en veelgestelde vragen, en boven het aanmeldformulier.</p>
      ${ui.renderTable({
        columns: [
          { label: 'Pagina', cell: (/** @type {any} */ row) => html`<a href="${BASE}${row.key}/">${row.label}</a>` },
          { label: 'Titel', cell: (/** @type {any} */ row) => row.title, wrap: true },
          { label: 'Foto', cell: (/** @type {any} */ row) => (row.image ? 'Ja' : 'Nee') },
          { label: 'Inhoud', cell: (/** @type {any} */ row) => SOURCE_LABELS[/** @type {keyof typeof SOURCE_LABELS} */ (row.source)] || row.source },
        ],
        rows,
        empty: 'Geen lijstpagina\'s.',
      })}`));
  }));

  router.get(routePath(`/lijstpaginas/${KEY_PATTERN}/`), guard, handle(async (req, res) => {
    if (await sendVuePage(req, res, `Lijstpagina: ${(await headerOf(req.params.key)).label}`, async () => ({ [`/lijstpaginas/${req.params.key}/`]: await reads.header(req.params.key), '/lijstpaginas/': await reads.overview() }))) return undefined;
    return res.send(await renderEdit(req));
  }));

  router.post(routePath(`/lijstpaginas/${KEY_PATTERN}/`), guard, auth.checkCsrf, handle(async (req, res) => {
    const { values, errors } = validateListHeaderFields(req.body);
    if (Object.keys(errors).length) return res.status(422).send(await renderEdit(req, { error: 'Controleer de velden.', values, errors }));
    await headers.update(req.params.key, values, contextFor(req, 'lijstkop.gewijzigd'));
    return res.redirect(303, `${BASE}${req.params.key}/?opgeslagen=1`);
  }));

  router.get(routePath(`/lijstpaginas/${KEY_PATTERN}/foto/`), guard, handle(async (req, res) => {
    if (await sendVuePage(req, res, `Foto: ${(await headerOf(req.params.key)).label}`, async () => ({ [`/lijstpaginas/${req.params.key}/`]: await reads.header(req.params.key), [`/lijstpaginas/${req.params.key}/fotos/?pagina=1`]: await reads.photos({ page: 1 }) }))) return undefined;
    return res.send(await renderPhoto(req));
  }));

  router.post(routePath(`/lijstpaginas/${KEY_PATTERN}/foto/`), guard, auth.checkCsrf, handle(async (req, res) => {
    const choice = chosenPhoto(req.body);
    if (!choice.valid) return res.status(422).send(await renderPhoto(req, { error: 'Kies een foto.' }));
    const outcome = await headers.setImage(req.params.key, choice.none ? null : Number(choice.mediaId), contextFor(req, 'lijstkop.foto'));
    if (outcome === 'foto-weg') return res.status(409).send(await renderPhoto(req, { error: 'Deze foto bestaat niet meer. Kies een andere.' }));
    return res.redirect(303, `${BASE}${req.params.key}/?opgeslagen=2#foto`);
  }));

  return router;
}

module.exports = { createListHeaderRoutes, LIST_HEADER_ACTION_LABELS, BASE, isListKey };
