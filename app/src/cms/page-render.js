/**
 * De inhoud van een pagina uit blokken voor de site en het voorbeeld in het CRM (CMS-pakket H): de inleiding, de
 * blokken (`cms/blocks.js`, met de gegevens die ze nodig hebben) en eventueel de fotogalerij uit de import eronder.
 */
const { html } = require('../site/html');
const { introduction } = require('../site/page-view');
const { renderGallery } = require('../site/trip-view');
const { renderBlocks, publishedBlocks, loadBlockData } = require('./blocks');

/**
 * De HTML onder de kop van een pagina.
 * @param {{title: string, intro?: string, blocks: *, body_html?: string, managed_in_crm?: boolean}} page Titel, inleiding en
 *   blokken (een rij uit `pages` of het concept; zie `publishedBlocks`).
 * @param {{faqs: Function, categories: Function, upcomingTrips: Function}} content Queries uit `site/content.js` (voor
 *   blokken met reizen, reistypes, landen of de FAQ).
 * @param {({title: string, subtitle: string, images: string[]}|null)} [gallery] Galerij uit `site-content.json`.
 * @returns {Promise<{body: object, hasVideo: boolean}>} HTML en of er een video in staat (voor de CSP).
 */
async function renderPageArticle(page, content, gallery = null) {
  const blocks = publishedBlocks(page);
  const data = await loadBlockData(blocks, content);
  const { body, hasVideo } = renderBlocks(blocks, { title: page.title, data });
  return { body: html`${introduction(page.intro)}${body}${gallery ? renderGallery(gallery) : ''}`, hasVideo };
}

module.exports = { renderPageArticle };
