/**
 * Extra's van Beheer > E-mail > Mailserver (recht `systeem`): de status van de mailserver, een testmail, het WAN-IP
 * van de server (voor een Exchange Online-connector) en de laatste verzendingen. De instellingen zelf staan in het
 * gewone instellingenformulier (`beheer/routes.js`). Een testmail komt in het auditlog (zonder adres); het overzicht
 * toont nooit adressen of wachtwoorden.
 */
const express = require('express');
const { html } = require('../site/html');
const { formatDateTime } = require('../crm/layout');
const { findSection } = require('./indeling');
const { mailFailure, validEmail } = require('../mail/mailer');
const { renderMail, LOGO_CID } = require('../mail/layout');
const { createRateLimiter } = require('../security/rate-limit');

/** Omschrijving van de soorten mail in het overzicht. */
const KIND_LABELS = { testmail: 'Testmail', 'melding-contact': 'Melding contactbericht', 'melding-aanmelding': 'Melding aanmelding' };

/**
 * Maakt de routes en het paneel van de mailserver.
 * @param {{auth: object, guard: Function, settings: object, mailer: object, wanIp: object, renderSettingsSection: Function, now?: () => number}} options
 *   Sessielaag, rechtencontrole, instellingen, mailer (`mail/mailer.js`), WAN-IP-opzoeker (`mail/wan-ip.js`), de
 *   weergave van een instellingensectie en (voor tests) de klok van de limiet.
 * @returns {{router: express.Router, renderPanel: Function, renderLayoutPanel: Function}} Router en panelen (voor onder
 *   het formulier van de mailserver en van de mail-opmaak).
 */
function createMailRoutes(options) {
  const { auth, guard, settings, mailer, wanIp } = options;
  const router = express.Router();
  // Testmails: hoogstens 5 per tien minuten per gebruiker; WAN-IP opzoeken: 10 per tien minuten per gebruiker.
  const testLimiter = createRateLimiter({ limit: 5, windowMs: 10 * 60 * 1000, now: options.now });
  const lookupLimiter = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000, now: options.now });
  const section = findSection('mailserver');

  /**
   * Een mail in de huidige opmaak.
   * @param {object} content Titel, inleiding, rijen en tekst (zie `renderMail`).
   * @returns {{html: string, text: string, attachments: object[]}} De mail.
   */
  const layout = (content) => renderMail({ headerColor: settings.get('mailHeaderColor'), footerText: settings.get('mailFooterText'), siteName: settings.get('siteName'), ...content });

  /**
   * Het paneel onder de mail-opmaak: een link naar het voorbeeld.
   * @returns {object} HTML.
   */
  const renderLayoutPanel = () => html`<h2>Voorbeeld</h2>
      <p>Sla eerst op en bekijk dan het <a href="/app/beheer/mail-opmaak/voorbeeld/" target="_blank" rel="noopener">voorbeeld van een melding</a> (opent in een nieuw tabblad), of verstuur een testmail onder <a href="/app/beheer/mailserver/#testmail">Mailserver</a>.</p>`;

  /**
   * Het paneel onder het formulier: status, testmail, WAN-IP en de laatste verzendingen.
   * @param {object} req Express-verzoek.
   * @param {{testTo?: string, testResult?: {ok: boolean, message: string}, wan?: {ip?: string, checkedAt?: Date, error?: string}}} [state]
   *   Ingevuld adres en uitkomst van een testmail, en de uitkomst van het opzoeken van het WAN-IP.
   * @returns {object} HTML.
   */
  const renderPanel = (req, state = {}) => {
    const configured = mailer.configured();
    const wan = state.wan || wanIp.peek() || {};
    const events = mailer.recent();
    return html`<h2>Status</h2>
      <p>${configured ? 'De mailserver is ingesteld.' : 'Er is nog geen mailserver ingesteld: vul de mailserver en het e-mailadres van de afzender in.'}</p>

      <h2 id="testmail">Testmail</h2>
      ${state.testResult ? html`<p class="${state.testResult.ok ? 'notice' : 'form-alert'}" role="${state.testResult.ok ? 'status' : 'alert'}">${state.testResult.message}</p>` : ''}
      <form class="form beheer-form" method="post" action="/app/beheer/mailserver/testmail/">
        <input type="hidden" name="_csrf" value="${req.session.csrf}">
        <div class="field">
          <span class="field__label"><label for="testmail-aan">Versturen naar</label></span>
          <input id="testmail-aan" type="email" name="to" value="${state.testTo ?? req.user.email}" maxlength="200" required autocomplete="email">
          <span class="field__help">Sla eerst de instellingen op; de testmail gebruikt de opgeslagen mailserver.</span>
        </div>
        <div><button class="btn btn--outline" type="submit"${configured ? '' : html` disabled`}>Testmail versturen</button></div>
      </form>

      <h2 id="wan-ip">WAN-IP van deze server</h2>
      <p>Een Exchange Online-connector op IP-basis moet dit adres vertrouwen (in Exchange-beheer: connector van <em>Uw organisatie</em> naar <em>Office 365</em>, op IP-adres). Het is het adres waarmee de server naar buiten verbindt, niet dat van de website.</p>
      ${wan.error ? html`<p class="form-alert" role="alert">${wan.error}</p>` : ''}
      ${wan.ip ? html`<p><strong>${wan.ip}</strong> (opgezocht ${formatDateTime(wan.checkedAt)})</p>` : ''}
      <form method="post" action="/app/beheer/mailserver/wan-ip/">
        <input type="hidden" name="_csrf" value="${req.session.csrf}">
        <button class="btn btn--outline btn--small" type="submit">${wan.ip ? 'Opnieuw opzoeken' : 'WAN-IP opzoeken'}</button>
      </form>

      <h2>Laatste verzendingen</h2>
      ${events.length ? html`<div class="crm-table-wrap"><table class="crm-table">
        <thead><tr><th scope="col">Tijdstip</th><th scope="col">Soort</th><th scope="col">Uitkomst</th></tr></thead>
        <tbody>${events.map((event) => html`<tr>
          <td>${formatDateTime(event.at)}</td>
          <td>${KIND_LABELS[event.kind] || event.kind}</td>
          <td>${event.ok ? 'Verstuurd' : event.message}</td>
        </tr>`)}</tbody>
      </table></div>
      <p class="field__help">Sinds de laatste herstart van de app, hoogstens 20; zonder adressen of inhoud.</p>` : html`<p>Sinds de laatste herstart is er nog niets verstuurd.</p>`}`;
  };

  router.post('/beheer/mailserver/testmail/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const to = typeof req.body.to === 'string' ? req.body.to.trim() : '';
      let testResult;
      if (!validEmail(to)) testResult = { ok: false, message: 'Vul een geldig e-mailadres in.' };
      else if (!mailer.configured()) testResult = { ok: false, message: 'Er is nog geen mailserver ingesteld.' };
      else if (!testLimiter.hit(`gebruiker:${req.user.id}`)) testResult = { ok: false, limited: true, message: 'Te veel testmails. Probeer het over tien minuten opnieuw.' };
      else {
        try {
          const mail = layout({ title: 'Testmail', intro: `Dit is een testmail uit Beheer van ${res.locals.site.siteName}.\n\nKomt deze mail aan, dan is de mailserver goed ingesteld.` });
          await mailer.send({ kind: 'testmail', to, subject: `Testmail van ${res.locals.site.siteName}`, text: mail.text, html: mail.html, attachments: mail.attachments });
          testResult = { ok: true, message: 'De testmail is verstuurd. Controleer de inbox (en de map met ongewenste mail).' };
        } catch (error) {
          testResult = { ok: false, message: mailFailure(error) };
        }
        await auth.audit(req, { userId: req.user.id, action: testResult.ok ? 'mail.test' : 'mail.test-mislukt', entity: 'settings', entityId: 'mailserver' });
      }
      const status = testResult.ok ? 200 : (testResult.limited ? 429 : 422);
      return res.status(status).send(options.renderSettingsSection(req, section, { extra: { testTo: to, testResult } }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/beheer/mailserver/wan-ip/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      let wan;
      if (!lookupLimiter.hit(`gebruiker:${req.user.id}`)) wan = { ...(wanIp.peek() || {}), limited: true, error: 'Te vaak opgezocht. Probeer het over tien minuten opnieuw.' };
      else {
        try {
          wan = await wanIp.get({ refresh: true });
        } catch (error) {
          wan = { error: 'Het WAN-IP kon niet worden bepaald: de opzoekdiensten zijn niet bereikbaar vanaf de server.' };
        }
      }
      return res.status(wan.error ? (wan.limited ? 429 : 503) : 200).send(options.renderSettingsSection(req, section, { extra: { wan } }));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/beheer/mail-opmaak/voorbeeld/', guard, (req, res) => {
    const mail = layout({
      title: 'Nieuw bericht via het contactformulier',
      intro: 'Er is een bericht binnengekomen via het contactformulier op de website. Antwoorden op deze mail gaat naar de afzender.',
      rows: [['Naam', 'Jan Jansen'], ['E-mail', 'jan@example.nl'], ['Onderwerp', 'Vraag over een reis']],
      body: 'Hallo,\n\nIs er nog plaats op de reis naar Albanië?\n\nGroet, Jan',
    });
    // In de browser het logo van de site zelf tonen in plaats van de ingebedde bijlage.
    return res.type('html').send(mail.html.replace(`cid:${LOGO_CID}`, '/images/logo.png'));
  });

  return { router, renderPanel, renderLayoutPanel };
}

module.exports = { createMailRoutes };
