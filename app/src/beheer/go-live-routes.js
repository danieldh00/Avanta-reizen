/**
 * Beheer > Systeem > Livegang (recht `systeem`): de controle uit `beheer/go-live-check.js` op één pagina. Bovenaan de
 * instellingen voor de overstap (draaiboek `docs/GO-LIVE.md`), daaronder welke vaste inhoud nog uit de
 * terugvalbestanden komt (F09). Alleen lezen; elke regel linkt naar de plek waar je het regelt.
 */
const express = require('express');
const { html } = require('../site/html');
const ui = require('../crm/ui');
const { createRateLimiter } = require('../security/rate-limit');
const { runGoLiveCheck } = require('./go-live-check');

/** Tekst en kleur (klasse `crm-status--<soort>` uit `crm.css`) per stand. */
const STATES = {
  klaar: { label: 'Klaar', kind: 'gepubliceerd' },
  open: { label: 'Open', kind: 'vol' },
  handmatig: { label: 'Zelf controleren', kind: 'open' },
  later: { label: 'Later', kind: 'concept' },
};

/**
 * Tekent een blok met regels van de controle.
 * @param {string} caption Onzichtbaar bijschrift van de tabel.
 * @param {object[]} rows Regels (`label`, `state`, `detail`, `href`).
 * @returns {object} HTML.
 */
function renderCheckTable(caption, rows) {
  return ui.renderTable({
    caption,
    empty: 'Niets te controleren.',
    rows,
    columns: [
      { label: 'Onderdeel', cell: (row) => (row.href ? html`<a href="${row.href}">${row.label}</a>` : row.label) },
      { label: 'Stand', cell: (row) => ui.renderStatus(STATES[row.state].kind, STATES[row.state].label) },
      { label: 'Toelichting', cell: (row) => row.detail },
    ],
  });
}

/**
 * Maakt de route.
 * @param {{db: object, guard: Function, settings: object, siteContent: {load: Function}, renderBeheerPage: Function, now?: () => number}} options
 *   Database, rechtencontrole, instellingen, de lezer van `site-content.json`, de weergave van een Beheer-pagina en
 *   (voor tests) de klok van de limiet.
 * @returns {express.Router} Router.
 */
function createGoLiveRoutes(options) {
  const { db, guard, settings, siteContent } = options;
  const router = express.Router();
  const limiter = createRateLimiter({ limit: 60, windowMs: 60 * 1000, now: options.now });

  router.get('/beheer/livegang/', guard, async (req, res, next) => {
    try {
      await settings.ready();
      if (!limiter.hit(`gebruiker:${req.user.id}`)) {
        return res.status(429).send(options.renderBeheerPage(req, { title: 'Livegang', sectionId: 'livegang', body: html`<p class="form-alert" role="alert">Te veel verzoeken. Probeer het over een minuut opnieuw.</p>` }));
      }
      const check = await runGoLiveCheck({ db, settings, siteContent });
      return res.send(options.renderBeheerPage(req, {
        title: 'Livegang',
        sectionId: 'livegang',
        body: html`<p>Wat de app zelf kan nagaan van het go-live-draaiboek (<code>docs/GO-LIVE.md</code>). Stappen buiten de app (hosting, DNS, Cloudflare, mailauthenticatie, afspraken met Avanta) staan alleen in het draaiboek.</p>
          <p class="notice" role="status">${check.open ? `Nog ${check.open} onderdeel/onderdelen open.` : 'Alles wat de app kan controleren is klaar.'}</p>
          <section class="crm-panel" aria-labelledby="livegang-instellingen">
            <h2 id="livegang-instellingen">Instellingen voor de overstap</h2>
            <p>Tweestapsverificatie verplicht, de balk uit, het basisadres en het indexeren zet je op de dag van de overstap, in de volgorde van het draaiboek; indexeren als laatste.</p>
            ${renderCheckTable('Instellingen voor de overstap', check.settings)}
          </section>
          <section class="crm-panel" aria-labelledby="livegang-inhoud">
            <h2 id="livegang-inhoud">Vaste inhoud in het CRM</h2>
            <p>Inhoud die nog uit de bestanden van de import komt (homepage.json, site-content.json) in plaats van uit het CRM. "Open" zet je vóór de livegang over; "Later" heeft nog geen plek in het CRM en wordt in een later pakket opgeruimd.</p>
            ${renderCheckTable('Vaste inhoud in het CRM', check.content)}
          </section>`,
      }));
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createGoLiveRoutes, STATES };
