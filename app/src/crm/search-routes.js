/**
 * De resultatenpagina van het zoeken over het hele CRM (`/app/zoeken/?q=…`), het doel van het zoekveld in de kopbalk.
 * Per bron (`crm/search.js`) een kopje met de treffers en, als er meer zijn, een link naar de lijst van die bron.
 * Ingelogd zijn is genoeg om de pagina te openen; welke bronnen meedoen, bepalen de rechten van de gebruiker.
 */
const express = require('express');
const { html } = require('../site/html');
const { renderCrmPage } = require('./layout');
const ui = require('./ui');
const { searchCrm, canSearch, MIN_LENGTH, SEARCH_LIMIT } = require('./search');

/**
 * Maakt de route van de zoekpagina.
 * @param {{db: object, auth: object}} options Database en de sessie- en rechtenlaag.
 * @returns {express.Router} Router.
 */
function createSearchRoutes(options) {
  const { db, auth } = options;
  const router = express.Router();

  router.get('/zoeken/', auth.requireLogin, async (req, res, next) => {
    try {
      if (!canSearch(req.user.role)) {
        return res.status(403).send(renderCrmPage({ title: 'Geen toegang', user: req.user, csrf: req.session.csrf, path: '/app/zoeken/', body: html`<p>Er is niets dat je kunt doorzoeken. <a href="/app/">Naar het overzicht</a></p>` }));
      }
      const result = await searchCrm(db, req.user.role, req.query.q);
      const total = result.groups.reduce((sum, group) => sum + group.rows.length, 0);
      let summary = '';
      if (result.tooShort) summary = html`<p class="crm-empty">Typ minstens ${MIN_LENGTH} tekens.</p>`;
      else if (result.text && !total) summary = html`<p class="crm-empty">Niets gevonden voor “${result.text}”.</p>`;
      else if (!result.text) summary = html`<p>Zoek op naam, e-mailadres, referentie, reiscode, titel of tekst van een bericht.</p>`;
      return res.send(renderCrmPage({
        title: result.text ? `Zoeken: ${result.text}` : 'Zoeken',
        user: req.user,
        csrf: req.session.csrf,
        path: '/app/zoeken/',
        search: result.text,
        body: html`${ui.renderSearch({ action: '/app/zoeken/', label: 'Zoeken in het CRM', value: result.text })}
          ${summary}
          ${result.groups.map((group) => html`<section class="crm-search-group" aria-labelledby="zoek-${group.source.key}">
            <h2 id="zoek-${group.source.key}">${group.source.title} <span class="crm-tabs-count">${group.more ? `${SEARCH_LIMIT}+` : group.rows.length}</span></h2>
            <ul class="crm-search-results">${group.rows.map((row) => {
              const detail = group.source.detail(row);
              return html`<li><a href="${group.source.href(row)}">${group.source.label(row)}</a>${detail ? html`<span class="crm-search-detail">${detail}</span>` : ''}</li>`;
            })}</ul>
            ${group.more && group.source.listHref ? html`<p><a href="${group.source.listHref(result.text)}">Alle treffers in ${group.source.title.toLowerCase()}</a></p>` : ''}
            ${group.more && !group.source.listHref ? html`<p class="field__help">Alleen de eerste ${SEARCH_LIMIT}; maak de zoekterm specifieker.</p>` : ''}
          </section>`)}`,
      }));
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createSearchRoutes };
