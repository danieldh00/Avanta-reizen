/**
 * Typen van de opschoner van de teksteditor (`app/public/js/rich-text-clean.js`, gewoon JavaScript dat de server en
 * de huidige schermen ook gebruiken).
 */
declare module '*/public/js/rich-text-clean.js' {
  interface RichTextClean {
    /** Zet knopen om naar opgeschoonde HTML met alleen de toegestane opmaak. */
    cleanNodes(nodes: NodeListOf<ChildNode> | ArrayLike<Node>): string;
    /** Zet platte tekst om naar alinea's. */
    textToHtml(text: string): string;
    /** Of een adres veilig is voor een link of afbeelding. */
    isSafeUrl(url: string): boolean;
    /** Escapet tekst voor HTML. */
    escapeText(text: string): string;
  }
  const richTextClean: RichTextClean;
  export default richTextClean;
}
