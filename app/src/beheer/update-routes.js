// @ts-check
/**
 * Beheer > Systeem > Updates en onderhoud (recht `systeem`): welke versie draait en klaarstaat (met releasenotes),
 * *Nu controleren*, *Nu updaten* (met het eigen wachtwoord), een aanvraag intrekken, automatisch bijwerken aan/uit en
 * de onderhoudsmodus met de hand. De koppeling met het hostscript staat in `system/system-update.js`; hier staan wie
 * wat mag, de limieten en het auditlog.
 */
const express = require('express');
const { html, raw } = require('../site/html');
const { formatDateTime } = require('../crm/layout');
const { verifyPassword, MAX_LENGTH } = require('../crm/passwords');
const { createRateLimiter } = require('../security/rate-limit');
const { SettingsError } = require('./settings');
const { DEFAULT_MESSAGE } = require('../system/maintenance');

/** Omschrijving van de stand van een uitrol. */
const STATE_LABELS = { idle: 'Nog geen uitrol vanuit de app', bezig: 'Bezig', geslaagd: 'Geslaagd', mislukt: 'Mislukt', geweigerd: 'Geweigerd' };
/** Omschrijving van de stappen van een uitrol. */
const STEP_LABELS = {
  ophalen: 'nieuwe versie ophalen en bouwen', onderhoud: 'onderhoudsmodus aan', 'back-up': 'back-up maken', herstarten: 'nieuwe versie starten',
  controleren: 'controleren', terugzetten: 'terugzetten naar de vorige versie', klaar: 'klaar',
};

/**
 * Korte weergave van een commit.
 * @param {(string|null)} commit Volledige commit.
 * @returns {string} De eerste 7 tekens, of leeg.
 */
function shortCommit(commit) {
  return commit ? commit.slice(0, 7) : '';
}

/** Uitrollen die nu worden vastgelegd (per sleutel), tegen een dubbele auditregel bij twee gelijktijdige rondes. */
const recording = new Set();
/** Uitrollen die dit proces al in het auditlog heeft gezet, ook als het onthouden op schijf mislukte (map niet schrijfbaar). */
const recorded = new Set();

/**
 * Legt een afgeronde uitrol (ook een automatische) één keer vast in het auditlog, zonder gebruiker. Pas na een
 * geslaagde regel wordt hij als vastgelegd onthouden (in het geheugen en op schijf); mislukt de regel, dan volgt een
 * nieuwe poging bij de volgende ronde. Mislukt alleen het onthouden op schijf, dan schrijft dit proces hem niet opnieuw.
 * @param {any} db Database.
 * @param {any} systemUpdate De koppeling met het hostscript.
 * @returns {Promise<boolean>} true als er een regel is geschreven.
 */
async function recordFinishedRun(db, systemUpdate) {
  const finished = systemUpdate.finishedRun();
  if (!finished || recording.has(finished.key) || recorded.has(finished.key)) return false;
  recording.add(finished.key);
  try {
    const { run } = finished;
    await db.query('INSERT INTO audit_log (user_id, action, entity, entity_id) VALUES (NULL, $1, $2, $3)', [`update.${run.state}`, 'systeem', run.version || shortCommit(run.commit) || null]);
    recorded.add(finished.key);
    try {
      systemUpdate.markAudited(finished.key);
    } catch (error) {
      console.error(`Uitrol vastgelegd, maar onthouden mislukt: ${error.code || 'fout'}`);
    }
    return true;
  } finally {
    recording.delete(finished.key);
  }
}

/**
 * Houdt de host en het auditlog bij, los van de pagina (een GET schrijft niets): bij het starten en daarna elke minuut
 * de stand van "automatisch bijwerken" naar `policy.json` en een afgeronde uitrol in het auditlog.
 * @param {{db: any, settings: any, systemUpdate: any, intervalMs?: number}} options Database, instellingen,
 *   koppeling met het hostscript en (voor tests) de tussentijd.
 * @returns {{sync: Function, timer: NodeJS.Timeout}} De ronde en de timer.
 */
function startUpdateSync({ db, settings, systemUpdate, intervalMs = 60 * 1000 }) {
  const sync = async () => {
    try {
      await settings.ready();
      systemUpdate.setAuto(settings.get('updateAuto'));
      await recordFinishedRun(db, systemUpdate);
    } catch (error) {
      console.error(`Updates bijhouden mislukt: ${String(error.message).replace(/[\r\n]/g, ' ')}`);
    }
  };
  sync();
  return { sync, timer: setInterval(sync, intervalMs).unref() };
}

/**
 * De tabel met de draaiende en beschikbare versie, de laatste controle en de laatste uitrol.
 * @param {any} view Weergave uit `systemUpdate.view()` (ingericht).
 * @returns {any} HTML.
 */
function renderVersionFacts(view) {
  const { status } = view;
  return html`<div class="crm-table-wrap"><table class="crm-table beheer-facts"><tbody>
        <tr><th scope="row">Draaiende versie</th><td>${view.running}${status.currentCommit ? html` <span class="field__help">(${shortCommit(status.currentCommit)})</span>` : ''}</td></tr>
        <tr><th scope="row">Beschikbaar</th><td>${status.available || '–'}${status.availableCommit ? html` <span class="field__help">(${shortCommit(status.availableCommit)})</span>` : ''}${view.newer ? html` <strong>nieuwer</strong>` : status.availableCommit ? ' (draait al)' : ''}</td></tr>
        <tr><th scope="row">Laatst gecontroleerd</th><td>${formatDateTime(status.checkedAt)}${view.checking ? ' (controle loopt)' : ''}</td></tr>
        <tr><th scope="row">Laatste uitrol</th><td>${STATE_LABELS[status.state]}${status.version ? ` (${status.version})` : ''}${status.state === 'bezig' && status.step ? `: ${STEP_LABELS[status.step]}` : ''}${status.finishedAt ? `, ${formatDateTime(status.finishedAt)}` : ''}${status.automatic ? ' (automatisch)' : ''}${status.message ? html`<br><span class="field__help">${status.message}</span>` : ''}</td></tr>
      </tbody></table></div>`;
}

/**
 * Het blok om een nieuwere versie te installeren: releasenotes en het formulier met het wachtwoord.
 * @param {any} req Express-verzoek.
 * @param {any} status Stand van de updates (`view.status`).
 * @param {any[]} releases Releasenotes tussen de draaiende en de beschikbare versie.
 * @param {{passwordError?: string}} state Fout bij het wachtwoord.
 * @returns {any} HTML.
 */
function renderInstallForm(req, status, releases, state) {
  const csrf = req.session.csrf;
  return html`<h2>Versie ${status.available || shortCommit(status.availableCommit)} installeren</h2>
        ${releases.length ? html`<div class="beheer-releases">${releases.map((release) => html`<section>
          <h3>${release.version}${release.title ? ` — ${release.title}` : ''}${release.date ? html` <span class="field__help">${release.date}</span>` : ''}</h3>
          ${release.items.length ? html`<ul>${release.items.map((item) => html`<li>${item}</li>`)}</ul>` : ''}
        </section>`)}</div>` : html`<p>Geen releasenotes voor deze versie (bijvoorbeeld een wijziging zonder nieuw versienummer).</p>`}
        <p>Tijdens de update maakt de server eerst een back-up en staat de site ongeveer een minuut in onderhoudsmodus. Start de nieuwe versie niet goed, dan zet de server de vorige versie terug.</p>
        <form class="form beheer-form" method="post" action="/app/beheer/updates/installeren/">
          <input type="hidden" name="_csrf" value="${csrf}">
          <input type="hidden" name="commit" value="${status.availableCommit}">
          <input type="hidden" name="username" value="${req.user.email}" autocomplete="username">
          <div class="field">
            <span class="field__label"><label for="update-wachtwoord">Je wachtwoord</label></span>
            <input id="update-wachtwoord" type="password" name="password" autocomplete="current-password" maxlength="${MAX_LENGTH}" required${state.passwordError ? raw(' aria-invalid="true" aria-describedby="update-wachtwoord-fout"') : ''}>
            ${state.passwordError ? html`<span class="field__error" id="update-wachtwoord-fout">${state.passwordError}</span>` : ''}
          </div>
          <div><button class="btn" type="submit">Nu updaten</button></div>
        </form>`;
}

/**
 * Maakt de routes.
 * @param {{db: any, auth: any, guard: Function, settings: any, systemUpdate: any, renderBeheerPage: Function, now?: () => number}} options
 *   Database, sessielaag, rechtencontrole, instellingen, de koppeling met het hostscript, de weergave van een
 *   Beheer-pagina en (voor tests) de klok van de limieten.
 * @returns {{router: express.Router}} Router.
 */
function createUpdateRoutes(options) {
  const { db, auth, guard, settings, systemUpdate } = options;
  const router = express.Router();
  // Starten: weinig pogingen per gebruiker (ook tegen raden van het wachtwoord). Controleren en wijzigen: ruim.
  const startLimiter = createRateLimiter({ limit: 5, windowMs: 15 * 60 * 1000, now: options.now });
  const checkLimiter = createRateLimiter({ limit: 30, windowMs: 10 * 60 * 1000, now: options.now });
  const changeLimiter = createRateLimiter({ limit: 30, windowMs: 60 * 60 * 1000, now: options.now });

  /**
   * Een melding boven de pagina.
   * @param {{ok: boolean, message: string}} [result] Uitkomst van een actie.
   * @returns {any} HTML.
   */
  const renderResult = (result) => (result ? html`<p class="${result.ok ? 'notice' : 'form-alert'}" role="${result.ok ? 'status' : 'alert'}">${result.message}</p>` : '');

  /**
   * Het blok met versies, de laatste uitrol, releasenotes en knoppen.
   * @param {any} req Express-verzoek.
   * @param {any} view Weergave uit `systemUpdate.view()`.
   * @param {any} state Fout bij het wachtwoord.
   * @returns {any} HTML.
   */
  const renderUpdateBlock = (req, view, state) => {
    if (!view.configured) {
      return html`<p>Updaten vanuit de app is op deze server niet ingericht. Dat werkt alleen op de server met het hostscript (<code>deploy/apps01</code>); daar richt de installatie het vanzelf in.</p>
        <div class="crm-table-wrap"><table class="crm-table beheer-facts"><tbody><tr><th scope="row">Draaiende versie</th><td>${view.running}</td></tr></tbody></table></div>`;
    }
    const { status } = view;
    const busy = view.maintenance.active || status.state === 'bezig';
    const csrf = req.session.csrf;
    return html`${renderVersionFacts(view)}
      ${busy ? html`<p class="notice" role="status">Er loopt een update. De site staat even in onderhoudsmodus; ververs deze pagina over een minuut.</p>` : ''}
      ${view.pending ? html`<div class="notice" role="status"><p>Update naar ${view.pending.version || shortCommit(view.pending.commit)} aangevraagd${view.pending.byName ? ` door ${view.pending.byName}` : ''} (${formatDateTime(view.pending.requestedAt)}); de server begint binnen een minuut.</p>
        <form method="post" action="/app/beheer/updates/intrekken/"><input type="hidden" name="_csrf" value="${csrf}"><button class="btn btn--outline btn--small" type="submit">Aanvraag intrekken</button></form></div>` : ''}
      <div class="beheer-actions">
        <form method="post" action="/app/beheer/updates/controleren/"><input type="hidden" name="_csrf" value="${csrf}"><button class="btn btn--outline btn--small" type="submit"${busy || view.pending || view.checking ? raw(' disabled') : ''}>Nu controleren</button></form>
      </div>
      ${view.newer && !busy && !view.pending ? renderInstallForm(req, status, view.releases, state) : ''}
      <h2>Automatisch bijwerken</h2>
      <form class="form beheer-form" method="post" action="/app/beheer/updates/automatisch/">
        <input type="hidden" name="_csrf" value="${csrf}">
        <label class="choice"><input type="checkbox" name="updateAuto" value="ja"${settings.get('updateAuto') ? raw(' checked') : ''}> <span>${settings.fields.updateAuto.label}</span></label>
        <span class="field__help">${settings.fields.updateAuto.help}</span>
        <div><button class="btn btn--outline btn--small" type="submit">Opslaan</button></div>
      </form>`;
  };

  /**
   * De pagina.
   * @param {any} req Express-verzoek.
   * @param {{result?: any, passwordError?: string}} [state] Uitkomst van een actie.
   * @returns {string} HTML-pagina.
   */
  const renderPage = (req, state = {}) => {
    const view = systemUpdate.view();
    const manual = settings.get('maintenanceMode') === true;
    return options.renderBeheerPage(req, {
      title: 'Updates en onderhoud',
      sectionId: 'updates',
      body: html`<p>Nieuwe versies komen van de branch main (na de Claude-reviews en de tests in GitHub). Hier zie je wat er klaarstaat en start je de update.</p>
        ${renderResult(state.result)}
        ${renderUpdateBlock(req, view, state)}
        <h2>Onderhoudsmodus</h2>
        <p>In de onderhoudsmodus kan niemand iets versturen of opslaan (contactformulier, aanmelden, CRM); lezen blijft werken en bovenaan elke pagina staat een melding. Tijdens een update zet de server de onderhoudsmodus zelf aan en uit.</p>
        <form class="form beheer-form" method="post" action="/app/beheer/updates/onderhoud/">
          <input type="hidden" name="_csrf" value="${req.session.csrf}">
          <label class="choice"><input type="checkbox" name="maintenanceMode" value="ja"${manual ? raw(' checked') : ''}> <span>${settings.fields.maintenanceMode.label} aan</span></label>
          <div class="field">
            <span class="field__label"><label for="onderhoud-tekst">${settings.fields.maintenanceMessage.label}</label></span>
            <input id="onderhoud-tekst" type="text" name="maintenanceMessage" maxlength="${settings.fields.maintenanceMessage.max}" value="${settings.get('maintenanceMessage')}" placeholder="${DEFAULT_MESSAGE}">
            <span class="field__help">${settings.fields.maintenanceMessage.help}</span>
          </div>
          <div><button class="btn btn--outline btn--small" type="submit">Opslaan</button></div>
        </form>`,
    });
  };

  /**
   * Slaat instellingen van deze pagina op, met audit in dezelfde transactie.
   * @param {any} req Express-verzoek.
   * @param {any} values Nieuwe waarden.
   * @returns {Promise<string[]>} Gewijzigde instellingen.
   */
  const saveSettings = (req, values) => settings.update({ values }, {
    userId: req.user.id,
    inTransaction: async (client, changed) => {
      for (const key of changed) await auth.audit(req, { userId: req.user.id, action: 'instelling.gewijzigd', entity: 'settings', entityId: key }, client);
    },
  });

  /**
   * Een fout bij een actie als pagina met melding.
   * @param {any} req Express-verzoek.
   * @param {any} res Express-antwoord.
   * @param {number} status HTTP-status.
   * @param {string} message Melding.
   * @returns {void}
   */
  const fail = (req, res, status, message) => {
    res.status(status).send(renderPage(req, { result: { ok: false, message } }));
  };

  router.get('/beheer/updates/', guard, async (req, res, next) => {
    try {
      await settings.ready();
      return res.send(renderPage(req, { result: req.query.klaar ? { ok: true, message: { aangevraagd: 'De update is aangevraagd; de server begint binnen een minuut.', controle: 'De server kijkt nu of er een nieuwe versie is; ververs de pagina over een minuut.', ingetrokken: 'De aanvraag is ingetrokken.', opgeslagen: 'Opgeslagen.' }[req.query.klaar] } : undefined }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/beheer/updates/controleren/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      await settings.ready();
      if (!checkLimiter.hit(`gebruiker:${req.user.id}`)) return fail(req, res, 429, 'Te vaak gecontroleerd. Probeer het over tien minuten opnieuw.');
      const out = systemUpdate.requestCheck({ byName: req.user.name });
      if (out.error) return fail(req, res, out.status, out.message);
      if (out.started) await auth.audit(req, { userId: req.user.id, action: 'update.controle', entity: 'systeem' });
      return res.redirect(303, '/app/beheer/updates/?klaar=controle');
    } catch (error) {
      return next(error);
    }
  });

  router.post('/beheer/updates/installeren/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      await settings.ready();
      if (!startLimiter.hit(`gebruiker:${req.user.id}`)) return fail(req, res, 429, 'Te veel pogingen. Probeer het over een kwartier opnieuw.');
      const password = typeof req.body.password === 'string' ? req.body.password.slice(0, MAX_LENGTH) : '';
      const [user] = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
      if (!password || !user || !(await verifyPassword(password, user.password_hash))) {
        await auth.audit(req, { userId: req.user.id, action: 'update.wachtwoord-fout', entity: 'systeem' });
        return res.status(422).send(renderPage(req, { passwordError: 'Je wachtwoord klopt niet.' }));
      }
      const out = systemUpdate.request({ commit: typeof req.body.commit === 'string' ? req.body.commit : '', byName: req.user.name });
      if (out.error) return fail(req, res, out.status, out.message);
      await auth.audit(req, { userId: req.user.id, action: 'update.aangevraagd', entity: 'systeem', entityId: out.request.version || shortCommit(out.request.commit) });
      return res.redirect(303, '/app/beheer/updates/?klaar=aangevraagd');
    } catch (error) {
      return next(error);
    }
  });

  router.post('/beheer/updates/intrekken/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      await settings.ready();
      if (!changeLimiter.hit(`gebruiker:${req.user.id}`)) return fail(req, res, 429, 'Te vaak gewijzigd. Probeer het later opnieuw.');
      const cancelled = systemUpdate.cancel();
      if (!cancelled) return fail(req, res, 404, 'Er staat geen aanvraag open (misschien is de update al begonnen).');
      await auth.audit(req, { userId: req.user.id, action: 'update.ingetrokken', entity: 'systeem', entityId: cancelled.version || shortCommit(cancelled.commit) || null });
      return res.redirect(303, '/app/beheer/updates/?klaar=ingetrokken');
    } catch (error) {
      return next(error);
    }
  });

  router.post('/beheer/updates/automatisch/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      await settings.ready();
      if (!changeLimiter.hit(`gebruiker:${req.user.id}`)) return fail(req, res, 429, 'Te vaak gewijzigd. Probeer het later opnieuw.');
      await saveSettings(req, { updateAuto: req.body.updateAuto === 'ja' });
      systemUpdate.setAuto(settings.get('updateAuto'));
      return res.redirect(303, '/app/beheer/updates/?klaar=opgeslagen');
    } catch (error) {
      return next(error);
    }
  });

  router.post('/beheer/updates/onderhoud/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      await settings.ready();
      if (!changeLimiter.hit(`gebruiker:${req.user.id}`)) return fail(req, res, 429, 'Te vaak gewijzigd. Probeer het later opnieuw.');
      const message = typeof req.body.maintenanceMessage === 'string' ? req.body.maintenanceMessage : '';
      try {
        await saveSettings(req, { maintenanceMode: req.body.maintenanceMode === 'ja', maintenanceMessage: message });
      } catch (error) {
        if (error instanceof SettingsError) return fail(req, res, 422, `Niet opgeslagen: ${error.message}`);
        throw error;
      }
      return res.redirect(303, '/app/beheer/updates/?klaar=opgeslagen');
    } catch (error) {
      return next(error);
    }
  });

  return { router };
}

module.exports = { createUpdateRoutes, recordFinishedRun, startUpdateSync };
