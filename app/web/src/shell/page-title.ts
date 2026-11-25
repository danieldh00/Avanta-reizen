/**
 * Titel van de pagina bij een wissel binnen een module. De server zet bij het laden de titel in `<title>` en in de kop
 * van de schil (`h1.crm-title`, `app/src/crm/layout.js`); wisselt de router naar een ander scherm, dan zet het scherm
 * hier zijn eigen titel, zodat kop, tabblad en schermlezer kloppen. Alleen tekst (`textContent`), nooit HTML.
 */

/** Achtervoegsel van de titel in het tabblad, gelijk aan de server. */
export const TITLE_SUFFIX = ' - Avanta CRM';

/**
 * Zet de titel van de pagina: het tabblad en de kop van de schil (als die er is).
 * @param title Titel van het scherm, bijvoorbeeld `Vraag wijzigen`.
 * @param doc Document (tests); standaard het echte document.
 */
export function setPageTitle(title: string, doc: Document = document): void {
  doc.title = `${title}${TITLE_SUFFIX}`;
  const heading = doc.querySelector('h1.crm-title');
  if (heading) heading.textContent = title;
}
