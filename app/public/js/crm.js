/**
 * Zijbalk van het CRM en Beheer (`crm/layout.js`), zoals in Aquatech. Staat direct na de kopbalk en de zijbalk in de
 * pagina, zodat de ingeklapte stand vóór het tekenen bekend is (geen verspringen).
 * - Breed scherm: in te klappen tot een iconenbalk; de keuze wordt per browser onthouden (localStorage).
 * - Groepen: één groep tegelijk open (accordeon); de groep met de huidige pagina staat bij het laden open. Tijdens
 *   zoeken in Beheer staan alle gevonden groepen open en klappen ze los van elkaar.
 * - Smal scherm (≤ 800 px): lade van links via de menuknop in de kopbalk; sluiten met de knop, de achtergrond of Esc.
 * Zonder JavaScript staan alle groepen open en staat de zijbalk op een smal scherm boven de inhoud.
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

  const searching = nav.hasAttribute('data-search');
  const sections = Array.prototype.slice.call(nav.querySelectorAll('.crm-nav-sec'));
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
  sections.forEach((section) => {
    const head = section.querySelector('.crm-nav-sec-head');
    if (!head) return;
    head.addEventListener('click', () => {
      const open = !section.classList.contains('is-open');
      if (open && !searching) sections.forEach((other) => { if (other !== section) setSectionOpen(other, false); });
      setSectionOpen(section, open);
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
