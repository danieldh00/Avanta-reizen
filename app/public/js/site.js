/**
 * Kleine interactie op de website, gelijk aan de huidige site: de kop op de homepage doorzichtig boven de foto tot je
 * scrolt, het uitschuifmenu en de submenu's op mobiel, en het zoekvenster. Zonder JavaScript werkt alles ook: de kop
 * is dan wit, het menu staat open in de kop en de zoekknop gaat naar /zoeken/. Daarnaast de sliders op de homepage
 * (`[data-slider]`: dia's met stippen of pijlen, automatisch doorschuiven tenzij de bezoeker minder beweging wil) en de
 * schuifrij met bestemmingen (`[data-scroller]`). Zonder JavaScript staat de eerste dia er en schuift de rij met de hand.
 */
(function setupSite() {
  document.documentElement.classList.add('js');
  setupSliders();
  setupScrollers();
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

  /**
   * Zet elke `[data-slider]` aan: één dia tegelijk zichtbaar, stippen (`data-slide-to`) en pijlen (`data-slide-prev`,
   * `data-slide-next`), en met `data-interval` automatisch doorschuiven. Dat pauzeert bij muis of focus erop en staat
   * uit als de bezoeker minder beweging wil.
   * @returns {void}
   */
  function setupSliders() {
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.querySelectorAll('[data-slider]').forEach((slider) => {
      const slides = Array.from(slider.querySelectorAll('[data-slide]'));
      if (slides.length < 2) return;
      const dots = Array.from(slider.querySelectorAll('[data-slide-to]'));
      let current = Math.max(0, slides.findIndex((slide) => slide.classList.contains('is-active')));
      let timer = null;
      let paused = false;

      /**
       * Toont de dia met dit nummer (rondlopend).
       * @param {number} index Nummer van de dia.
       * @returns {void}
       */
      function show(index) {
        current = (index + slides.length) % slides.length;
        slides.forEach((slide, position) => {
          const active = position === current;
          slide.classList.toggle('is-active', active);
          if (active) slide.removeAttribute('aria-hidden');
          else slide.setAttribute('aria-hidden', 'true');
        });
        dots.forEach((dot, position) => {
          if (position === current) dot.setAttribute('aria-current', 'true');
          else dot.removeAttribute('aria-current');
        });
      }

      /**
       * Start (opnieuw) de timer voor automatisch doorschuiven, als dat mag.
       * @returns {void}
       */
      function restart() {
        window.clearInterval(timer);
        const interval = Number(slider.dataset.interval);
        if (!interval || reduceMotion || paused) return;
        timer = window.setInterval(() => show(current + 1), Math.max(interval, 3000));
      }

      dots.forEach((dot) => dot.addEventListener('click', () => {
        show(Number(dot.dataset.slideTo));
        restart();
      }));
      const previous = slider.querySelector('[data-slide-prev]');
      const next = slider.querySelector('[data-slide-next]');
      if (previous) previous.addEventListener('click', () => { show(current - 1); restart(); });
      if (next) next.addEventListener('click', () => { show(current + 1); restart(); });
      /**
       * Pauzeert of hervat het automatisch doorschuiven.
       * @param {boolean} pause Of het moet pauzeren.
       * @returns {void}
       */
      const setPaused = (pause) => {
        paused = pause;
        restart();
      };
      slider.addEventListener('mouseenter', () => setPaused(true));
      slider.addEventListener('mouseleave', () => setPaused(slider.contains(document.activeElement)));
      slider.addEventListener('focusin', () => setPaused(true));
      slider.addEventListener('focusout', (event) => setPaused(slider.contains(event.relatedTarget) || slider.matches(':hover')));
      show(current);
      restart();
    });
  }

  /**
   * Zet elke `[data-scroller]` aan: de knoppen schuiven de rij (`data-scroller-track`) één item op.
   * @returns {void}
   */
  function setupScrollers() {
    document.querySelectorAll('[data-scroller]').forEach((scroller) => {
      const track = scroller.querySelector('[data-scroller-track]');
      if (!track) return;
      /**
       * Schuift de rij één item naar links of rechts.
       * @param {number} direction -1 of 1.
       * @returns {void}
       */
      const move = (direction) => {
        const item = track.firstElementChild;
        if (!item) return;
        const style = window.getComputedStyle(item);
        const step = item.getBoundingClientRect().width + (parseFloat(style.marginLeft) || 0) + (parseFloat(style.marginRight) || 0);
        track.scrollBy({ left: direction * step });
      };
      const previous = scroller.querySelector('[data-scroller-prev]');
      const next = scroller.querySelector('[data-scroller-next]');
      if (previous) previous.addEventListener('click', () => move(-1));
      if (next) next.addEventListener('click', () => move(1));
    });
  }
}());
