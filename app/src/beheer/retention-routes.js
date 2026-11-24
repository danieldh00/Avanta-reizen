/**
 * Extra's van Beheer > Toegang en beveiliging > AVG en bewaartermijnen (recht `systeem`): de laatste rondes van de
 * AVG-opschoning met aantallen, een voorbeeld van wat de volgende ronde zou doen en *Nu opschonen*. De termijnen staan
 * in het gewone instellingenformulier (`beheer/routes.js`); de opschoning zelf in `persons/retention.js`. Nooit namen of
 * andere persoonsgegevens in de uitvoer, alleen aantallen.
 */
const express = require('express');
const { html } = require('../site/html');
const { formatDateTime } = require('../crm/layout');
const { findSection } = require('./indeling');
const { createRateLimiter } = require('../security/rate-limit');
const { COUNT_LABELS } = require('../persons/retention');

/** Acties voor het auditlog (zie `ACTION_LABELS` in `crm/users.js`). */
const RETENTION_ACTION_LABELS = {
  'avg.opschonen': 'AVG-opschoning met de hand gestart',
};

/**
 * Korte samenvatting van de aantallen van een ronde.
 * @param {Record<string, number>} counts Aantallen per onderdeel.
 * @returns {string} Tekst, bijv. "2 personen geanonimiseerd, 1 contactbericht verwijderd", of "Niets te doen".
 */
function summarize(counts) {
  const parts = Object.keys(COUNT_LABELS).filter((key) => Number(counts?.[key]) > 0).map((key) => `${COUNT_LABELS[key]}: ${Number(counts[key])}`);
  return parts.length ? parts.join(' · ') : 'Niets te wissen';
}

/**
 * Maakt de routes en het paneel van de AVG-opschoning.
 * @param {{auth: object, guard: Function, retention: object, renderSettingsSection: Function, now?: () => number}} options
 *   Sessielaag, rechtencontrole, de opschoning (`persons/retention.js`), de weergave van een instellingensectie en (voor
 *   tests) de klok van de limieten.
 * @returns {{router: express.Router, renderPanel: Function}} Router en paneel (voor onder het formulier).
 */
function createRetentionRoutes(options) {
  const { auth, guard, retention } = options;
  const router = express.Router();
  // Voorbeeld en opschonen zijn zware zoekopdrachten: hoogstens 10 per tien minuten per gebruiker.
  const limiter = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000, now: options.now });
  const section = findSection('bewaartermijnen');

  /**
   * Het paneel onder het formulier.
   * @param {object} req Express-verzoek.
   * @param {{result?: {ok: boolean, message: string}, preview?: Record<string, number>}} [state] Uitkomst van een actie.
   * @returns {object} HTML.
   */
  const renderPanel = (req, state = {}) => {
    const view = retention.view();
    const csrfField = html`<input type="hidden" name="_csrf" value="${req.session.csrf}">`;
    return html`<h2 id="opschonen">Opschonen</h2>
      ${state.result ? html`<p class="${state.result.ok ? 'notice' : 'form-alert'}" role="${state.result.ok ? 'status' : 'alert'}">${state.result.message}</p>` : ''}
      ${view.enabled ? html`<p>De opschoning draait elke dag automatisch.</p>` : html`<p class="form-alert" role="alert">Het automatisch opschonen staat uit: er wordt niets gewist tot je het weer aanzet of Nu opschonen kiest.</p>`}
      ${view.running ? html`<p class="notice" role="status">Er loopt nu een ronde.</p>` : ''}
      ${state.preview ? html`<h3>Voorbeeld: wat er nu gewist zou worden</h3>
        <div class="crm-table-wrap"><table class="crm-table">
          <tbody>${Object.keys(COUNT_LABELS).map((key) => html`<tr><th scope="row">${COUNT_LABELS[key]}</th><td>${Number(state.preview[key] || 0)}</td></tr>`)}</tbody>
        </table></div>` : ''}
      <form class="beheer-confirm" id="form-opschonen" method="post" action="/app/beheer/bewaartermijnen/opschonen/">${csrfField}
        <label class="choice"><input type="checkbox" name="bevestigen" value="ja" required> <span>Ik begrijp dat wissen niet terug te draaien is</span></label>
      </form>
      <div class="beheer-actions">
        <form method="post" action="/app/beheer/bewaartermijnen/voorbeeld/">${csrfField}<button class="btn btn--outline btn--small" type="submit">Voorbeeld berekenen</button></form>
        <button class="btn btn--outline btn--small" type="submit" form="form-opschonen">Nu opschonen</button>
      </div>
      <p class="field__help">Wissen en anonimiseren is niet terug te draaien (alleen nog in oudere back-ups, die volgens hun eigen bewaartermijn verdwijnen).</p>
      <h2>Laatste rondes</h2>
      ${view.runs.length ? html`<div class="crm-table-wrap"><table class="crm-table">
        <thead><tr><th scope="col">Gestart</th><th scope="col">Door</th><th scope="col">Gewist</th><th scope="col">Mislukt</th></tr></thead>
        <tbody>${view.runs.map((run) => html`<tr>
          <td>${formatDateTime(run.started_at)}</td>
          <td>${run.trigger === 'handmatig' ? `Met de hand${run.user_name ? ` (${run.user_name})` : ''}` : 'Dagelijks'}</td>
          <td>${run.finished_at ? summarize(run.counts) : 'Loopt nog of afgebroken'}</td>
          <td>${run.error ? `Ronde afgebroken (${run.error})` : Number(run.failed) || 0}</td>
        </tr>`)}</tbody>
      </table></div>
      <p class="field__help">De laatste 30 rondes; rondes blijven twee jaar bewaard. Mislukt betekent meestal dat een blok niet te ontsleutelen is (andere hoofdsleutel); de volgende ronde probeert het opnieuw.</p>` : html`<p>Er is nog niet opgeschoond.</p>`}`;
  };

  /**
   * Weigert met 429 als de limiet bereikt is.
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @returns {boolean} Waar als het verzoek is afgehandeld (geweigerd).
   */
  const refuseOverLimit = (req, res) => {
    if (limiter.hit(`gebruiker:${req.user.id}`)) return false;
    res.status(429).send(options.renderSettingsSection(req, section, { extra: { result: { ok: false, message: 'Te vaak geprobeerd. Probeer het over tien minuten opnieuw.' } } }));
    return true;
  };

  router.post('/beheer/bewaartermijnen/voorbeeld/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      if (refuseOverLimit(req, res)) return undefined;
      const preview = await retention.preview();
      return res.send(options.renderSettingsSection(req, section, { extra: { preview } }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/beheer/bewaartermijnen/opschonen/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      if (req.body.bevestigen !== 'ja') {
        return res.status(422).send(options.renderSettingsSection(req, section, { extra: { result: { ok: false, message: 'Vink aan dat je begrijpt dat wissen niet terug te draaien is.' } } }));
      }
      if (refuseOverLimit(req, res)) return undefined;
      const outcome = await retention.run({ trigger: 'handmatig', userId: req.user.id });
      // De ronde zelf staat met aantallen in retention_runs; het auditlog verwijst ernaar.
      if (outcome) await auth.audit(req, { userId: req.user.id, action: 'avg.opschonen', entity: 'retention_runs', entityId: outcome.runId });
      if (!outcome) {
        return res.status(409).send(options.renderSettingsSection(req, section, { extra: { result: { ok: false, message: 'Er loopt al een ronde. Probeer het over een paar minuten opnieuw.' } } }));
      }
      if (outcome.error) {
        return res.status(500).send(options.renderSettingsSection(req, section, { extra: { result: { ok: false, message: `De ronde is afgebroken (${outcome.error}). Zie het logboek.` } } }));
      }
      const message = `Opgeschoond. ${summarize(outcome.counts)}.${outcome.failed ? ` ${outcome.failed} mislukt.` : ''}`;
      return res.send(options.renderSettingsSection(req, section, { extra: { result: { ok: !outcome.failed, message } } }));
    } catch (error) {
      return next(error);
    }
  });

  return { router, renderPanel };
}

module.exports = { createRetentionRoutes, RETENTION_ACTION_LABELS, summarize };
