/**
 * Design-controle: de metingen die in de browser op één pagina draaien (via `page.evaluate`). Elke controle geeft
 * bevindingen terug met een soort, een korte omschrijving, een herkenbare selector en de rechthoek van het element, zodat
 * `check.js` ze kan samenvoegen over pagina's en er een uitsnede van kan maken.
 *
 * Controles (drempels in `THRESHOLDS`):
 * - `overloop`: de pagina is breder dan het venster (horizontaal scrollen), met de elementen die eruit steken.
 * - `afgekapt`: tekst valt weg in een element met `overflow: hidden` (geen bewuste `text-overflow: ellipsis`).
 * - `ingekort`: tekst wordt met een beletselteken (…) ingekort; soms bewust, vaak een te smal vak.
 * - `overlap`: tekst of bedieningselementen liggen over elkaar heen.
 * - `knophoogte`: knoppen en velden naast elkaar zijn niet even hoog of staan niet op één lijn.
 * - `uitlijning`: onder elkaar gestapelde blokken of formuliervelden wijken een paar pixels af van dezelfde linkerrand.
 * - `rand`: tekst raakt op mobiel (bijna) de rand van het scherm.
 * - `afbeelding`: een afbeelding laadt niet.
 * - `kleine-tekst`: tekst kleiner dan 12 px.
 * - `klikdoel`: op mobiel een knop of losse link kleiner dan 24 × 24 px (WCAG 2.2, 2.5.8).
 *
 * Het bestand exporteert één functie die Playwright als tekst naar de browser stuurt; ze mag dus niets van buiten gebruiken.
 */

/**
 * Voert alle controles uit op de geladen pagina.
 * @param {{mobile: boolean}} context Of het venster een mobiel venster is (375 px).
 * @returns {Array<{check: string, message: string, selector: string, rect: {x: number, y: number, width: number, height: number}}>}
 *   Bevindingen; de rechthoek is in paginacoördinaten (inclusief scrollpositie).
 */
function runPageChecks(context) {
  const THRESHOLDS = {
    overflowPx: 1, // meer dan 1 px breder dan het venster telt als overloop
    overlapPx: 3, // overlap in beide richtingen minstens 3 px
    rowHeightPx: 2, // knoppen/velden in één rij mogen hoogstens 2 px verschillen
    nearEdgeMinPx: 1, // afwijking van een linkerrand vanaf 1 px …
    nearEdgeMaxPx: 6, // … tot en met 6 px telt als "bijna gelijk, dus scheef"
    screenEdgePx: 12, // tekst dichter dan 12 px bij de rand van een mobiel scherm
    minFontPx: 12,
    minTargetPx: 24,
  };
  const findings = [];
  const viewportWidth = document.documentElement.clientWidth;

  /**
   * Of een element zichtbaar is (ook niet weggestopt met de bekende sr-only-truc).
   * @param {Element} element Element.
   * @returns {boolean} Zichtbaar.
   */
  const isVisible = (element) => {
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    if (element.closest('svg') && element.tagName.toLowerCase() !== 'svg') return false; // binnenkant van een icoon
    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    if (rect.right + scrollX < 0 || rect.bottom + scrollY < 0) return false; // buiten beeld geparkeerd (skiplink)
    // Weggescrold of afgeknipt binnen een scroll- of knipcontainer (bijv. een lange lijst met vinkjes).
    for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const parentStyle = getComputedStyle(parent);
      if (!/(auto|scroll|hidden|clip)/.test(parentStyle.overflowY + parentStyle.overflowX)) continue;
      const box = parent.getBoundingClientRect();
      if (rect.bottom <= box.top + 1 || rect.top >= box.bottom - 1 || rect.right <= box.left + 1 || rect.left >= box.right - 1) return false;
    }
    if (style.clip === 'rect(0px, 0px, 0px, 0px)' || style.clipPath === 'inset(50%)') return false;
    return element.checkVisibility ? element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : true;
  };

  /**
   * Een korte, herkenbare selector: tot drie niveaus tag + klassen (+ id), zonder volgnummers, zodat hetzelfde
   * onderdeel op verschillende pagina's dezelfde selector krijgt.
   * @param {Element} element Element.
   * @returns {string} Selector.
   */
  const describe = (element) => {
    const parts = [];
    for (let current = element; current && current !== document.body && parts.length < 3; current = current.parentElement) {
      let part = current.tagName.toLowerCase();
      if (current.id && !/\d{3,}/.test(current.id)) part += `#${current.id}`;
      const classes = [...current.classList].filter((name) => !/\d{3,}/.test(name)).slice(0, 2);
      if (classes.length) part += `.${classes.join('.')}`;
      parts.unshift(part);
    }
    return parts.join(' > ');
  };

  /**
   * De rechthoek van een element in paginacoördinaten.
   * @param {Element} element Element.
   * @returns {{x: number, y: number, width: number, height: number}} Rechthoek.
   */
  const pageRect = (element) => {
    const rect = element.getBoundingClientRect();
    return { x: Math.round(rect.left + scrollX), y: Math.round(rect.top + scrollY), width: Math.round(rect.width), height: Math.round(rect.height) };
  };

  /**
   * Voegt een bevinding toe.
   * @param {string} check Soort controle.
   * @param {Element} element Het element.
   * @param {string} message Omschrijving.
   * @returns {void}
   */
  const add = (check, element, message) => findings.push({ check, message, selector: describe(element), rect: pageRect(element) });

  /**
   * Of het element in een vaste of meeschuivende laag zit (kopbalk, balk "in ontwikkeling", cookiebalk): die mag over
   * de inhoud liggen.
   * @param {Element} element Element.
   * @returns {boolean} In een vaste laag.
   */
  const inFixedLayer = (element) => {
    for (let current = element; current; current = current.parentElement) {
      const position = getComputedStyle(current).position;
      if (position === 'fixed' || position === 'sticky') return true;
    }
    return false;
  };

  /**
   * Of een voorouder de inhoud zelf laat scrollen of afknipt (dan steekt het element niet uit de pagina).
   * @param {Element} element Element.
   * @returns {boolean} Binnen een scroll- of knipcontainer.
   */
  const insideClippingAncestor = (element) => {
    for (let current = element.parentElement; current && current !== document.body; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) return true;
    }
    return false;
  };

  const all = [...document.body.querySelectorAll('*')].filter((element) => !['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'BR', 'OPTION'].includes(element.tagName));
  const visible = all.filter(isVisible);

  /** Elementen met eigen tekst (een tekstknoop met inhoud als direct kind). */
  const hasOwnText = (element) => [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim().length > 0);
  const controlSelector = 'button, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea, a.btn, .btn';
  const textElements = visible.filter((element) => hasOwnText(element));
  const controls = visible.filter((element) => element.matches(controlSelector));

  // 1. Horizontale overloop.
  if (document.documentElement.scrollWidth > viewportWidth + THRESHOLDS.overflowPx) {
    const sticking = visible.filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.right > viewportWidth + THRESHOLDS.overflowPx && !insideClippingAncestor(element);
    });
    // Alleen de diepste elementen: een ouder die uitsteekt omdat een kind uitsteekt, noemen we niet apart.
    const deepest = sticking.filter((element) => !sticking.some((other) => other !== element && element.contains(other)));
    for (const element of deepest.slice(0, 5)) {
      add('overloop', element, `Steekt ${Math.round(element.getBoundingClientRect().right - viewportWidth)} px buiten het venster (pagina ${document.documentElement.scrollWidth} px breed bij ${viewportWidth} px).`);
    }
  }

  // 2. Afgekapte tekst.
  for (const element of visible) {
    if (element.matches('input, select, textarea, img, svg, video, iframe, canvas')) continue;
    const style = getComputedStyle(element);
    if (!(element.textContent || '').trim()) continue;
    const clipsX = /(hidden|clip)/.test(style.overflowX) && style.textOverflow !== 'ellipsis' && element.scrollWidth > element.clientWidth + 1;
    const clipsY = /(hidden|clip)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 2 && !/line-clamp/.test(style.cssText) && style.webkitLineClamp === 'none';
    if (style.textOverflow === 'ellipsis' && element.scrollWidth > element.clientWidth + 1 && hasOwnText(element)) {
      add('ingekort', element, `Tekst wordt met … ingekort ("${element.textContent.trim().slice(0, 40)}").`);
    }
    if ((clipsX || clipsY) && element.clientWidth > 0) {
      // Een afknipcontainer rond afbeeldingen (foto's met afgeronde hoeken) is geen afgekapte tekst. Tekst in een
      // eigen scroll- of afknipvak daarbinnen (schuifbalk met reizen) telt bij dat vak, en verborgen tekst (inactieve
      // dia's van een carrousel) is niet zichtbaar afgekapt.
      const nestedOrHidden = (child) => {
        if (getComputedStyle(child).visibility === 'hidden') return true;
        for (let ancestor = child.parentElement; ancestor && ancestor !== element; ancestor = ancestor.parentElement) {
          const ancestorStyle = getComputedStyle(ancestor);
          if (ancestor.getAttribute('aria-hidden') === 'true') return true;
          if (/(auto|scroll|hidden|clip)/.test(`${ancestorStyle.overflowX} ${ancestorStyle.overflowY}`)) return true;
        }
        return false;
      };
      const textInside = [...element.querySelectorAll('*')].concat(element).some((child) => hasOwnText(child) && !(child !== element && nestedOrHidden(child)) && (() => {
        const outer = element.getBoundingClientRect();
        const inner = child.getBoundingClientRect();
        return inner.right > outer.right + 1 || inner.bottom > outer.bottom + 2 || inner.left < outer.left - 1;
      })());
      if (textInside) add('afgekapt', element, `Tekst valt weg (${clipsX ? `breedte ${element.scrollWidth} > ${element.clientWidth} px` : `hoogte ${element.scrollHeight} > ${element.clientHeight} px`}).`);
    }
  }

  // 3. Overlap van tekst en bedieningselementen (niet: in een vaste laag, of de één in de ander).
  // Een label dat bewust over zijn eigen veld ligt (zwevend label, of een select als groot klikvlak) telt niet.
  const labelFor = (label, control) => label.tagName === 'LABEL' && (label.htmlFor ? label.htmlFor === control.id : label.contains(control));
  /**
   * De vakken die echt inkt bevatten: voor tekst de regels van de eigen tekstknopen (een inline element over twee regels
   * is anders één groot vak), voor bedieningselementen het element zelf.
   * @param {Element} element Element.
   * @returns {DOMRect[]} Vakken.
   */
  const inkRects = (element) => {
    if (element.matches(controlSelector)) return [element.getBoundingClientRect()];
    const rects = [];
    for (const node of element.childNodes) {
      if (node.nodeType !== 3 || !node.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      rects.push(...[...range.getClientRects()].filter((rect) => rect.width > 1 && rect.height > 1));
    }
    return rects;
  };
  const boxes = [];
  for (const element of new Set([...textElements, ...controls])) {
    if (inFixedLayer(element)) continue;
    for (const rect of inkRects(element)) boxes.push({ element, rect });
  }
  boxes.sort((a, b) => a.rect.top - b.rect.top);
  const reported = new Set();
  // Vegen van boven naar beneden: alleen vakken vergelijken die verticaal kunnen overlappen.
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length && boxes[j].rect.top < boxes[i].rect.bottom; j++) {
      const first = boxes[i];
      const second = boxes[j];
      if (first.element === second.element || first.element.contains(second.element) || second.element.contains(first.element)) continue;
      if (labelFor(first.element, second.element) || labelFor(second.element, first.element)) continue;
      const overlapX = Math.min(first.rect.right, second.rect.right) - Math.max(first.rect.left, second.rect.left);
      const overlapY = Math.min(first.rect.bottom, second.rect.bottom) - Math.max(first.rect.top, second.rect.top);
      // Regelvakken van grote koppen overlappen door de regelhoogte zonder dat de letters elkaar raken; pas vanaf de helft
      // van het kleinste regelvak telt het.
      const minimumY = Math.max(THRESHOLDS.overlapPx, Math.min(first.rect.height, second.rect.height) / 2);
      const pair = [describe(first.element), describe(second.element)].join('|');
      if (overlapX >= THRESHOLDS.overlapPx && overlapY >= minimumY && !reported.has(pair)) {
        reported.add(pair);
        add('overlap', first.element, `Ligt ${Math.round(overlapX)} × ${Math.round(overlapY)} px over "${describe(second.element)}" ("${(second.element.textContent || second.element.value || '').trim().slice(0, 40)}").`);
      }
    }
  }

  // 4. Knoppen en velden in één rij: zelfde hoogte en op één lijn.
  const rowControls = controls.filter((element) => !element.matches('textarea'));
  const seenRows = new Set();
  for (const control of rowControls) {
    const rect = control.getBoundingClientRect();
    const neighbours = rowControls.filter((other) => {
      if (other === control || other.contains(control) || control.contains(other)) return false;
      const otherRect = other.getBoundingClientRect();
      const verticalOverlap = Math.min(rect.bottom, otherRect.bottom) - Math.max(rect.top, otherRect.top);
      const gap = Math.max(otherRect.left - rect.right, rect.left - otherRect.right);
      return verticalOverlap > Math.min(rect.height, otherRect.height) / 2 && gap >= 0 && gap < 48 && control.closest('form, nav, header, section, div') === other.closest('form, nav, header, section, div');
    });
    for (const other of neighbours) {
      const key = [describe(control), describe(other)].sort().join('|');
      if (seenRows.has(key)) continue;
      seenRows.add(key);
      const otherRect = other.getBoundingClientRect();
      const heightDifference = Math.abs(rect.height - otherRect.height);
      const topDifference = Math.abs(rect.top - otherRect.top);
      if (heightDifference > THRESHOLDS.rowHeightPx || topDifference > THRESHOLDS.rowHeightPx) {
        add('knophoogte', control, `Naast "${describe(other)}": hoogte ${Math.round(rect.height)} tegen ${Math.round(otherRect.height)} px, bovenkant ${Math.round(topDifference)} px verschoven.`);
      }
    }
  }

  // 5. Bijna-gelijke linkerranden van onder elkaar gestapelde blokken (zelfde ouder) en van formuliervelden.
  const parents = new Set(visible.map((element) => element.parentElement).filter(Boolean));
  for (const parent of parents) {
    const children = [...parent.children].filter((child) => isVisible(child) && !inFixedLayer(child) && getComputedStyle(child).position !== 'absolute' && getComputedStyle(child).float === 'none');
    if (children.length < 2) continue;
    const rects = children.map((child) => child.getBoundingClientRect());
    // Alleen een echte stapel: elk kind begint onder het vorige.
    const stacked = rects.every((rect, index) => index === 0 || rect.top >= rects[index - 1].bottom - 1);
    if (!stacked) continue;
    const lefts = rects.map((rect) => rect.left);
    const reference = lefts.slice().sort((a, b) => lefts.filter((value) => value === b).length - lefts.filter((value) => value === a).length)[0];
    children.forEach((child, index) => {
      const difference = Math.abs(lefts[index] - reference);
      if (difference >= THRESHOLDS.nearEdgeMinPx && difference <= THRESHOLDS.nearEdgeMaxPx) {
        add('uitlijning', child, `Linkerrand ${difference.toFixed(1)} px verschoven ten opzichte van de andere blokken in "${describe(parent)}".`);
      }
    });
  }
  for (const form of document.querySelectorAll('form')) {
    const fields = [...form.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea')].filter(isVisible);
    const lefts = fields.map((field) => field.getBoundingClientRect().left);
    fields.forEach((field, index) => {
      const near = lefts.filter((left, other) => other !== index && Math.abs(left - lefts[index]) >= THRESHOLDS.nearEdgeMinPx && Math.abs(left - lefts[index]) <= THRESHOLDS.nearEdgeMaxPx);
      if (near.length) add('uitlijning', field, `Veld staat ${Math.abs(near[0] - lefts[index]).toFixed(1)} px naast de linkerrand van andere velden in hetzelfde formulier.`);
    });
  }

  // 6. Tekst tegen de rand van een mobiel scherm.
  if (context.mobile) {
    for (const element of textElements) {
      if (inFixedLayer(element) || insideClippingAncestor(element)) continue;
      const range = document.createRange();
      range.selectNodeContents(element);
      const rect = range.getBoundingClientRect();
      if (rect.width < 1) continue;
      if (rect.left < THRESHOLDS.screenEdgePx || rect.right > viewportWidth - THRESHOLDS.screenEdgePx) {
        if (rect.right > viewportWidth + 1) continue; // valt al onder overloop
        add('rand', element, `Tekst staat ${Math.round(Math.min(rect.left, viewportWidth - rect.right))} px van de rand van het scherm.`);
      }
    }
  }

  // 7. Afbeeldingen die niet laden.
  for (const image of document.images) {
    if (image.complete && image.naturalWidth === 0 && isVisible(image)) add('afbeelding', image, `Afbeelding laadt niet (${(image.currentSrc || image.src).slice(-80)}).`);
  }

  // 8. Te kleine tekst.
  for (const element of textElements) {
    const size = parseFloat(getComputedStyle(element).fontSize);
    if (size < THRESHOLDS.minFontPx) add('kleine-tekst', element, `Tekst is ${size} px (minimaal ${THRESHOLDS.minFontPx}).`);
  }

  // 9. Kleine klikdoelen op mobiel: knoppen en links die niet midden in lopende tekst staan.
  if (context.mobile) {
    for (const element of visible.filter((candidate) => candidate.matches('a[href], button, [role=button], input[type=submit]'))) {
      if (element.closest('p, li p, td') && getComputedStyle(element).display === 'inline') continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < THRESHOLDS.minTargetPx || rect.height < THRESHOLDS.minTargetPx) {
        add('klikdoel', element, `Klikdoel ${Math.round(rect.width)} × ${Math.round(rect.height)} px (minimaal ${THRESHOLDS.minTargetPx} × ${THRESHOLDS.minTargetPx}).`);
      }
    }
  }

  return findings;
}

module.exports = { runPageChecks };
