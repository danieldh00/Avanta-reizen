/**
 * Extra's van Beheer > Toegang en beveiliging > Captcha op formulieren (recht `systeem`): of de captcha actief is,
 * een controle van de geheime sleutel bij Google en de laatste uitkomsten (actie, uitkomst, score; nooit tokens of
 * IP-adressen). De instellingen zelf staan in het gewone instellingenformulier (`beheer/routes.js`).
 */
const express = require('express');
const { html } = require('../site/html');
const { formatDateTime } = require('../crm/layout');
const { findSection } = require('./indeling');
const { createRateLimiter } = require('../security/rate-limit');

/** Omschrijving van de uitkomsten. */
const OUTCOME_LABELS = {
  ok: 'Doorgelaten',
  missing: 'Geweigerd: geen token (JavaScript uit of adblocker)',
  failed: 'Geweigerd: token ongeldig of verlopen',
  wrong_action: 'Geweigerd: token van een ander formulier',
  low_score: 'Geweigerd: score te laag',
  unreachable: 'Google niet bereikbaar',
  misconfigured: 'Geheime sleutel klopt niet',
};

/** Melding na het controleren van de geheime sleutel. */
const SECRET_RESULTS = {
  ok: { ok: true, message: 'Google kent deze geheime sleutel.' },
  invalid: { ok: false, message: 'Google kent deze geheime sleutel niet. Kopieer hem opnieuw uit de reCAPTCHA-console.' },
  unreachable: { ok: false, message: 'Google is nu niet bereikbaar vanaf de server. Probeer het later opnieuw.' },
  not_set: { ok: false, message: 'Er is nog geen geheime sleutel opgeslagen.' },
};

/**
 * Maakt de routes en het paneel van de captcha.
 * @param {{auth: object, guard: Function, captcha: object, renderSettingsSection: Function, now?: () => number}} options
 *   Sessielaag, rechtencontrole, captcha-dienst (`security/captcha.js`), de weergave van een instellingensectie en
 *   (voor tests) de klok van de limiet.
 * @returns {{router: express.Router, renderPanel: Function}} Router en paneel (voor onder het formulier).
 */
function createCaptchaRoutes(options) {
  const { auth, guard, captcha } = options;
  const router = express.Router();
  // Sleutelcontroles: hoogstens 10 per tien minuten per gebruiker (elke controle is een verzoek aan Google).
  const checkLimiter = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000, now: options.now });
  const section = findSection('captcha');

  /**
   * Het paneel onder het formulier: status, sleutelcontrole en de laatste uitkomsten.
   * @param {object} req Express-verzoek.
   * @param {{secretResult?: {ok: boolean, message: string}}} [state] Uitkomst van een sleutelcontrole.
   * @returns {object} HTML.
   */
  const renderPanel = (req, state = {}) => {
    const events = captcha.recent();
    return html`<h2>Status</h2>
      <p>${captcha.active() ? 'De captcha is actief op het contact- en aanmeldformulier.' : 'De captcha is niet actief: zet de schakelaar aan en vul de sitesleutel en de geheime sleutel in.'}</p>
      <h2 id="sleutel-controleren">Geheime sleutel controleren</h2>
      ${state.secretResult ? html`<p class="${state.secretResult.ok ? 'notice' : 'form-alert'}" role="${state.secretResult.ok ? 'status' : 'alert'}">${state.secretResult.message}</p>` : ''}
      <form method="post" action="/app/beheer/captcha/controleren/">
        <input type="hidden" name="_csrf" value="${req.session.csrf}">
        <button class="btn btn--outline btn--small" type="submit">Opgeslagen sleutel controleren</button>
      </form>
      <h2>Laatste controles</h2>
      ${events.length ? html`<div class="crm-table-wrap"><table class="crm-table">
        <thead><tr><th scope="col">Tijdstip</th><th scope="col">Formulier</th><th scope="col">Uitkomst</th><th scope="col">Score</th></tr></thead>
        <tbody>${events.map((event) => html`<tr>
          <td>${formatDateTime(event.at)}</td>
          <td>${event.action === 'aanmelden' ? 'Aanmelden' : 'Contact'}</td>
          <td>${OUTCOME_LABELS[event.outcome] || event.outcome}</td>
          <td>${event.score === null ? '–' : event.score.toFixed(1).replace('.', ',')}</td>
        </tr>`)}</tbody>
      </table></div>
      <p class="field__help">Sinds de laatste herstart van de app, hoogstens 20; zonder tokens of IP-adressen.</p>` : html`<p>Sinds de laatste herstart is er nog niets gecontroleerd.</p>`}`;
  };

  router.post('/beheer/captcha/controleren/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      if (!checkLimiter.hit(`gebruiker:${req.user.id}`)) {
        return res.status(429).send(options.renderSettingsSection(req, section, { extra: { secretResult: { ok: false, message: 'Te vaak gecontroleerd. Probeer het over tien minuten opnieuw.' } } }));
      }
      const outcome = await captcha.checkSecret();
      const secretResult = SECRET_RESULTS[outcome];
      return res.status(secretResult.ok ? 200 : 422).send(options.renderSettingsSection(req, section, { extra: { secretResult } }));
    } catch (error) {
      return next(error);
    }
  });

  return { router, renderPanel };
}

module.exports = { createCaptchaRoutes };
