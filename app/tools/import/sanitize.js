/**
 * Schoont geïmporteerde WordPress-HTML op met een allowlist: alleen opmaak-tags en veilige attributen blijven over,
 * scripts/iframes/formulieren verdwijnen, links en afbeeldingen worden herschreven naar de nieuwe site.
 */
const { parse } = require('node-html-parser');

/** Tags die blijven (met hun toegestane attributen). */
const ALLOWED_TAGS = {
  p: [], br: [], hr: [], h2: [], h3: [], h4: [], h5: [], ul: [], ol: [], li: [],
  strong: [], b: [], em: [], i: [], u: [], sup: [], sub: [], blockquote: [], figure: [], figcaption: [],
  table: [], thead: [], tbody: [], tr: [], th: ['colspan', 'rowspan'], td: ['colspan', 'rowspan'],
  a: ['href', 'title'], img: ['src', 'alt', 'width', 'height'],
};

/** Tags die met inhoud en al verdwijnen. */
const DROPPED_TAGS = new Set(['script', 'style', 'noscript', 'form', 'input', 'button', 'select', 'textarea', 'object', 'embed', 'svg', 'link', 'meta', 'template']);

/** Tags die worden omgezet naar een andere tag. */
const RENAMED_TAGS = { h1: 'h2', h6: 'h5' };

/**
 * Controleert of een link-URL veilig is (http(s), mailto, tel of relatief).
 * @param {string} url De URL.
 * @returns {boolean} Waar als de URL is toegestaan.
 */
function isSafeUrl(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return false;
  if (/^(https?:|mailto:|tel:)/i.test(trimmed)) return true;
  return /^[/#?]/.test(trimmed) && !trimmed.startsWith('//');
}

/**
 * Escapet tekst voor een HTML-attribuut.
 * @param {string} value De waarde.
 * @returns {string} Ge-escapete waarde.
 */
function escapeAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Escapet tekst voor HTML-inhoud.
 * @param {string} value De tekst.
 * @returns {string} Ge-escapete tekst.
 */
function escapeText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Schoont een HTML-fragment op.
 * @param {string} markup De ruwe HTML.
 * @param {{rewriteLink?: (url: string) => string, rewriteImage?: (url: string) => string}} [options] Herschrijvers voor URL's.
 * @returns {string} Veilige HTML.
 */
function sanitizeHtml(markup, options = {}) {
  const rewriteLink = options.rewriteLink || ((url) => url);
  const rewriteImage = options.rewriteImage || ((url) => url);
  const root = parse(String(markup || ''), { comment: false, blockTextElements: { script: true, style: true, noscript: true, pre: true } });

  /**
   * Zet een knoop (en zijn kinderen) om naar veilige HTML.
   * @param {object} node Knoop uit node-html-parser.
   * @returns {string} HTML.
   */
  const renderNode = (node) => {
    if (node.nodeType === 3) return escapeText(node.text);
    if (node.nodeType !== 1) return '';
    const tag = (node.rawTagName || '').toLowerCase();
    if (DROPPED_TAGS.has(tag)) return '';
    const children = () => node.childNodes.map(renderNode).join('');
    if (tag === 'iframe') {
      const source = node.getAttribute('src') || '';
      return isSafeUrl(source) && /^https?:/i.test(source) ? `<p><a href="${escapeAttribute(source)}" rel="noopener" target="_blank">Bekijk de video</a></p>` : '';
    }
    // Fotogalerijen (slider in WordPress) worden een eenvoudig raster.
    if (tag === 'div' && /slick-slider(?!__)|gallery/.test(node.getAttribute('class') || '') && !node.closest?.('.gallery')) {
      return `<div class="gallery">${children()}</div>`;
    }
    const finalTag = RENAMED_TAGS[tag] || tag;
    const allowed = ALLOWED_TAGS[finalTag];
    if (!allowed) return children();

    const attributes = [];
    for (const name of allowed) {
      let value = node.getAttribute(name);
      if (value === undefined || value === null || value === '') continue;
      if (name === 'href') {
        if (!isSafeUrl(value)) continue;
        value = rewriteLink(value.trim());
      }
      if (name === 'src') {
        if (!/^https?:/i.test(value) && !value.startsWith('/')) continue;
        value = rewriteImage(value.trim());
      }
      if ((name === 'width' || name === 'height' || name === 'colspan' || name === 'rowspan') && !/^\d{1,4}$/.test(value)) continue;
      attributes.push(`${name}="${escapeAttribute(value)}"`);
    }
    if (finalTag === 'img') {
      if (!attributes.some((attribute) => attribute.startsWith('src='))) return '';
      if (!attributes.some((attribute) => attribute.startsWith('alt='))) attributes.push('alt=""');
      attributes.push('loading="lazy"');
      return `<img ${attributes.join(' ')}>`;
    }
    if (finalTag === 'a' && /^https?:/i.test(node.getAttribute('href') || '') && (node.getAttribute('target') === '_blank')) {
      attributes.push('target="_blank"', 'rel="noopener"');
    }
    if (finalTag === 'br' || finalTag === 'hr') return `<${finalTag}>`;
    const inner = children();
    if (finalTag === 'p' && !inner.replace(/&nbsp;|\s|<br>/g, '')) return '';
    return `<${finalTag}${attributes.length ? ` ${attributes.join(' ')}` : ''}>${inner}</${finalTag}>`;
  };

  return root.childNodes.map(renderNode).join('').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Haalt platte tekst uit HTML (voor samenvattingen).
 * @param {string} markup HTML.
 * @returns {string} Tekst met enkele spaties.
 */
function plainText(markup) {
  return parse(String(markup || '')).text.replace(/\s+/g, ' ').trim();
}

module.exports = { sanitizeHtml, plainText, isSafeUrl };
