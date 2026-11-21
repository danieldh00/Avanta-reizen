/**
 * Paginaopbouw van het CRM onder `/app/`: compacte kop met logo, menu op basis van de rechten van de gebruiker en
 * uitlogknop. Zelfde huisstijl als de site (`site.css`), nooit indexeerbaar.
 */
const { html, toString } = require('../site/html');
const { roleHasRight, roleHasGlobalRight, roleLabel } = require('./rights');
const { renderMaintenanceBanner } = require('../site/layout');

/** Versie van de statische bestanden, tegen verouderde caches. */
const ASSET_VERSION = require('../../package.json').version;

/** Menu van het CRM; een item verschijnt alleen als de gebruiker het recht heeft (de server controleert opnieuw). `global`: niet voor rollen die tot eigen vertrekken beperkt zijn. */
const CRM_MENU = [
  { label: 'Overzicht', href: '/app/' },
  { label: 'Deelnemers', href: '/app/deelnemers/', right: 'deelnemers', global: true },
  { label: 'Gebruikers', href: '/app/gebruikers/', right: 'gebruikers' },
  { label: 'Auditlog', href: '/app/auditlog/', right: 'gebruikers' },
  { label: 'Beheer', href: '/app/beheer/', right: 'systeem' },
];

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
 * Maakt een volledige CRM-pagina.
 * @param {{title: string, body: object, user?: (object|null), csrf?: string, path?: string}} page Titel,
 *   inhoud, de ingelogde gebruiker (zonder: geen menu), het CSRF-token voor de uitlogknop en het huidige pad (een
 *   menu-item is actief op zijn eigen pad en alles eronder).
 * @returns {string} De HTML.
 */
function renderCrmPage(page) {
  const user = page.user || null;
  const currentPath = page.path || '';
  const isCurrent = (href) => (href === '/app/' ? currentPath === href : currentPath.startsWith(href));
  const menu = user ? CRM_MENU.filter((item) => !item.right || (item.global ? roleHasGlobalRight : roleHasRight)(user.role, item.right)) : [];
  return '<!doctype html>\n' + toString(html`<html lang="nl-NL">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${page.title} - Avanta CRM</title>
  <link rel="icon" type="image/png" href="/images/favicon.png">
  <link rel="stylesheet" href="/css/site.css?v=${ASSET_VERSION}">
</head>
<body class="crm">
  <a class="skip-link" href="#inhoud">Naar de inhoud</a>
  ${renderMaintenanceBanner()}
  <header class="crm-header">
    <div class="container crm-header__inner">
      <a class="crm-brand" href="/app/"><img src="/images/logo.png" alt="Avanta reizen" width="80" height="47"> <span>CRM</span></a>
      ${menu.length ? html`<nav class="crm-nav" aria-label="CRM-menu"><ul>${menu.map((item) => html`<li><a href="${item.href}"${isCurrent(item.href) ? html` aria-current="page"` : ''}>${item.label}</a></li>`)}</ul></nav>` : ''}
      ${user ? html`<div class="crm-user">
        <a href="/app/wachtwoord/" title="Wachtwoord wijzigen">${user.name}</a> <span class="crm-user__role">${roleLabel(user.role)}</span>
        <form method="post" action="/app/uitloggen/"><input type="hidden" name="_csrf" value="${page.csrf || ''}"><button class="btn btn--outline btn--small" type="submit">Uitloggen</button></form>
      </div>` : ''}
    </div>
  </header>
  <main id="inhoud" class="container crm-main">
    <h1 class="crm-title">${page.title}</h1>
    ${page.body}
  </main>
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
