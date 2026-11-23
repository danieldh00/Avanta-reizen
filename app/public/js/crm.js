/**
 * Zijbalk en kopbalk van het CRM en Beheer (`crm/layout.js`). Staat direct na de kopbalk en de zijbalk in de pagina,
 * zodat de ingeklapte stand vóór het tekenen bekend is (geen verspringen).
 * - Breed scherm: zijbalk in te klappen tot een iconenbalk; de keuze wordt per browser onthouden (localStorage).
 * - Hoofdzijbalk: vaste groepen, altijd open. Beheer heeft een tweede zijbalk (`#crm-sub`) met inklapbare groepen: één
 *   groep tegelijk open (accordeon), de groep met de huidige pagina staat bij het laden open; tijdens zoeken staan alle
 *   gevonden groepen open. Op een smal scherm opent een knop die lijst.
 * - Gebruikersmenu in de kopbalk (`details.crm-user`): sluit bij een klik ernaast of Esc.
 * - Smal scherm (≤ 800 px): lade van links via de menuknop in de kopbalk; sluiten met de knop, de achtergrond of Esc.
 * Zonder JavaScript staan alle groepen open, werkt het gebruikersmenu als gewone `<details>` en staat de zijbalk op een
 * smal scherm boven de inhoud.
 */
(function setupCrmNav() {
  const COMPACT_KEY = 'avanta_nav_compact';
  const body = document.body;
  const nav = document.getElementById('crm-nav');
  if (!nav) return;
  document.documentElement.classList.add('js');

  /**
   * Leest een waarde uit localStorage (zonder opslag, zoals in een privévenster: null).
   * @param {string} key De sleutel.
   * @returns {(string|null)} De waarde.
   */
  function readStore(key) {
    try { return window.localStorage.getItem(key); } catch (error) { return null; }
  }

  /**
   * Schrijft een waarde naar localStorage; mislukt stil zonder opslag.
   * @param {string} key De sleutel.
   * @param {string} value De waarde.
   * @returns {void}
   */
  function writeStore(key, value) {
    try { window.localStorage.setItem(key, value); } catch (error) { /* geen opslag */ }
  }

  const compactButton = nav.querySelector('[data-nav-compact]');
  /**
   * Zet de ingeklapte stand (alleen van belang op een breed scherm).
   * @param {boolean} compact true = alleen iconen.
   * @returns {void}
   */
  function setCompact(compact) {
    body.classList.toggle('nav-compact', compact);
    if (compactButton) {
      compactButton.setAttribute('aria-pressed', compact ? 'true' : 'false');
      compactButton.title = compact ? 'Zijbalk uitklappen' : 'Zijbalk inklappen';
      const label = compactButton.querySelector('.crm-nav-label');
      if (label) label.textContent = compact ? 'Uitklappen' : 'Inklappen';
    }
  }
  setCompact(readStore(COMPACT_KEY) === '1');
  if (compactButton) {
    compactButton.addEventListener('click', () => {
      const compact = !body.classList.contains('nav-compact');
      setCompact(compact);
      writeStore(COMPACT_KEY, compact ? '1' : '0');
    });
  }

  /**
   * Opent of sluit één groep.
   * @param {Element} section De groep.
   * @param {boolean} open Of de groep open moet.
   * @returns {void}
   */
  function setSectionOpen(section, open) {
    section.classList.toggle('is-open', open);
    const head = section.querySelector('.crm-nav-sec-head');
    if (head) head.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  /**
   * Maakt de groepen van een zijbalk inklapbaar: één groep tegelijk open, behalve tijdens zoeken (`data-search`).
   * @param {Element} container De zijbalk (`#crm-nav` of `#crm-sub`).
   * @returns {void}
   */
  function setupGroups(container) {
    const searching = container.hasAttribute('data-search');
    const sections = Array.prototype.slice.call(container.querySelectorAll('.crm-nav-sec'));
    sections.forEach((section) => {
      const head = section.querySelector('.crm-nav-sec-head');
      if (!head) return;
      head.addEventListener('click', () => {
        const open = !section.classList.contains('is-open');
        if (open && !searching) sections.forEach((other) => { if (other !== section) setSectionOpen(other, false); });
        setSectionOpen(section, open);
      });
    });
  }
  const userMenu = document.querySelector('details.crm-user');
  if (userMenu) {
    document.addEventListener('click', (event) => {
      if (userMenu.open && !userMenu.contains(event.target)) userMenu.open = false;
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !userMenu.open) return;
      userMenu.open = false;
      const summary = userMenu.querySelector('summary');
      if (summary) summary.focus();
    });
  }

  // Tweede zijbalk van Beheer: dezelfde groepen, en op een smal scherm een knop die de lijst opent of sluit. Die zijbalk
  // staat in de inhoud, ná dit script, dus dit wacht tot de pagina geladen is.
  document.addEventListener('DOMContentLoaded', () => {
    const sub = document.getElementById('crm-sub');
    if (!sub) return;
    setupGroups(sub);
    const subToggle = sub.querySelector('[data-sub-toggle]');
    if (!subToggle) return;
    subToggle.addEventListener('click', () => {
      const open = !sub.classList.contains('is-open');
      sub.classList.toggle('is-open', open);
      subToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });

  const toggle = document.querySelector('[data-nav-toggle]');
  /**
   * Opent of sluit de lade (smal scherm). Bij openen gaat de focus naar de lade, bij sluiten terug naar de menuknop.
   * @param {boolean} open Of de lade open moet.
   * @returns {void}
   */
  function setDrawer(open) {
    body.classList.toggle('nav-open', open);
    if (toggle) {
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Menu sluiten' : 'Menu openen');
    }
    if (open) {
      const first = nav.querySelector('[aria-current="page"]') || nav.querySelector('a, button, input');
      if (first) first.focus();
    } else if (toggle && nav.contains(document.activeElement)) {
      toggle.focus();
    }
  }
  if (toggle) toggle.addEventListener('click', () => setDrawer(!body.classList.contains('nav-open')));
  Array.prototype.forEach.call(document.querySelectorAll('[data-nav-close]'), (element) => {
    element.addEventListener('click', () => setDrawer(false));
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && body.classList.contains('nav-open')) setDrawer(false);
  });
})();

/**
 * Opmaakknoppen boven een tekstvak met HTML (`textarea.cms-richtext`, pagina's in het CMS): vet, cursief, kopjes, lijst,
 * link en alinea zetten de bijbehorende tags om de selectie. De server schoont de HTML bij het opslaan altijd op;
 * zonder JavaScript typ je de tags zelf. Het script staat vóór de inhoud, dus dit wacht tot de pagina geladen is.
 */
document.addEventListener('DOMContentLoaded', function setupRichText() {
  const TOOLS = [
    { label: 'Vet', before: '<strong>', after: '</strong>' },
    { label: 'Cursief', before: '<em>', after: '</em>' },
    { label: 'Kop', before: '<h2>', after: '</h2>' },
    { label: 'Tussenkop', before: '<h3>', after: '</h3>' },
    { label: 'Alinea', before: '<p>', after: '</p>' },
    { label: 'Lijst', before: '<ul>\n<li>', after: '</li>\n</ul>', lines: true },
    { label: 'Link', link: true },
  ];
  Array.prototype.forEach.call(document.querySelectorAll('textarea.cms-richtext'), (area) => {
    const bar = document.createElement('div');
    bar.className = 'cms-toolbar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Opmaak');
    TOOLS.forEach((tool) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn--small btn--outline';
      button.textContent = tool.label;
      button.addEventListener('click', () => {
        const start = area.selectionStart;
        const end = area.selectionEnd;
        let selected = area.value.slice(start, end);
        let before = tool.before;
        let after = tool.after;
        if (tool.link) {
          const address = window.prompt('Adres van de link (bijv. /contact/ of https://…)', '/');
          if (!address) return;
          before = `<a href="${address.replace(/"/g, '&quot;')}">`;
          after = '</a>';
        }
        if (tool.lines && selected.includes('\n')) selected = selected.split('\n').filter(Boolean).join('</li>\n<li>');
        area.setRangeText(before + selected + after, start, end, 'select');
        area.focus();
      });
      bar.appendChild(button);
    });
    area.parentNode.insertBefore(bar, area);
  });
});
