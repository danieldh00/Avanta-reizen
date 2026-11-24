// @ts-check
/**
 * Veilig HTML opbouwen: elke ingevoegde waarde wordt ge-escaped, tenzij die bewust als `raw()` is gemarkeerd
 * (alleen voor HTML die we zelf hebben opgeschoond, zoals geïmporteerde content).
 */

const RAW = Symbol('raw-html');

/**
 * Escapet tekst voor gebruik in HTML (inhoud en attributen).
 * @param {*} value De waarde.
 * @returns {string} Ge-escapete tekst.
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Markeert HTML als veilig, zodat `html` hem niet opnieuw escapet.
 * @param {string} markup Vertrouwde HTML.
 * @returns {{[RAW]: string}} Gemarkeerde HTML.
 */
function raw(markup) {
  return { [RAW]: String(markup ?? '') };
}

/**
 * Zet één ingevoegde waarde om naar HTML: arrays worden samengevoegd, raw blijft zoals het is, de rest wordt ge-escaped.
 * @param {*} value De waarde.
 * @returns {string} HTML.
 */
function renderValue(value) {
  if (value === null || value === undefined || value === false) return '';
  if (Array.isArray(value)) return value.map(renderValue).join('');
  if (typeof value === 'object' && RAW in value) return value[RAW];
  return escapeHtml(value);
}

/**
 * Tagged template voor HTML: `html\`<p>${naam}</p>\`` escapet `naam`. Het resultaat is zelf raw, zodat het
 * genest kan worden.
 * @param {TemplateStringsArray} strings Vaste delen.
 * @param {...*} values Ingevoegde waarden.
 * @returns {{[RAW]: string}} De HTML.
 */
function html(strings, ...values) {
  let output = strings[0];
  for (let i = 0; i < values.length; i++) output += renderValue(values[i]) + strings[i + 1];
  return raw(output);
}

/**
 * Geeft de HTML-tekst van een (geneste) html-waarde.
 * @param {*} value Resultaat van `html` of `raw`.
 * @returns {string} HTML-tekst.
 */
function toString(value) {
  return renderValue(value);
}

module.exports = { escapeHtml, raw, html, toString };
