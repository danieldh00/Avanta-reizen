/**
 * Opschonen van opgemaakte tekst voor de teksteditor van het CRM (`rich-editor.js`). Zet een boom van knopen (uit de
 * editor, uit geplakte HTML of uit de opgeslagen tekst) om naar nette HTML met alleen de opmaak die de server ook
 * toelaat (`tools/import/sanitize.js`): alinea's, kopjes, vet, cursief, lijsten, citaten, links, tabellen en
 * afbeeldingen. Losse tekst op het hoogste niveau komt in een alinea, `<b>`/`<i>` worden `<strong>`/`<em>`, een `<div>`
 * wordt een alinea en `<span>` met vet of cursief (zoals uit een tekstverwerker) wordt `<strong>`/`<em>`.
 *
 * Dit is gemak voor de gebruiker, geen beveiliging: de server schoont de HTML bij het opslaan altijd zelf op.
 * Werkt zowel op knopen van de browser (DOM) als op die van node-html-parser, zodat de tests het zonder browser
 * kunnen controleren. In de browser staat de functie op `window.AvantaRichText`, in Node via `require`.
 */
(function exposeRichTextClean(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AvantaRichText = api;
}(typeof self !== 'undefined' ? self : this, function createRichTextClean() {
  'use strict';

  /** Toegestane tags met hun attributen; gelijk aan de allowlist van de server. */
  const ALLOWED = {
    p: [], br: [], hr: [], h2: [], h3: [], h4: [], h5: [], ul: [], ol: [], li: [],
    strong: [], em: [], u: [], sup: [], sub: [], blockquote: [], figure: [], figcaption: [],
    table: [], thead: [], tbody: [], tr: [], th: ['colspan', 'rowspan'], td: ['colspan', 'rowspan'],
    a: ['href', 'title'], img: ['src', 'alt', 'width', 'height'],
  };

  /** Tags die een andere naam krijgen. */
  const RENAMED = { b: 'strong', i: 'em', h1: 'h2', h6: 'h5' };

  /** Tags die met inhoud en al verdwijnen. */
  const DROPPED = ['script', 'style', 'noscript', 'form', 'input', 'button', 'select', 'textarea', 'object', 'embed', 'svg', 'link', 'meta', 'template', 'iframe', 'head', 'title'];

  /** Blokelementen: die staan nooit binnen een alinea. */
  const BLOCKS = ['p', 'h2', 'h3', 'h4', 'h5', 'ul', 'ol', 'li', 'blockquote', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'div'];

  /** Elementen waarbinnen losse tekst niet in een alinea hoeft (ze zijn zelf al een blok met tekst). */
  const TEXT_CONTAINERS = ['li', 'blockquote', 'td', 'th', 'figcaption'];

  /**
   * Escapet tekst voor HTML-inhoud.
   * @param {string} value Tekst.
   * @returns {string} Ge-escapete tekst.
   */
  function escapeText(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00a0/g, '&nbsp;');
  }

  /**
   * Escapet tekst voor een attribuut tussen dubbele aanhalingstekens.
   * @param {string} value Waarde.
   * @returns {string} Ge-escapete waarde.
   */
  function escapeAttribute(value) {
    return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * Controleert een linkadres: http(s), mailto, tel of een adres op de eigen site (zoals de server).
   * @param {string} url Adres.
   * @returns {boolean} Waar als het adres mag.
   */
  function isSafeUrl(url) {
    const trimmed = String(url || '').trim();
    if (!trimmed) return false;
    if (/^(https?:|mailto:|tel:)/i.test(trimmed)) return true;
    return /^[/#?]/.test(trimmed) && !trimmed.startsWith('//');
  }

  /**
   * De tagnaam van een knoop in kleine letters (DOM en node-html-parser).
   * @param {object} node Knoop.
   * @returns {string} Tagnaam of ''.
   */
  function tagOf(node) {
    return String(node.tagName || node.rawTagName || '').toLowerCase();
  }

  /**
   * Een attribuut van een knoop, of '' als het ontbreekt.
   * @param {object} node Knoop.
   * @param {string} name Naam van het attribuut.
   * @returns {string} Waarde.
   */
  function attributeOf(node, name) {
    const value = node.getAttribute ? node.getAttribute(name) : null;
    return value == null ? '' : String(value);
  }

  /**
   * De kinderen van een knoop als lijst.
   * @param {object} node Knoop.
   * @returns {object[]} Kinderen.
   */
  function childrenOf(node) {
    return Array.prototype.slice.call(node.childNodes || []);
  }

  /**
   * De toegestane attributen van een element als tekst (met spatie ervoor), of null als het element zonder zijn
   * verplichte attribuut niet kan bestaan (een afbeelding zonder geldig adres).
   * @param {object} node Element.
   * @param {string} tag Tag na hernoemen.
   * @returns {string|null} Attributen.
   */
  function attributesFor(node, tag) {
    const parts = [];
    for (const name of ALLOWED[tag]) {
      const value = attributeOf(node, name).trim();
      if (!value) continue;
      if (name === 'href' && !isSafeUrl(value)) continue;
      if (name === 'src' && !/^https?:/i.test(value) && !value.startsWith('/')) continue;
      if (['width', 'height', 'colspan', 'rowspan'].indexOf(name) > -1 && !/^\d{1,4}$/.test(value)) continue;
      parts.push(` ${name}="${escapeAttribute(value)}"`);
    }
    if (tag === 'img') {
      if (!parts.some((part) => part.startsWith(' src='))) return null;
      if (!parts.some((part) => part.startsWith(' alt='))) parts.push(' alt=""');
    }
    return parts.join('');
  }

  /**
   * Zet een rij delen om naar HTML; losse (inline) delen komen samen in een alinea als `wrap` waar is. Een rij met
   * alleen witruimte en regeleinden verdwijnt.
   * @param {{html: string, block: boolean}[]} parts Delen.
   * @param {boolean} wrap Losse tekst in `<p>` zetten.
   * @returns {string} HTML.
   */
  function joinParts(parts, wrap) {
    if (!wrap) return parts.map((part) => part.html).join('');
    let output = '';
    let run = '';
    const flush = () => {
      if (run.replace(/&nbsp;|\s|<br>/g, '')) output += `<p>${run.trim().replace(/^(<br>)+|(<br>)+$/g, '')}</p>`;
      run = '';
    };
    for (const part of parts) {
      if (part.block) { flush(); output += part.html; } else run += part.html;
    }
    flush();
    return output;
  }

  /**
   * Zet een knoop om naar delen veilige HTML.
   * @param {object} node Knoop.
   * @param {boolean} inline Waar als de knoop binnen een alinea, kop of ander tekstelement staat.
   * @returns {{html: string, block: boolean}[]} Delen.
   */
  function convert(node, inline) {
    if (node.nodeType === 3) {
      const text = node.nodeValue != null ? node.nodeValue : node.text;
      // Een losse harde spatie (die de browser bij typen zet, bijv. voor vet) wordt een gewone spatie.
      const plain = String(text).replace(/[\r\n\t]+/g, ' ').replace(/(^|[^ \u00a0])\u00a0(?=[^ \u00a0]|$)/g, '$1 ');
      return [{ html: escapeText(plain), block: false }];
    }
    if (node.nodeType !== 1) return [];
    const original = tagOf(node);
    if (DROPPED.indexOf(original) > -1) return [];
    const childParts = (childInline) => childrenOf(node).reduce((all, child) => all.concat(convert(child, childInline)), []);

    if (original === 'div') {
      const parts = childParts(inline);
      // Binnen tekst of met eigen blokken: alleen de inhoud. Anders wordt de div een alinea.
      if (inline || parts.some((part) => part.block)) return parts;
      return [{ html: joinParts(parts, true), block: true }];
    }
    if (original === 'span' || original === 'font') {
      const style = attributeOf(node, 'style').replace(/\s/g, '').toLowerCase();
      let inner = joinParts(childParts(true), false);
      if (/font-style:italic/.test(style)) inner = `<em>${inner}</em>`;
      if (/font-weight:(bold|[6-9]00)/.test(style)) inner = `<strong>${inner}</strong>`;
      return [{ html: inner, block: false }];
    }

    const tag = RENAMED[original] || original;
    if (!ALLOWED[tag]) return childParts(inline);
    const attributes = attributesFor(node, tag);
    if (attributes === null) return [];
    // Een link zonder (veilig) adres: alleen de tekst.
    if (tag === 'a' && attributes.indexOf(' href=') === -1) return childParts(inline);
    if (tag === 'br' || tag === 'hr') return [{ html: `<${tag}>`, block: tag === 'hr' }];
    if (tag === 'img') return [{ html: `<img${attributes}>`, block: false }];
    const block = BLOCKS.indexOf(tag) > -1;

    if (['ul', 'ol', 'table', 'thead', 'tbody', 'tr'].indexOf(tag) > -1) {
      const inner = joinParts(childParts(false).filter((part) => part.block), false);
      return inner ? [{ html: `<${tag}${attributes}>${inner}</${tag}>`, block: true }] : [];
    }
    if (TEXT_CONTAINERS.indexOf(tag) > -1 || tag === 'figure') {
      return [{ html: `<${tag}${attributes}>${joinParts(childParts(false), false).trim()}</${tag}>`, block: true }];
    }
    const parts = childParts(true);
    if (parts.some((part) => part.block)) {
      // Blokken binnen een alinea, kop, vet of link (geplakte rommel): de alinea splitst, de opmaak eromheen vervalt.
      return block ? [{ html: joinParts(parts, true), block: true }] : parts;
    }
    const joined = joinParts(parts, false);
    // Spaties aan de rand van vet of cursief horen bij de zin; alleen bij een blok vallen ze (en een laatste <br>) weg.
    const inner = block ? joined.trim().replace(/(<br>)+$/, '') : joined;
    if (block && !inner.replace(/&nbsp;|\s|<br>/g, '')) return [];
    if (!block && !inner.trim()) return [];
    return [{ html: `<${tag}${attributes}>${inner}</${tag}>`, block }];
  }

  /**
   * Schoont een rij knopen op (de inhoud van de editor of van een geplakt stuk) tot nette HTML.
   * @param {ArrayLike<object>} nodes Knopen.
   * @returns {string} HTML met alleen toegestane opmaak; losse tekst staat in alinea's.
   */
  function cleanNodes(nodes) {
    const parts = Array.prototype.slice.call(nodes || []).reduce((all, node) => all.concat(convert(node, false)), []);
    return joinParts(parts, true);
  }

  /**
   * Zet platte tekst (geplakt zonder opmaak) om naar alinea's: een lege regel begint een nieuwe alinea, een enkel
   * regeleinde wordt `<br>`.
   * @param {string} text Tekst.
   * @returns {string} HTML.
   */
  function textToHtml(text) {
    return String(text || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .map((paragraph) => `<p>${paragraph.split('\n').map(escapeText).join('<br>')}</p>`)
      .join('');
  }

  return { cleanNodes, textToHtml, isSafeUrl, escapeText };
}));
