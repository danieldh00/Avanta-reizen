// @ts-check
/**
 * Gedeelde bouwstenen voor de schermen van het CRM.
 * - Lijsten: paginakop met acties, filterknoppen, zoekregel, tabel, statuslabel en bladeren.
 * - Bewerkschermen: tabbladen (`renderTabNav` met `renderTabPanel`) en een vaste opslaanbalk (`renderSaveBar`).
 * Elk scherm gebruikt dezelfde opzet, zodat schermen er overal gelijk uitzien en zich gelijk gedragen.
 * Alle uitvoer loopt via `html`, dus waarden worden altijd ge-escaped.
 */

const { html, raw } = require('../site/html');

/**
 * Bouwt een querystring uit de gevulde waarden (lege waarden vallen weg).
 * @param {Record<string, (string|number|null|undefined)>} params Parameters.
 * @returns {string} Querystring zonder vraagteken; leeg als er niets gevuld is.
 */
function queryString(params) {
  const filled = Object.entries(params).filter(([, value]) => value !== null && value !== undefined && value !== '');
  return new URLSearchParams(filled.map(([key, value]) => [key, String(value)])).toString();
}

/**
 * Een adres met querystring; zonder gevulde parameters alleen het adres.
 * @param {string} base Adres van de lijst.
 * @param {Record<string, (string|number|null|undefined)>} params Parameters.
 * @returns {string} Adres.
 */
function listUrl(base, params) {
  const query = queryString(params);
  return query ? `${base}?${query}` : base;
}

/**
 * Een statuslabel.
 * @param {string} kind Soort (bepaalt de kleur via `crm-status--<soort>`); alleen letters, cijfers en streepjes.
 * @param {string} label Tekst.
 * @returns {object} HTML.
 */
function renderStatus(kind, label) {
  const modifier = /^[a-z0-9-]{1,40}$/.test(String(kind)) ? String(kind) : 'onbekend';
  return html`<span class="crm-status crm-status--${modifier}">${label}</span>`;
}

/**
 * De acties rechts van de paginatitel (knoppen en links).
 * @param {{label: string, href: string, primary?: boolean}[]} actions Acties; lege waarden worden overgeslagen.
 * @returns {(object|string)} HTML, of een lege tekst als er geen acties zijn.
 */
function renderActions(actions) {
  const list = (actions || []).filter(Boolean);
  if (!list.length) return '';
  return html`<div class="crm-actions">${list.map((action) => html`<a class="btn btn--small${action.primary ? '' : ' btn--outline'}" href="${action.href}">${action.label}</a>`)}</div>`;
}

/**
 * Filterknoppen boven een lijst: één keuze is actief, de andere parameters van de lijst blijven behouden.
 * @param {{base: string, name: string, current: string, options: {value: string, label: string, count?: number}[],
 *   params?: Record<string, (string|number|null|undefined)>, label?: string}} filter Adres van de lijst, naam van de
 *   parameter, de actieve waarde, de keuzes (met eventueel een aantal) en de overige parameters.
 * @returns {object} HTML.
 */
function renderFilterTabs(filter) {
  return html`<nav class="crm-tabs" aria-label="${filter.label || 'Filter'}"><ul>${filter.options.map((option) => html`<li>
    <a href="${listUrl(filter.base, { ...(filter.params || {}), [filter.name]: option.value })}"${option.value === filter.current ? raw(' aria-current="true"') : ''}>${option.label}${Number.isInteger(option.count) ? html` <span class="crm-tabs-count">${option.count}</span>` : ''}</a>
  </li>`)}</ul></nav>`;
}

/**
 * De zoek- en filterregel van een lijst.
 * @param {{action: string, label: string, value: string, hidden?: Record<string, (string|number|null|undefined)>,
 *   extra?: object, submitLabel?: string}} search Adres, label van het zoekveld, de zoektekst, verborgen parameters
 *   (bijvoorbeeld het actieve filter), extra velden en de tekst op de knop.
 * @returns {object} HTML.
 */
function renderSearch(search) {
  const hidden = Object.entries(search.hidden || {}).filter(([, value]) => value !== null && value !== undefined && value !== '');
  return html`<form class="crm-search" method="get" action="${search.action}" role="search">
    ${hidden.map(([name, value]) => html`<input type="hidden" name="${name}" value="${String(value)}">`)}
    <label for="veld-q">${search.label}</label>
    <input id="veld-q" name="q" type="search" value="${search.value}" maxlength="100">
    ${search.extra || ''}
    <button class="btn btn--small btn--outline" type="submit">${search.submitLabel || 'Zoeken'}</button>
  </form>`;
}

/**
 * Een tabel met kolomkoppen, of de melding dat er niets is.
 * @param {{columns: {label: string, cell: (row: object) => (object|string|number), numeric?: boolean}[], rows: object[],
 *   empty: string, caption?: string}} table Kolommen (met per kolom de inhoud van een cel), rijen, de melding bij een
 *   lege lijst en een onzichtbaar bijschrift.
 * @returns {object} HTML.
 */
function renderTable(table) {
  if (!table.rows.length) return html`<p class="crm-empty">${table.empty}</p>`;
  return html`<div class="crm-table-wrap"><table class="crm-table">
    ${table.caption ? html`<caption class="visually-hidden">${table.caption}</caption>` : ''}
    <thead><tr>${table.columns.map((column) => html`<th scope="col"${column.numeric ? raw(' class="crm-num"') : ''}>${column.label}</th>`)}</tr></thead>
    <tbody>${table.rows.map((row) => html`<tr>${table.columns.map((column) => html`<td${column.numeric ? raw(' class="crm-num"') : ''}>${column.cell(row)}</td>`)}</tr>`)}</tbody>
  </table></div>`;
}

/**
 * Bladeren onder een lijst: vorige en volgende pagina met behoud van de filters.
 * @param {{base: string, params?: Record<string, (string|number|null|undefined)>, page: number, hasNext: boolean}} pager
 *   Adres van de lijst, de filters, de huidige pagina en of er een volgende is.
 * @returns {(object|string)} HTML, of een lege tekst als er maar één pagina is.
 */
function renderPager(pager) {
  if (pager.page <= 1 && !pager.hasNext) return '';
  const link = (page) => listUrl(pager.base, { ...(pager.params || {}), pagina: page > 1 ? page : '' });
  return html`<nav class="crm-pager" aria-label="Bladeren">
    ${pager.page > 1 ? html`<a class="btn btn--small btn--outline" href="${link(pager.page - 1)}" rel="prev">Vorige</a>` : html`<span class="crm-pager-off">Vorige</span>`}
    <span class="crm-pager-page">Pagina ${pager.page}</span>
    ${pager.hasNext ? html`<a class="btn btn--small btn--outline" href="${link(pager.page + 1)}" rel="next">Volgende</a>` : html`<span class="crm-pager-off">Volgende</span>`}
  </nav>`;
}

/**
 * Controleert de sleutel van een tabblad; die komt in een id en een adres.
 * @param {string} key Sleutel.
 * @returns {string} De sleutel.
 * @throws {Error} Als de sleutel iets anders bevat dan kleine letters, cijfers en streepjes.
 */
function checkedTabKey(key) {
  if (!/^[a-z0-9-]{1,40}$/.test(String(key))) throw new Error('Ongeldige sleutel voor een tabblad.');
  return String(key);
}

/**
 * De tabbladen van een bewerkscherm: links naar de panelen op dezelfde pagina. Het omsluitende element krijgt
 * `data-tabs`; `public/js/crm.js` toont dan één paneel tegelijk. Zonder JavaScript staan alle panelen onder elkaar en
 * springen de links naar het paneel.
 * @param {{key: string, label: string, count?: number}[]} tabs De tabbladen in volgorde; lege waarden vallen weg.
 * @param {string} [label] Naam van de navigatie voor schermlezers.
 * @returns {object} HTML.
 */
function renderTabNav(tabs, label = 'Onderdelen') {
  return html`<nav class="crm-tabs crm-tabs--edit" aria-label="${label}"><ul>${tabs.filter(Boolean).map((tab) => html`<li>
    <a href="#tab-${checkedTabKey(tab.key)}" data-tab="${checkedTabKey(tab.key)}">${tab.label}${Number.isInteger(tab.count) ? html` <span class="crm-tabs-count">${tab.count}</span>` : ''}</a>
  </li>`)}</ul></nav>`;
}

/**
 * Eén paneel bij een tabblad.
 * @param {string} key Sleutel van het tabblad (gelijk aan die in `renderTabNav`).
 * @param {object} body Inhoud van het paneel.
 * @returns {object} HTML.
 */
function renderTabPanel(key, body) {
  return html`<div class="crm-tabpanel" id="tab-${checkedTabKey(key)}" data-tab-panel="${checkedTabKey(key)}">${body}</div>`;
}

/**
 * De vaste balk onderaan een formulier met de knop om op te slaan. Hoort binnen het `<form>`.
 * @param {{label: string, note?: (object|string)}} bar Tekst op de knop en een toelichting links ervan.
 * @returns {object} HTML.
 */
function renderSaveBar(bar) {
  return html`<div class="crm-savebar">
    <span class="crm-savebar-note">${bar.note || ''}</span>
    <button class="btn" type="submit">${bar.label}</button>
  </div>`;
}

module.exports = { queryString, listUrl, renderStatus, renderActions, renderFilterTabs, renderSearch, renderTable, renderPager, renderTabNav, renderTabPanel, renderSaveBar };
