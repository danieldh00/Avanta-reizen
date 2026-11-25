/**
 * Hulpfuncties van de teksteditor (`rich-text-editor.vue`), los van het component zodat ze apart te testen zijn: de
 * knoppen, HTML omzetten naar opgeschoonde knopen en het blok waarin de cursor staat. De opschoning zelf komt uit
 * `app/public/js/rich-text-clean.js`, dezelfde als in de huidige editor en op de server, zodat de regels gelijk blijven.
 */
import richTextClean from '../../../public/js/rich-text-clean.js';

/** Eén knop van de knoppenbalk. */
export interface RichTextTool {
  label: string;
  title: string;
  /** Opdracht voor `document.execCommand`. */
  command?: string;
  /** Blok voor `formatBlock` (alinea, kop, citaat); de knop toont dan of de cursor in dat blok staat. */
  block?: string;
  /** De knop toont een aan/uit-stand via `queryCommandState`. */
  state?: boolean;
  /** De knop opent het veld voor een link. */
  link?: boolean;
}

/** De knoppen, in de volgorde van de huidige editor (`app/public/js/rich-editor.js`). */
export const RICH_TEXT_TOOLS: readonly RichTextTool[] = [
  { label: 'Alinea', title: 'Gewone tekst', command: 'formatBlock', block: 'p' },
  { label: 'Kop', title: 'Kop (groot)', command: 'formatBlock', block: 'h2' },
  { label: 'Tussenkop', title: 'Tussenkop (kleiner)', command: 'formatBlock', block: 'h3' },
  { label: 'Vet', title: 'Vet (Ctrl+B)', command: 'bold', state: true },
  { label: 'Cursief', title: 'Cursief (Ctrl+I)', command: 'italic', state: true },
  { label: 'Opsomming', title: 'Lijst met bolletjes', command: 'insertUnorderedList', state: true },
  { label: 'Nummering', title: 'Genummerde lijst', command: 'insertOrderedList', state: true },
  { label: 'Citaat', title: 'Citaat', command: 'formatBlock', block: 'blockquote' },
  { label: 'Link', title: 'Link toevoegen (Ctrl+K)', link: true },
  { label: 'Link weg', title: 'Link weghalen', command: 'unlink' },
];

/** Melding bij een adres dat niet mag. */
export const UNSAFE_LINK_MESSAGE = 'Dit adres kan niet: gebruik een adres op deze site (/…), https://…, mailto: of tel:.';

/**
 * Schoont HTML op met de regels van de editor.
 * @param markup HTML (opgeslagen of geplakt).
 * @returns Opgeschoonde HTML.
 */
export function cleanHtml(markup: string): string {
  return richTextClean.cleanNodes(new DOMParser().parseFromString(String(markup || ''), 'text/html').body.childNodes);
}

/**
 * Zet HTML om naar opgeschoonde knopen voor het bewerkvak. Alles gaat eerst door een inert document (`DOMParser`) en
 * de opschoner; ongeschoonde HTML komt nooit in de pagina.
 * @param markup HTML.
 * @returns Knopen, klaar voor `replaceChildren`.
 */
export function nodesFromHtml(markup: string): Node[] {
  const cleaned = new DOMParser().parseFromString(cleanHtml(markup), 'text/html');
  return Array.from(cleaned.body.childNodes, (node) => document.importNode(node, true));
}

/**
 * Schoont de inhoud van het bewerkvak op tot HTML.
 * @param editor Het bewerkvak.
 * @returns Opgeschoonde HTML.
 */
export function htmlFromEditor(editor: HTMLElement): string {
  return richTextClean.cleanNodes(editor.childNodes);
}

/**
 * Zet geplakte inhoud om naar opgeschoonde HTML: opmaak uit een tekstverwerker of website wordt opgeschoond, platte
 * tekst wordt alinea's.
 * @param markup De HTML van het klembord (kan leeg zijn).
 * @param text De platte tekst van het klembord.
 * @returns Opgeschoonde HTML.
 */
export function pastedHtml(markup: string, text: string): string {
  return markup ? cleanHtml(markup) : richTextClean.textToHtml(text);
}

/**
 * Of een adres als link mag (adres op de site, https, mailto of tel).
 * @param address Het adres.
 * @returns Of het mag.
 */
export function isSafeLink(address: string): boolean {
  return richTextClean.isSafeUrl(address);
}

/**
 * HTML voor een link waarvan het adres ook de tekst is (als er niets geselecteerd is).
 * @param address Een veilig adres.
 * @returns HTML met het adres als tekst.
 */
export function linkHtml(address: string): string {
  const attribute = address.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<a href="${attribute}">${richTextClean.escapeText(address)}</a>`;
}

/**
 * Geeft het blok (alinea, kop, citaat, lijstpunt) waarin de cursor staat, binnen het bewerkvak.
 * @param editor Het bewerkvak.
 * @returns Tagnaam in kleine letters, of ''.
 */
export function currentBlock(editor: HTMLElement): string {
  const selection = window.getSelection();
  let node: Node | null = selection && selection.rangeCount ? selection.getRangeAt(0).startContainer : null;
  while (node && node !== editor) {
    if (node instanceof HTMLElement && /^(P|H2|H3|H4|H5|BLOCKQUOTE|LI)$/.test(node.tagName)) return node.tagName.toLowerCase();
    node = node.parentNode;
  }
  return '';
}

/**
 * Of de browser de opdrachten van de editor kent. Zonder (bijvoorbeeld een heel oude browser) blijft alleen het
 * tekstvak met de HTML over.
 * @returns Of `execCommand` bestaat.
 */
export function editingSupported(): boolean {
  return typeof document.execCommand === 'function';
}
