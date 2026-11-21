/**
 * Paginaopbouw van het CRM onder `/app/`: een vaste zijbalk links (zoals in Aquatech) met het logo, een zoekveld voor
 * Beheer, de modules in inklapbare groepen op basis van de rechten van de gebruiker, en onderaan de gebruiker met
 * wachtwoord, tweestapsverificatie en uitloggen. Op een breed scherm is de zijbalk in te klappen tot een iconenbalk
 * (per browser onthouden, `public/js/crm.js`); op een smal scherm (≤ 800 px) is het een lade via de menuknop in de
 * kopbalk. Zonder JavaScript staan alle groepen open en staat de zijbalk op een smal scherm boven de inhoud. Zelfde
 * huisstijl als de site (`site.css`), nooit indexeerbaar.
 */
const { html, toString } = require('../site/html');
const { icon } = require('../site/icons');
const { roleHasRight, roleHasGlobalRight, roleLabel } = require('./rights');
const { renderMaintenanceBanner } = require('../site/layout');
const { GROUPS: BEHEER_GROUPS } = require('../beheer/indeling');

/** Versie van de statische bestanden, tegen verouderde caches. */
const ASSET_VERSION = require('../../package.json').version;

/**
 * Menu van het CRM in groepen; een item verschijnt alleen als de gebruiker het recht heeft (de server controleert
 * opnieuw), een groep zonder zichtbare items verdwijnt. `global`: niet voor rollen die tot eigen vertrekken beperkt
 * zijn. Groep `top` staat los bovenaan, zonder kop.
 */
const CRM_MENU = [
  { key: 'top', items: [{ label: 'Overzicht', href: '/app/', icon: 'home' }] },
  {
    key: 'reizigers',
    title: 'Reizigers',
    icon: 'users',
    items: [
      { label: 'Aanmeldingen', href: '/app/aanmeldingen/', icon: 'clipboard', right: 'aanmeldingen', global: true },
      { label: 'Deelnemers', href: '/app/deelnemers/', icon: 'users', right: 'deelnemers', global: true },
      { label: 'Deelnemerslijsten', href: '/app/deelnemerslijsten/', icon: 'list', right: 'export.deelnemers' },
      { label: 'Betalingen', href: '/app/betalingen/', icon: 'euro', right: 'betalingen', global: true },
    ],
  },
  {
    key: 'website',
    title: 'Website',
    icon: 'image',
    items: [
      { label: 'Pagina\'s', href: '/app/paginas/', icon: 'list', right: 'content' },
      { label: 'Blog', href: '/app/blog/', icon: 'calendar', right: 'content' },
      { label: 'Veelgestelde vragen', href: '/app/faq/', icon: 'information', right: 'content' },
      { label: 'Menu\'s', href: '/app/menus/', icon: 'menu', right: 'content' },
      { label: 'Reizen', href: '/app/reizen/', icon: 'location', right: 'reizen' },
      { label: 'Reistypes en landen', href: '/app/reistypes-en-landen/', icon: 'label', right: 'reizen' },
      { label: 'Reisleiders', href: '/app/reisleiders/', icon: 'user', right: 'reizen' },
      { label: 'Fotobibliotheek', href: '/app/fotobibliotheek/', icon: 'image', right: 'media' },
    ],
  },
  {
    key: 'gebruikers',
    title: 'Gebruikers',
    icon: 'user',
    items: [
      { label: 'Gebruikers', href: '/app/gebruikers/', icon: 'user', right: 'gebruikers' },
      { label: 'Auditlog', href: '/app/auditlog/', icon: 'list', right: 'gebruikers' },
    ],
  },
];

/** Icoon per groep van Beheer (`beheer/indeling.js`); een nieuwe groep zonder icoon krijgt het tandwiel. */
const BEHEER_ICONS = {
  Systeem: 'settings',
  Organisatie: 'building',
  'E-mail': 'mail',
  'Toegang en beveiliging': 'shield',
  'Back-ups en herstel': 'archive',
  Vindbaarheid: 'search',
};

/**
 * Formatteert een tijdstip in Europe/Amsterdam (dd-mm-jjjj uu:mm).
 * @param {(Date|string|null)} value Tijdstip.
 * @returns {string} Tekst, of een streepje.
 */
function formatDateTime(value) {
  if (!value) return '–';
  return new Date(value).toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * Maakt van de groepen van Beheer zijbalkgroepen (sleutel `beheer-<n>`, links naar `/app/beheer/<id>/`).
 * @param {{title: string, sections: {id: string, label: string}[]}[]} groups Groepen uit `beheer/indeling.js`
 *   (eventueel gefilterd door het zoekveld).
 * @returns {object[]} Groepen in de vorm van `CRM_MENU`.
 */
function beheerMenuGroups(groups) {
  return groups.map((group) => ({
    key: `beheer-${BEHEER_GROUPS.findIndex((original) => original.title === group.title)}`,
    title: group.title,
    icon: BEHEER_ICONS[group.title] || 'settings',
    items: group.sections.map((section) => ({ label: section.label, href: `/app/beheer/${section.id}/`, icon: BEHEER_ICONS[group.title] || 'settings' })),
  }));
}

/**
 * Bepaalt het huidige menu-item: het item met de langste href waar het pad mee begint (`/app/` alleen exact). Een
 * Beheer-pagina zonder eigen sectie (bijv. 404) valt zo terug op niets in plaats van op een willekeurige sectie.
 * @param {object[]} groups Zichtbare groepen.
 * @param {string} currentPath Huidig pad.
 * @returns {string} De href van het huidige item, of een lege tekst.
 */
function currentHref(groups, currentPath) {
  let best = '';
  for (const group of groups) {
    for (const item of group.items) {
      const matches = item.href === '/app/' ? currentPath === item.href : currentPath.startsWith(item.href);
      if (matches && item.href.length > best.length) best = item.href;
    }
  }
  return best;
}

/**
 * De zichtbare menugroepen voor een gebruiker: de CRM-groepen volgens de rechten, plus (met recht `systeem`) de groepen
 * van Beheer.
 * @param {object} user De ingelogde gebruiker.
 * @param {(object[]|null)} beheerGroups Gefilterde groepen van Beheer (zoekveld), of null voor alle.
 * @returns {{crm: object[], beheer: object[]}} De groepen.
 */
function visibleMenu(user, beheerGroups) {
  const allowed = (item) => !item.right || (item.global ? roleHasGlobalRight : roleHasRight)(user.role, item.right);
  const crm = CRM_MENU.map((group) => ({ ...group, items: group.items.filter(allowed) })).filter((group) => group.items.length);
  const beheer = roleHasRight(user.role, 'systeem') ? beheerMenuGroups(beheerGroups || BEHEER_GROUPS) : [];
  return { crm, beheer };
}

/**
 * Eén link in de zijbalk.
 * @param {{label: string, href: string, icon: string}} item Het menu-item.
 * @param {string} activeHref De href van het huidige item.
 * @returns {object} HTML.
 */
function renderNavItem(item, activeHref) {
  return html`<a class="crm-nav-item" href="${item.href}"${item.href === activeHref ? html` aria-current="page"` : ''} title="${item.label}"><span class="crm-nav-ico">${icon(item.icon)}</span><span class="crm-nav-label">${item.label}</span></a>`;
}

/**
 * Eén inklapbare groep in de zijbalk. De groep met de huidige pagina (of alle groepen tijdens zoeken) staat open.
 * @param {object} group De groep (key, title, icon, items).
 * @param {string} activeHref De href van het huidige item.
 * @param {boolean} forceOpen Open ongeacht de huidige pagina (zoeken).
 * @returns {object} HTML.
 */
function renderNavGroup(group, activeHref, forceOpen) {
  if (group.key === 'top') return html`<div class="crm-nav-list crm-nav-top">${group.items.map((item) => renderNavItem(item, activeHref))}</div>`;
  const hasActive = group.items.some((item) => item.href === activeHref);
  const open = forceOpen || hasActive;
  const bodyId = `crm-nav-${group.key}`;
  return html`<div class="crm-nav-sec${open ? ' is-open' : ''}${hasActive ? ' has-active' : ''}" data-group="${group.key}">
    <button class="crm-nav-sec-head" type="button" aria-expanded="${open ? 'true' : 'false'}" aria-controls="${bodyId}"><span class="crm-nav-ico">${icon(group.icon)}</span><span class="crm-nav-label">${group.title}</span>${icon('chevron-down', { className: 'crm-nav-chevron' })}</button>
    <div class="crm-nav-sec-body crm-nav-list" id="${bodyId}">${group.items.map((item) => renderNavItem(item, activeHref))}</div>
  </div>`;
}

/**
 * De zijbalk van het CRM.
 * @param {{user: object, csrf: string, path: string, beheer?: {groups?: object[], query?: string}}} page De gebruiker, het
 *   CSRF-token, het huidige pad en (op Beheer-pagina's) de gefilterde groepen en zoekterm.
 * @returns {object} HTML van de zijbalk en de achtergrond van de lade.
 */
function renderSidebar(page) {
  const { user } = page;
  const beheer = page.beheer || {};
  const query = beheer.query || '';
  const menu = visibleMenu(user, beheer.groups || null);
  const activeHref = currentHref(menu.crm.concat(menu.beheer), page.path);
  const canSearch = roleHasRight(user.role, 'systeem');
  return html`<nav class="crm-nav" id="crm-nav" aria-label="CRM-menu"${query ? html` data-search="1"` : ''}>
    <div class="crm-nav-head">
      <a class="crm-nav-brand" href="/app/"><img class="crm-nav-logo" src="/images/logo-light.png" alt="Avanta reizen" width="68" height="40"><span class="crm-nav-label crm-nav-app">CRM</span></a>
      <button class="crm-nav-close" type="button" data-nav-close aria-label="Menu sluiten">${icon('close')}</button>
    </div>
    ${canSearch ? html`<form class="crm-nav-search" method="get" action="/app/beheer/" role="search">
      ${icon('search')}
      <label class="visually-hidden" for="beheer-zoek">Zoeken in Beheer</label>
      <input id="beheer-zoek" class="crm-nav-search-input" type="search" name="zoek" value="${query}" maxlength="100" placeholder="Zoeken in Beheer">
    </form>` : ''}
    ${menu.crm.map((group) => renderNavGroup(group, activeHref, false))}
    ${menu.beheer.length || query ? html`<p class="crm-nav-divider"><span class="crm-nav-label">Beheer</span></p>` : ''}
    ${query && !menu.beheer.length ? html`<p class="crm-nav-empty">Niets gevonden voor “${query}”. <a href="/app/beheer/">Alles tonen</a></p>` : ''}
    ${menu.beheer.map((group) => renderNavGroup(group, activeHref, Boolean(query)))}
    <div class="crm-nav-foot crm-nav-list">
      <a class="crm-nav-item crm-nav-user" href="/app/wachtwoord/"${page.path.startsWith('/app/wachtwoord/') ? html` aria-current="page"` : ''} title="Wachtwoord wijzigen"><span class="crm-nav-ico">${icon('user')}</span><span class="crm-nav-label">${user.name} <span class="crm-nav-role">${roleLabel(user.role)}</span></span></a>
      <a class="crm-nav-item" href="/app/tweestaps/"${page.path.startsWith('/app/tweestaps/') ? html` aria-current="page"` : ''} title="Tweestapsverificatie"><span class="crm-nav-ico">${icon('lock')}</span><span class="crm-nav-label">Tweestapsverificatie</span></a>
      <form class="crm-nav-logout" method="post" action="/app/uitloggen/"><input type="hidden" name="_csrf" value="${page.csrf || ''}"><button class="crm-nav-item" type="submit" title="Uitloggen"><span class="crm-nav-ico">${icon('logout')}</span><span class="crm-nav-label">Uitloggen</span></button></form>
    </div>
    <button class="crm-nav-collapse" type="button" data-nav-compact aria-pressed="false" title="Zijbalk inklappen"><span class="crm-nav-ico">${icon('chevron-left')}</span><span class="crm-nav-label">Inklappen</span></button>
  </nav>
  <div class="crm-nav-backdrop" data-nav-close></div>`;
}

/**
 * Maakt een volledige CRM-pagina.
 * @param {{title: string, body: object, user?: (object|null), csrf?: string, path?: string, beheer?: object}} page
 *   Titel, inhoud, de ingelogde gebruiker (zonder: geen zijbalk), het CSRF-token voor de uitlogknop, het huidige pad
 *   (een menu-item is actief op zijn eigen pad en alles eronder; het langste item wint) en op Beheer-pagina's de
 *   gefilterde groepen en zoekterm (`{groups, query}`).
 * @returns {string} De HTML.
 */
function renderCrmPage(page) {
  const user = page.user || null;
  const path = page.path || '';
  return '<!doctype html>\n' + toString(html`<html lang="nl-NL">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${page.title} - Avanta CRM</title>
  <link rel="icon" type="image/png" href="/images/favicon.png">
  <link rel="stylesheet" href="/css/site.css?v=${ASSET_VERSION}">
</head>
<body class="crm${user ? ' crm--nav' : ''}">
  <a class="skip-link" href="#inhoud">Naar de inhoud</a>
  <div class="crm-page">
    ${renderMaintenanceBanner()}
    <header class="crm-header">
      <div class="crm-header__inner">
        ${user ? html`<button class="crm-nav-toggle" type="button" data-nav-toggle aria-controls="crm-nav" aria-expanded="false" aria-label="Menu openen">${icon('menu')}</button>` : ''}
        <a class="crm-brand" href="/app/"><img src="/images/logo.png" alt="Avanta reizen" width="68" height="40"> <span>CRM</span></a>
      </div>
    </header>
    ${user ? html`${renderSidebar({ user, csrf: page.csrf, path, beheer: page.beheer })}
    <script src="/js/crm.js?v=${ASSET_VERSION}"></script>` : ''}
    <main id="inhoud" class="crm-main">
      <h1 class="crm-title">${page.title}</h1>
      ${page.body}
    </main>
  </div>
</body>
</html>`);
}

/**
 * Eén invoerveld met label en eventuele foutmelding.
 * @param {{name: string, label: string, type?: string, value?: string, error?: string, autocomplete?: string, required?: boolean, max?: number}} field Veld.
 * @returns {object} HTML.
 */
function renderInput(field) {
  const id = `veld-${field.name}`;
  return html`<div class="field">
    <span class="field__label"><label for="${id}">${field.label}</label></span>
    <input id="${id}" name="${field.name}" type="${field.type || 'text'}" value="${field.value || ''}"${field.autocomplete ? html` autocomplete="${field.autocomplete}"` : ''}${field.max ? html` maxlength="${field.max}"` : ''}${field.required === false ? '' : html` required`}${field.error ? html` aria-invalid="true" aria-describedby="${id}-fout"` : ''}>
    ${field.error ? html`<span class="field__error" id="${id}-fout">${field.error}</span>` : ''}
  </div>`;
}

/**
 * Een foutmelding boven een formulier, of niets.
 * @param {string} [message] Melding.
 * @returns {object} HTML.
 */
function renderAlert(message) {
  return message ? html`<div class="form-alert" role="alert">${message}</div>` : '';
}

module.exports = { renderCrmPage, renderInput, renderAlert, formatDateTime, CRM_MENU };
