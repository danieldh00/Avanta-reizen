/**
 * Het auditlog in Beheer (`/app/auditlog/`, recht `gebruikers`): wie wat deed en wanneer, met filters op gebruiker,
 * actie, soort record, record en periode, bladeren naar oudere regels, en een export naar Excel
 * (`/app/auditlog/export.xlsx`, nooit CSV) met dezelfde filters. Een export komt zelf ook in het auditlog en heeft een
 * limiet per gebruiker. De omschrijving van elke actie komt uit `ACTION_LABELS` in `crm/users.js`.
 */
const express = require('express');
const { html, raw } = require('../site/html');
const { renderCrmPage, renderAlert, formatDateTime } = require('./layout');
const ui = require('./ui');
const { XLSX_TYPE } = require('../export/xlsx');
const { createRateLimiter } = require('../security/rate-limit');
const { ACTION_LABELS } = require('./users');
const audit = require('./audit-log');

/** Adres van het scherm. */
const BASE = '/app/auditlog/';

/** Langste recordnummer dat voluit in de tabel staat. */
const RECORD_ID_MAX = 16;

/** Exports per gebruiker per venster. */
const EXPORT_LIMIT = 10;
const EXPORT_WINDOW_MINUTES = 10;

/** Acties voor het auditlog (zie `ACTION_LABELS` in `crm/users.js`). */
const AUDIT_ACTION_LABELS = {
  'export.auditlog': 'Auditlog geëxporteerd (.xlsx)',
};

/**
 * Maakt de routes van het auditlog.
 * @param {{db: object, auth: object, now?: () => number, exportMax?: number}} options Database, sessie- en rechtenlaag,
 *   de klok en (tests) het maximum aantal regels per export.
 * @returns {express.Router} Router.
 */
function createAuditRoutes(options) {
  const { db, auth } = options;
  const now = options.now || Date.now;
  const router = express.Router();
  const guard = auth.requireRight('gebruikers');
  const limiter = createRateLimiter({ limit: EXPORT_LIMIT, windowMs: EXPORT_WINDOW_MINUTES * 60 * 1000, now: options.now });
  const labels = { ...ACTION_LABELS, ...AUDIT_ACTION_LABELS };

  /**
   * De keuzes voor de filters: gebruikers (ook uitgeschakelde) en de soorten record uit `ENTITIES` (een vaste lijst, zodat
   * het scherm niet het hele log hoeft te lezen), gesorteerd op naam; een gekozen soort die daar niet in staat, komt erbij.
   * @param {string} [current] Gekozen soort record.
   * @returns {Promise<{users: object[], entities: string[]}>} Keuzes.
   */
  const filterChoices = async (current) => {
    const users = await db.query('SELECT id, name, active FROM users ORDER BY lower(name), id');
    const entities = Object.keys(audit.ENTITIES).sort((first, second) => audit.ENTITIES[first].label.localeCompare(audit.ENTITIES[second].label, 'nl'));
    if (current && !audit.ENTITIES[current]) entities.push(current);
    return { users, entities };
  };

  /**
   * De gebruikte filters als tekst, voor het tabblad "Over deze export".
   * @param {object} filter Uitkomst van `readAuditFilter`.
   * @param {object[]} users Gebruikers (id, name).
   * @returns {Array<[string, string]>} Regels.
   */
  const filterLines = (filter, users) => {
    const user = filter.user === audit.SYSTEM_USER ? 'Systeem of onbekend' : (users.find((row) => String(row.id) === filter.user) || {}).name;
    return [
      ['Gebruiker', filter.user ? user || `#${filter.user}` : 'Alle'],
      ['Actie', filter.action ? labels[filter.action] || filter.action : 'Alle'],
      ['Soort record', filter.entity ? (audit.ENTITIES[filter.entity] ? audit.ENTITIES[filter.entity].label : filter.entity) : 'Alle'],
      ['Record', filter.record || 'Alle'],
      ['Van', filter.from || 'begin'],
      ['Tot en met', filter.to || 'nu'],
    ];
  };

  /**
   * Het filterformulier (GET, werkt zonder JavaScript).
   * @param {object} filter Uitkomst van `readAuditFilter`.
   * @param {{users: object[], entities: string[]}} choices Keuzes.
   * @returns {object} HTML.
   */
  const renderFilter = (filter, choices) => {
    const selected = (value, current) => (value === current ? raw(' selected') : '');
    const actions = Object.entries(labels).sort((first, second) => first[1].localeCompare(second[1], 'nl'));
    return html`<form class="crm-audit-filter" method="get" action="${BASE}" role="search" aria-label="Auditlog filteren">
      <div class="field"><span class="field__label"><label for="veld-gebruiker">Gebruiker</label></span>
        <select id="veld-gebruiker" name="gebruiker"><option value="">Alle</option>
          <option value="${audit.SYSTEM_USER}"${selected(audit.SYSTEM_USER, filter.user)}>Systeem of onbekend</option>
          ${choices.users.map((user) => html`<option value="${user.id}"${selected(String(user.id), filter.user)}>${user.name}${user.active ? '' : ' (uitgeschakeld)'}</option>`)}</select></div>
      <div class="field"><span class="field__label"><label for="veld-actie">Actie</label></span>
        <select id="veld-actie" name="actie"><option value="">Alle</option>
          ${actions.map(([key, label]) => html`<option value="${key}"${selected(key, filter.action)}>${label}</option>`)}</select></div>
      <div class="field"><span class="field__label"><label for="veld-soort">Soort record</label></span>
        <select id="veld-soort" name="soort"><option value="">Alle</option>
          ${choices.entities.map((entity) => html`<option value="${entity}"${selected(entity, filter.entity)}>${audit.ENTITIES[entity] ? audit.ENTITIES[entity].label : entity}</option>`)}</select></div>
      <div class="field"><span class="field__label"><label for="veld-record">Record (nummer)</label></span>
        <input id="veld-record" name="record" type="text" inputmode="numeric" value="${filter.record}" maxlength="40"></div>
      <div class="field"><span class="field__label"><label for="veld-van">Van</label></span>
        <input id="veld-van" name="van" type="date" value="${filter.from}"></div>
      <div class="field"><span class="field__label"><label for="veld-tot">Tot en met</label></span>
        <input id="veld-tot" name="tot" type="date" value="${filter.to}"></div>
      <div class="crm-actions crm-audit-filter-buttons"><button class="btn btn--small" type="submit">Filteren</button>${audit.hasAuditFilter(filter) ? html` <a class="btn btn--small btn--outline" href="${BASE}">Alles tonen</a>` : ''}</div>
    </form>`;
  };

  /**
   * Het record van een regel, met een link als het een eigen pagina heeft. Een lang nummer (bijvoorbeeld de naam van een
   * back-up) wordt ingekort; de volledige waarde staat in de tooltip en in de export.
   * @param {object} row Regel.
   * @returns {(object|string)} HTML of tekst.
   */
  const recordCell = (row) => {
    if (!row.entity) return '–';
    const entity = audit.ENTITIES[row.entity];
    const name = entity ? entity.label : row.entity;
    const id = String(row.entity_id || '');
    const shortId = id.length > RECORD_ID_MAX ? `${id.slice(0, RECORD_ID_MAX - 1)}…` : id;
    const label = id ? `${name} #${shortId}` : name;
    const link = entity && entity.href && /^\d{1,18}$/.test(id);
    return html`<span class="crm-audit-record"${shortId === id ? '' : html` title="${id}"`}>${link ? html`<a href="${entity.href(id)}">${label}</a>` : label}</span>`;
  };

  router.get('/auditlog/', guard, async (req, res, next) => {
    try {
      const filter = audit.readAuditFilter(req.query);
      const before = /^\d{1,18}$/.test(String(req.query.voor || '')) ? String(req.query.voor) : null;
      const [page, choices] = await Promise.all([audit.loadAuditPage(db, filter, before), filterChoices(filter.entity)]);
      const params = audit.auditFilterParams(filter);
      return res.send(renderCrmPage({
        title: 'Auditlog',
        user: req.user,
        csrf: req.session.csrf,
        path: BASE,
        actions: ui.renderActions([{ label: 'Excel (.xlsx)', href: ui.listUrl(`${BASE}export.xlsx`, params) }]),
        body: html`<p>Wie wat deed en wanneer. Waarden en persoonsgegevens worden nooit gelogd; het IP-adres alleen ingekort.</p>
          ${renderFilter(filter, choices)}
          ${before ? html`<p><a href="${ui.listUrl(BASE, params)}">Naar de nieuwste regels</a></p>` : ''}
          ${ui.renderTable({
          caption: 'Auditlog',
          empty: audit.hasAuditFilter(filter) ? 'Geen regels bij deze filters.' : 'Nog geen regels.',
          rows: page.rows,
          columns: [
            { label: 'Tijdstip', cell: (row) => formatDateTime(row.created_at) },
            { label: 'Gebruiker', cell: (row) => row.user_name || '–' },
            { label: 'Actie', cell: (row) => html`<span class="crm-audit-action">${labels[row.action] || row.action}</span>` },
            { label: 'Record', cell: recordCell },
            { label: 'IP-reeks', cell: (row) => row.ip_prefix || '–' },
          ],
        })}
          ${page.older ? html`<p><a class="btn btn--small btn--outline" href="${ui.listUrl(BASE, { ...params, voor: page.older })}" rel="next">Oudere regels</a></p>` : ''}`,
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/auditlog/export.xlsx', guard, async (req, res, next) => {
    try {
      /**
       * Een melding in plaats van het bestand.
       * @param {number} status HTTP-status.
       * @param {string} title Titel.
       * @param {string} message Melding.
       * @returns {void}
       */
      const refuse = (status, title, message) => res.status(status).send(renderCrmPage({
        title, user: req.user, csrf: req.session.csrf, path: BASE, body: html`${renderAlert(message)}<p><a href="${BASE}">Naar het auditlog</a></p>`,
      }));
      if (!limiter.hit(`gebruiker:${req.user.id}`)) {
        return refuse(429, 'Even wachten', `Je hebt het maximum van ${EXPORT_LIMIT} exports per ${EXPORT_WINDOW_MINUTES} minuten bereikt. Probeer het straks opnieuw.`);
      }
      const filter = audit.readAuditFilter(req.query);
      const max = options.exportMax || audit.AUDIT_EXPORT_MAX;
      const { rows, tooMany } = await audit.loadAuditExport(db, filter, max);
      // Nooit stilletjes een onvolledig bestand: eerst de periode of het filter verkleinen.
      if (tooMany) return refuse(422, 'Te veel regels', `Deze selectie heeft meer dan ${max} regels. Kies een kortere periode of een filter en exporteer opnieuw.`);
      const { users } = await filterChoices();
      const clock = new Date(now());
      const file = audit.buildAuditWorkbook({ rows, labels, filterLines: filterLines(filter, users), userName: req.user.name, now: clock });
      // Eerst loggen: een export die niet gelogd kan worden gaat niet de deur uit.
      await auth.audit(req, { userId: req.user.id, action: 'export.auditlog' });
      const day = clock.toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });
      return res.set({
        'Content-Type': XLSX_TYPE,
        'Content-Disposition': `attachment; filename="auditlog-${day}.xlsx"`,
        'Cache-Control': 'no-store',
      }).send(file);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createAuditRoutes, AUDIT_ACTION_LABELS, EXPORT_LIMIT };
