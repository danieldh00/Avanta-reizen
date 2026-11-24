/**
 * Routes van Beheer onder `/app/beheer/` (alleen recht `systeem`, rol beheerder): zijbalk met groepen en een zoekveld
 * (`beheer/indeling.js`), de startpagina (stand van het systeem en de onderwerpen als kaarten), het systeemoverzicht,
 * de lijst met alle instellingen en hun bron, en de instellingenformulieren. Elke wijziging komt in het auditlog
 * (welke instelling, nooit de waarde); geheimen gaan nooit volledig terug naar de browser.
 */
const express = require('express');
const { routePath } = require('../route-path');
const { html, raw } = require('../site/html');
const { renderCrmPage, renderAlert, formatDateTime } = require('../crm/layout');
const { systemState } = require('../crm/dashboard');
const ui = require('../crm/ui');
const { GROUPS, findSection, filterGroups } = require('./indeling');
const { SettingsError } = require('./settings');
const { verifyPassword, MAX_LENGTH } = require('../crm/passwords');
const { createRateLimiter } = require('../security/rate-limit');
const { createRedirectRoutes } = require('./redirect-routes');
const { createMailRoutes } = require('./mail-routes');
const { createCaptchaRoutes } = require('./captcha-routes');
const { createMonitorRoutes } = require('./monitor-routes');
const { createBackupRoutes } = require('./backup-routes');
const { createDriveRoutes } = require('./drive-routes');
const { createRestoreTestRoutes } = require('./restore-test-routes');
const { createUpdateRoutes } = require('./update-routes');
const { createHostTaskRoutes } = require('./host-task-routes');
const { createLogRoutes } = require('./log-routes');
const { createRetentionRoutes } = require('./retention-routes');
const { createPasswordCheckPanel } = require('./password-check-panel');
const { createGoLiveRoutes } = require('./go-live-routes');

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
 * @param {{db: object, auth: object, settings: object, redirects?: object, mailer?: object, wanIp?: object, captcha?: object, passwordCheck?: object, backups?: object, drive?: object, restoreTests?: object, systemUpdate?: object, hostTasks?: object, appLog?: object, monitor?: object, retention?: object, siteContent?: {load: Function}, now?: () => number}} options
 *   Database, sessie- en rechtenlaag, de instellingen, de laag voor doorverwijzingen (`site/redirects.js`), de mailer en
 *   WAN-IP-opzoeker (`mail/`), de captcha (`security/captcha.js`), de wachtwoordcontrole (`security/password-check.js`), de back-updienst (`backup/backups.js`), de Drive-koppeling (`backup/drive.js`), de hersteltests
 *   (`backup/restore-test.js`), de koppeling met het updatescript (`system/system-update.js`), de servertaken
 *   (`system/host-tasks.js`), het logboek (`system/app-log.js`), de bewaking (`system/monitor.js`), de AVG-opschoning, de lezer van `site-content.json` (Livegang; zonder lezer geen Livegang-pagina) en (voor tests) de klok van de limieten.
 * @returns {express.Router} Router, te koppelen binnen de CRM-router.
 */
function createBeheerRoutes(options) {
  const { db, auth, settings } = options;
  const router = express.Router();
  const guard = auth.requireRight('systeem');
  // Wachtwoordcontroles (bij het aanzetten van een instelling met `confirmOn`): 5 per kwartier per gebruiker.
  const passwordLimiter = createRateLimiter({ limit: 5, windowMs: 15 * 60 * 1000, now: options.now });

  /**
   * De instellingen van een sectie die met het wachtwoord bevestigd moeten worden als ze aan gaan en nu uit staan.
   * @param {object} section Sectie uit de indeling.
   * @returns {string[]} Namen van die instellingen.
   */
  const confirmableKeys = (section) => (section.fields || []).filter((key) => settings.fields[key].confirmOn && settings.get(key) !== true);

  /**
   * Een volledige Beheer-pagina. De groepen en secties staan in de tweede zijbalk van Beheer (`crm/layout.js`); met een
   * zoekterm (`?zoek=`, werkt zonder JavaScript via een GET) toont die alleen de secties die erbij passen.
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
      path: page.sectionId ? `/app/beheer/${page.sectionId}/` : '/app/beheer/',
      beheer: { groups: filterGroups(query, settings.fields), query },
      body: html`<div class="beheer-content">${page.body}</div>`,
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
   * @param {{values?: object, errors?: object, saved?: boolean, extra?: object}} [state] Waarden en fouten na een mislukte
   *   poging, of dat het opslaan gelukt is, en de toestand van het extra paneel van de sectie (zoals de testmail).
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
        ${confirmableKeys(section).length ? html`<input type="hidden" name="username" value="${req.user.email}" autocomplete="username">
        <div class="field">
          <span class="field__label"><label for="instelling-wachtwoord">Je wachtwoord</label></span>
          <input id="instelling-wachtwoord" type="password" name="_password" autocomplete="current-password" maxlength="${MAX_LENGTH}">
          <span class="field__help">Alleen nodig als je ${confirmableKeys(section).map((key) => settings.fields[key].label.toLowerCase()).join(' of ')} aanzet.</span>
        </div>` : ''}
        <div><button class="btn" type="submit">Opslaan</button></div>
      </form>
      ${section.extra && extraPanels[section.extra] ? extraPanels[section.extra](req, state.extra || {}) : ''}`,
  });

  /**
   * De meldingen die op de startpagina en het systeemoverzicht bovenaan staan: open incidenten en open servertaken.
   * @returns {object} HTML (leeg als er niets openstaat).
   */
  const renderSystemAlerts = () => html`${options.monitor && options.monitor.view().open.length ? html`<p class="form-alert" role="alert">Er staan incidenten open. Zie <a href="/app/beheer/bewaking/">Bewaking en meldingen</a>.</p>` : ''}
    ${options.hostTasks && options.hostTasks.view().pending ? html`<p class="notice" role="status">Er staan servertaken open. Zie <a href="/app/beheer/servertaken/">Servertaken</a>.</p>` : ''}`;

  /** Tekst op de tegel Tweestapsverificatie per waarde van `mfaRequiredFor`. */
  const MFA_TILE_TEXT = { niemand: 'Optioneel', gegevens: 'Verplicht (gegevens)', iedereen: 'Verplicht (iedereen)' };

  /**
   * Hoeveel actieve beheerders er zijn (voor de waarschuwing bij één beheerder, bevinding F07).
   * @returns {Promise<number>} Aantal actieve gebruikers met de rol beheerder.
   */
  const countActiveAdmins = async () => {
    const [row] = await db.query("SELECT count(*)::int AS admins FROM users WHERE role = 'beheerder' AND active");
    return row.admins;
  };

  /**
   * De startpagina van Beheer: de stand van het systeem als tegels en daaronder elk onderwerp als kaart met zijn
   * onderdelen (met een zoekterm alleen wat erbij past). De gegevens komen uit het geheugen (bewaking, back-uplijst,
   * updates, instellingen); alleen het aantal beheerders komt uit de database en wordt meegegeven.
   * @param {object} req Express-verzoek.
   * @param {{activeAdmins: number}} access Aantal actieve beheerders.
   * @returns {string} HTML-pagina.
   */
  const renderStart = (req, access) => {
    const system = systemState({ monitor: options.monitor, backups: options.backups, systemUpdate: options.systemUpdate });
    const pendingTasks = options.hostTasks ? options.hostTasks.view().pending : 0;
    // Met een zoekterm (`?zoek=`) tonen de kaarten alleen de onderdelen die erbij passen, net als de zijbalk.
    const query = typeof req.query.zoek === 'string' ? req.query.zoek.trim().slice(0, 100) : '';
    const groups = filterGroups(query, settings.fields);
    const monitorText = !system.monitorEnabled ? 'Uit' : (system.openIncidents ? `${system.openIncidents} open` : 'In orde');
    const tiles = [
      { href: '/app/beheer/bewaking/', label: 'Bewaking', value: monitorText, open: system.monitorEnabled && system.openIncidents > 0 },
      { href: '/app/beheer/back-ups/', label: 'Laatste back-up', value: system.lastBackupAt ? formatDateTime(system.lastBackupAt) : 'Nog geen', open: !system.lastBackupAt },
      { href: '/app/beheer/updates/', label: system.updateAvailable ? 'Versie (update beschikbaar)' : 'Versie', value: system.version || APP_VERSION, open: system.updateAvailable },
      { href: '/app/beheer/servertaken/', label: 'Open servertaken', value: String(pendingTasks), open: pendingTasks > 0 },
      // Toegang: 2FA is optioneel tot de livegang (besluit 23-11-2026); dan op 'gegevens' zetten (audit A05).
      { href: '/app/beheer/tweestaps/', label: 'Tweestapsverificatie', value: MFA_TILE_TEXT[settings.get('mfaRequiredFor')] || 'Onbekend', open: settings.get('mfaRequiredFor') === 'niemand' },
      // Met één beheerder kan niemand anders een vergeten wachtwoord herstellen (F07).
      { href: '/app/gebruikers/', label: 'Actieve beheerders', value: String(access.activeAdmins), open: access.activeAdmins < 2 },
    ];
    return renderBeheerPage(req, {
      title: 'Beheer',
      sectionId: '',
      body: html`${renderSystemAlerts()}
        ${access.activeAdmins < 2 ? html`<p class="notice" role="status">Er is maar één actieve beheerder. Maak een tweede beheerder aan onder
          <a href="/app/gebruikers/">Gebruikers</a>: dan kan die een vergeten wachtwoord of een verloren authenticator herstellen.</p>` : ''}
        ${settings.get('mfaRequiredFor') === 'niemand' ? html`<p class="notice" role="status">Tweestapsverificatie is nog optioneel. Zet het vóór de
          livegang verplicht voor de rollen met bijzondere gegevens onder <a href="/app/beheer/tweestaps/">Tweestapsverificatie</a>.</p>` : ''}
        <section class="crm-panel" aria-labelledby="beheer-stand">
          <h2 id="beheer-stand">Stand van het systeem</h2>
          <ul class="crm-tiles crm-tiles--three">${tiles.map((tile) => html`<li><a class="crm-tile${tile.open ? ' crm-tile--open' : ''}" href="${tile.href}">
            <span class="crm-tile-count crm-tile-count--text">${tile.value}</span>
            <span class="crm-tile-label">${tile.label}</span>
          </a></li>`)}</ul>
        </section>
        ${groups.length ? html`<section class="crm-panel" aria-labelledby="beheer-onderwerpen">
          <h2 id="beheer-onderwerpen">${query ? 'Gevonden onderdelen' : 'Onderwerpen'}</h2>
          <div class="beheer-cards">${groups.map((group) => html`<section class="beheer-card">
            <h3>${group.title}</h3>
            <ul>${group.sections.map((section) => html`<li><a href="/app/beheer/${section.id}/">${section.label}</a></li>`)}</ul>
          </section>`)}</div>
        </section>` : ''}`,
    });
  };

  /**
   * Het systeemoverzicht: versie, Node, PostgreSQL, laatste migratie en looptijd.
   * @param {object} req Express-verzoek.
   * @returns {Promise<string>} HTML-pagina.
   */
  const renderOverview = async (req) => {
    const [[database], [migration]] = await Promise.all([
      db.query("SELECT current_setting('server_version') AS version"),
      db.query('SELECT id, name, applied_at FROM schema_migrations ORDER BY id DESC LIMIT 1'),
    ]);
    return renderBeheerPage(req, {
      title: 'Systeemoverzicht',
      sectionId: 'overzicht',
      body: html`${renderSystemAlerts()}
        <div class="crm-table-wrap"><table class="crm-table beheer-facts">
          <tbody>
            <tr><th scope="row">Versie</th><td>${APP_VERSION}</td></tr>
            <tr><th scope="row">Node.js</th><td>${process.version}</td></tr>
            <tr><th scope="row">PostgreSQL</th><td>${database ? database.version : '–'}</td></tr>
            <tr><th scope="row">Laatste migratie</th><td>${migration ? `${migration.id}: ${migration.name} (${formatDateTime(migration.applied_at)})` : '–'}</td></tr>
            <tr><th scope="row">Draait sinds</th><td>${formatUptime(Math.floor(process.uptime()))}</td></tr>
          </tbody>
        </table></div>
        <p><a href="/app/beheer/instellingen/">Alle instellingen en hun bron</a></p>`,
    });
  };

  /**
   * Alle instellingen met de sectie waar ze staan en waar de waarde vandaan komt (Beheer, omgeving of standaard).
   * @param {object} req Express-verzoek.
   * @returns {string} HTML-pagina.
   */
  const renderSettingsList = (req) => {
    const settingRows = GROUPS.flatMap((group) => group.sections.flatMap((section) => (section.fields || []).map((key) => ({ key, section }))));
    return renderBeheerPage(req, {
      title: 'Alle instellingen en hun bron',
      sectionId: 'instellingen',
      body: html`<p>Waar elke instelling vandaan komt. Wat in Beheer is opgeslagen gaat voor de omgeving (startwaarde) en de standaard.</p>
        ${ui.renderTable({
          caption: 'Instellingen en hun bron',
          empty: 'Er zijn geen instellingen.',
          rows: settingRows,
          columns: [
            { label: 'Instelling', cell: (row) => settings.fields[row.key].label },
            { label: 'Sectie', cell: (row) => html`<a href="/app/beheer/${row.section.id}/">${row.section.label}</a>` },
            { label: 'Bron', cell: (row) => SOURCE_LABELS[settings.source(row.key)] },
          ],
        })}`,
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

  /** Extra panelen onder een instellingenformulier, per waarde van `extra` in de indeling. */
  const extraPanels = {};
  if (options.mailer && options.wanIp) {
    const mailRoutes = createMailRoutes({ auth, guard, settings, mailer: options.mailer, wanIp: options.wanIp, renderSettingsSection, now: options.now });
    extraPanels.mail = mailRoutes.renderPanel;
    extraPanels['mail-opmaak'] = mailRoutes.renderLayoutPanel;
    router.use(mailRoutes.router);
  }
  if (options.backups) {
    const backupRoutes = createBackupRoutes({ auth, guard, settings, backups: options.backups, renderSettingsSection, notFound, now: options.now });
    extraPanels['back-ups'] = backupRoutes.renderPanel;
    router.use(backupRoutes.router);
  }
  if (options.drive) {
    const driveRoutes = createDriveRoutes({ auth, guard, settings, drive: options.drive, renderSettingsSection, now: options.now });
    extraPanels['google-drive'] = driveRoutes.renderPanel;
    router.use(driveRoutes.router);
  }
  if (options.monitor) {
    const monitorRoutes = createMonitorRoutes({ auth, guard, monitor: options.monitor, renderSettingsSection, now: options.now });
    extraPanels.bewaking = monitorRoutes.renderPanel;
    router.use(monitorRoutes.router);
  }
  if (options.retention) {
    const retentionRoutes = createRetentionRoutes({ auth, guard, retention: options.retention, renderSettingsSection, now: options.now });
    extraPanels.bewaartermijnen = retentionRoutes.renderPanel;
    router.use(retentionRoutes.router);
  }
  if (options.passwordCheck) extraPanels.wachtwoordcontrole = createPasswordCheckPanel({ passwordCheck: options.passwordCheck });
  if (options.captcha) {
    const captchaRoutes = createCaptchaRoutes({ auth, guard, captcha: options.captcha, renderSettingsSection, now: options.now });
    extraPanels.captcha = captchaRoutes.renderPanel;
    router.use(captchaRoutes.router);
  }

  if (options.systemUpdate) router.use(createUpdateRoutes({ db, auth, guard, settings, systemUpdate: options.systemUpdate, renderBeheerPage, now: options.now }).router);
  if (options.hostTasks) router.use(createHostTaskRoutes({ auth, guard, settings, hostTasks: options.hostTasks, renderBeheerPage, notFound, now: options.now }));
  // De lezer van site-content.json is dezelfde als die van de publieke site (`services.js`), zodat de controle toont wat de site uitlevert.
  if (options.siteContent) router.use(createGoLiveRoutes({ db, guard, settings, siteContent: options.siteContent, renderBeheerPage, now: options.now }));
  router.use(createLogRoutes({ db, guard, settings, appLog: options.appLog, renderBeheerPage, now: options.now }));
  if (options.restoreTests) router.use(createRestoreTestRoutes({ auth, guard, settings, restoreTests: options.restoreTests, renderBeheerPage, now: options.now }));
  // Doorverwijzingen en de 404-lijst hebben eigen routes (vóór de algemene secties).
  if (options.redirects) router.use(createRedirectRoutes({ db, auth, guard, redirects: options.redirects, renderBeheerPage, notFound }));

  router.get('/beheer/', guard, async (req, res, next) => {
    try {
      await settings.ready();
      return res.send(renderStart(req, { activeAdmins: await countActiveAdmins() }));
    } catch (error) {
      return next(error);
    }
  });

  router.get(routePath('/beheer/:section([a-z0-9-]{1,40})/'), guard, async (req, res, next) => {
    try {
      const section = findSection(req.params.section);
      if (!section) return notFound(req, res);
      await settings.ready();
      if (section.view === 'overzicht') return res.send(await renderOverview(req));
      if (section.view === 'instellingen') return res.send(renderSettingsList(req));
      if (!section.fields) return notFound(req, res);
      return res.send(renderSettingsSection(req, section, { saved: req.query.opgeslagen === '1' }));
    } catch (error) {
      return next(error);
    }
  });

  /**
   * Controleert het wachtwoord waarmee de beheerder het aanzetten van een instelling met `confirmOn` bevestigt.
   * Telt elke poging mee in de limiet per gebruiker; een geslaagde bevestiging zet de teller terug.
   * @param {object} req Verzoek met `body._password` en `user`.
   * @returns {Promise<string>} Foutmelding, of een lege tekst als het wachtwoord klopt.
   */
  async function passwordConfirmationProblem(req) {
    const password = formText(req.body, '_password') || '';
    if (!password) return 'Bevestig het aanzetten met je wachtwoord.';
    if (!passwordLimiter.hit(`gebruiker:${req.user.id}`)) return 'Te veel pogingen. Probeer het over een kwartier opnieuw.';
    const [user] = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!user || !(await verifyPassword(password, user.password_hash))) return 'Je wachtwoord klopt niet.';
    passwordLimiter.clear(`gebruiker:${req.user.id}`);
    return '';
  }

  router.post(routePath('/beheer/:section([a-z0-9-]{1,40})/'), guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const section = findSection(req.params.section);
      if (!section || !section.fields) return notFound(req, res);
      const sectionKeys = new Set(section.fields);
      // Een selectievakje dat ontbreekt is "uit"; een ontbrekend tekstveld laat de instelling ongewijzigd; een veld dat
      // meer dan eens voorkomt is ongeldig.
      const values = {};
      const errors = {};
      for (const key of section.fields) {
        const definition = settings.fields[key];
        const text = formText(req.body, key);
        if (Object.hasOwn(req.body, key) && text === undefined) errors[key] = 'Ongeldige waarde.';
        else if (definition.type === 'bool') values[key] = text === 'ja';
        else if (text !== undefined) values[key] = text;
      }
      // Alleen instellingen van deze sectie mogen worden teruggezet of geleegd.
      const reset = formList(req.body, '_reset').filter((key) => sectionKeys.has(key));
      const clear = formList(req.body, '_clear').filter((key) => sectionKeys.has(key));
      if (Object.keys(errors).length) return res.status(422).send(renderSettingsSection(req, section, { values, errors }));
      // Aanzetten van een instelling met `confirmOn` (zoals indexeren) vraagt het wachtwoord van de beheerder.
      // Ook terugzetten telt als aanzetten als de startwaarde (bijvoorbeeld SITE_INDEXABLE=true) aan is.
      const turningOn = confirmableKeys(section).filter((key) => (reset.includes(key) ? settings.startValue(key) === true : values[key] === true));
      if (turningOn.length) {
        const problem = await passwordConfirmationProblem(req);
        if (problem) {
          // Ingevulde geheimen gaan niet terug naar de browser.
          section.fields.filter((key) => settings.fields[key].type === 'secret').forEach((key) => delete values[key]);
          return res.status(problem.startsWith('Te veel') ? 429 : 422).send(renderSettingsSection(req, section, { values, errors: { [turningOn[0]]: problem } }));
        }
      }
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
