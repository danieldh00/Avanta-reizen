// @ts-check
/**
 * Beheer > Vindbaarheid: doorverwijzingen (301/302) en de lijst met niet-gevonden adressen (404). Alleen met het recht
 * `systeem`; elke wijziging komt in het auditlog (welke doorverwijzing, nooit een pad uit de 404-lijst). De laag zelf
 * (geheugen, tellers, opruimen) staat in `site/redirects.js`.
 */
const express = require('express');
const { routePath } = require('../route-path');
const { html } = require('../site/html');
const { renderAlert, formatDateTime } = require('../crm/layout');
const { validateRedirect, normalizePath, MAX_NOT_FOUND_ROWS, NOT_FOUND_RETENTION_DAYS } = require('../site/redirects');

/** Hoogste aantal doorverwijzingen (ze staan allemaal in het geheugen). */
const MAX_REDIRECTS = 5000;

/** Hoogste aantal regels dat een lijst in één keer toont. */
const LIST_LIMIT = 200;

/** Hoogste lengte van een notitie bij een doorverwijzing. */
const MAX_NOTE_LENGTH = 200;

/**
 * Een pad leesbaar voor het scherm (procentcodering terug naar tekens als ë).
 * @param {string} path Gecodeerd pad.
 * @returns {string} Leesbaar pad.
 */
function readablePath(path) {
  try {
    return decodeURI(path);
  } catch (_) {
    return path;
  }
}

/**
 * Leest één veld uit een formulier als tekst; een herhaald veld (lijst) of een ontbrekend veld geeft leeg.
 * @param {any} body Ingezonden velden.
 * @param {string} name Naam van het veld.
 * @returns {string} Tekst.
 */
function bodyText(body, name) {
  const value = Object.hasOwn(body, name) ? body[name] : '';
  return typeof value === 'string' ? value : '';
}

/** Vaste sleutel voor `pg_advisory_xact_lock`: toevoegen van doorverwijzingen gebeurt één voor één. */
const REDIRECTS_LOCK_KEY = 726001;

/** Melding als er voor het oude pad al een doorverwijzing is. */
const TAKEN_MESSAGE = 'Voor dit pad bestaat al een doorverwijzing. Verwijder die eerst.';

/** Wat er al bestaat rond een nieuwe doorverwijzing: oud pad bezet, doel zelf doorverwezen, oud pad al een doel, aantal. */
const CHAIN_QUERY = `SELECT
   EXISTS (SELECT 1 FROM redirects WHERE from_path = $1) AS taken,
   EXISTS (SELECT 1 FROM redirects WHERE from_path = ANY($2::text[])) AS target_redirected,
   EXISTS (SELECT 1 FROM redirects WHERE split_part(to_url, '?', 1) = $1 OR split_part(to_url, '?', 1) || '/' = $1) AS source_is_target,
   (SELECT count(*)::int FROM redirects) AS total`;

/**
 * De oude paden die een doel raakt: een doorverwijzing van `/x/` geldt ook voor `/x`, dus een doel `/x` raakt beide.
 * @param {string} toUrl Nieuw adres.
 * @returns {string[]} Paden (leeg bij een extern adres).
 */
function targetKeysOf(toUrl) {
  const targetPath = toUrl.startsWith('/') ? toUrl.split('?')[0] : '';
  return targetPath ? [targetPath, ...(targetPath.endsWith('/') ? [] : [`${targetPath}/`])] : [];
}

/**
 * Controleert een nieuwe doorverwijzing tegen de bestaande: geen lus, dubbel, keten of overschrijding van het maximum.
 * @param {{fromPath: string, toUrl: string}} values Oud pad en nieuw adres.
 * @param {{taken: boolean, target_redirected: boolean, source_is_target: boolean, total: number}} existing Uitkomst van `CHAIN_QUERY`.
 * @returns {any} Fouten per veld (leeg als alles klopt).
 */
function chainProblems(values, existing) {
  if (targetKeysOf(values.toUrl).includes(values.fromPath)) return { to: 'Het nieuwe adres komt weer uit bij het oude pad.' };
  if (existing.taken) return { from: TAKEN_MESSAGE };
  if (existing.source_is_target) return { from: 'Naar dit pad wordt al doorverwezen. Pas die doorverwijzing aan, zodat er geen keten ontstaat.' };
  if (existing.target_redirected) return { to: 'Dit adres wordt zelf doorverwezen. Kies het uiteindelijke adres.' };
  if (existing.total >= MAX_REDIRECTS) return { from: `Er kunnen hoogstens ${MAX_REDIRECTS} doorverwijzingen zijn.` };
  return {};
}

/**
 * Maakt een zoekterm geschikt voor `ILIKE`: `%`, `_` en `\` gelden letterlijk.
 * @param {string} text Zoekterm.
 * @returns {string} Patroon met `%` aan beide kanten.
 */
function likePattern(text) {
  return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/**
 * Maakt de routes voor doorverwijzingen en de 404-lijst.
 * @param {{db: any, auth: any, guard: Function, redirects: any, renderBeheerPage: Function, notFound: Function}} options
 *   Database, sessie- en auditlaag, de rechtencontrole, de laag voor doorverwijzingen, en de pagina-opmaak en 404 van Beheer.
 * @returns {express.Router} Router, te koppelen vóór de algemene secties van Beheer.
 */
function createRedirectRoutes(options) {
  const { db, auth, guard, redirects, renderBeheerPage, notFound } = options;
  const router = express.Router();

  /**
   * De pagina met doorverwijzingen: formulier voor een nieuwe en de lijst (eventueel gefilterd).
   * @param {any} req Express-verzoek.
   * @param {{values?: any, errors?: any}} [state] Ingevulde waarden en fouten na een mislukte poging.
   * @returns {Promise<string>} HTML-pagina.
   */
  const renderRedirectsPage = async (req, state = {}) => {
    const filter = typeof req.query.filter === 'string' ? req.query.filter.trim().slice(0, 100) : '';
    const pattern = likePattern(filter);
    const [rows, [{ total }]] = await Promise.all([
      db.query(
        `SELECT id, from_path, to_url, status, note, hits, last_hit_at FROM redirects
          WHERE $1 = '' OR from_path ILIKE $2 OR to_url ILIKE $2 OR from_path ILIKE $3
          ORDER BY from_path LIMIT $4`,
        [filter, pattern, likePattern(encodeURI(filter)), LIST_LIMIT],
      ),
      db.query('SELECT count(*)::int AS total FROM redirects'),
    ]);
    const errors = state.errors || {};
    const prefill = typeof req.query.van === 'string' ? normalizePath(req.query.van) : '';
    const values = state.values || { from: prefill ? readablePath(prefill) : '', to: '', status: '301', note: '' };
    const field = (name, label, help, max) => html`<div class="field">
      <span class="field__label"><label for="doorverwijzing-${name}">${label}</label></span>
      <input id="doorverwijzing-${name}" name="${name}" type="text" value="${values[name] || ''}" maxlength="${max}"${errors[name] ? html` aria-invalid="true" aria-describedby="doorverwijzing-${name}-fout"` : ''}>
      ${help ? html`<span class="field__help">${help}</span>` : ''}
      ${errors[name] ? html`<span class="field__error" id="doorverwijzing-${name}-fout">${errors[name]}</span>` : ''}
    </div>`;
    return renderBeheerPage(req, {
      title: 'Doorverwijzingen',
      sectionId: 'doorverwijzingen',
      body: html`<p>Stuur bezoekers en zoekmachines van een oud adres naar de nieuwe pagina. Gebruik 301 (permanent) voor een
        pagina die is verhuisd; 302 (tijdelijk) alleen als het oude adres terugkomt.</p>
        ${req.query.opgeslagen === '1' ? html`<p class="notice" role="status">De doorverwijzing is opgeslagen.</p>` : ''}
        ${req.query.verwijderd === '1' ? html`<p class="notice" role="status">De doorverwijzing is verwijderd.</p>` : ''}
        ${renderAlert(Object.keys(errors).length ? 'Niet opgeslagen: controleer de gemarkeerde velden.' : '')}
        <form class="form beheer-form" method="post" action="/app/beheer/doorverwijzingen/">
          <input type="hidden" name="_csrf" value="${req.session.csrf}">
          ${field('from', 'Oud pad', 'Bijvoorbeeld /oude-pagina/. De querystring telt niet mee; een pad zonder / aan het eind werkt ook.', 300)}
          ${field('to', 'Nieuw adres', 'Een pad op de site (/reis/albanie/) of een volledig adres dat met https:// begint.', 500)}
          <div class="field">
            <span class="field__label"><label for="doorverwijzing-status">Soort</label></span>
            <select id="doorverwijzing-status" name="status">
              <option value="301"${values.status === '302' ? '' : html` selected`}>301: permanent verhuisd</option>
              <option value="302"${values.status === '302' ? html` selected` : ''}>302: tijdelijk</option>
            </select>
          </div>
          ${field('note', 'Notitie (niet verplicht)', 'Waarom deze doorverwijzing bestaat, alleen zichtbaar in Beheer.', MAX_NOTE_LENGTH)}
          <div><button class="btn" type="submit">Toevoegen</button></div>
        </form>
        <h2>Bestaande doorverwijzingen</h2>
        <form class="beheer-filter" method="get" action="/app/beheer/doorverwijzingen/" role="search">
          <label class="visually-hidden" for="doorverwijzing-filter">Filter op pad of adres</label>
          <input id="doorverwijzing-filter" type="search" name="filter" value="${filter}" maxlength="100" placeholder="Filter op pad of adres">
          <button class="btn btn--outline btn--small" type="submit">Filter</button>
        </form>
        <p>${filter ? `${rows.length} gevonden (van ${total}).` : `${total} ${total === 1 ? 'doorverwijzing' : 'doorverwijzingen'}${total > rows.length ? `, de eerste ${rows.length} getoond` : ''}.`}</p>
        ${rows.length ? html`<div class="crm-table-wrap"><table class="crm-table">
          <thead><tr><th scope="col">Oud pad</th><th scope="col">Nieuw adres</th><th scope="col">Soort</th><th scope="col">Gebruikt</th><th scope="col">Laatst</th><th scope="col">Notitie</th><th scope="col"><span class="visually-hidden">Actie</span></th></tr></thead>
          <tbody>${rows.map((row) => html`<tr>
            <td>${readablePath(row.from_path)}</td>
            <td>${readablePath(row.to_url)}</td>
            <td>${row.status}</td>
            <td>${row.hits}</td>
            <td>${row.last_hit_at ? formatDateTime(row.last_hit_at) : '–'}</td>
            <td>${row.note || '–'}</td>
            <td><form method="post" action="/app/beheer/doorverwijzingen/${row.id}/verwijderen">
              <input type="hidden" name="_csrf" value="${req.session.csrf}">
              <button class="btn btn--outline btn--small" type="submit">Verwijderen</button>
            </form></td>
          </tr>`)}</tbody>
        </table></div>` : ''}`,
    });
  };

  /**
   * De 404-lijst: de vaakst gevraagde adressen die niet bestaan, met een knop om ze door te verwijzen.
   * @param {any} req Express-verzoek.
   * @returns {Promise<string>} HTML-pagina.
   */
  const renderNotFoundPage = async (req) => {
    const [rows, [{ total }]] = await Promise.all([
      db.query('SELECT path, hits, first_seen_at, last_seen_at, referrer_host FROM not_found_log ORDER BY hits DESC, path LIMIT $1', [LIST_LIMIT]),
      db.query('SELECT count(*)::int AS total FROM not_found_log'),
    ]);
    const csrf = req.session.csrf;
    return renderBeheerPage(req, {
      title: 'Niet gevonden (404)',
      sectionId: 'niet-gevonden',
      body: html`<p>Adressen op de site die niet bestaan, met hoe vaak ze zijn gevraagd en de site die ernaar verwees. Verwijs
        een oud adres door naar de juiste pagina. Er wordt alleen het pad bewaard (zonder querystring of IP-adres); een
        regel verdwijnt na ${NOT_FOUND_RETENTION_DAYS} dagen zonder nieuwe aanvraag, en de lijst telt hoogstens
        ${MAX_NOT_FOUND_ROWS} regels. De tellers worden elke minuut bijgewerkt.</p>
        ${req.query.verwijderd === '1' ? html`<p class="notice" role="status">De regel is verwijderd.</p>` : ''}
        ${req.query.geleegd === '1' ? html`<p class="notice" role="status">De lijst is leeggemaakt.</p>` : ''}
        <p>${total} ${total === 1 ? 'adres' : 'adressen'}${total > rows.length ? `, de ${rows.length} vaakst gevraagde getoond` : ''}.</p>
        ${rows.length ? html`<div class="crm-table-wrap"><table class="crm-table">
          <thead><tr><th scope="col">Pad</th><th scope="col">Aantal</th><th scope="col">Eerst</th><th scope="col">Laatst</th><th scope="col">Verwezen door</th><th scope="col"><span class="visually-hidden">Acties</span></th></tr></thead>
          <tbody>${rows.map((row) => html`<tr>
            <td>${readablePath(row.path)}</td>
            <td>${row.hits}</td>
            <td>${formatDateTime(row.first_seen_at)}</td>
            <td>${formatDateTime(row.last_seen_at)}</td>
            <td>${row.referrer_host || '–'}</td>
            <td class="beheer-actions">
              <a class="btn btn--small" href="/app/beheer/doorverwijzingen/?van=${encodeURIComponent(row.path)}">Doorverwijzen</a>
              <form method="post" action="/app/beheer/niet-gevonden/verwijderen">
                <input type="hidden" name="_csrf" value="${csrf}">
                <input type="hidden" name="path" value="${row.path}">
                <button class="btn btn--outline btn--small" type="submit">Verwijderen</button>
              </form>
            </td>
          </tr>`)}</tbody>
        </table></div>
        <form method="post" action="/app/beheer/niet-gevonden/leegmaken">
          <input type="hidden" name="_csrf" value="${csrf}">
          <button class="btn btn--outline" type="submit">Lijst leegmaken</button>
        </form>` : ''}`,
    });
  };

  router.get('/beheer/doorverwijzingen/', guard, async (req, res, next) => {
    try {
      return res.send(await renderRedirectsPage(req));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/beheer/doorverwijzingen/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const input = { from: bodyText(req.body, 'from'), to: bodyText(req.body, 'to'), status: bodyText(req.body, 'status'), note: bodyText(req.body, 'note') };
      const { values, errors } = validateRedirect(input);
      const note = input.note.trim();
      if (note.length > MAX_NOTE_LENGTH) errors.note = `Hoogstens ${MAX_NOTE_LENGTH} tekens.`;
      // eslint-disable-next-line no-control-regex
      if (/[\u0000-\u001f\u007f]/.test(note)) errors.note = 'Gebruik geen regeleinden of stuurtekens.';
      if (!errors.from && values.fromPath === '/') errors.from = 'De homepage kan niet worden doorverwezen.';
      if (Object.keys(errors).length) return res.status(422).send(await renderRedirectsPage(req, { values: input, errors }));
      // Controle en opslaan in één transactie onder een vaste advisory lock: twee gelijktijdige toevoegingen kunnen zo
      // geen keten, lus of overschrijding van het maximum maken.
      let problems;
      try {
        problems = await db.transaction(async (client) => {
          await client.query('SELECT pg_advisory_xact_lock($1)', [REDIRECTS_LOCK_KEY]);
          const found = chainProblems(values, (await client.query(CHAIN_QUERY, [values.fromPath, targetKeysOf(values.toUrl)]))[0]);
          if (Object.keys(found).length) return found;
          const [row] = await client.query(
            'INSERT INTO redirects (from_path, to_url, status, note, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [values.fromPath, values.toUrl, values.status, note, req.user.id],
          );
          await client.query('DELETE FROM not_found_log WHERE path = $1', [values.fromPath]);
          await auth.audit(req, { userId: req.user.id, action: 'doorverwijzing.aangemaakt', entity: 'redirects', entityId: row.id }, client);
          return {};
        });
      } catch (error) {
        if (error.code !== '23505') throw error;
        problems = { from: TAKEN_MESSAGE };
      }
      if (Object.keys(problems).length) return res.status(422).send(await renderRedirectsPage(req, { values: input, errors: problems }));
      await redirects.reload();
      return res.redirect(303, '/app/beheer/doorverwijzingen/?opgeslagen=1');
    } catch (error) {
      return next(error);
    }
  });

  router.post(routePath('/beheer/doorverwijzingen/:id(\\d{1,9})/verwijderen'), guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const deleted = await db.transaction(async (client) => {
        const rows = await client.query('DELETE FROM redirects WHERE id = $1 RETURNING id', [id]);
        if (rows.length) await auth.audit(req, { userId: req.user.id, action: 'doorverwijzing.verwijderd', entity: 'redirects', entityId: id }, client);
        return rows.length > 0;
      });
      if (!deleted) return notFound(req, res);
      await redirects.reload();
      return res.redirect(303, '/app/beheer/doorverwijzingen/?verwijderd=1');
    } catch (error) {
      return next(error);
    }
  });

  router.get('/beheer/niet-gevonden/', guard, async (req, res, next) => {
    try {
      return res.send(await renderNotFoundPage(req));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/beheer/niet-gevonden/verwijderen', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const path = normalizePath(bodyText(req.body, 'path'));
      const deleted = path && await db.transaction(async (client) => {
        const rows = await client.query('DELETE FROM not_found_log WHERE path = $1 RETURNING path', [path]);
        // Het pad zelf komt niet in het auditlog: het is door bezoekers ingevoerd.
        if (rows.length) await auth.audit(req, { userId: req.user.id, action: 'niet-gevonden.verwijderd', entity: 'not_found_log' }, client);
        return rows.length > 0;
      });
      if (!deleted) return notFound(req, res);
      redirects.forgetKnownNotFound();
      return res.redirect(303, '/app/beheer/niet-gevonden/?verwijderd=1');
    } catch (error) {
      return next(error);
    }
  });

  router.post('/beheer/niet-gevonden/leegmaken', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      await db.transaction(async (client) => {
        await client.query('DELETE FROM not_found_log');
        await auth.audit(req, { userId: req.user.id, action: 'niet-gevonden.geleegd', entity: 'not_found_log' }, client);
      });
      redirects.forgetKnownNotFound();
      return res.redirect(303, '/app/beheer/niet-gevonden/?geleegd=1');
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createRedirectRoutes, likePattern, readablePath, MAX_REDIRECTS };
