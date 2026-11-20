/**
 * Routes van Beheer onder `/app/beheer/` (alleen recht `systeem`, rol beheerder): zijbalk met groepen en een zoekveld
 * (`beheer/indeling.js`), het systeemoverzicht en de instellingenformulieren. Elke wijziging komt in het auditlog
 * (welke instelling, nooit de waarde); geheimen gaan nooit volledig terug naar de browser.
 */
const express = require('express');
const { html, raw } = require('../site/html');
const { renderCrmPage, renderAlert, formatDateTime } = require('../crm/layout');
const { GROUPS, findSection, filterGroups } = require('./indeling');
const { SettingsError } = require('./settings');

/** Versie van de app (voor het systeemoverzicht). */
const APP_VERSION = require('../../package.json').version;

/** Omschrijving van de bron van een instelling. */
const SOURCE_LABELS = { database: 'Ingesteld in Beheer', omgeving: 'Uit de omgeving (startwaarde)', standaard: 'Standaardwaarde' };

/**
 * Leest één veld uit een formulier als tekst; een herhaald veld (lijst) is ongeldig.
 * @param {object} body Ingezonden velden.
 * @param {string} name Naam van het veld.
 * @returns {(string|undefined)} Tekst, of undefined als het veld ontbreekt of geen tekst is.
 */
function formText(body, name) {
  const value = Object.hasOwn(body, name) ? body[name] : undefined;
  return typeof value === 'string' ? value : undefined;
}

/**
 * Leest een veld dat meerdere keren kan voorkomen (selectievakjes met dezelfde naam) als lijst.
 * @param {object} body Ingezonden velden.
 * @param {string} name Naam van het veld.
 * @returns {string[]} Waarden.
 */
function formList(body, name) {
  const value = Object.hasOwn(body, name) ? body[name] : [];
  return (Array.isArray(value) ? value : [value]).filter((item) => typeof item === 'string');
}

/**
 * Formatteert een duur in seconden als dagen, uren en minuten.
 * @param {number} seconds Duur.
 * @returns {string} Bijvoorbeeld `2 dagen, 3 uur en 5 minuten`.
 */
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (days) parts.push(`${days} ${days === 1 ? 'dag' : 'dagen'}`);
  if (hours) parts.push(`${hours} uur`);
  parts.push(`${minutes} ${minutes === 1 ? 'minuut' : 'minuten'}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} en ${parts[parts.length - 1]}` : parts[0];
}

/**
 * Maakt de routes van Beheer.
 * @param {{db: object, auth: object, settings: object}} options Database, sessie- en rechtenlaag en de instellingen.
 * @returns {express.Router} Router, te koppelen binnen de CRM-router.
 */
function createBeheerRoutes(options) {
  const { db, auth, settings } = options;
  const router = express.Router();
  const guard = auth.requireRight('systeem');

  /**
   * De zijbalk: zoekveld (werkt zonder JavaScript via een GET) en de groepen met hun secties.
   * @param {string} currentId Id van de open sectie.
   * @param {string} query Zoekterm.
   * @returns {object} HTML.
   */
  const renderSidebar = (currentId, query) => {
    const groups = filterGroups(query, settings.fields);
    return html`<aside class="beheer-side" aria-label="Beheer">
      <form class="beheer-search" method="get" action="/app/beheer/" role="search">
        <label class="visually-hidden" for="beheer-zoek">Zoeken in Beheer</label>
        <input id="beheer-zoek" type="search" name="zoek" value="${query}" maxlength="100" placeholder="Zoeken in Beheer">
        <button class="btn btn--outline btn--small" type="submit">Zoek</button>
      </form>
      ${query && !groups.length ? html`<p class="beheer-side__empty">Niets gevonden voor “${query}”. <a href="/app/beheer/">Alles tonen</a></p>` : ''}
      ${groups.map((group) => html`<details class="beheer-group" open>
        <summary>${group.title}</summary>
        <ul>${group.sections.map((section) => html`<li><a href="/app/beheer/${section.id}/"${section.id === currentId ? raw(' aria-current="page"') : ''}>${section.label}</a></li>`)}</ul>
      </details>`)}
    </aside>`;
  };

  /**
   * Een volledige Beheer-pagina: zijbalk links, inhoud rechts.
   * @param {object} req Express-verzoek.
   * @param {{title: string, sectionId: string, body: object}} page Titel, open sectie en inhoud.
   * @returns {string} HTML-pagina.
   */
  const renderBeheerPage = (req, page) => {
    const query = typeof req.query.zoek === 'string' ? req.query.zoek.trim().slice(0, 100) : '';
    return renderCrmPage({
      title: page.title,
      user: req.user,
      csrf: req.session.csrf,
      path: '/app/beheer/',
      body: html`<div class="beheer">
        ${renderSidebar(page.sectionId, query)}
        <div class="beheer-content">${page.body}</div>
      </div>`,
    });
  };

  /**
   * Eén invoerveld voor een instelling, met label, hulptekst, bron en eventueel "terugzetten".
   * @param {string} key Naam van de instelling.
   * @param {{values: object, errors: object}} state Ingevulde waarden (na een fout) en fouten per instelling.
   * @returns {object} HTML.
   */
  const renderSettingField = (key, state) => {
    const definition = settings.fields[key];
    const id = `instelling-${key}`;
    const error = state.errors[key];
    const source = settings.source(key);
    const current = settings.view(key);
    const value = Object.hasOwn(state.values, key) ? state.values[key] : current;
    const invalid = error ? html` aria-invalid="true" aria-describedby="${id}-fout"` : '';
    let input;
    if (definition.type === 'bool') {
      input = html`<label class="choice"><input id="${id}" type="checkbox" name="${key}" value="ja"${value === true ? raw(' checked') : ''}> <span>${definition.label}</span></label>`;
    } else if (definition.type === 'textarea') {
      input = html`<textarea id="${id}" name="${key}" rows="6" maxlength="${definition.max || 500}"${invalid}>${value}</textarea>`;
    } else if (definition.type === 'enum') {
      input = html`<select id="${id}" name="${key}"${invalid}>${definition.values.map((option) => html`<option value="${option}"${option === value ? raw(' selected') : ''}>${(definition.labels && definition.labels[option]) || option}</option>`)}</select>`;
    } else if (definition.type === 'secret') {
      input = html`<input id="${id}" type="password" name="${key}" value="" autocomplete="new-password" maxlength="${definition.max || 500}" placeholder="${current.set ? `Ingesteld (eindigt op ${current.last4})` : 'Niet ingesteld'}"${invalid}>
        ${current.set ? html`<label class="choice"><input type="checkbox" name="_clear" value="${key}"> <span>Leegmaken</span></label>` : ''}`;
    } else {
      const type = { email: 'email', url: 'url', int: 'number' }[definition.type] || 'text';
      input = html`<input id="${id}" type="${type}" name="${key}" value="${value}"${definition.type === 'int' ? html` min="${definition.min}" max="${definition.max}"` : html` maxlength="${definition.max || 500}"`}${definition.required ? raw(' required') : ''}${invalid}>`;
    }
    return html`<div class="field">
      ${definition.type === 'bool' ? '' : html`<span class="field__label"><label for="${id}">${definition.label}</label></span>`}
      ${input}
      ${definition.help ? html`<span class="field__help">${definition.help}${definition.type === 'secret' ? ' Laat leeg om de huidige waarde te houden.' : ''}</span>` : ''}
      <span class="field__help beheer-source">${SOURCE_LABELS[source]}</span>
      ${source === 'database' ? html`<label class="choice beheer-reset"><input type="checkbox" name="_reset" value="${key}"> <span>Terugzetten naar de startwaarde</span></label>` : ''}
      ${error ? html`<span class="field__error" id="${id}-fout">${error}</span>` : ''}
    </div>`;
  };

  /**
   * Het instellingenformulier van een sectie.
   * @param {object} req Express-verzoek.
   * @param {object} section Sectie uit de indeling.
   * @param {{values?: object, errors?: object, saved?: boolean}} [state] Waarden en fouten na een mislukte poging, of
   *   dat het opslaan gelukt is.
   * @returns {string} HTML-pagina.
   */
  const renderSettingsSection = (req, section, state = {}) => renderBeheerPage(req, {
    title: section.label,
    sectionId: section.id,
    body: html`${section.intro ? html`<p>${section.intro}</p>` : ''}
      ${state.saved ? html`<p class="notice" role="status">De instellingen zijn opgeslagen.</p>` : ''}
      ${renderAlert(state.errors && Object.keys(state.errors).length ? 'Niet opgeslagen: controleer de gemarkeerde velden.' : '')}
      <form class="form beheer-form" method="post" action="/app/beheer/${section.id}/">
        <input type="hidden" name="_csrf" value="${req.session.csrf}">
        ${section.fields.map((key) => renderSettingField(key, { values: state.values || {}, errors: state.errors || {} }))}
        <div><button class="btn" type="submit">Opslaan</button></div>
      </form>`,
  });

  /**
   * Het systeemoverzicht: versie, Node, PostgreSQL, laatste migratie, looptijd en de bron van elke instelling.
   * @param {object} req Express-verzoek.
   * @returns {Promise<string>} HTML-pagina.
   */
  const renderOverview = async (req) => {
    const [[database], [migration]] = await Promise.all([
      db.query("SELECT current_setting('server_version') AS version"),
      db.query('SELECT id, name, applied_at FROM schema_migrations ORDER BY id DESC LIMIT 1'),
    ]);
    const settingRows = GROUPS.flatMap((group) => group.sections.flatMap((section) => (section.fields || []).map((key) => ({ key, section }))));
    return renderBeheerPage(req, {
      title: 'Systeemoverzicht',
      sectionId: 'overzicht',
      body: html`<div class="crm-table-wrap"><table class="crm-table beheer-facts">
          <tbody>
            <tr><th scope="row">Versie</th><td>${APP_VERSION}</td></tr>
            <tr><th scope="row">Node.js</th><td>${process.version}</td></tr>
            <tr><th scope="row">PostgreSQL</th><td>${database ? database.version : '–'}</td></tr>
            <tr><th scope="row">Laatste migratie</th><td>${migration ? `${migration.id}: ${migration.name} (${formatDateTime(migration.applied_at)})` : '–'}</td></tr>
            <tr><th scope="row">Draait sinds</th><td>${formatUptime(Math.floor(process.uptime()))}</td></tr>
          </tbody>
        </table></div>
        <h2>Instellingen</h2>
        <p>Waar elke instelling vandaan komt. Wat in Beheer is opgeslagen gaat voor de omgeving (startwaarde) en de standaard.</p>
        <div class="crm-table-wrap"><table class="crm-table">
          <thead><tr><th scope="col">Instelling</th><th scope="col">Sectie</th><th scope="col">Bron</th></tr></thead>
          <tbody>${settingRows.map((row) => html`<tr>
            <td>${settings.fields[row.key].label}</td>
            <td><a href="/app/beheer/${row.section.id}/">${row.section.label}</a></td>
            <td>${SOURCE_LABELS[settings.source(row.key)]}</td>
          </tr>`)}</tbody>
        </table></div>`,
    });
  };

  /**
   * 404 binnen Beheer.
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @returns {void}
   */
  const notFound = (req, res) => res.status(404).send(renderBeheerPage(req, {
    title: 'Niet gevonden',
    sectionId: '',
    body: html`<p>Deze pagina bestaat niet in Beheer. Kies een onderdeel in de zijbalk.</p>`,
  }));

  router.get('/beheer/', guard, async (req, res, next) => {
    try {
      await settings.ready();
      return res.send(await renderOverview(req));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/beheer/:section([a-z0-9-]{1,40})/', guard, async (req, res, next) => {
    try {
      const section = findSection(req.params.section);
      if (!section) return notFound(req, res);
      await settings.ready();
      if (section.view === 'overzicht') return res.send(await renderOverview(req));
      return res.send(renderSettingsSection(req, section, { saved: req.query.opgeslagen === '1' }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/beheer/:section([a-z0-9-]{1,40})/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const section = findSection(req.params.section);
      if (!section || !section.fields) return notFound(req, res);
      const sectionKeys = new Set(section.fields);
      const values = {};
      for (const key of section.fields) {
        const definition = settings.fields[key];
        if (definition.type === 'bool') values[key] = formText(req.body, key) === 'ja';
        else values[key] = formText(req.body, key) ?? (definition.type === 'secret' ? '' : undefined);
      }
      const errors = {};
      for (const [key, value] of Object.entries(values)) if (value === undefined) errors[key] = 'Ongeldige waarde.';
      // Alleen instellingen van deze sectie mogen worden teruggezet of geleegd.
      const reset = formList(req.body, '_reset').filter((key) => sectionKeys.has(key));
      const clear = formList(req.body, '_clear').filter((key) => sectionKeys.has(key));
      if (Object.keys(errors).length) return res.status(422).send(renderSettingsSection(req, section, { values, errors }));
      try {
        await settings.update({ values, reset, clear }, {
          userId: req.user.id,
          inTransaction: async (client, changed) => {
            for (const key of changed) {
              await auth.audit(req, { userId: req.user.id, action: reset.includes(key) ? 'instelling.teruggezet' : 'instelling.gewijzigd', entity: 'settings', entityId: key }, client);
            }
          },
        });
      } catch (error) {
        if (!(error instanceof SettingsError)) throw error;
        // Een geheim komt nooit terug in het formulier.
        for (const key of section.fields) if (settings.fields[key].type === 'secret') delete values[key];
        return res.status(422).send(renderSettingsSection(req, section, { values, errors: { [error.key]: error.message } }));
      }
      return res.redirect(303, `/app/beheer/${section.id}/?opgeslagen=1`);
    } catch (error) {
      return next(error);
    }
  });

  router.use('/beheer/', guard, (req, res) => notFound(req, res));

  return router;
}

module.exports = { createBeheerRoutes, formatUptime };
