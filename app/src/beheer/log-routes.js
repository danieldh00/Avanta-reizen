// @ts-check
/**
 * Beheer > Systeem > Logboek (recht `systeem`): de regels uit `app_logs` (fouten met foutcode, trage verzoeken,
 * waarschuwingen en fouten van achtergrondtaken), nieuwste eerst, te filteren op niveau en bron en te zoeken op
 * foutcode, request-id of tekst. 50 per pagina (op id, zonder OFFSET).
 */
const express = require('express');
const { html } = require('../site/html');
const { formatDateTime } = require('../crm/layout');
const { createRateLimiter } = require('../security/rate-limit');
const { LEVELS, SOURCE_LABELS, sourceLabel } = require('../system/app-log');

/** Bronnen in het filter, op naam gesorteerd (een onbekende bron blijft via "Alle bronnen" zichtbaar). */
const SOURCE_OPTIONS = Object.entries(SOURCE_LABELS).sort(([, first], [, second]) => first.localeCompare(second, 'nl'));
const LEVEL_LABELS = { info: 'Info', warn: 'Waarschuwing', error: 'Fout' };
/** Kleur van het niveau (de labels van de bewaking: `monitor-state--…` in crm.css). */
const LEVEL_STATES = { info: 'info', warn: 'warn', error: 'error' };
const PAGE_SIZE = 50;

/**
 * Maakt de routes.
 * @param {{db: any, guard: Function, settings: any, appLog?: any, renderBeheerPage: Function, now?: () => number}} options
 *   Database, rechtencontrole, instellingen, het logboek (om de buffer eerst weg te schrijven), de weergave van een
 *   Beheer-pagina en (voor tests) de klok van de limiet.
 * @returns {express.Router} Router.
 */
function createLogRoutes(options) {
  const { db, guard, settings } = options;
  const router = express.Router();
  const limiter = createRateLimiter({ limit: 120, windowMs: 60 * 1000, now: options.now });

  router.get('/beheer/logboek/', guard, async (req, res, next) => {
    try {
      await settings.ready();
      if (!limiter.hit(`gebruiker:${req.user.id}`)) return res.status(429).send(options.renderBeheerPage(req, { title: 'Logboek', sectionId: 'logboek', body: html`<p class="form-alert" role="alert">Te veel verzoeken. Probeer het over een minuut opnieuw.</p>` }));
      if (options.appLog) await options.appLog.flush();
      const text = (name, max) => (typeof req.query[name] === 'string' ? req.query[name].trim().slice(0, max) : '');
      const level = LEVELS.includes(text('niveau', 10)) ? text('niveau', 10) : '';
      const source = /^[a-z0-9-]{1,30}$/.test(text('bron', 30)) ? text('bron', 30) : '';
      const search = text('zoek', 100);
      const before = /^\d{1,18}$/.test(text('voor', 18)) ? text('voor', 18) : '';
      const where = [];
      const params = [];
      const add = (clause, value) => { params.push(value); where.push(clause.replace('?', `$${params.length}`)); };
      if (level) add('level = ?', level);
      if (source) add('source = ?', source);
      if (before) add('id < ?', before);
      if (/^[0-9a-f]{8}$/i.test(search)) add('error_code = ?', search.toLowerCase());
      else if (/^[0-9a-f]{12}$/i.test(search)) add('request_id = ?', search.toLowerCase());
      else if (search) add("message ILIKE ? ESCAPE '\\'", `%${search.replace(/[\\%_]/g, (match) => `\\${match}`)}%`);
      params.push(PAGE_SIZE + 1);
      const rows = await db.query(
        `SELECT id, created_at, first_at, level, source, request_id, error_code, message, data, duration_ms, repeat_count
         FROM app_logs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT $${params.length}`,
        params,
      );
      const more = rows.length > PAGE_SIZE;
      const shown = rows.slice(0, PAGE_SIZE);
      const nextQuery = new URLSearchParams({ ...(level && { niveau: level }), ...(source && { bron: source }), ...(search && { zoek: search }), voor: more ? String(shown[shown.length - 1].id) : '' }).toString();
      return res.send(options.renderBeheerPage(req, {
        title: 'Logboek',
        sectionId: 'logboek',
        body: html`<p>Fouten, trage verzoeken en meldingen van de app, nieuwste eerst. Een foutcode van een bezoeker of de request-id uit de kop X-Request-Id vind je met het zoekveld. Het logboek bevat geen persoonsgegevens; regels blijven ${settings.get('logRetentionDays')} dagen bewaard (<a href="/app/beheer/foutopsporing/">Foutopsporing</a>).</p>
          <form class="beheer-filter beheer-log-filter" method="get" action="/app/beheer/logboek/" role="search">
            <label class="visually-hidden" for="log-niveau">Niveau</label>
            <select id="log-niveau" name="niveau"><option value="">Alle niveaus</option>${LEVELS.map((value) => html`<option value="${value}"${value === level ? html` selected` : ''}>${LEVEL_LABELS[value]}</option>`)}</select>
            <label class="visually-hidden" for="log-bron">Bron</label>
            <select id="log-bron" name="bron"><option value="">Alle bronnen</option>${SOURCE_OPTIONS.map(([value, label]) => html`<option value="${value}"${value === source ? html` selected` : ''}>${label}</option>`)}</select>
            <label class="visually-hidden" for="log-zoek">Zoeken</label>
            <input id="log-zoek" type="search" name="zoek" value="${search}" maxlength="100" placeholder="Foutcode, request-id of tekst">
            <button class="btn btn--outline btn--small" type="submit">Zoek</button>
          </form>
          ${shown.length ? html`<div class="crm-table-wrap"><table class="crm-table beheer-log">
            <thead><tr><th scope="col" class="beheer-log__time">Tijd</th><th scope="col" class="beheer-log__level">Niveau</th><th scope="col" class="beheer-log__source">Bron</th><th scope="col">Melding</th></tr></thead>
            <tbody>${shown.map((row) => html`<tr>
              <td class="beheer-log__time">${formatDateTime(row.created_at)}${row.repeat_count > 1 ? html`<br><span class="field__help">${row.repeat_count}× sinds ${formatDateTime(row.first_at)}</span>` : ''}</td>
              <td class="beheer-log__level"><span class="monitor-state monitor-state--${LEVEL_STATES[row.level] || 'uit'}">${LEVEL_LABELS[row.level] || row.level}</span></td>
              <td class="beheer-log__source">${sourceLabel(row.source)}</td>
              <td class="beheer-log__message">${row.message}${row.error_code ? html`<br><span class="field__help">foutcode <code>${row.error_code}</code></span>` : ''}${row.request_id ? html`<br><span class="field__help">verzoek <code>${row.request_id}</code></span>` : ''}${row.duration_ms ? html`<br><span class="field__help">${row.duration_ms} ms</span>` : ''}
                ${row.data && Object.keys(row.data).length ? html`<details><summary>Details</summary><pre>${JSON.stringify(row.data, null, 2)}</pre></details>` : ''}</td>
            </tr>`)}</tbody>
          </table></div>
          ${more ? html`<p><a class="btn btn--outline btn--small" href="/app/beheer/logboek/?${nextQuery}">Oudere regels</a></p>` : ''}` : html`<p>Geen regels gevonden.</p>`}`,
      }));
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createLogRoutes };
