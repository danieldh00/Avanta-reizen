// @ts-check
/**
 * Routepaden met een patroon per parameter, zoals `/reizen/:id(\d{1,9})/`.
 *
 * Express 5 (path-to-regexp 8) kent geen patroon meer achter een parameter: `:id(\d+)` geeft daar een fout bij het
 * starten. Met `routePath` blijft de korte schrijfwijze leesbaar in de routes; de functie maakt er een reguliere
 * expressie met benoemde groepen van, zodat `req.params.id` gewoon gevuld wordt. Het gedrag is gelijk aan Express 4
 * zonder `strict`: hoofdletterongevoelig, en een `/` aan het eind mag ontbreken. Een pad dat niet aan het patroon
 * voldoet (bijv. `/reizen/nieuw/` bij `:id(\d{1,9})`) valt dus net als vroeger door naar de volgende route.
 */

/** Parameter met een eigen patroon: `:naam(patroon)`; het patroon zelf bevat geen haakjes-groepen. */
const PARAMETER = /:([A-Za-z][A-Za-z0-9]*)\(([^()]+)\)/g;

/** Parameter zonder patroon: `:naam`, zoals Express die overal toestaat (één padsegment). */
const PLAIN_PARAMETER = /:([A-Za-z][A-Za-z0-9]*)/g;

/**
 * Zet letterlijke tekst om naar een veilig deel van een reguliere expressie (alle speciale tekens ge-escapet).
 * @param {string} text Letterlijk stuk van het pad.
 * @returns {string} Tekst die in een RegExp alleen zichzelf betekent.
 */
function escapeLiteral(text) {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/**
 * Vertaalt een stuk pad zonder patroon-parameters, met eventueel gewone `:naam`-parameters.
 * @param {string} text Stuk pad.
 * @param {Set<string>} names Al gebruikte parameternamen (voor de controle op dubbele namen).
 * @returns {string} Deel van de reguliere expressie.
 */
function translatePlain(text, names) {
  let source = '';
  let position = 0;
  for (const match of text.matchAll(PLAIN_PARAMETER)) {
    const index = match.index ?? 0;
    source += escapeLiteral(text.slice(position, index));
    source += namedGroup(match[1], '[^/]+?', names);
    position = index + match[0].length;
  }
  return source + escapeLiteral(text.slice(position));
}

/**
 * Maakt een benoemde groep voor één parameter en bewaakt dat elke naam één keer voorkomt.
 * @param {string} name Naam van de parameter.
 * @param {string} pattern Patroon van de waarde (zonder vangende groepen).
 * @param {Set<string>} names Al gebruikte namen.
 * @returns {string} Benoemde groep, bijv. `(?<id>\d{1,9})`.
 */
function namedGroup(name, pattern, names) {
  if (names.has(name)) throw new Error(`routePath: parameter ":${name}" komt twee keer voor`);
  names.add(name);
  return `(?<${name}>${pattern})`;
}

/**
 * Maakt van een routepad met patronen per parameter een reguliere expressie voor Express 5.
 * @param {string} path Pad in Express 4-schrijfwijze, bijv. `/reizen/:id(\\d{1,9})/fotos/:link(\\d{1,9})/`.
 * @returns {RegExp} Volledig verankerde, hoofdletterongevoelige expressie met benoemde groepen.
 */
function routePath(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) throw new Error('routePath: pad moet met "/" beginnen');
  const names = new Set();
  const withoutSlash = path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path;
  let source = '';
  let position = 0;
  for (const match of withoutSlash.matchAll(PARAMETER)) {
    const index = match.index ?? 0;
    source += translatePlain(withoutSlash.slice(position, index), names);
    source += namedGroup(match[1], match[2], names);
    position = index + match[0].length;
  }
  source += translatePlain(withoutSlash.slice(position), names);
  return new RegExp(`^${source}\\/?$`, 'i');
}

module.exports = { routePath };
