/**
 * Voorgeladen antwoorden van de API. De server zet de antwoorden van de GET-verzoeken van het eerste scherm in het
 * koppelpunt (`data-voorgeladen` op `#crm-app`, `renderMountPoint` in `app/src/crm/web-bundle.js`), zodat het scherm
 * meteen kan tekenen zonder eerst op een extra verzoek te wachten. Elk antwoord wordt één keer gebruikt; na de eerste
 * wissel binnen de module vervalt de rest, zodat een later scherm altijd verse gegevens van de server haalt.
 */

/** Antwoorden per pad binnen `/app/api` (bijvoorbeeld `/faq/`). */
let stored = new Map<string, unknown>();

/**
 * Leest de voorgeladen antwoorden uit het koppelpunt en haalt het attribuut weg. Ongeldige inhoud telt als niets.
 * @param element Het koppelpunt.
 */
export function loadPreloaded(element: HTMLElement): void {
  stored = new Map();
  const text = element.dataset.voorgeladen;
  delete element.dataset.voorgeladen;
  if (!text) return;
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === 'object' && !Array.isArray(value)) stored = new Map(Object.entries(value));
  } catch {
    // Kapotte inhoud: het scherm haalt de gegevens gewoon zelf op.
  }
}

/**
 * Geeft een voorgeladen antwoord één keer terug.
 * @param path Pad binnen `/app/api`, precies zoals het scherm het vraagt.
 * @returns Het antwoord, of `undefined` als er niets voor dit pad is.
 */
export function takePreloaded(path: string): { value: unknown } | undefined {
  if (!stored.has(path)) return undefined;
  const value = stored.get(path);
  stored.delete(path);
  return { value };
}

/** Laat de voorgeladen antwoorden vervallen (na de eerste wissel binnen de module). */
export function clearPreloaded(): void {
  stored.clear();
}
