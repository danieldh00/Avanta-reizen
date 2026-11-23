/**
 * Paneel onder Beheer > Toegang en beveiliging > Wachtwoorden: of de controle bij Have I Been Pwned aan staat en de
 * laatste uitkomsten van de wachtwoordcontrole (`security/password-check.js`), zonder wachtwoord, hash of gebruiker.
 */
const { html } = require('../site/html');
const { formatDateTime } = require('../crm/layout');

/** Uitkomsten in gewone taal. */
const OUTCOME_LABELS = {
  ok: 'Goedgekeurd (niet in lekken gevonden)',
  lokaal: 'Geweigerd: te makkelijk te raden',
  gelekt: 'Geweigerd: komt voor in gelekte wachtwoorden',
  onbereikbaar: 'Have I Been Pwned niet bereikbaar; alleen lokaal gecontroleerd',
};

/**
 * Maakt de functie die het paneel tekent.
 * @param {{passwordCheck: {active: Function, recent: Function}}} options De wachtwoordcontrole.
 * @returns {Function} `(req) => HTML` voor onder het formulier.
 */
function createPasswordCheckPanel({ passwordCheck }) {
  return () => {
    const events = passwordCheck.recent();
    return html`<h2>Status</h2>
      <p>${passwordCheck.active()
    ? 'Nieuwe wachtwoorden worden lokaal en bij Have I Been Pwned gecontroleerd.'
    : 'Nieuwe wachtwoorden worden alleen lokaal gecontroleerd (veelgebruikte woorden en reeksen).'}</p>
      <h2>Laatste controles</h2>
      ${events.length ? html`<div class="crm-table-wrap"><table class="crm-table">
        <thead><tr><th scope="col">Tijdstip</th><th scope="col">Uitkomst</th></tr></thead>
        <tbody>${events.map((event) => html`<tr><td>${formatDateTime(event.at)}</td><td>${OUTCOME_LABELS[event.outcome] || event.outcome}</td></tr>`)}</tbody>
      </table></div>
      <p class="field__help">Sinds de laatste herstart van de app, hoogstens 20; zonder wachtwoorden of namen.</p>` : html`<p>Sinds de laatste herstart is er nog geen nieuw wachtwoord gecontroleerd.</p>`}`;
  };
}

module.exports = { createPasswordCheckPanel, OUTCOME_LABELS };
