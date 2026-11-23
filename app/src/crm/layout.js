/**
 * Paginaopbouw van het CRM onder `/app/`: een vaste zijbalk links met het logo, de modules in vier vaste groepen
 * (Boekingen, Reisaanbod, Website en de ingang naar Beheer) op basis van de rechten van de gebruiker, en een kopbalk
 * met het kruimelpad, een link naar de site en het gebruikersmenu (wachtwoord, tweestapsverificatie, uitloggen). Op een
 * breed scherm is de zijbalk in te klappen tot een iconenbalk (per browser onthouden, `public/js/crm.js`); op een smal
 * scherm (≤ 800 px) is het een lade via de menuknop in de kopbalk. Zonder JavaScript staat de zijbalk op een smal scherm
 * boven de inhoud. De opmaak staat in `public/css/crm.css`, bovenop de basis van `site.css`.
 *
 * Beheer (`/app/beheer/`, gebruikers en auditlog) is een eigen omgeving, zoals in Aquatech: naast de hoofdzijbalk staat
 * een tweede, lichte zijbalk met een weg terug naar het CRM, het zoekveld en de onderdelen van Beheer per onderwerp.
 * Op een smal scherm klapt die tweede zijbalk samen tot een knop boven de inhoud. Zelfde huisstijl als de site
 * (`site.css`), nooit indexeerbaar.
 */
const { html, toString } = require('../site/html');
const { icon } = require('../site/icons');
const { roleHasRight, roleHasGlobalRight, roleLabel } = require('./rights');
const { renderMaintenanceBanner } = require('../site/layout');
const { GROUPS: BEHEER_GROUPS, normalizeSearch } = require('../beheer/indeling');

/** Versie van de statische bestanden, tegen verouderde caches. */
const ASSET_VERSION = require('../../package.json').version;

/**
 * Menu van het CRM in groepen; een item verschijnt alleen als de gebruiker het recht heeft (de server controleert
 * opnieuw), een groep zonder zichtbare items verdwijnt. `global`: niet voor rollen die tot eigen vertrekken beperkt
 * zijn. Groep `top` staat los bovenaan, zonder kop; de andere groepen staan altijd open onder hun titel. Beheer staat
 * hier niet in: dat is één ingang onderaan (`renderBeheerEntry`) met een eigen zijbalk.
 */
const CRM_MENU = [
  { key: 'top', items: [{ label: 'Overzicht', href: '/app/', icon: 'home' }] },
  {
    key: 'boekingen',
    title: 'Boekingen',
    icon: 'users',
    items: [
      { label: 'Aanmeldingen', href: '/app/aanmeldingen/', icon: 'clipboard', right: 'aanmeldingen', global: true },
      { label: 'Deelnemers', href: '/app/deelnemers/', icon: 'users', right: 'deelnemers', global: true },
      { label: 'Deelnemerslijsten', href: '/app/deelnemerslijsten/', icon: 'list', right: 'export.deelnemers' },
      { label: 'Betalingen', href: '/app/betalingen/', icon: 'euro', right: 'betalingen', global: true },
    ],
  },
  {
    key: 'reisaanbod',
    title: 'Reisaanbod',
    icon: 'location',
    items: [
      { label: 'Reizen', href: '/app/reizen/', icon: 'location', right: 'reizen' },
      { label: 'Reistypes en landen', href: '/app/reistypes-en-landen/', icon: 'label', right: 'reizen' },
      { label: 'Reisleiders', href: '/app/reisleiders/', icon: 'user', right: 'reizen' },
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
      { label: 'Fotobibliotheek', href: '/app/fotobibliotheek/', icon: 'image', right: 'media' },
    ],
  },
];

/**
 * Onderdelen van Beheer die geen instellingensectie zijn (eigen routes in `crm/users.js`). Ze staan als eerste groep
 * in de zijbalk van Beheer, alleen met recht `gebruikers`; `words` telt mee bij het zoeken.
 */
const BEHEER_EXTRA_GROUP = {
  key: 'gebruikers',
  title: 'Gebruikers',
  icon: 'users',
  items: [
    { label: 'Gebruikers', href: '/app/gebruikers/', icon: 'user', right: 'gebruikers', words: 'gebruiker gebruikers account accounts rol rollen rechten toevoegen uitnodigen blokkeren wachtwoord tweestapsverificatie 2fa' },
    { label: 'Auditlog', href: '/app/auditlog/', icon: 'list', right: 'gebruikers', words: 'audit auditlog historie geschiedenis wie wat wanneer wijziging wijzigingen' },
  ],
};

/** Paden die bij Beheer horen: daar staat de tweede zijbalk en is de ingang "Beheer" gemarkeerd. */
const BEHEER_PATHS = ['/app/beheer/', '/app/gebruikers/', '/app/auditlog/'];

/** Icoon per groep van Beheer (`beheer/indeling.js`); een nieuwe groep zonder icoon krijgt het tandwiel. */
const BEHEER_ICONS = {
  Systeem: 'settings',
  Organisatie: 'building',
  'E-mail': 'mail',
  CRM: 'euro',
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
 * Of een pad bij Beheer hoort.
 * @param {string} currentPath Huidig pad.
 * @returns {boolean} Waar voor `/app/beheer/…`, `/app/gebruikers/…` en `/app/auditlog/…`.
 */
function isBeheerPath(currentPath) {
  return BEHEER_PATHS.some((prefix) => currentPath.startsWith(prefix));
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
 * De zichtbare groepen van het CRM-menu voor een gebruiker, volgens de rechten.
 * @param {object} user De ingelogde gebruiker.
 * @returns {object[]} De groepen.
 */
function visibleCrmMenu(user) {
  const allowed = (item) => !item.right || (item.global ? roleHasGlobalRight : roleHasRight)(user.role, item.right);
  return CRM_MENU.map((group) => ({ ...group, items: group.items.filter(allowed) })).filter((group) => group.items.length);
}

/**
 * Waar de ingang "Beheer" naartoe gaat, of null als de gebruiker niets in Beheer mag.
 * @param {object} user De ingelogde gebruiker.
 * @returns {(string|null)} `/app/beheer/` met recht `systeem`, anders `/app/gebruikers/` met recht `gebruikers`.
 */
function beheerEntryHref(user) {
  if (roleHasRight(user.role, 'systeem')) return '/app/beheer/';
  if (roleHasRight(user.role, 'gebruikers')) return '/app/gebruikers/';
  return null;
}

/**
 * De groepen van de zijbalk van Beheer voor een gebruiker: eerst Gebruikers (recht `gebruikers`), dan de groepen van
 * de instellingen (recht `systeem`, sleutel `beheer-<n>`, links naar `/app/beheer/<id>/`). Met een zoekterm vallen
 * gebruikers en auditlog weg als ze niet passen; de instellingengroepen zijn dan al gefilterd door `filterGroups`.
 * @param {object} user De ingelogde gebruiker.
 * @param {(object[]|null)} settingGroups Gefilterde groepen uit `beheer/indeling.js`, of null voor alle.
 * @param {string} query De zoekterm (leeg = alles).
 * @returns {object[]} Groepen in de vorm van `CRM_MENU`.
 */
function visibleBeheerMenu(user, settingGroups, query) {
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean).slice(0, 8);
  const matches = (item) => terms.every((term) => normalizeSearch(`${item.label} ${BEHEER_EXTRA_GROUP.title} ${item.words}`).includes(term));
  const extraItems = BEHEER_EXTRA_GROUP.items.filter((item) => roleHasRight(user.role, item.right) && matches(item));
  const groups = extraItems.length ? [{ ...BEHEER_EXTRA_GROUP, items: extraItems }] : [];
  if (!roleHasRight(user.role, 'systeem')) return groups;
  return groups.concat((settingGroups || BEHEER_GROUPS).map((group) => {
    const groupIcon = BEHEER_ICONS[group.title] || 'settings';
    return {
      key: `beheer-${BEHEER_GROUPS.findIndex((original) => original.title === group.title)}`,
      title: group.title,
      icon: groupIcon,
      items: group.sections.map((section) => ({ label: section.label, href: `/app/beheer/${section.id}/`, icon: groupIcon })),
    };
  }));
}

/**
 * Eén link in een zijbalk.
 * @param {{label: string, href: string, icon: string}} item Het menu-item.
 * @param {string} activeHref De href van het huidige item.
 * @returns {object} HTML.
 */
function renderNavItem(item, activeHref) {
  return html`<a class="crm-nav-item" href="${item.href}"${item.href === activeHref ? html` aria-current="page"` : ''} title="${item.label}"><span class="crm-nav-ico">${icon(item.icon)}</span><span class="crm-nav-label">${item.label}</span></a>`;
}

/**
 * Eén inklapbare groep in een zijbalk. De groep met de huidige pagina (of alle groepen tijdens zoeken) staat open.
 * @param {object} group De groep (key, title, icon, items).
 * @param {string} activeHref De href van het huidige item.
 * @param {boolean} forceOpen Open ongeacht de huidige pagina (zoeken).
 * @param {string} [idPrefix] Voorvoegsel van het id van de groep (`crm-nav` of `crm-sub`).
 * @returns {object} HTML.
 */
function renderNavGroup(group, activeHref, forceOpen, idPrefix = 'crm-nav') {
  if (group.key === 'top') return html`<div class="crm-nav-list crm-nav-top">${group.items.map((item) => renderNavItem(item, activeHref))}</div>`;
  const hasActive = group.items.some((item) => item.href === activeHref);
  const open = forceOpen || hasActive;
  const bodyId = `${idPrefix}-${group.key}`;
  return html`<div class="crm-nav-sec${open ? ' is-open' : ''}${hasActive ? ' has-active' : ''}" data-group="${group.key}">
    <button class="crm-nav-sec-head" type="button" aria-expanded="${open ? 'true' : 'false'}" aria-controls="${bodyId}"><span class="crm-nav-ico">${icon(group.icon)}</span><span class="crm-nav-label">${group.title}</span>${icon('chevron-down', { className: 'crm-nav-chevron' })}</button>
    <div class="crm-nav-sec-body crm-nav-list" id="${bodyId}">${group.items.map((item) => renderNavItem(item, activeHref))}</div>
  </div>`;
}

/**
 * Eén vaste groep in de hoofdzijbalk: de titel met de onderdelen eronder, altijd zichtbaar.
 * @param {object} group De groep (key, title, items).
 * @param {string} activeHref De href van het huidige item.
 * @returns {object} HTML.
 */
function renderMainGroup(group, activeHref) {
  if (group.key === 'top') return html`<div class="crm-nav-list crm-nav-top">${group.items.map((item) => renderNavItem(item, activeHref))}</div>`;
  const titleId = `crm-nav-${group.key}`;
  return html`<div class="crm-nav-group${group.items.some((item) => item.href === activeHref) ? ' has-active' : ''}" data-group="${group.key}" role="group" aria-labelledby="${titleId}">
    <p class="crm-nav-group-title" id="${titleId}"><span class="crm-nav-label">${group.title}</span></p>
    <div class="crm-nav-list">${group.items.map((item) => renderNavItem(item, activeHref))}</div>
  </div>`;
}

/**
 * De ingang naar Beheer in de hoofdzijbalk; op een Beheer-pagina gemarkeerd als huidig onderdeel (`aria-current="true"`,
 * de pagina zelf staat gemarkeerd in de tweede zijbalk).
 * @param {object} user De ingelogde gebruiker.
 * @param {string} currentPath Huidig pad.
 * @returns {(object|string)} HTML, of niets zonder rechten in Beheer.
 */
function renderBeheerEntry(user, currentPath) {
  const href = beheerEntryHref(user);
  if (!href) return '';
  return html`<div class="crm-nav-list crm-nav-beheer"><a class="crm-nav-item" href="${href}"${isBeheerPath(currentPath) ? html` aria-current="true"` : ''} title="Beheer"><span class="crm-nav-ico">${icon('settings')}</span><span class="crm-nav-label">Beheer</span></a></div>`;
}

/**
 * De hoofdzijbalk van het CRM.
 * @param {{user: object, path: string}} page De gebruiker en het huidige pad.
 * @returns {object} HTML van de zijbalk en de achtergrond van de lade.
 */
function renderSidebar(page) {
  const { user } = page;
  const menu = visibleCrmMenu(user);
  const activeHref = currentHref(menu, page.path);
  return html`<nav class="crm-nav" id="crm-nav" aria-label="CRM-menu">
    <div class="crm-nav-head">
      <a class="crm-nav-brand" href="/app/"><img class="crm-nav-logo" src="/images/logo-light.png" alt="Avanta reizen" width="68" height="40"><span class="crm-nav-label crm-nav-app">CRM</span></a>
      <button class="crm-nav-close" type="button" data-nav-close aria-label="Menu sluiten">${icon('close')}</button>
    </div>
    ${menu.map((group) => renderMainGroup(group, activeHref))}
    <div class="crm-nav-spacer"></div>
    ${renderBeheerEntry(user, page.path)}
    <button class="crm-nav-collapse" type="button" data-nav-compact aria-pressed="false" title="Zijbalk inklappen"><span class="crm-nav-ico">${icon('chevron-left')}</span><span class="crm-nav-label">Inklappen</span></button>
  </nav>
  <div class="crm-nav-backdrop" data-nav-close></div>`;
}

/**
 * De tweede zijbalk van Beheer: kop met de weg terug naar het CRM, zoekveld (recht `systeem`, werkt zonder JavaScript
 * via een GET) en de onderdelen per onderwerp. Op een smal scherm opent een knop met de naam van het huidige onderdeel
 * de lijst (`public/js/crm.js`); zonder JavaScript staat de lijst gewoon open.
 * @param {{user: object, path: string, beheer?: {groups?: object[], query?: string}}} page De gebruiker, het huidige pad
 *   en (op instellingenpagina's) de gefilterde groepen en zoekterm.
 * @returns {object} HTML.
 */
function renderBeheerSidebar(page) {
  const { user } = page;
  const beheer = page.beheer || {};
  const query = beheer.query || '';
  const groups = visibleBeheerMenu(user, beheer.groups || null, query);
  const activeHref = currentHref(groups, page.path);
  const activeItem = groups.flatMap((group) => group.items).find((item) => item.href === activeHref);
  const canSearch = roleHasRight(user.role, 'systeem');
  return html`<aside class="crm-sub" id="crm-sub" aria-label="Beheer"${query ? html` data-search="1"` : ''}>
    <div class="crm-sub-head">
      <a class="crm-sub-back" href="/app/">${icon('chevron-left')}<span>Terug naar het CRM</span></a>
      <p class="crm-sub-title">${icon('settings')}<span>Beheer</span></p>
    </div>
    <button class="crm-sub-toggle" type="button" data-sub-toggle aria-controls="crm-sub-body" aria-expanded="false"><span>${activeItem ? activeItem.label : 'Onderdelen van Beheer'}</span>${icon('chevron-down', { className: 'crm-nav-chevron' })}</button>
    <div class="crm-sub-body" id="crm-sub-body">
      ${canSearch ? html`<form class="crm-sub-search" method="get" action="/app/beheer/" role="search">
        ${icon('search')}
        <label class="visually-hidden" for="beheer-zoek">Zoeken in Beheer</label>
        <input id="beheer-zoek" class="crm-sub-search-input" type="search" name="zoek" value="${query}" maxlength="100" placeholder="Zoeken in Beheer">
      </form>` : ''}
      ${query && !groups.length ? html`<p class="crm-sub-empty">Niets gevonden voor “${query}”. <a href="/app/beheer/">Alles tonen</a></p>` : ''}
      ${groups.map((group) => renderNavGroup(group, activeHref, Boolean(query), 'crm-sub'))}
    </div>
  </aside>`;
}

/**
 * Het kruimelpad van een pagina: de groep en het onderdeel uit het menu, en de titel van de pagina als die afwijkt
 * (bijvoorbeeld een reis onder Reizen). In Beheer: Beheer en de titel. Een pagina buiten het menu heeft alleen de titel.
 * @param {object} user De ingelogde gebruiker.
 * @param {string} currentPath Huidig pad.
 * @param {string} title Titel van de pagina.
 * @returns {Array<{label: string, href?: string}>} De kruimels; alleen een kruimel met `href` is een link.
 */
function breadcrumbsFor(user, currentPath, title) {
  const beheerHref = beheerEntryHref(user);
  if (beheerHref && isBeheerPath(currentPath)) return [{ label: 'Beheer', href: beheerHref }, { label: title }];
  const menu = visibleCrmMenu(user);
  const activeHref = currentHref(menu, currentPath);
  const group = menu.find((candidate) => candidate.items.some((item) => item.href === activeHref));
  if (!group) return [{ label: title }];
  const item = group.items.find((candidate) => candidate.href === activeHref);
  const crumbs = group.title ? [{ label: group.title }] : [];
  if (item.label === title) return crumbs.concat({ label: title });
  return crumbs.concat({ label: item.label, href: item.href }, { label: title });
}

/**
 * De kopbalk van het CRM: menuknop en logo (smal scherm), het kruimelpad, een link naar de site en het gebruikersmenu.
 * Het gebruikersmenu is een `<details>` en werkt dus zonder JavaScript; `public/js/crm.js` sluit het bij een klik
 * ernaast of Esc. Zonder gebruiker (inloggen, installatie) alleen het logo.
 * @param {{user: (object|null), csrf?: string, path: string, title: string}} page De gebruiker, het CSRF-token voor
 *   de uitlogknop, het huidige pad en de titel.
 * @returns {object} HTML.
 */
function renderHeader(page) {
  const { user } = page;
  if (!user) {
    return html`<header class="crm-header"><div class="crm-header__inner">
        <a class="crm-brand" href="/app/"><img src="/images/logo.png" alt="Avanta reizen" width="68" height="40"> <span>CRM</span></a>
      </div></header>`;
  }
  const crumbs = breadcrumbsFor(user, page.path, page.title);
  const current = (prefix) => (page.path.startsWith(prefix) ? html` aria-current="page"` : '');
  return html`<header class="crm-header"><div class="crm-header__inner">
      <button class="crm-nav-toggle" type="button" data-nav-toggle aria-controls="crm-nav" aria-expanded="false" aria-label="Menu openen">${icon('menu')}</button>
      <a class="crm-brand" href="/app/"><img src="/images/logo.png" alt="Avanta reizen" width="68" height="40"> <span>CRM</span></a>
      <nav class="crm-crumbs" aria-label="Kruimelpad"><ol>${crumbs.map((crumb, index) => html`<li${index === crumbs.length - 1 ? html` aria-current="location"` : ''}>${crumb.href ? html`<a href="${crumb.href}">${crumb.label}</a>` : crumb.label}</li>`)}</ol></nav>
      <a class="crm-header-site" href="/">Bekijk de site</a>
      <details class="crm-user">
        <summary class="crm-user-button"><span class="crm-user-ico">${icon('user')}</span><span class="crm-user-name">${user.name} <span class="crm-user-role">${roleLabel(user.role)}</span></span>${icon('chevron-down', { className: 'crm-user-chevron' })}</summary>
        <div class="crm-user-menu">
          <a class="crm-user-item crm-user-item--site" href="/">${icon('home')}<span>Bekijk de site</span></a>
          <a class="crm-user-item" href="/app/wachtwoord/"${current('/app/wachtwoord/')}>${icon('user')}<span>Wachtwoord wijzigen</span></a>
          <a class="crm-user-item" href="/app/tweestaps/"${current('/app/tweestaps/')}>${icon('lock')}<span>Tweestapsverificatie</span></a>
          <form class="crm-user-logout" method="post" action="/app/uitloggen/"><input type="hidden" name="_csrf" value="${page.csrf || ''}"><button class="crm-user-item" type="submit">${icon('logout')}<span>Uitloggen</span></button></form>
        </div>
      </details>
    </div></header>`;
}

/**
 * De kop van een pagina: de titel met rechts de acties van de pagina (zie `renderActions` in `crm/ui.js`).
 * @param {{title: string, actions?: object}} page Pagina.
 * @returns {object} HTML.
 */
function renderPageHead(page) {
  return html`<div class="crm-pagehead"><h1 class="crm-title">${page.title}</h1>${page.actions || ''}</div>`;
}

/**
 * Maakt een volledige CRM-pagina.
 * @param {{title: string, body: object, user?: (object|null), csrf?: string, path?: string, beheer?: object, actions?: object}} page
 *   Titel, inhoud, de ingelogde gebruiker (zonder: geen zijbalk), het CSRF-token voor de uitlogknop, het huidige pad
 *   (een menu-item is actief op zijn eigen pad en alles eronder; het langste item wint; een pad van Beheer krijgt de
 *   tweede zijbalk) en op instellingenpagina's de gefilterde groepen en zoekterm (`{groups, query}`).
 * @returns {string} De HTML.
 */
function renderCrmPage(page) {
  const user = page.user || null;
  const path = page.path || '';
  const inBeheer = Boolean(user) && isBeheerPath(path) && Boolean(beheerEntryHref(user));
  return '<!doctype html>\n' + toString(html`<html lang="nl-NL">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${page.title} - Avanta CRM</title>
  <link rel="icon" type="image/png" href="/images/favicon.png">
  <link rel="stylesheet" href="/css/site.css?v=${ASSET_VERSION}">
  <link rel="stylesheet" href="/css/crm.css?v=${ASSET_VERSION}">
</head>
<body class="crm${user ? ' crm--nav' : ''}${inBeheer ? ' crm--beheer' : ''}">
  <a class="skip-link" href="#inhoud">Naar de inhoud</a>
  <div class="crm-page">
    ${renderMaintenanceBanner()}
    ${renderHeader({ user, csrf: page.csrf, path, title: page.title })}
    ${user ? html`${renderSidebar({ user, path })}
    <script src="/js/crm.js?v=${ASSET_VERSION}"></script>` : ''}
    <main id="inhoud" class="crm-main${inBeheer ? ' crm-main--beheer' : ''}">
      ${inBeheer ? html`<div class="crm-beheer">
        ${renderBeheerSidebar({ user, path, beheer: page.beheer })}
        <div class="crm-beheer-main">
          ${renderPageHead(page)}
          ${page.body}
        </div>
      </div>` : html`${renderPageHead(page)}
      ${page.body}`}
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

module.exports = { renderCrmPage, renderInput, renderAlert, formatDateTime, CRM_MENU, isBeheerPath, breadcrumbsFor };
