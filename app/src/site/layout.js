/**
 * Paginaopbouw van de website: kop met logo en menu, inhoud en voettekst, in de huisstijl van Avanta.
 */
const { html, toString } = require('./html');
const { renderSeoHead } = require('./seo');

/** Hoofdmenu, gelijk aan de huidige site. */
const MENU = [
  { label: 'Reizen', href: '/reis/' },
  {
    label: 'Over Avanta',
    href: '/avanta-reizen/',
    children: [
      { label: 'Onze manier van reizen', href: '/avanta-reizen/onzemaniervanreizen/' },
      { label: 'Het Avantateam', href: '/avanta-reizen/' },
      { label: 'Voorpret', href: '/avanta-reizen/voorpret/' },
      { label: 'Veelgestelde vragen', href: '/faq/' },
      { label: 'Algemene voorwaarden', href: '/algemene-voorwaarden/' },
    ],
  },
  { label: 'Reisleiders', href: '/reisleider/' },
  { label: 'Weblog', href: '/blog/' },
  { label: 'Contact', href: '/contact/' },
];

/** Standaard contactgegevens in de voettekst; de echte komen uit Beheer (`page.site.contact`). */
const CONTACT = { phone: '0118 638427', email: 'info@avantareizen.nl' };

/** Versie van de statische bestanden, tegen verouderde caches. */
const ASSET_VERSION = require('../../package.json').version;

/**
 * Bepaalt of een menu-item bij het huidige pad hoort.
 * @param {string} href Pad van het menu-item.
 * @param {string} currentPath Pad van de huidige pagina.
 * @returns {boolean} Waar als het item actief is.
 */
function isActive(href, currentPath) {
  return href === '/' ? currentPath === '/' : currentPath.startsWith(href);
}

/**
 * Maakt het hoofdmenu.
 * @param {string} currentPath Pad van de huidige pagina.
 * @returns {object} HTML van het menu.
 */
function renderMenu(currentPath) {
  return html`<ul class="menu">${MENU.map((item) => html`
    <li class="menu__item${item.children ? ' menu__item--parent' : ''}${isActive(item.href, currentPath) ? ' is-active' : ''}">
      <a href="${item.href}">${item.label}</a>
      ${item.children ? html`<ul class="menu__sub">${item.children.map((child) => html`<li><a href="${child.href}">${child.label}</a></li>`)}</ul>` : ''}
    </li>`)}
  </ul>`;
}

/**
 * Maakt een volledige HTML-pagina.
 * @param {{title: string, description?: string, body: object, path?: string, header?: object, bodyClass?: string, indexable?: boolean, seo?: object, site?: object}} page Gegevens van de pagina; `path` is het menupad, `seo` de canonical-URL, afbeelding, type en JSON-LD (zie `seo.renderSeoHead`), `site` de site-instellingen uit Beheer (`site/site-settings.js`: naam, titels, omschrijving, contact, verificatie; zonder: de standaard).
 * @returns {string} De HTML.
 */
function renderPage(page) {
  const currentPath = page.path || '/';
  const site = page.site || {};
  const contact = site.contact || CONTACT;
  const siteName = site.siteName || 'Avanta reizen';
  const fullTitle = page.title ? `${page.title} - ${siteName}` : (site.homeTitle || 'Avontuurlijke groepsreizen over heel de wereld - Avanta reizen');
  const description = page.description || site.description || '';
  const verification = site.verification || {};
  const year = new Date().toLocaleDateString('nl-NL', { year: 'numeric', timeZone: 'Europe/Amsterdam' });
  return '<!doctype html>\n' + toString(html`<html lang="nl-NL">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${fullTitle}</title>
  ${description ? html`<meta name="description" content="${description}">` : ''}
  <meta name="robots" content="${page.indexable ? 'index, follow' : 'noindex, nofollow'}">
  ${verification.google ? html`<meta name="google-site-verification" content="${verification.google}">` : ''}
  ${verification.bing ? html`<meta name="msvalidate.01" content="${verification.bing}">` : ''}
  ${page.seo ? renderSeoHead({ title: fullTitle, description, siteName, defaultDescription: site.description, ...page.seo }) : ''}
  <link rel="icon" type="image/png" href="/images/favicon.png">
  <link rel="stylesheet" href="/css/site.css?v=${ASSET_VERSION}">
</head>
<body class="${page.bodyClass || ''}">
  <a class="skip-link" href="#inhoud">Naar de inhoud</a>
  <header class="site-header">
    <div class="container site-header__inner">
      <a class="brand" href="/"><img src="/images/logo.png" alt="${siteName}" width="140" height="82"></a>
      <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="hoofdmenu">Menu</button>
      <nav id="hoofdmenu" class="site-nav" aria-label="Hoofdmenu">${renderMenu(currentPath)}</nav>
    </div>
  </header>
  ${page.header || ''}
  <main id="inhoud" class="site-main">${page.body}</main>
  <footer class="site-footer">
    <div class="container site-footer__inner">
      <nav class="site-footer__links" aria-label="Voettekst">
        <a href="/avanta-reizen/">Het Avantateam</a>
        <a href="/blog/">Weblog</a>
        <a href="/contact/">Contact</a>
      </nav>
      <p class="site-footer__contact">T: <a href="tel:${contact.phone.replace(/[^0-9+]/g, '')}">${contact.phone}</a>
        &nbsp; E: <a href="mailto:${contact.email}">${contact.email}</a></p>
      <p class="site-footer__copy">© ${year} ${siteName}</p>
    </div>
  </footer>
  <script src="/js/site.js?v=${ASSET_VERSION}"></script>
</body>
</html>`);
}

/**
 * Maakt de paginakop met titel (en optioneel pretitel, ondertitel, terug-link en achtergrondafbeelding).
 * @param {{title: string, pretitle?: string, subtitle?: string, imageUrl?: string, backLink?: string}} header Gegevens van de kop.
 * @returns {object} HTML van de kop.
 */
function renderPageHeader(header) {
  return html`<section class="page-header${header.imageUrl ? ' page-header--image' : ''}"${header.imageUrl ? html` style="--header-image: url('${header.imageUrl}')"` : ''}>
    <div class="container">
      ${header.backLink ? html`<a class="page-header__back" href="${header.backLink}">Naar overzicht</a>` : ''}
      ${header.pretitle ? html`<p class="page-header__pretitle">${header.pretitle}</p>` : ''}
      <h1 class="page-header__title">${header.title}</h1>
      ${header.subtitle ? html`<p class="page-header__subtitle">${header.subtitle}</p>` : ''}
    </div>
  </section>`;
}

module.exports = { MENU, CONTACT, renderPage, renderPageHeader, renderMenu };
