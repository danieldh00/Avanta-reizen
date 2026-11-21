/**
 * Eigen SVG-iconen van de website in dezelfde stijl als de huidige site (lijniconen, 24 × 24): reistypes, social media
 * en de kleine iconen in kop, menu, filter en reisdetail. Ze staan als vaste paden in de code en worden inline
 * getekend via `html\`…\`` (geen extern bestand, geen iconfont, geen `raw()`), zodat ze met `currentColor` meekleuren
 * en de Content-Security-Policy niet hoeft te veranderen.
 */
const { html } = require('./html');

/**
 * De iconen. Elk icoon is een lijst vormen: `d` is een pad (lijn), `circle` een cirkel `[cx, cy, r]`, `rect` een
 * rechthoek `[x, y, breedte, hoogte, hoekstraal]`; `fill: true` vult de vorm in plaats van een lijn te tekenen.
 */
const ICONS = {
  // Bediening
  menu: [{ d: 'M3.5 6.5h17M3.5 12h17M3.5 17.5h17' }],
  close: [{ d: 'M5.5 5.5l13 13M18.5 5.5l-13 13' }],
  search: [{ circle: [10.5, 10.5, 6.5] }, { d: 'M15.3 15.3l5.2 5.2' }],
  'chevron-down': [{ d: 'M6 9l6 6 6-6' }],
  'chevron-up': [{ d: 'M6 15l6-6 6 6' }],
  'chevron-left': [{ d: 'M15 5.5L8.5 12l6.5 6.5' }],
  'chevron-right': [{ d: 'M9 5.5l6.5 6.5L9 18.5' }],
  'arrow-left': [{ d: 'M20 12H4M10 6l-6 6 6 6' }],
  'arrow-right': [{ d: 'M4 12h16M14 6l6 6-6 6' }],
  'arrow-down': [{ d: 'M12 4v16M6 14l6 6 6-6' }],
  plus: [{ d: 'M12 4.5v15M4.5 12h15' }],
  mouse: [{ rect: [7, 3, 10, 17, 5] }, { d: 'M12 7v3' }],
  // Zijbalk van het CRM en Beheer
  home: [{ d: 'M3.5 11L12 4l8.5 7M5.5 9.5V20h13V9.5M10 20v-5.5h4V20' }],
  clipboard: [{ rect: [5, 4.5, 14, 16, 1.5] }, { d: 'M9 4.5V3h6v1.5M8.5 10h7M8.5 13.5h7M8.5 17h4' }],
  users: [{ circle: [9, 8, 3.3] }, { d: 'M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 5a3.2 3.2 0 010 6.2M18 14.3c2.1.7 3.5 2.8 3.5 5.7' }],
  user: [{ circle: [12, 8, 3.8] }, { d: 'M4.5 20.5c0-4 3.4-6.8 7.5-6.8s7.5 2.8 7.5 6.8' }],
  image: [{ rect: [3, 4.5, 18, 15, 1.5] }, { circle: [8.5, 9.5, 1.8] }, { d: 'M3.5 17.5l5-5 4 4 3-3 5 5' }],
  list: [{ d: 'M9 6.5h11.5M9 12h11.5M9 17.5h11.5' }, { circle: [4.5, 6.5, 1], fill: true }, { circle: [4.5, 12, 1], fill: true }, { circle: [4.5, 17.5, 1], fill: true }],
  settings: [{ circle: [12, 12, 3] }, { d: 'M12 2.8v2.5M12 18.7v2.5M2.8 12h2.5M18.7 12h2.5M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8' }],
  building: [{ rect: [4.5, 3.5, 15, 17, 1] }, { d: 'M8.5 7.5h2M13.5 7.5h2M8.5 11h2M13.5 11h2M8.5 14.5h2M13.5 14.5h2M10.5 20.5v-3h3v3' }],
  shield: [{ d: 'M12 3l7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6z' }, { d: 'M8.8 12l2.2 2.2 4.2-4.4' }],
  archive: [{ rect: [3, 4, 18, 4.5, 1] }, { d: 'M4.5 8.5V20h15V8.5M10 12.5h4' }],
  key: [{ circle: [8, 15, 4] }, { d: 'M10.8 12.2L20 3M16.5 6.5l2.5 2.5M14 9l2 2' }],
  lock: [{ rect: [5, 10.5, 14, 10, 1.5] }, { d: 'M8 10.5V7.5a4 4 0 018 0v3M12 14.5v2.5' }],
  logout: [{ d: 'M14 4.5H5.5v15H14M10 12h10.5M17 8.5l3.5 3.5-3.5 3.5' }],
  // Filter en reisdetail
  location: [{ d: 'M12 21s-6.5-6.1-6.5-11a6.5 6.5 0 0113 0c0 4.9-6.5 11-6.5 11z' }, { circle: [12, 10, 2.3] }],
  label: [{ d: 'M3.5 3.5h8l9 9-8 8-9-9z' }, { circle: [8, 8, 1.4] }],
  calendar: [{ rect: [3.5, 5, 17, 15, 1.5] }, { d: 'M3.5 10h17M8 3v4M16 3v4' }],
  information: [{ circle: [12, 12, 9] }, { d: 'M12 11v6M12 7.5v.2' }],
  mail: [{ rect: [3, 5.5, 18, 13, 1.5] }, { d: 'M3.5 6.5l8.5 7 8.5-7' }],
  phone: [{ d: 'M6.5 3.5h3l1.5 4-2 1.5a11 11 0 006 6l1.5-2 4 1.5v3a2 2 0 01-2 2A16 16 0 014.5 5.5a2 2 0 012-2z' }],
  badge: [{ circle: [12, 12, 9] }, { circle: [12, 12, 6.3] }, { d: 'M12 8.6l1 2.1 2.3.3-1.7 1.6.4 2.3-2-1.1-2 1.1.4-2.3-1.7-1.6 2.3-.3z' }],
  footprints: [
    { d: 'M7.5 3.5c1.7 0 2.5 2 2.5 4.2s-.9 3.8-2.5 3.8S5 9.9 5 7.7s.8-4.2 2.5-4.2zM5.3 13.5h4.4c0 1.8-.8 3-2.2 3s-2.2-1.2-2.2-3z' },
    { d: 'M16.5 7.5c1.7 0 2.5 2 2.5 4.2s-.9 3.8-2.5 3.8-2.5-1.6-2.5-3.8.8-4.2 2.5-4.2zM14.3 17.5h4.4c0 1.8-.8 3-2.2 3s-2.2-1.2-2.2-3z' },
  ],
  // Reistypes en kenmerken
  hostel: [{ d: 'M3 3.5v17M21 3.5v17M3 7.5c2.5 7 15.5 7 18 0M3 7.5c3 3 15 3 18 0M2 20.5h3M19 20.5h3' }],
  jeugd: [{ circle: [12, 6.5, 2.3] }, { d: 'M12 9.8v5.2M8.3 12.2l3.7-1.5 3.7 1.5M12 15l-2.4 5.5M12 15l2.4 5.5' }],
  jongeren: [{ circle: [10.5, 4.8, 2.1] }, { d: 'M10.5 8v7.5M10.5 15.5l-2.5 5.5M10.5 15.5l2.5 5.5M10.5 10l-3 3.5' }, { rect: [12, 8.5, 4, 5.5, 1.2] }],
  plusreis: [{ circle: [10, 4.5, 2] }, { d: 'M10 7.5l-.8 6 2.8 3 .8 4M9.2 13.5L7.3 21M10 9.5l3.2 2.3M9.6 9l-3 3.2M16 11.5V21' }],
  kamperen: [{ d: 'M2.5 20h19M12 5L3.5 20M12 5l8.5 15M9.5 20l2.5-6 2.5 6M12 5l-1.6-2M12 5l1.6-2' }],
  'verre-reizen': [{ circle: [12, 12, 9] }, { d: 'M3 12h18M12 3c3.2 3.5 3.2 14.5 0 18M12 3c-3.2 3.5-3.2 14.5 0 18' }],
  'avanta-vervoer': [{ d: 'M2.5 16.5v-7a2 2 0 012-2h10l4.5 4.5h.5a2 2 0 012 2v2.5h-1.6M5.2 16.5H2.5M8.8 16.5h6.4M5 8v4h13.5M10 7.5V12' }, { circle: [7, 16.8, 1.8] }, { circle: [17, 16.8, 1.8] }],
  ov: [{ rect: [5.5, 3, 13, 14, 3] }, { d: 'M5.5 10.5h13M8 17l-2 4M16 17l2 4M9 3v7.5M15 3v7.5' }, { circle: [9, 13.8, 0.9], fill: true }, { circle: [15, 13.8, 0.9], fill: true }],
  vliegreis: [{ d: 'M21 15.5l-7.5-4.6V5a1.5 1.5 0 00-3 0v5.9L3 15.5V17l7.5-2.3v4.3l-2 1.5V22l3.5-1 3.5 1v-1.5l-2-1.5v-4.3L21 17z' }],
  wintersport: [{ d: 'M12 2.5v19M3.8 7.3l16.4 9.4M3.8 16.7l16.4-9.4M9.5 3.8L12 6l2.5-2.2M9.5 20.2L12 18l2.5 2.2' }],
  // Social media
  facebook: [{ d: 'M13.6 21v-7.6h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.5-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 3.9v2.2H8v3h2.6V21z', fill: true }],
  instagram: [{ rect: [3.5, 3.5, 17, 17, 5] }, { circle: [12, 12, 4] }, { circle: [17.2, 6.8, 1], fill: true }],
  youtube: [{ rect: [2.5, 5.5, 19, 13, 3.5] }, { d: 'M10 9.2v5.6l4.8-2.8z', fill: true }],
  linkedin: [{ d: 'M6.5 10v8.5M10.5 18.5V10M10.5 13.5c0-2.2 1.4-3.5 3.2-3.5s3 1.2 3 3.5v5' }, { circle: [6.5, 6.5, 1.3], fill: true }],
  x: [{ d: 'M4.5 4.5l15 15M19.5 4.5l-15 15' }],
};

/**
 * Reistype of kenmerk (slug van de categorie op de huidige site) → icoon. Onbekende slugs krijgen de wereldbol.
 */
const TYPE_ICONS = {
  hostel: 'hostel',
  jeugdreizen: 'jeugd',
  jeugd: 'jeugd',
  jongerenreizen: 'jongeren',
  jongeren: 'jongeren',
  plusreizen: 'plusreis',
  plus: 'plusreis',
  kampeerreizen: 'kamperen',
  kamperen: 'kamperen',
  'verre-reizen': 'verre-reizen',
  vliegreis: 'vliegreis',
  'avanta-vervoer': 'avanta-vervoer',
  ov: 'ov',
  wintersport: 'wintersport',
};

/**
 * Tekent één vorm van een icoon.
 * @param {{d?: string, circle?: number[], rect?: number[], fill?: boolean}} shape De vorm.
 * @returns {object} HTML van de vorm.
 */
function renderShape(shape) {
  const className = shape.fill ? 'icon__fill' : '';
  if (shape.circle) {
    const [cx, cy, radius] = shape.circle;
    return html`<circle${className ? html` class="${className}"` : ''} cx="${cx}" cy="${cy}" r="${radius}"/>`;
  }
  if (shape.rect) {
    const [x, y, width, height, cornerRadius] = shape.rect;
    return html`<rect${className ? html` class="${className}"` : ''} x="${x}" y="${y}" width="${width}" height="${height}" rx="${cornerRadius || 0}"/>`;
  }
  return html`<path${className ? html` class="${className}"` : ''} d="${shape.d}"/>`;
}

/**
 * Tekent een icoon als inline SVG. Zonder `label` is het icoon versiering (`aria-hidden`); met `label` krijgt het een
 * toegankelijke naam.
 * @param {string} name Naam uit `ICONS`.
 * @param {{label?: string, className?: string}} [options] Toegankelijke naam en extra CSS-klasse.
 * @returns {object} HTML van het icoon (leeg bij een onbekende naam).
 */
function icon(name, options = {}) {
  const shapes = ICONS[name];
  if (!shapes) return '';
  const className = options.className ? `icon icon--${name} ${options.className}` : `icon icon--${name}`;
  const a11y = options.label ? html` role="img" aria-label="${options.label}"` : html` aria-hidden="true" focusable="false"`;
  return html`<svg class="${className}" viewBox="0 0 24 24" width="24" height="24"${a11y}>${shapes.map(renderShape)}</svg>`;
}

/**
 * Het icoon bij een reistype of kenmerk.
 * @param {string} slug Slug van de categorie (bijv. `kampeerreizen`).
 * @returns {string} Naam van het icoon.
 */
function typeIconName(slug) {
  return TYPE_ICONS[String(slug || '').toLowerCase()] || 'verre-reizen';
}

module.exports = { ICONS, TYPE_ICONS, icon, typeIconName };
