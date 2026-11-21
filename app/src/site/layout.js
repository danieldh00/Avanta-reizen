/**
 * Paginaopbouw van de website, gelijk aan de huidige site: vaste kop met logo, menu en zoekvenster (papierrand eronder,
 * op mobiel een uitschuifmenu), paginakop met foto, inhoud en de donkere voettekst met achtergrondfoto.
 */
const { html, toString } = require('./html');
const { renderSeoHead } = require('./seo');
const { currentContext } = require('../system/request-context');
const { icon } = require('./icons');
const { formatDate } = require('./format');

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

/** Menu in de voettekst, gelijk aan de huidige site. */
const FOOTER_MENU = [
  { label: 'Het Avantateam', href: '/avanta-reizen/' },
  { label: 'Weblog', href: '/blog/' },
  { label: 'Contact', href: '/contact/' },
];

/** Social-media-iconen in de voettekst: sleutel in `site.social` (Beheer > Organisatie) → icoon en naam. */
const SOCIAL_LINKS = [
  { key: 'facebook', icon: 'facebook', label: 'Facebook' },
  { key: 'instagram', icon: 'instagram', label: 'Instagram' },
  { key: 'youtube', icon: 'youtube', label: 'YouTube' },
  { key: 'linkedin', icon: 'linkedin', label: 'LinkedIn' },
];

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
 * Maakt het hoofdmenu zoals op de huidige site: items in Playfair, een submenu dat op de computer bij aanwijzen
 * openklapt en op mobiel met een eigen knop (`foldout-toggle`, zie `public/js/site.js`).
 * @param {string} currentPath Pad van de huidige pagina.
 * @param {object[]} [items] Items uit het CRM (`cms/menus.js`); zonder: het vaste menu.
 * @returns {object} HTML van het menu.
 */
function renderMenu(currentPath, items) {
  const menu = Array.isArray(items) && items.length ? items : MENU;
  return html`<ul class="nav">${menu.map((item, index) => html`
    <li class="menu-item${item.children ? ' menu-item-has-children' : ''}${isActive(item.href, currentPath) ? ' is-active' : ''}">
      <a href="${item.href}">${item.label}${item.children ? icon('chevron-down', { className: 'menu-item__chevron' }) : ''}</a>
      ${item.children ? html`<button class="foldout-toggle" type="button" aria-expanded="false" aria-controls="submenu-${index}"><span class="visually-hidden">Submenu ${item.label}</span>${icon('chevron-down')}</button>
      <ul class="sub-menu" id="submenu-${index}">${item.children.map((child) => html`<li class="menu-item"><a href="${child.href}">${child.label}</a></li>`)}</ul>` : ''}
    </li>`)}
  </ul>`;
}

/**
 * Maakt de kop: logo, hoofdmenu, zoekknop met zoekvenster en (op mobiel) de menuknop. Op de homepage begint de kop
 * doorzichtig boven de foto (`is-transparent`, alleen met JavaScript actief).
 * @param {string} currentPath Pad van de huidige pagina.
 * @param {string} siteName Naam van de site (alt-tekst van het logo).
 * @param {object[]} [menuItems] Hoofdmenu uit het CRM; zonder: het vaste menu.
 * @returns {object} HTML van de kop.
 */
function renderHeader(currentPath, siteName, menuItems) {
  return html`<header class="header-main${currentPath === '/' ? ' is-transparent' : ''}">
    <div class="layout-container header-main__inner">
      <div class="mobile-header">
        <a class="brand" href="/"><img class="brand__dark" src="/images/logo.png" alt="${siteName}" width="140" height="82"><img class="brand__light" src="/images/logo-light.png" alt="${siteName}" width="140" height="82"></a>
        <button class="menutoggle" type="button" aria-expanded="false" aria-controls="hoofdmenu"><span class="visually-hidden">Menu</span>${icon('menu', { className: 'menutoggle__open' })}${icon('close', { className: 'menutoggle__close' })}</button>
      </div>
      <nav id="hoofdmenu" class="nav-primary" aria-label="Hoofdmenu">
        ${renderMenu(currentPath, menuItems)}
        <form id="zoekvenster" class="search-widget" role="search" action="/zoeken/" method="get">
          <button class="search-widget__close" type="button"><span class="visually-hidden">Zoekvenster sluiten</span>${icon('close')}</button>
          <label class="visually-hidden" for="zoekterm">Zoeken</label>
          <input id="zoekterm" class="search-widget__input" type="search" name="s" placeholder="Waar ben je naar op zoek?..." maxlength="80" required>
          <button class="btn search-widget__submit" type="submit">${icon('search', { className: 'search-widget__submit-icon' })}<span class="search-widget__submit-label">Zoeken</span></button>
        </form>
      </nav>
      <a class="search-toggle" href="/zoeken/" aria-controls="zoekvenster" aria-expanded="false">${icon('search')}<span class="search-toggle__label">Zoeken</span></a>
    </div>
  </header>`;
}

/**
 * Maakt de voettekst: wit logo, menu en contact in Playfair op de achtergrondfoto, social-iconen (alleen ingevulde
 * adressen uit Beheer), het SGR-logo en de copyrightregel.
 * @param {{siteName: string, contact: {phone: string, email: string}, social?: object, measurementId?: string, menu?: object[]}} footer Gegevens (`menu`: menu uit het CRM; zonder: het vaste voetmenu).
 * @returns {object} HTML van de voettekst.
 */
function renderFooter(footer) {
  const { siteName, contact } = footer;
  const social = footer.social || {};
  const socialLinks = SOCIAL_LINKS.filter((link) => social[link.key]);
  const footerMenu = Array.isArray(footer.menu) && footer.menu.length ? footer.menu : FOOTER_MENU;
  const year = new Date().toLocaleDateString('nl-NL', { year: 'numeric', timeZone: 'Europe/Amsterdam' });
  return html`<footer class="footer-main">
    <a class="brand brand--footer" href="/"><img src="/images/logo-light.png" alt="${siteName}" width="241" height="142"></a>
    <div class="layout-container nav-footer">
      <nav aria-label="Voettekst"><ul class="nav">${footerMenu.map((item) => html`<li><a href="${item.href}">${item.label}</a></li>`)}</ul></nav>
      <div class="location">
        <span class="location__phone">T: <a href="tel:${contact.phone.replace(/[^0-9+]/g, '')}">${contact.phone}</a></span>
        <span class="location__mail">E: <a href="mailto:${contact.email}">${contact.email}</a></span>
      </div>
    </div>
    <div class="layout-container contact-footer">
      ${socialLinks.length ? html`<ul class="social-items">${socialLinks.map((link) => html`<li class="social-item"><a class="social-item__icon" href="${social[link.key]}" rel="noopener" target="_blank">${icon(link.icon, { label: link.label })}</a></li>`)}</ul>` : ''}
      <a href="https://www.sgr.nl/" rel="noopener" target="_blank"><img class="footer-logo-srg" src="/images/sgr.png" alt="Lid van de Stichting Garantiefonds Reisgelden (SGR)" width="44" height="40"></a>
    </div>
    <div class="layout-container legal-footer">
      <p class="legal-footer__copyright">© ${year} ${siteName}</p>
      ${footer.measurementId ? html`<p><button class="link-button" type="button" data-consent-settings>Cookie-instellingen</button></p>` : ''}
    </div>
  </footer>`;
}

/**
 * Maakt een volledige HTML-pagina.
 * @param {{title: string, description?: string, body: object, path?: string, header?: object, bodyClass?: string, indexable?: boolean, seo?: object, site?: object}} page Gegevens van de pagina; `path` is het menupad, `seo` de canonical-URL, afbeelding, type en JSON-LD (zie `seo.renderSeoHead`), `site` de site-instellingen uit Beheer (`site/site-settings.js`: naam, titels, omschrijving, contact, social media, verificatie, tekst van de balk "in ontwikkeling", de menu's uit het CRM in `menus`; zonder: de standaard).
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
  const measurementId = (site.analytics && site.analytics.measurementId) || '';
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
  <link rel="preload" href="/fonts/playfair-display-latin-900-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/css/site.css?v=${ASSET_VERSION}">
</head>
<body class="${page.bodyClass || ''}"${measurementId ? html` data-analytics="${measurementId}" data-privacy-url="/privacy/"` : ''}>
  <a class="skip-link" href="#inhoud">Naar de inhoud</a>
  ${renderMaintenanceBanner()}
  ${site.devBanner ? html`<div class="dev-banner" role="note">${site.devBanner}</div>` : ''}
  ${renderHeader(currentPath, siteName, site.menus && site.menus.hoofd)}
  <main id="inhoud" class="site-main">${page.header || ''}${page.body}</main>
  ${renderFooter({ siteName, contact, social: site.social, measurementId, menu: site.menus && site.menus.voet })}
  <script src="/js/site.js?v=${ASSET_VERSION}"></script>
  ${measurementId ? html`<script src="/js/analytics.js?v=${ASSET_VERSION}"></script>` : ''}
  ${site.captchaSiteKey ? html`<script src="/js/captcha.js?v=${ASSET_VERSION}"></script>` : ''}
</body>
</html>`);
}

/**
 * De balk bovenaan elke pagina (site en CRM) zolang de onderhoudsmodus aan staat; de stand komt uit de context van
 * het verzoek (`system/request-context.js`, gezet in `server.js`).
 * @returns {(object|string)} HTML, of leeg buiten onderhoud.
 */
function renderMaintenanceBanner() {
  const maintenance = currentContext().maintenance;
  return maintenance && maintenance.active ? html`<div class="maintenance-banner" role="status">${maintenance.message}</div>` : '';
}

/**
 * Geeft een afbeeldingsadres terug dat veilig in `url('…')` in een style-attribuut past: alleen een eigen pad of
 * https. Haakjes, enkele aanhalingstekens en spaties worden procent-gecodeerd (zo blijven bestandsnamen als
 * `foto (1).jpg` werken); een adres met dubbele aanhalingstekens, backslash, `<`, `>` of andere witruimte wordt
 * geweigerd, zodat een adres uit de database de CSS nooit kan openbreken.
 * @param {string} url Adres van de afbeelding.
 * @returns {string} Het (gecodeerde) adres, of leeg als het niet veilig is.
 */
function cssImageUrl(url) {
  const value = String(url || '').replace(/[()' ]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return /^(https:\/\/|\/(?!\/))[^\s"\\<>]*$/.test(value) ? value : '';
}

/**
 * Maakt de paginakop zoals op de huidige site: foto over de volle breedte met verloop, cursieve pretitel en titel in
 * Playfair 900. Met `destinations` (reis) staat de titel links met de landen erboven en een knop "Naar overzicht".
 * @param {{title?: string, pretitle?: string, date?: (Date|null), subtitle?: string, imageUrl?: string, backLink?: string, destinations?: string[], bare?: boolean, single?: boolean}} header Gegevens van de kop (`bare`: alleen de knop "Naar overzicht", zoals bij een reisleider; `date`: datum
 *   van een blogbericht als pretitel, dd/mm/jjjj; `single`: blogbericht, op mobiel staat "Naar overzicht" als balk boven de kop).
 * @returns {object} HTML van de kop.
 */
function renderPageHeader(header) {
  const imageUrl = cssImageUrl(header.imageUrl);
  const back = header.backLink ? html`<a class="to-archive" href="${header.backLink}">${icon('chevron-left')}<span class="to-archive__label">Naar overzicht</span></a>` : '';
  // Zonder titel en foto (reisleider): alleen de knop "Naar overzicht", zoals op de huidige site.
  if (header.bare) return html`<section class="page-header page-header--bare"><div class="layout-container">${back}</div></section>`;
  const isTrip = Array.isArray(header.destinations);
  const titleBlock = isTrip
    ? html`<div class="page-header__title-block">
        ${header.destinations.length ? html`<p class="page-header__destination">${header.destinations.join(', ')}</p>` : ''}
        <h1 class="page-header__title">${header.title}</h1>
      </div>`
    : html`${header.date ? html`<p class="page-header__pretitle"><time datetime="${header.date.toISOString()}">${formatDate(header.date).replace(/-/g, '/')}</time></p>` : ''}
      ${header.pretitle ? html`<p class="page-header__pretitle">${header.pretitle}</p>` : ''}
      <h1 class="page-header__title">${header.title}</h1>
      ${header.subtitle ? html`<p class="page-header__subtitle">${header.subtitle}</p>` : ''}`;
  return html`<section class="page-header${imageUrl ? ' page-header--image' : ''}${isTrip ? ' page-header--trip' : ''}${header.single ? ' page-header--single' : ''}">
    ${imageUrl ? html`<div class="page-header__image" style="background-image: url('${imageUrl}')"></div>` : ''}
    <div class="layout-container">
      ${back}
      ${titleBlock}
    </div>
  </section>`;
}

module.exports = { MENU, FOOTER_MENU, SOCIAL_LINKS, CONTACT, renderPage, renderPageHeader, cssImageUrl, renderMenu, renderHeader, renderFooter, renderMaintenanceBanner };
