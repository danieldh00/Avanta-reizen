// @ts-check
/**
 * De inhoud van een pagina uit blokken voor de site en het voorbeeld in het CRM (CMS-pakket H): de inleiding, de
 * blokken (`cms/blocks.js`, met de gegevens die ze nodig hebben).
 */
const { html } = require('../site/html');
const { introduction } = require('../site/page-view');
const { publishedBlocks } = require('./blocks');
const { renderBlocks, loadBlockData } = require('./block-render');

/**
 * De HTML onder de kop van een pagina; voor de homepage (pad `/`) alleen de blokken, omhuld zoals de vaste homepage.
 * @param {{title: string, path?: string, intro?: string, blocks: *, body_html?: string, managed_in_crm?: boolean}} page Titel,
 *   pad, inleiding en blokken (een rij uit `pages` of het concept; zie `publishedBlocks`).
 * @param {any} content Queries uit `site/content.js` (voor blokken met reizen, reistypes, landen, de FAQ, blog en
 *   de homepage-secties).
 * @param {{featuredSlug?: string}} [options] Uitgelicht blogbericht voor het blogblok van de homepage.
 * @returns {Promise<{body: any, hasVideo: boolean}>} HTML en of er een video in staat (voor de CSP).
 */
async function renderPageArticle(page, content, options = {}) {
  const blocks = publishedBlocks(page);
  const data = await loadBlockData(blocks, content, options);
  const homepage = page.path === '/';
  const { body, hasVideo } = renderBlocks(blocks, { title: page.title, data, homepage });
  if (homepage) return { body, hasVideo };
  return { body: html`${introduction(page.intro)}${body}`, hasVideo };
}

module.exports = { renderPageArticle };
