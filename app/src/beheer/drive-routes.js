/**
 * Extra's van Beheer > Back-ups en herstel > Google Drive (recht `systeem`): het terugkeeradres voor de Google Cloud
 * Console, de status van de koppeling, *Koppelen met Google*, *Ontkoppelen*, *Nu synchroniseren* en de laatste
 * gebeurtenissen. De terugkeer van Google (`/app/beheer/google-drive/terug/`) heeft geen sessie nodig: de sessiecookie
 * is `SameSite=Strict` en gaat dus niet mee bij een doorverwijzing vanaf Google. Die route vertrouwt alleen de
 * eenmalige `state` (15 minuten, gebonden aan de beheerder die het koppelen begon) en stuurt daarna door naar Beheer.
 */
const express = require('express');
const { html, raw } = require('../site/html');
const { renderCrmPage, formatDateTime } = require('../crm/layout');
const { findSection } = require('./indeling');
const { createRateLimiter } = require('../security/rate-limit');
const { REVOKE_BY_HAND } = require('../backup/drive');

/**
 * Maakt de routes en het paneel van Google Drive.
 * @param {{auth: object, guard: Function, settings: object, drive: object, renderSettingsSection: Function, now?: () => number}} options
 *   Sessielaag, rechtencontrole, instellingen, Drive-koppeling (`backup/drive.js`), weergave van een instellingensectie
 *   en (voor tests) de klok van de limieten.
 * @returns {{router: express.Router, renderPanel: Function}} Router en paneel (voor onder het formulier).
 */
function createDriveRoutes(options) {
  const { auth, guard, settings, drive } = options;
  const router = express.Router();
  const section = findSection('google-drive');
  // Synchroniseren op verzoek: hoogstens 6 per tien minuten per gebruiker; terugkeer van Google: 20 per kwartier per bezoeker.
  const syncLimiter = createRateLimiter({ limit: 6, windowMs: 10 * 60 * 1000, now: options.now });
  const callbackLimiter = createRateLimiter({ limit: 20, windowMs: 15 * 60 * 1000, now: options.now });

  /**
   * Het paneel onder het formulier.
   * @param {object} req Express-verzoek.
   * @param {{result?: {ok: boolean, message: string}}} [state] Uitkomst van een actie.
   * @returns {object} HTML.
   */
  const renderPanel = (req, state = {}) => {
    const driveState = drive.state();
    const connected = drive.connected();
    let status = 'Niet gekoppeld.';
    if (!drive.configured()) status = 'Niet gekoppeld: vul eerst het client-ID en het client-secret in en sla ze op.';
    else if (connected && driveState.needsReconnect) status = 'Google weigert de koppeling: koppel opnieuw.';
    else if (connected) status = `Gekoppeld${driveState.account ? ` met ${driveState.account}` : ''}${settings.get('driveEnabled') ? '' : ', maar de kopie staat uit (vink hierboven aan)'}.`;
    const newest = driveState.uploaded[0];
    return html`<h2 id="status">Status</h2>
      ${state.result ? html`<p class="${state.result.ok ? 'notice' : 'form-alert'}" role="${state.result.ok ? 'status' : 'alert'}">${state.result.message}</p>` : ''}
      <div class="crm-table-wrap"><table class="crm-table beheer-facts"><tbody>
        <tr><th scope="row">Koppeling</th><td>${status}</td></tr>
        <tr><th scope="row">Map</th><td>${driveState.folderId ? driveState.folderName : '–'}</td></tr>
        <tr><th scope="row">Laatste upload</th><td>${newest ? html`${formatDateTime(newest.at)}: <code>${newest.name}</code>` : '–'}</td></tr>
        <tr><th scope="row">Laatst gelukt</th><td>${formatDateTime(driveState.lastOkAt)}</td></tr>
        <tr><th scope="row">Terugkeeradres</th><td><code>${drive.redirectUri()}</code> <span class="field__help">Vul dit precies zo in bij de OAuth-client in de Google Cloud Console (Geautoriseerde omleidings-URI's). Het komt uit het basisadres onder Vindbaarheid > Zoekmachines.</span></td></tr>
      </tbody></table></div>
      <div class="beheer-actions">
        ${drive.configured() ? html`<form method="post" action="/app/beheer/google-drive/koppelen/">
          <input type="hidden" name="_csrf" value="${req.session.csrf}">
          <button class="btn btn--small" type="submit">${connected ? 'Opnieuw koppelen met Google' : 'Koppelen met Google'}</button>
        </form>` : ''}
        ${connected ? html`<form method="post" action="/app/beheer/google-drive/synchroniseren/">
          <input type="hidden" name="_csrf" value="${req.session.csrf}">
          <button class="btn btn--outline btn--small" type="submit"${settings.get('driveEnabled') ? '' : raw(' disabled')}>Nu synchroniseren</button>
        </form>
        <form method="post" action="/app/beheer/google-drive/ontkoppelen/">
          <input type="hidden" name="_csrf" value="${req.session.csrf}">
          <button class="btn btn--outline btn--small" type="submit">Ontkoppelen</button>
        </form>` : ''}
      </div>
      <h2>Laatste gebeurtenissen</h2>
      ${driveState.events.length ? html`<div class="crm-table-wrap"><table class="crm-table">
        <thead><tr><th scope="col">Tijdstip</th><th scope="col">Uitkomst</th><th scope="col">Melding</th></tr></thead>
        <tbody>${driveState.events.map((event) => html`<tr><td>${formatDateTime(event.at)}</td><td>${event.ok ? 'Gelukt' : 'Mislukt'}</td><td>${event.message}</td></tr>`)}</tbody>
      </table></div>` : html`<p>Nog niets gebeurd.</p>`}`;
  };

  /**
   * Toont de sectie met de uitkomst van een actie.
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @param {number} status HTTP-status.
   * @param {boolean} ok Gelukt of niet.
   * @param {string} message Melding.
   * @returns {object} Express-antwoord.
   */
  const respond = (req, res, status, ok, message) => res.status(status).send(options.renderSettingsSection(req, section, { extra: { result: { ok, message } } }));

  router.post('/beheer/google-drive/koppelen/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      await settings.ready();
      if (!drive.configured()) return respond(req, res, 422, false, 'Vul eerst het client-ID en het client-secret in en sla ze op.');
      // Geen 303 naar Google: de CSP (`form-action 'self'`) blokkeert een doorverwijzing na een formulier naar een
      // ander domein. Daarom een tussenpagina met een gewone link (en een automatische doorverwijzing).
      const target = drive.startAuthorization(req.user.id);
      return res.send(renderCrmPage({
        title: 'Koppelen met Google',
        user: req.user,
        csrf: req.session.csrf,
        path: '/app/beheer/google-drive/',
        body: html`<meta http-equiv="refresh" content="0; url=${target}">
          <p>Je gaat naar Google om toestemming te geven voor de map met back-ups.</p>
          <p><a class="btn" href="${target}" rel="noreferrer">Doorgaan naar Google</a></p>`,
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/beheer/google-drive/terug/', async (req, res, next) => {
    /**
     * Een eenvoudige pagina na de terugkeer van Google, met een doorverwijzing naar Beheer.
     * @param {number} status HTTP-status.
     * @param {string} message Melding.
     * @param {string} target Adres om naartoe te gaan.
     * @returns {object} Express-antwoord.
     */
    const page = (status, message, target) => res.status(status).send(renderCrmPage({
      title: 'Google Drive',
      body: html`${status === 200 ? html`<meta http-equiv="refresh" content="1; url=${target}">` : ''}
        <p class="${status === 200 ? 'notice' : 'form-alert'}" role="${status === 200 ? 'status' : 'alert'}">${message}</p>
        <p><a href="${target}">Terug naar Beheer > Google Drive</a></p>`,
    }));
    try {
      if (!callbackLimiter.hit(`ip:${req.ip}`)) return page(429, 'Te veel pogingen. Probeer het over een kwartier opnieuw.', '/app/beheer/google-drive/');
      await settings.ready();
      const query = (name) => (typeof req.query[name] === 'string' ? req.query[name] : undefined);
      try {
        const result = await drive.finishAuthorization({ state: query('state'), code: query('code'), error: query('error') });
        drive.sync().catch(() => {});
        return page(200, `Gekoppeld met Google Drive${result.account ? ` (${result.account})` : ''}.`, '/app/beheer/google-drive/');
      } catch (error) {
        if (error.name !== 'DriveError') throw error;
        return page(400, `Koppelen is niet gelukt: ${error.message}`, '/app/beheer/google-drive/');
      }
    } catch (error) {
      return next(error);
    }
  });

  router.post('/beheer/google-drive/ontkoppelen/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      await settings.ready();
      const { revoked } = await drive.disconnect(req.user.id);
      if (!revoked) return respond(req, res, 200, false, `Ontkoppeld, maar intrekken bij Google is mislukt: ${REVOKE_BY_HAND}`);
      return respond(req, res, 200, true, 'Ontkoppeld en ingetrokken bij Google. De back-ups op Google Drive blijven staan.');
    } catch (error) {
      return next(error);
    }
  });

  router.post('/beheer/google-drive/synchroniseren/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      await settings.ready();
      if (!syncLimiter.hit(`gebruiker:${req.user.id}`)) return respond(req, res, 429, false, 'Te vaak gesynchroniseerd. Probeer het over tien minuten opnieuw.');
      if (!drive.connected() || !settings.get('driveEnabled')) return respond(req, res, 422, false, 'Zet de kopie aan en koppel eerst met Google.');
      try {
        const result = await drive.sync();
        return respond(req, res, 200, true, `Gesynchroniseerd: ${result.uploaded.length} geüpload, ${result.removed.length} oude verwijderd.`);
      } catch (error) {
        return respond(req, res, 502, false, `Synchroniseren mislukt: ${error.name === 'DriveError' ? error.message : 'onverwachte fout'}`);
      }
    } catch (error) {
      return next(error);
    }
  });

  return { router, renderPanel };
}

module.exports = { createDriveRoutes };
