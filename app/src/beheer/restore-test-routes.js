/**
 * Beheer > Back-ups en herstel > Hersteltest (recht `systeem`): de uitslagen van de wekelijkse hersteltest op de server
 * (`deploy/apps01/restore-test.sh`) en van de hersteltest van de Google Drive-kopie, met *Nu testen* voor beide.
 * Aanvragen komen in het auditlog.
 */
const express = require('express');
const { html, raw } = require('../site/html');
const { formatDateTime } = require('../crm/layout');
const { createRateLimiter } = require('../security/rate-limit');

/** Omschrijving van de uitkomsten. */
const STATE_LABELS = { bezig: 'Bezig', geslaagd: 'Geslaagd', waarschuwing: 'Waarschuwing', mislukt: 'Mislukt' };
/** Omschrijving van de aanleiding. */
const TRIGGER_LABELS = { schema: 'wekelijks', handmatig: 'handmatig' };

/**
 * Maakt de routes van de hersteltest.
 * @param {{auth: object, guard: Function, settings: object, restoreTests: object, renderBeheerPage: Function, now?: () => number}} options
 *   Sessielaag, rechtencontrole, instellingen, de hersteltests (`backup/restore-test.js`), de weergave van een
 *   Beheer-pagina en (voor tests) de klok van de limieten.
 * @returns {express.Router} Router.
 */
function createRestoreTestRoutes(options) {
  const { auth, guard, settings, restoreTests } = options;
  const router = express.Router();
  // Aanvragen: hoogstens 3 per uur per gebruiker en per soort (elke test is een volledige terugzet of download).
  const hostLimiter = createRateLimiter({ limit: 3, windowMs: 60 * 60 * 1000, now: options.now });
  const driveLimiter = createRateLimiter({ limit: 3, windowMs: 60 * 60 * 1000, now: options.now });

  /**
   * Een tabel met runs.
   * @param {object[]} runs Runs, nieuwste eerst.
   * @param {boolean} withDetails Of de kolommen van de servertest (tabellen, rijen, app) erbij horen.
   * @returns {object} HTML.
   */
  const renderRuns = (runs, withDetails) => (runs.length ? html`<div class="crm-table-wrap"><table class="crm-table beheer-restore-runs">
      <thead><tr><th scope="col">Gestart</th><th scope="col" class="beheer-restore-runs__fixed">Uitkomst</th><th scope="col">Back-up</th>${withDetails ? html`<th scope="col" class="beheer-restore-runs__fixed">Tabellen / rijen</th>` : ''}<th scope="col">Toelichting</th></tr></thead>
      <tbody>${runs.map((run) => html`<tr>
        <td>${formatDateTime(run.startedAt)} <span class="field__help">${TRIGGER_LABELS[run.trigger]}</span></td>
        <td class="beheer-restore-runs__fixed">${run.state === 'geslaagd' ? STATE_LABELS[run.state] : html`<strong>${STATE_LABELS[run.state]}</strong>`}</td>
        <td>${run.backup ? html`<code>${run.backup}</code>` : '–'}</td>
        ${withDetails ? html`<td class="beheer-restore-runs__fixed">${run.tables ? `${run.tables} / ${run.rows}` : '–'}</td>` : ''}
        <td>${run.message}${run.differences.length ? html`<br><span class="field__help">Verschillen: ${run.differences.map((entry) => `${entry.table} ${entry.restored ?? '–'} → ${entry.live ?? '–'}`).join(', ')}</span>` : ''}</td>
      </tr>`)}</tbody>
    </table></div>` : html`<p>Nog geen hersteltest uitgevoerd.</p>`);

  /**
   * De pagina.
   * @param {object} req Express-verzoek.
   * @param {{result?: {ok: boolean, message: string}}} [state] Uitkomst van een aanvraag.
   * @returns {string} HTML-pagina.
   */
  const renderPage = (req, state = {}) => {
    const hostRuns = restoreTests.hostRuns();
    const hostBusy = hostTestBusy(hostRuns);
    return options.renderBeheerPage(req, {
      title: 'Hersteltest',
      sectionId: 'hersteltest',
      body: html`<p>Een back-up is pas iets waard als hij terug te zetten is. Daarom wordt elke week getest of dat lukt.</p>
        ${state.result ? html`<p class="${state.result.ok ? 'notice' : 'form-alert'}" role="${state.result.ok ? 'status' : 'alert'}">${state.result.message}</p>` : ''}
        <h2>Op de server</h2>
        <p>Elke zondag rond 04:30 uur zet de server de nieuwste back-up terug in een wegwerpdatabase zonder netwerk naar buiten, start daar een wegwerp-app op en vergelijkt het aantal rijen per tabel met de echte database. Daarna wordt alles weer opgeruimd.</p>
        ${hostBusy ? html`<p class="notice" role="status">Er is een hersteltest aangevraagd of bezig; ververs deze pagina over een paar minuten.</p>` : ''}
        <form method="post" action="/app/beheer/hersteltest/server/">
          <input type="hidden" name="_csrf" value="${req.session.csrf}">
          <button class="btn btn--outline btn--small" type="submit"${hostBusy ? raw(' disabled') : ''}>Nu testen op de server</button>
        </form>
        ${renderRuns(hostRuns, true)}
        <h2>Kopie op Google Drive</h2>
        <p>Wekelijks (en op verzoek) downloadt de app de nieuwste back-up van Google Drive, ontsleutelt die volledig en controleert of er een complete database-dump in zit die gelijk is aan de back-up op de server.</p>
        ${restoreTests.driveRunning() ? html`<p class="notice" role="status">De Drive-kopie wordt nu getest; ververs deze pagina over een minuut.</p>` : ''}
        ${settings.get('driveEnabled') ? html`<form method="post" action="/app/beheer/hersteltest/drive/">
          <input type="hidden" name="_csrf" value="${req.session.csrf}">
          <button class="btn btn--outline btn--small" type="submit"${restoreTests.driveRunning() ? raw(' disabled') : ''}>Drive-kopie nu testen</button>
        </form>` : html`<p>De kopie naar Google Drive staat uit (<a href="/app/beheer/google-drive/">Google Drive</a>).</p>`}
        ${renderRuns(restoreTests.driveRuns(), false)}`,
    });
  };

  /**
   * Of er op de server al een hersteltest is aangevraagd of loopt.
   * @param {object[]} [hostRuns] De runs (anders opnieuw gelezen).
   * @returns {boolean} Waar als aangevraagd of bezig.
   */
  function hostTestBusy(hostRuns = restoreTests.hostRuns()) {
    return restoreTests.hostRequested() || Boolean(hostRuns[0] && hostRuns[0].state === 'bezig');
  }

  router.get('/beheer/hersteltest/', guard, async (req, res, next) => {
    try {
      await settings.ready();
      return res.send(renderPage(req));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/beheer/hersteltest/server/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      await settings.ready();
      // Al aangevraagd of bezig (dubbelklik, tweede beheerder, oude pagina): niets opnieuw aanvragen.
      if (!hostTestBusy()) {
        if (!hostLimiter.hit(`gebruiker:${req.user.id}`)) return res.status(429).send(renderPage(req, { result: { ok: false, message: 'Te vaak aangevraagd. Probeer het over een uur opnieuw.' } }));
        await auth.audit(req, { userId: req.user.id, action: 'hersteltest.aangevraagd', entity: 'backup', entityId: 'server' });
        restoreTests.requestHostTest();
      }
      return res.redirect(303, '/app/beheer/hersteltest/');
    } catch (error) {
      return next(error);
    }
  });

  router.post('/beheer/hersteltest/drive/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      await settings.ready();
      if (!settings.get('driveEnabled')) return res.status(422).send(renderPage(req, { result: { ok: false, message: 'Zet eerst de kopie naar Google Drive aan.' } }));
      if (!restoreTests.driveRunning()) {
        if (!driveLimiter.hit(`gebruiker:${req.user.id}`)) return res.status(429).send(renderPage(req, { result: { ok: false, message: 'Te vaak aangevraagd. Probeer het over een uur opnieuw.' } }));
        await auth.audit(req, { userId: req.user.id, action: 'hersteltest.aangevraagd', entity: 'backup', entityId: 'google-drive' });
        restoreTests.runDriveTest({ trigger: 'handmatig' }).catch(() => {});
      }
      return res.redirect(303, '/app/beheer/hersteltest/');
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createRestoreTestRoutes };
