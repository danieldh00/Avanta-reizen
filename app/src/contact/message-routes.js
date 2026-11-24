// @ts-check
/**
 * Berichten in het CRM (`/app/berichten/`, recht `berichten`): de lijst met filter op status en zoeken, één bericht
 * met de gegevens van de afzender, afhandelen (met een optionele notitie), weer openen en verwijderen. Elke wijziging
 * komt in het auditlog, zonder de inhoud van het bericht. De teller van nieuwe berichten in het menu komt uit
 * `countNewMessages` (`messages.js`) via `crm/menu-counters.js`.
 */
const express = require('express');
const { routePath } = require('../route-path');
const { html } = require('../site/html');
const { tripPath } = require('../site/format');
const { roleHasGlobalRight } = require('../crm/rights');
const { renderCrmPage, renderAlert, formatDateTime } = require('../crm/layout');
const ui = require('../crm/ui');
const messages = require('./messages');

/** Adres van de lijst (voor links) en het pad binnen de router van `/app`. */
const BASE = '/app/berichten/';
const ROUTE = '/berichten/';

/** Acties voor het auditlog (zie `ACTION_LABELS` in `crm/users.js`). */
const MESSAGE_ACTION_LABELS = {
  'bericht.afgehandeld': 'Bericht afgehandeld',
  'bericht.heropend': 'Bericht weer geopend',
  'bericht.verwijderd': 'Bericht verwijderd',
};

/** Meldingen na een geslaagde actie (`?opgeslagen=…`). */
const NOTICES = {
  afgehandeld: 'Het bericht is afgehandeld.',
  heropend: 'Het bericht staat weer op nieuw.',
};

/**
 * Maakt de routes voor de berichten.
 * @param {{db: any, auth: any}} options Database en de sessie- en rechtenlaag.
 * @returns {express.Router} Router.
 */
function createMessageRoutes(options) {
  const { db, auth } = options;
  const router = express.Router();
  const guard = auth.requireGlobalRight('berichten');

  /**
   * 404-pagina binnen het CRM.
   * @param {any} req Express-verzoek.
   * @param {any} res Express-antwoord.
   * @returns {void}
   */
  const notFound = (req, res) => res.status(404).send(renderCrmPage({
    title: 'Niet gevonden', user: req.user, csrf: req.session.csrf, path: BASE, body: html`<p>Dit bericht bestaat niet (meer). <a href="${BASE}">Naar de berichten</a></p>`,
  }));

  router.get(ROUTE, guard, async (req, res, next) => {
    try {
      const status = Object.hasOwn(messages.MESSAGE_STATUSES, req.query.status) ? req.query.status : (req.query.status === 'alle' ? 'alle' : 'nieuw');
      const page = Math.min(Math.max(Number.parseInt(req.query.pagina, 10) || 1, 1), 10000);
      const list = await messages.listMessages(db, { status: status === 'alle' ? '' : status, q: req.query.q, page });
      const total = Object.values(list.counts).reduce((sum, count) => sum + count, 0);
      return res.send(renderCrmPage({
        title: 'Berichten',
        user: req.user,
        csrf: req.session.csrf,
        path: BASE,
        body: html`<p>Berichten die via het contactformulier op de site binnenkomen. Handel een bericht af als het beantwoord is.</p>
          ${ui.renderFilterTabs({
          base: BASE,
          name: 'status',
          current: status,
          params: { q: list.text },
          label: 'Status',
          options: [
            { value: 'nieuw', label: 'Nieuw', count: list.counts.nieuw || 0 },
            { value: 'afgehandeld', label: 'Afgehandeld', count: list.counts.afgehandeld || 0 },
            { value: 'alle', label: 'Alle', count: total },
          ],
        })}
          ${ui.renderSearch({ action: BASE, label: 'Zoek op naam, e-mailadres, telefoon of tekst', value: list.text, hidden: { status } })}
          ${ui.renderTable({
          caption: 'Berichten',
          empty: status === 'nieuw' && !list.text ? 'Geen nieuwe berichten.' : 'Geen berichten gevonden.',
          rows: list.rows,
          columns: [
            { label: 'Ontvangen', cell: (message) => formatDateTime(message.created_at) },
            { label: 'Van', cell: (message) => html`<a href="${BASE}${message.id}/">${message.name}</a>` },
            { label: 'Onderwerp', cell: (message) => message.subject || (message.trip_slug ? 'Vraag over een reis' : '–') },
            { label: 'Status', cell: (message) => ui.renderStatus(message.status, messages.MESSAGE_STATUSES[message.status] || message.status) },
          ],
        })}
          ${ui.renderPager({ base: BASE, params: { q: list.text, status }, page, hasNext: list.hasNext })}`,
      }));
    } catch (error) {
      return next(error);
    }
  });

  /**
   * De pagina van één bericht.
   * @param {any} req Express-verzoek.
   * @param {any} message Het bericht (`findMessage`).
   * @param {{notice?: string, error?: string}} [state] Melding en foutmelding.
   * @returns {string} HTML-pagina.
   */
  const renderMessage = (req, message, state = {}) => {
    const hidden = html`<input type="hidden" name="_csrf" value="${req.session.csrf}">`;
    const handled = message.status === 'afgehandeld';
    const canSeeTrips = roleHasGlobalRight(req.user.role, 'reizen');
    const trip = message.trip_id
      ? html`${canSeeTrips ? html`<a href="/app/reizen/${message.trip_id}/">${message.trip_title}</a>` : message.trip_title}${message.trip_code ? ` (${message.trip_code})` : ''}`
      : (message.trip_slug ? html`<a href="${tripPath(message.trip_slug)}">${message.trip_slug}</a> (reis bestaat niet meer)` : '');
    const facts = [
      ['Ontvangen', formatDateTime(message.created_at)],
      ['Naam', message.name],
      ['E-mailadres', html`<a href="mailto:${message.email}">${message.email}</a>`],
      ['Telefoon', message.phone ? html`<a href="tel:${message.phone.replace(/[^+\d]/g, '')}">${message.phone}</a>` : '–'],
      ...(trip ? [['Over de reis', trip]] : []),
      ['Akkoord privacyverklaring', formatDateTime(message.consent_at)],
    ];
    return renderCrmPage({
      title: message.subject ? `Bericht: ${message.subject}` : `Bericht van ${message.name}`,
      user: req.user,
      csrf: req.session.csrf,
      path: BASE,
      body: html`<p><a href="${BASE}">Naar de berichten</a></p>
        ${state.notice ? html`<p class="notice" role="status">${state.notice}</p>` : ''}
        ${renderAlert(state.error)}
        <div class="crm-columns">
          <section>
            <h2>Status: ${ui.renderStatus(message.status, messages.MESSAGE_STATUSES[message.status] || message.status)}</h2>
            <div class="crm-message">${message.message}</div>
            ${handled ? html`<dl class="crm-facts">
                <dt>Afgehandeld</dt><dd>${formatDateTime(message.handled_at)} · ${message.handled_by_name || '–'}</dd>
                ${message.note ? html`<dt>Notitie</dt><dd class="crm-message-note">${message.note}</dd>` : ''}
              </dl>
              <form class="form crm-narrow" method="post" action="${BASE}${message.id}/heropenen/">${hidden}
                <div><button class="btn btn--outline" type="submit">Weer op nieuw zetten</button></div>
              </form>` : html`<form class="form crm-narrow" method="post" action="${BASE}${message.id}/afhandelen/">${hidden}
                <div class="field"><span class="field__label"><label for="veld-notitie">Notitie (niet verplicht)</label></span>
                  <textarea id="veld-notitie" name="notitie" rows="3" maxlength="${messages.MESSAGE_NOTE_MAX}"></textarea>
                  <span class="field__help">Bijvoorbeeld hoe en wanneer je hebt geantwoord.</span></div>
                <div><button class="btn" type="submit">Afhandelen</button></div>
              </form>`}
          </section>
          <section>
            <h2>Afzender</h2>
            <dl class="crm-facts">${facts.map(([label, value]) => html`<dt>${label}</dt><dd>${value}</dd>`)}</dl>
            <h2>Verwijderen</h2>
            <form class="form crm-narrow" method="post" action="${BASE}${message.id}/verwijderen/">${hidden}
              <label class="choice"><input type="checkbox" name="bevestig" value="ja" required> <span>Ja, verwijder dit bericht definitief (bijvoorbeeld spam)</span></label>
              <div><button class="btn btn--outline" type="submit">Bericht verwijderen</button></div>
            </form>
          </section>
        </div>`,
    });
  };

  router.get(routePath(`${ROUTE}:id(\\d{1,9})/`), guard, async (req, res, next) => {
    try {
      const message = await messages.findMessage(db, req.params.id);
      if (!message) return notFound(req, res);
      return res.send(renderMessage(req, message, { notice: NOTICES[req.query.opgeslagen] || '' }));
    } catch (error) {
      return next(error);
    }
  });

  router.post(routePath(`${ROUTE}:id(\\d{1,9})/afhandelen/`), guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const note = messages.messageNote(req.body.notitie);
      const changed = await db.transaction(async (client) => {
        const done = await messages.markHandled(client, id, { userId: req.user.id, note });
        if (done) await auth.audit(req, { userId: req.user.id, action: 'bericht.afgehandeld', entity: 'contact_messages', entityId: id }, client);
        return done;
      });
      const message = await messages.findMessage(db, id);
      if (!message) return notFound(req, res);
      // Intussen al door iemand anders afgehandeld: de stand tonen in plaats van blind te overschrijven.
      if (!changed) return res.status(409).send(renderMessage(req, message, { error: 'Dit bericht was intussen al afgehandeld.' }));
      return res.redirect(303, `${BASE}${id}/?opgeslagen=afgehandeld`);
    } catch (error) {
      return next(error);
    }
  });

  router.post(routePath(`${ROUTE}:id(\\d{1,9})/heropenen/`), guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const changed = await db.transaction(async (client) => {
        const done = await messages.reopenMessage(client, id);
        if (done) await auth.audit(req, { userId: req.user.id, action: 'bericht.heropend', entity: 'contact_messages', entityId: id }, client);
        return done;
      });
      const message = await messages.findMessage(db, id);
      if (!message) return notFound(req, res);
      if (!changed) return res.status(409).send(renderMessage(req, message, { error: 'Dit bericht stond al op nieuw.' }));
      return res.redirect(303, `${BASE}${id}/?opgeslagen=heropend`);
    } catch (error) {
      return next(error);
    }
  });

  router.post(routePath(`${ROUTE}:id(\\d{1,9})/verwijderen/`), guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (req.body.bevestig !== 'ja') {
        const message = await messages.findMessage(db, id);
        if (!message) return notFound(req, res);
        return res.status(422).send(renderMessage(req, message, { error: 'Vink aan dat je het bericht definitief wilt verwijderen.' }));
      }
      const removed = await db.transaction(async (client) => {
        const done = await messages.deleteMessage(client, id);
        if (done) await auth.audit(req, { userId: req.user.id, action: 'bericht.verwijderd', entity: 'contact_messages', entityId: id }, client);
        return done;
      });
      if (!removed) return notFound(req, res);
      return res.redirect(303, BASE);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createMessageRoutes, MESSAGE_ACTION_LABELS };
