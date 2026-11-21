/**
 * HTML-onderdelen van de website die nog niet in de opmaak van de huidige site staan (blogkaart en paginering, die
 * volgen in CMS-pakket E4). Reizen en reisleiders staan in `trip-view.js`, de homepage in `home-view.js`.
 */
const { html } = require('./html');
const { formatLongDate, isoDate, postPath } = require('./format');

/**
 * Kaart van een blogbericht.
 * @param {object} post Bericht.
 * @returns {object} HTML.
 */
function postCard(post) {
  return html`<a class="post-card" href="${postPath(post.slug)}">
    <figure class="post-card__image">${post.image_url ? html`<img src="${post.image_url}" alt="" loading="lazy">` : ''}</figure>
    <div class="post-card__body">
      ${post.published_at ? html`<time datetime="${new Date(post.published_at).toISOString()}">${formatLongDate(new Date(post.published_at))}</time>` : ''}
      <h3 class="post-card__title">${post.title}</h3>
      ${post.excerpt ? html`<p>${post.excerpt}</p>` : ''}
    </div>
  </a>`;
}

/**
 * Paginering met vorige/volgende.
 * @param {{page: number, pages: number, basePath: string}} paging Huidige pagina, aantal pagina's en basispad.
 * @returns {object} HTML.
 */
function pagination(paging) {
  if (paging.pages <= 1) return html``;
  const link = (page) => (page === 1 ? paging.basePath : `${paging.basePath}?pagina=${page}`);
  return html`<nav class="pagination" aria-label="Paginering">
    ${paging.page > 1 ? html`<a href="${link(paging.page - 1)}">Vorige</a>` : ''}
    <span>Pagina ${paging.page} van ${paging.pages}</span>
    ${paging.page < paging.pages ? html`<a href="${link(paging.page + 1)}">Volgende</a>` : ''}
  </nav>`;
}

module.exports = { postCard, pagination, isoDate };
