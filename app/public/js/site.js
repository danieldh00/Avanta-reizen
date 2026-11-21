/**
 * Kleine interactie op de website, gelijk aan de huidige site: de kop op de homepage doorzichtig boven de foto tot je
 * scrolt, het uitschuifmenu en de submenu's op mobiel, en het zoekvenster. Zonder JavaScript werkt alles ook: de kop
 * is dan wit, het menu staat open in de kop en de zoekknop gaat naar /zoeken/.
 */
(function setupSite() {
  document.documentElement.classList.add('js');
  const header = document.querySelector('.header-main');
  if (!header) return;

  /**
   * Zet de kop op de homepage doorzichtig zolang je bovenaan de pagina staat.
   * @returns {void}
   */
  function updateTransparency() {
    header.classList.toggle('is-transparent', window.scrollY < 10);
  }
  if (document.body.classList.contains('home')) {
    updateTransparency();
    window.addEventListener('scroll', updateTransparency, { passive: true });
  }

  const menuToggle = header.querySelector('.menutoggle');
  /**
   * Opent of sluit het uitschuifmenu op mobiel; het menu begint direct onder de kop (ook als er een balk boven staat).
   * @param {boolean} open Of het menu open moet.
   * @returns {void}
   */
  function setMenu(open) {
    if (open) header.style.setProperty('--menu-top', `${Math.round(header.getBoundingClientRect().bottom)}px`);
    header.classList.toggle('is-open', open);
    if (menuToggle) menuToggle.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('menu-open', open);
  }
  if (menuToggle) menuToggle.addEventListener('click', () => setMenu(!header.classList.contains('is-open')));

  header.querySelectorAll('.foldout-toggle').forEach((button) => {
    button.addEventListener('click', () => {
      const item = button.closest('.menu-item');
      const open = item.classList.toggle('is-open');
      button.setAttribute('aria-expanded', String(open));
    });
  });

  const searchToggle = header.querySelector('.search-toggle');
  const searchWidget = header.querySelector('.search-widget');
  /**
   * Opent of sluit het zoekvenster (op de computer een laag over de pagina).
   * @param {boolean} open Of het venster open moet.
   * @returns {void}
   */
  function setSearch(open) {
    if (!searchWidget) return;
    searchWidget.classList.toggle('is-open', open);
    if (searchToggle) searchToggle.setAttribute('aria-expanded', String(open));
    if (open) searchWidget.querySelector('input').focus();
    else if (searchToggle) searchToggle.focus();
  }
  if (searchToggle && searchWidget) {
    searchToggle.addEventListener('click', (event) => {
      event.preventDefault();
      setSearch(true);
    });
    searchWidget.querySelector('.search-widget__close').addEventListener('click', () => setSearch(false));
    searchWidget.addEventListener('click', (event) => {
      if (event.target === searchWidget) setSearch(false);
    });
  }
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (searchWidget && searchWidget.classList.contains('is-open')) setSearch(false);
    else if (header.classList.contains('is-open')) setMenu(false);
  });
}());
