/**
 * Hulpfuncties voor een volgorde in de schermen: een element een plaats verschuiven en het veld Volgorde lezen.
 * Gedeeld door alle modules met een volgorde (FAQ, blogcategorieën en tags, menu's, reistypes en landen).
 */

/**
 * Verschuift één element in een lijst een plaats omhoog of omlaag.
 * @param ids De id's in de huidige volgorde.
 * @param id Het id dat verschuift.
 * @param step -1 omhoog, 1 omlaag.
 * @returns De nieuwe volgorde, of null als het element al bovenaan of onderaan staat (of niet in de lijst).
 */
export function moveId(ids: number[], id: number, step: -1 | 1): number[] | null {
  const from = ids.indexOf(id);
  const to = from + step;
  if (from < 0 || to < 0 || to >= ids.length) return null;
  const moved = [...ids];
  moved[from] = ids[to]!;
  moved[to] = id;
  return moved;
}

/**
 * Leest een volgorde uit een veld: leeg is geen volgorde (de server neemt dan 0), anders het getal zoals ingevuld.
 * Een ongeldig getal gaat ongewijzigd mee, zodat de server de melding geeft. Vue zet de waarde van een getalveld
 * (`type="number"`) zelf al om naar een getal; daarom mag het ook een getal zijn.
 * @param value Ingevulde waarde.
 * @returns Getal, of undefined als het veld leeg is.
 */
export function readOrder(value: string | number): number | undefined {
  const trimmed = String(value).trim();
  return trimmed === '' ? undefined : Number(trimmed);
}
