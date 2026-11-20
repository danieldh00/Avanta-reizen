/**
 * Extra's van Beheer > Systeem > Bewaking en meldingen (recht `systeem`): de stand van elke controle, open en gesloten
 * incidenten, de laatste meldingen en heartbeat, *Nu controleren* en een testmelding. De instellingen (meldadres,
 * webhook, heartbeat, drempels) staan in het gewone instellingenformulier (`beheer/routes.js`); de bewaking zelf in
 * `system/monitor.js`. Nooit URL's of adressen in de uitvoer.
 */
const express = require('express');
const { html } = require('../site/html');
const { formatDateTime } = require('../crm/layout');
const { findSection } = require('./indeling');
const { createRateLimiter } = require('../security/rate-limit');
const { CHECK_LABELS } = require('../system/monitor');

/** Weergave van de uitkomst van een controle. */
const STATE_LABELS = { ok: 'In orde', warn: 'Waarschuwing', error: 'Ernstig', uit: 'Niet van toepassing' };
/** Weergave van de ernst van een incident. */
const SEVERITY_LABELS = { warn: 'Waarschuwing', error: 'Ernstig' };
/** Weergave van een kanaal. */
const CHANNEL_LABELS = { mail: 'Mail', webhook: 'Webhook', heartbeat: 'Heartbeat' };

/**
 * Tekst voor de uitkomst van een kanaal bij de testmelding.
 * @param {(boolean|null)} value Gelukt, mislukt of niet ingesteld.
 * @returns {string} Tekst.
 */
function channelResult(value) {
  if (value === null || value === undefined) return 'niet ingesteld';
  return value ? 'gelukt' : 'mislukt';
}

/**
 * Maakt de routes en het paneel van de bewaking.
 * @param {{auth: object, guard: Function, monitor: object, renderSettingsSection: Function, now?: () => number}} options
 *   Sessielaag, rechtencontrole, de bewaking (`system/monitor.js`), de weergave van een instellingensectie en (voor
 *   tests) de klok van de limieten.
 * @returns {{router: express.Router, renderPanel: Function}} Router en paneel (voor onder het formulier).
 */
function createMonitorRoutes(options) {
  const { auth, guard, monitor } = options;
  const router = express.Router();
  // Testmeldingen: hoogstens 5 per tien minuten per gebruiker (elke test is een mail en een verzoek naar buiten).
  const testLimiter = createRateLimiter({ limit: 5, windowMs: 10 * 60 * 1000, now: options.now });
  // Nu controleren: hoogstens 12 per tien minuten per gebruiker.
  const runLimiter = createRateLimiter({ limit: 12, windowMs: 10 * 60 * 1000, now: options.now });
  const section = findSection('bewaking');

  /**
   * Het paneel onder het formulier.
   * @param {object} req Express-verzoek.
   * @param {{result?: {ok: boolean, message: string}}} [state] Uitkomst van een actie.
   * @returns {object} HTML.
   */
  const renderPanel = (req, state = {}) => {
    const view = monitor.view();
    const csrfField = html`<input type="hidden" name="_csrf" value="${req.session.csrf}">`;
    return html`<h2 id="stand">Stand</h2>
      ${state.result ? html`<p class="${state.result.ok ? 'notice' : 'form-alert'}" role="${state.result.ok ? 'status' : 'alert'}">${state.result.message}</p>` : ''}
      ${view.enabled ? '' : html`<p class="form-alert" role="alert">De bewaking staat uit: er worden geen incidenten aangemaakt en geen meldingen verstuurd.</p>`}
      ${view.open.length ? html`<p class="form-alert" role="alert">${view.open.length === 1 ? 'Er staat 1 incident open.' : `Er staan ${view.open.length} incidenten open.`}</p>` : ''}
      ${view.lastRunAt ? html`<div class="crm-table-wrap"><table class="crm-table beheer-monitor">
        <thead><tr><th scope="col">Controle</th><th scope="col">Stand</th><th scope="col">Toelichting</th></tr></thead>
        <tbody>${view.checks.map((check) => html`<tr>
          <td>${check.label}</td>
          <td><span class="monitor-state monitor-state--${check.state}">${STATE_LABELS[check.state] || check.state}</span></td>
          <td>${check.message}</td>
        </tr>`)}</tbody>
      </table></div>
      <p class="field__help">Laatste controle: ${formatDateTime(view.lastRunAt)}. De bewaking draait elke vijf minuten.</p>` : html`<p>Er is sinds de laatste herstart nog niet gecontroleerd; de eerste controle volgt binnen een minuut.</p>`}
      <div class="beheer-actions">
        <form method="post" action="/app/beheer/bewaking/controleren/">${csrfField}<button class="btn btn--outline btn--small" type="submit">Nu controleren</button></form>
        <form method="post" action="/app/beheer/bewaking/testen/">${csrfField}<button class="btn btn--outline btn--small" type="submit">Testmelding versturen</button></form>
      </div>
      <h2>Open incidenten</h2>
      ${view.open.length ? html`<div class="crm-table-wrap"><table class="crm-table">
        <thead><tr><th scope="col">Controle</th><th scope="col">Ernst</th><th scope="col">Melding</th><th scope="col">Sinds</th><th scope="col">Gemeld</th></tr></thead>
        <tbody>${view.open.map((incident) => html`<tr>
          <td>${CHECK_LABELS[incident.check_key] || incident.check_key}</td>
          <td>${SEVERITY_LABELS[incident.severity]}</td>
          <td>${incident.message}</td>
          <td>${formatDateTime(incident.opened_at)}</td>
          <td>${incident.notify_count ? `${incident.notify_count}× (laatst ${formatDateTime(incident.notified_at)})` : 'Nee'}</td>
        </tr>`)}</tbody>
      </table></div>` : html`<p>Geen open incidenten.</p>`}
      <h2>Gesloten incidenten</h2>
      ${view.closed.length ? html`<div class="crm-table-wrap"><table class="crm-table">
        <thead><tr><th scope="col">Controle</th><th scope="col">Ernst</th><th scope="col">Melding</th><th scope="col">Van</th><th scope="col">Tot</th></tr></thead>
        <tbody>${view.closed.map((incident) => html`<tr>
          <td>${CHECK_LABELS[incident.check_key] || incident.check_key}</td>
          <td>${SEVERITY_LABELS[incident.severity]}</td>
          <td>${incident.message}</td>
          <td>${formatDateTime(incident.opened_at)}</td>
          <td>${formatDateTime(incident.resolved_at)}</td>
        </tr>`)}</tbody>
      </table></div>
      <p class="field__help">De laatste 30; gesloten incidenten blijven een jaar bewaard.</p>` : html`<p>Nog geen gesloten incidenten.</p>`}
      <h2>Laatste meldingen</h2>
      <p>Heartbeat: ${view.heartbeat ? `${view.heartbeat.ok ? 'gelukt' : 'mislukt'} (${formatDateTime(view.heartbeat.at)}, ${view.heartbeat.message})` : 'sinds de herstart niet aangeroepen'}.</p>
      ${view.deliveries.length ? html`<div class="crm-table-wrap"><table class="crm-table">
        <thead><tr><th scope="col">Tijdstip</th><th scope="col">Kanaal</th><th scope="col">Soort</th><th scope="col">Uitkomst</th></tr></thead>
        <tbody>${view.deliveries.map((entry) => html`<tr>
          <td>${formatDateTime(entry.at)}</td>
          <td>${CHANNEL_LABELS[entry.channel] || entry.channel}</td>
          <td>${entry.kind === 'test' ? 'Test' : 'Incidenten'}</td>
          <td>${entry.ok ? 'Gelukt' : 'Mislukt'}: ${entry.message}</td>
        </tr>`)}</tbody>
      </table></div>
      <p class="field__help">Sinds de laatste herstart, hoogstens 20; zonder adressen of URL's.</p>` : html`<p>Sinds de laatste herstart is er nog niets gemeld.</p>`}`;
  };

  router.post('/beheer/bewaking/controleren/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      if (!runLimiter.hit(`gebruiker:${req.user.id}`)) {
        return res.status(429).send(options.renderSettingsSection(req, section, { extra: { result: { ok: false, message: 'Te vaak gecontroleerd. Probeer het over tien minuten opnieuw.' } } }));
      }
      await monitor.run();
      return res.send(options.renderSettingsSection(req, section, { extra: { result: { ok: true, message: 'Alles is opnieuw gecontroleerd.' } } }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/beheer/bewaking/testen/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      if (!testLimiter.hit(`gebruiker:${req.user.id}`)) {
        return res.status(429).send(options.renderSettingsSection(req, section, { extra: { result: { ok: false, message: 'Te veel testmeldingen. Probeer het over tien minuten opnieuw.' } } }));
      }
      const outcome = await monitor.test();
      await auth.audit(req, { userId: req.user.id, action: 'bewaking.test', entity: 'bewaking', entityId: null });
      const values = [outcome.mail, outcome.webhook, outcome.heartbeat];
      const message = `Testmelding: mail ${channelResult(outcome.mail)}, webhook ${channelResult(outcome.webhook)}, heartbeat ${channelResult(outcome.heartbeat)}.`;
      if (values.every((value) => value === null)) {
        return res.status(422).send(options.renderSettingsSection(req, section, { extra: { result: { ok: false, message: 'Er is nog geen kanaal ingesteld: vul een meldadres (met mailserver), een webhook of een heartbeat in.' } } }));
      }
      const ok = !values.includes(false);
      return res.status(ok ? 200 : 422).send(options.renderSettingsSection(req, section, { extra: { result: { ok, message } } }));
    } catch (error) {
      return next(error);
    }
  });

  return { router, renderPanel };
}

module.exports = { createMonitorRoutes };
