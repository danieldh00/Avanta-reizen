// @ts-check
/**
 * Beheer > Systeem > Servertaken (recht `systeem`): de afvinklijst met taken voor de server en het ene vaste commando
 * voor de Proxmox-host dat alle openstaande taken uitvoert (`system/host-tasks.js`, `deploy/apps01/servertaken.sh`).
 * Met de hand af- of openzetten komt in het auditlog.
 */
const express = require('express');
const { html } = require('../site/html');
const { formatDateTime } = require('../crm/layout');
const { createRateLimiter } = require('../security/rate-limit');
const { TASK_ID } = require('../system/host-tasks');

/**
 * Maakt de routes.
 * @param {{auth: any, guard: Function, settings: any, hostTasks: any, renderBeheerPage: Function, notFound: Function, now?: () => number}} options
 *   Sessielaag, rechtencontrole, instellingen, de servertakenlaag, de weergave van een Beheer-pagina, de 404 binnen
 *   Beheer en (voor tests) de klok van de limiet.
 * @returns {express.Router} Router.
 */
function createHostTaskRoutes(options) {
  const { auth, guard, settings, hostTasks } = options;
  const router = express.Router();
  const changeLimiter = createRateLimiter({ limit: 60, windowMs: 60 * 60 * 1000, now: options.now });

  /**
   * De pagina.
   * @param {any} req Express-verzoek.
   * @param {string} [problem] Melding als een actie is geweigerd.
   * @returns {string} HTML-pagina.
   */
  const renderPage = (req, problem = '') => {
    const view = hostTasks.view();
    return options.renderBeheerPage(req, {
      title: 'Servertaken',
      sectionId: 'servertaken',
      body: html`${problem ? html`<p class="form-alert" role="alert">${problem}</p>` : ''}
        <p>Sommige wijzigingen vragen iets op de server dat de automatische update niet zelf kan doen. Die taken staan hieronder. Je hoeft nooit losse commando's te typen: één vast commando voert alle openstaande taken uit en vinkt ze hier af.</p>
        ${view.pending ? html`<p class="notice" role="status">${view.pending === 1 ? 'Er staat 1 taak open.' : `Er staan ${view.pending} taken open.`}</p>` : html`<p class="notice" role="status">Alle servertaken zijn gedaan.</p>`}
        <h2>Het vaste commando</h2>
        <p>Plak dit als <strong>root</strong> in de shell van de Proxmox-host (pve). Het haalt het script op de nieuwste commit van main op, toont wat er openstaat en vraagt bevestiging voordat het iets doet.</p>
        <pre class="beheer-command"><code>${view.command}</code></pre>
        <p class="field__help">Alleen kijken (verandert niets): vervang <code>openstaand</code> aan het eind door <code>status</code>. Laatste melding van de server: ${formatDateTime(view.checkedAt)}.</p>
        <p class="field__help">Schijf bijna vol: vervang <code>openstaand</code> door <code>schijf</code>. Dat toont waar de ruimte zit (Docker, back-ups, foto's, database, logs) en ruimt na bevestiging de Docker-buildcache ouder dan 7 dagen op (van de hele server, ook andere stacks; een volgende build is daardoor eenmalig trager).</p>
        <h2>Taken</h2>
        <div class="crm-table-wrap"><table class="crm-table">
          <thead><tr><th scope="col">Taak</th><th scope="col">Stand</th><th scope="col"><span class="visually-hidden">Actie</span></th></tr></thead>
          <tbody>${view.tasks.map((task) => html`<tr>
            <td><strong>${task.title}</strong> <span class="field__help">(${task.id}, toegevoegd ${task.addedAt})</span><br>${task.description}</td>
            <td>${task.doneBy === 'server' ? `Gedaan door de server (${formatDateTime(task.doneAt)})` : task.doneBy === 'handmatig' ? 'Met de hand afgevinkt' : html`<strong>Open</strong>`}</td>
            <td>${task.doneBy === 'server' ? '' : html`<form method="post" action="/app/beheer/servertaken/${task.id}/">
              <input type="hidden" name="_csrf" value="${req.session.csrf}">
              <input type="hidden" name="done" value="${task.done ? 'nee' : 'ja'}">
              <button class="btn btn--outline btn--small" type="submit">${task.done ? 'Weer openzetten' : 'Afvinken'}</button>
            </form>`}</td>
          </tr>`)}</tbody>
        </table></div>`,
    });
  };

  router.get('/beheer/servertaken/', guard, async (req, res, next) => {
    try {
      await settings.ready();
      return res.send(renderPage(req));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/beheer/servertaken/:id/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      await settings.ready();
      const { id } = req.params;
      if (!TASK_ID.test(id) || !hostTasks.known(id)) return options.notFound(req, res);
      if (req.body.done !== 'ja' && req.body.done !== 'nee') return res.status(400).send(renderPage(req, 'Ongeldige keuze; vernieuw de pagina en probeer het opnieuw.'));
      if (!changeLimiter.hit(`gebruiker:${req.user.id}`)) return res.status(429).send(renderPage(req, 'Te vaak gewijzigd. Probeer het over een uur opnieuw.'));
      const done = req.body.done === 'ja';
      await settings.update({ values: { hostTasksDone: hostTasks.checkedValue(id, done) } }, {
        userId: req.user.id,
        inTransaction: async (client, changed) => {
          if (changed.length) await auth.audit(req, { userId: req.user.id, action: done ? 'servertaak.afgevinkt' : 'servertaak.heropend', entity: 'servertaak', entityId: id }, client);
        },
      });
      return res.redirect(303, '/app/beheer/servertaken/');
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createHostTaskRoutes };
