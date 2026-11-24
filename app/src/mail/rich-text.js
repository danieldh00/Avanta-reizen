// @ts-check
/**
 * Opgemaakte tekst (HTML uit de teksteditor van het CRM) geschikt maken voor een e-mail: opnieuw opschonen met de
 * allowlist van de site (`sanitizeHtml`), links en afbeeldingen met een pad op de eigen site omzetten naar een volledig
 * adres (een mailprogramma kent het basisadres niet), inline stijlen per tag toevoegen (mailprogramma's negeren een
 * stylesheet) en een platte-tekstversie maken. De invoer wordt nooit vertrouwd: ook al opgeschoonde HTML gaat hier
 * opnieuw door `sanitizeHtml`.
 */
const { parse } = require('node-html-parser');
const { sanitizeHtml } = require('../../tools/import/sanitize');

/** Lettertype en kleur van de tekst in de mail (gelijk aan `renderMail`). */
const FONT = 'font-family:Arial,Helvetica,sans-serif;color:#434248;';

/** Inline stijl per tag in de mail. */
const TAG_STYLES = {
  p: `margin:0 0 12px;${FONT}font-size:14px;line-height:21px;`,
  h2: `margin:16px 0 8px;${FONT}font-size:18px;line-height:24px;font-weight:bold;`,
  h3: `margin:14px 0 6px;${FONT}font-size:16px;line-height:22px;font-weight:bold;`,
  h4: `margin:12px 0 6px;${FONT}font-size:14px;line-height:20px;font-weight:bold;`,
  h5: `margin:12px 0 6px;${FONT}font-size:14px;line-height:20px;font-weight:bold;`,
  ul: `margin:0 0 12px;padding-left:22px;${FONT}font-size:14px;line-height:21px;`,
  ol: `margin:0 0 12px;padding-left:22px;${FONT}font-size:14px;line-height:21px;`,
  li: 'margin:0 0 4px;',
  blockquote: `margin:0 0 12px;padding:8px 12px;border-left:3px solid #e4e2df;${FONT}font-size:14px;line-height:21px;`,
  table: 'border-collapse:collapse;margin:0 0 12px;',
  th: `padding:4px 8px;border:1px solid #e4e2df;text-align:left;${FONT}font-size:14px;`,
  td: `padding:4px 8px;border:1px solid #e4e2df;vertical-align:top;${FONT}font-size:14px;`,
  a: 'color:#a95c4c;text-decoration:underline;',
  img: 'display:block;max-width:100%;height:auto;border:0;margin:0 0 12px;',
  hr: 'border:0;border-top:1px solid #e4e2df;margin:16px 0;',
};

/** Tags die in de platte tekst een nieuwe alinea beginnen. */
const BLOCK_TAGS = new Set(['p', 'h2', 'h3', 'h4', 'h5', 'ul', 'ol', 'blockquote', 'table', 'figure', 'hr']);

/**
 * Maakt van een pad op de eigen site een volledig adres; volledige adressen, `mailto:`, `tel:` en ankers blijven gelijk.
 * @param {string} siteUrl Basisadres van de site zonder `/` aan het eind (bijv. `https://www.avantareizen.nl`).
 * @param {string} url Adres uit de tekst (al gecontroleerd door `sanitizeHtml`).
 * @returns {string} Het adres voor in de mail.
 */
function absoluteMailUrl(siteUrl, url) {
  const value = String(url || '').trim();
  if (!value.startsWith('/') || value.startsWith('//')) return value;
  return `${siteUrl}${value}`;
}

/**
 * Zet opgemaakte tekst om naar HTML voor een e-mail: opgeschoond, met volledige adressen en inline stijlen.
 * @param {string} markup HTML uit de teksteditor.
 * @param {string} siteUrl Basisadres van de site (zonder `/` aan het eind).
 * @returns {string} Veilige HTML voor in `renderMail` (`bodyHtml`).
 */
function mailHtmlFromRichText(markup, siteUrl) {
  const base = String(siteUrl || '').replace(/\/+$/, '');
  const clean = sanitizeHtml(markup, {
    rewriteLink: (url) => absoluteMailUrl(base, url),
    rewriteImage: (url) => absoluteMailUrl(base, url),
  });
  // `sanitizeHtml` levert alleen tags uit de allowlist, zonder style-attribuut; een tag krijgt hier zijn vaste stijl.
  // Afbeeldingen laden in een mail niet "lui": dat attribuut valt weg.
  return clean
    .replace(/ loading="lazy"/g, '')
    .replace(/<(p|h2|h3|h4|h5|ul|ol|li|blockquote|table|th|td|a|img|hr)(?=[\s>])/g, (match, tag) => `<${tag} style="${TAG_STYLES[tag]}"`);
}

/**
 * De platte-tekstversie van opgemaakte tekst: alinea's gescheiden door een lege regel, lijstpunten met een streepje en
 * een link als "tekst (adres)" als de tekst niet al het adres is.
 * @param {string} markup Veilige HTML (uitkomst van `mailHtmlFromRichText`).
 * @returns {string} Platte tekst.
 */
function plainTextFromRichText(markup) {
  const root = parse(String(markup || ''), { comment: false });
  /**
   * Zet een knoop en zijn kinderen om naar tekst.
   * @param {any} node Knoop uit node-html-parser.
   * @returns {string} Tekst.
   */
  const walk = (node) => {
    if (node.nodeType === 3) return node.text.replace(/\s+/g, ' ');
    if (node.nodeType !== 1) return '';
    const tag = String(node.rawTagName || '').toLowerCase();
    const inner = node.childNodes.map(walk).join('');
    if (tag === 'br') return '\n';
    if (tag === 'hr') return '\n\n----\n\n';
    if (tag === 'li') return `\n- ${inner.trim()}`;
    if (tag === 'tr') return `\n${node.childNodes.map(walk).map((cell) => cell.trim()).filter(Boolean).join(' | ')}`;
    if (tag === 'td' || tag === 'th') return `${inner} `;
    if (tag === 'a') {
      const href = node.getAttribute('href') || '';
      const text = inner.trim();
      return href && href !== text && `mailto:${text}` !== href ? `${text} (${href})` : text;
    }
    if (tag === 'img') {
      const alt = node.getAttribute('alt') || '';
      return alt ? `[${alt}]` : '';
    }
    return BLOCK_TAGS.has(tag) ? `\n\n${inner.trim()}\n\n` : inner;
  };
  return root.childNodes.map(walk).join('')
    .split('\n').map((line) => line.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { mailHtmlFromRichText, plainTextFromRichText, absoluteMailUrl, TAG_STYLES };
