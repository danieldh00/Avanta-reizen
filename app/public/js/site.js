/**
 * Kleine interactie op de website: het menu op mobiel openen en sluiten.
 */
(function setupMenu() {
  const toggle = document.querySelector('.menu-toggle');
  const navigation = document.getElementById('hoofdmenu');
  if (!toggle || !navigation) return;
  toggle.addEventListener('click', () => {
    const open = navigation.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
}());
