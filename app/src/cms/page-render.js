/**
 * De inhoud van een pagina uit blokken voor de site en het voorbeeld in het CRM (CMS-pakket H1): de inleiding, de
 * blokken (`cms/blocks.js`) en eventueel de fotogalerij uit de import eronder.
 */
const { html } = require('../site/html');
const { introduction } = require('../site/page-view');
const { renderGallery } = require('../site/trip-view');
const { renderBlocks, publishedBlocks } = require('./blocks');

/**
 * De HTML onder de kop van een pagina.
 * @param {{title: string, intro?: string, blocks: *, body_html?: string, managed_in_crm?: boolean}} page Titel, inleiding en
 *   blokken (een rij uit `pages` of het concept; zie `publishedBlocks`).
 * @param {({title: string, subtitle: string, images: string[]}|null)} [gallery] Galerij uit `site-content.json`.
 * @returns {{body: object, hasVideo: boolean}} HTML en of er een video in staat (voor de CSP).
 */
function renderPageArticle(page, gallery = null) {
  const { body, hasVideo } = renderBlocks(publishedBlocks(page), { title: page.title });
  return { body: html`${introduction(page.intro)}${body}${gallery ? renderGallery(gallery) : ''}`, hasVideo };
}

module.exports = { renderPageArticle };
