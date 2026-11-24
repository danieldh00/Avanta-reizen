// @ts-check
/**
 * HTML van het reizigersaccount (CMS-pakket J2): inloggen, registreren, bevestigen, wachtwoord vergeten en herstellen,
 * en het overzicht. In de huisstijl van de site (`form--theme`, `page-content__form`); alles via `html\`…\`` (escaping).
 */
const { html, raw } = require('../site/html');
const { MAX_LENGTH, MIN_LENGTH } = require('../crm/passwords');

/**
 * Eén invoerveld met label en foutmelding.
 * @param {{name: string, label: string, type?: string, value?: string, error?: string, autocomplete?: string, max?: number, help?: string}} field
 *   Naam, label, type, waarde, foutmelding, autocomplete, maximale lengte en hulptekst.
 * @returns {any} HTML.
 */
function renderField(field) {
  const id = `veld-${field.name}`;
  const describedBy = [field.help ? `${id}-hulp` : '', field.error ? `${id}-fout` : ''].filter(Boolean).join(' ');
  return html`<div class="field">
    <span class="field__label"><label for="${id}">${field.label}</label> <span class="required" aria-hidden="true">*</span></span>
    <input type="${field.type || 'text'}" id="${id}" name="${field.name}" value="${field.value || ''}" required${field.max ? html` maxlength="${field.max}"` : ''}${field.autocomplete ? html` autocomplete="${field.autocomplete}"` : ''}${describedBy ? html` aria-describedby="${describedBy}"` : ''}${field.error ? raw(' aria-invalid="true"') : ''}>
    ${field.help ? html`<span class="field__help" id="${id}-hulp">${field.help}</span>` : ''}
    ${field.error ? html`<span class="field__error" id="${id}-fout">${field.error}</span>` : ''}
  </div>`;
}

/**
 * Het kader om een accountscherm: inleiding, melding en inhoud.
 * @param {{intro?: any, alert?: string, notice?: string, content: any}} parts Onderdelen.
 * @returns {any} HTML.
 */
function frame(parts) {
  return html`<div class="content-main">
    <section class="page-content"><div class="page-content__form account">
      ${parts.intro ? html`<div class="account__intro">${parts.intro}</div>` : ''}
      ${parts.notice ? html`<p class="notice" role="status">${parts.notice}</p>` : ''}
      ${parts.alert ? html`<div class="form-alert" role="alert">${parts.alert}</div>` : ''}
      ${parts.content}
    </div></section>
  </div>`;
}

/**
 * Het inlogscherm.
 * @param {{email?: string, error?: string, notice?: string}} state Ingevuld adres, foutmelding en melding.
 * @returns {any} HTML.
 */
function loginView(state = {}) {
  return frame({
    intro: html`<p>Log in om je reizen te bekijken. Nog geen account? <a href="/account/registreren/">Maak er een aan</a> met het e-mailadres waarmee je je aanmeldt.</p>`,
    notice: state.notice,
    alert: state.error,
    content: html`<form class="form form--theme" method="post" action="/account/inloggen/" novalidate>
      ${renderField({ name: 'email', label: 'E-mailadres', type: 'email', value: state.email, autocomplete: 'username', max: 200 })}
      ${renderField({ name: 'password', label: 'Wachtwoord', type: 'password', autocomplete: 'current-password', max: MAX_LENGTH })}
      <div class="form__footer"><button class="btn" type="submit">Inloggen</button></div>
      <p class="account__links"><a href="/account/wachtwoord-vergeten/">Wachtwoord vergeten?</a></p>
    </form>`,
  });
}

/**
 * Het registratiescherm.
 * @param {{values?: any, errors?: any, hiddenFields: any, captchaField: (any|string)}} state Waarden,
 *   fouten, de verborgen velden van de formulierbeveiliging en het captchaveld.
 * @returns {any} HTML.
 */
function registerView(state) {
  const values = state.values || {};
  const errors = state.errors || {};
  return frame({
    intro: html`<p>Met een account zie je je komende en eerdere reizen. Gebruik het e-mailadres waarmee je je aanmeldt voor een reis. Je krijgt een mail om het adres te bevestigen.</p>
      <p>Heb je al een account? <a href="/account/inloggen/">Log in</a>.</p>`,
    alert: errors._form || (Object.keys(errors).length ? 'Controleer de gemarkeerde velden.' : ''),
    content: html`<form class="form form--theme" method="post" action="/account/registreren/" novalidate>
      ${state.hiddenFields}${state.captchaField}
      ${renderField({ name: 'email', label: 'E-mailadres', type: 'email', value: values.email, error: errors.email, autocomplete: 'email', max: 200 })}
      ${renderField({ name: 'password', label: 'Wachtwoord', type: 'password', error: errors.password, autocomplete: 'new-password', max: MAX_LENGTH, help: `Minimaal ${MIN_LENGTH} tekens. Een zin van een paar woorden is sterk en makkelijk te onthouden.` })}
      ${renderField({ name: 'password2', label: 'Wachtwoord herhalen', type: 'password', error: errors.password2, autocomplete: 'new-password', max: MAX_LENGTH })}
      <div class="form__footer"><button class="btn" type="submit">Account aanmaken</button></div>
    </form>`,
  });
}

/**
 * Melding na registreren of wachtwoord vergeten: altijd dezelfde tekst, of het adres nu een account heeft of niet.
 * @param {string} message De melding.
 * @returns {any} HTML.
 */
function mailSentView(message) {
  return frame({
    content: html`<div class="account__done"><p>${message}</p><p>Geen mail gekregen? Kijk ook bij ongewenste mail, of probeer het over een paar minuten opnieuw.</p>
      <p><a class="btn" href="/account/inloggen/">Naar inloggen</a></p></div>`,
  });
}

/**
 * Bevestigen: inloggen met het wachtwoord van de registratie (de link alleen is niet genoeg).
 * @param {{token: string, error?: string}} state Token uit de link en foutmelding.
 * @returns {any} HTML.
 */
function verifyView(state) {
  return frame({
    intro: html`<p>Bijna klaar. Vul het wachtwoord in dat je bij het aanmaken van je account koos om je e-mailadres te bevestigen.</p>`,
    alert: state.error,
    content: html`<form class="form form--theme" method="post" action="/account/bevestigen/" novalidate>
      <input type="hidden" name="token" value="${state.token}">
      ${renderField({ name: 'password', label: 'Wachtwoord', type: 'password', autocomplete: 'current-password', max: MAX_LENGTH })}
      <div class="form__footer"><button class="btn" type="submit">Account bevestigen</button></div>
    </form>`,
  });
}

/**
 * Melding bij een verlopen, gebruikte of onbekende link.
 * @param {string} again Pad om een nieuwe link aan te vragen.
 * @returns {any} HTML.
 */
function invalidLinkView(again) {
  return frame({
    content: html`<div class="account__done"><p>Deze link is verlopen, al gebruikt of klopt niet.</p>
      <p><a class="btn" href="${again}">Vraag een nieuwe link aan</a></p></div>`,
  });
}

/**
 * Wachtwoord vergeten: e-mailadres invullen.
 * @param {{values?: any, errors?: any, hiddenFields: any, captchaField: (any|string)}} state Waarden,
 *   fouten, de verborgen velden van de formulierbeveiliging en het captchaveld.
 * @returns {any} HTML.
 */
function forgotView(state) {
  const values = state.values || {};
  const errors = state.errors || {};
  return frame({
    intro: html`<p>Vul het e-mailadres van je account in. Je krijgt een mail met een link om een nieuw wachtwoord in te stellen.</p>`,
    alert: errors._form || '',
    content: html`<form class="form form--theme" method="post" action="/account/wachtwoord-vergeten/" novalidate>
      ${state.hiddenFields}${state.captchaField}
      ${renderField({ name: 'email', label: 'E-mailadres', type: 'email', value: values.email, error: errors.email, autocomplete: 'email', max: 200 })}
      <div class="form__footer"><button class="btn" type="submit">Stuur de link</button></div>
    </form>`,
  });
}

/**
 * Nieuw wachtwoord instellen via de link.
 * @param {{token: string, errors?: any}} state Token en fouten.
 * @returns {any} HTML.
 */
function resetView(state) {
  const errors = state.errors || {};
  return frame({
    intro: html`<p>Kies een nieuw wachtwoord. Daarna ben je meteen ingelogd en worden andere apparaten uitgelogd.</p>`,
    alert: errors._form || (Object.keys(errors).length ? 'Controleer de gemarkeerde velden.' : ''),
    content: html`<form class="form form--theme" method="post" action="/account/wachtwoord-herstellen/" novalidate>
      <input type="hidden" name="token" value="${state.token}">
      ${renderField({ name: 'password', label: 'Nieuw wachtwoord', type: 'password', error: errors.password, autocomplete: 'new-password', max: MAX_LENGTH, help: `Minimaal ${MIN_LENGTH} tekens.` })}
      ${renderField({ name: 'password2', label: 'Wachtwoord herhalen', type: 'password', error: errors.password2, autocomplete: 'new-password', max: MAX_LENGTH })}
      <div class="form__footer"><button class="btn" type="submit">Wachtwoord opslaan</button></div>
    </form>`,
  });
}

/**
 * Het overzicht van een ingelogde reiziger.
 * @param {{email: string, csrf: string, notice?: string, content?: any}} state Adres, CSRF-token, melding en de
 *   inhoud van het overzicht (Mijn reizen, J3).
 * @returns {any} HTML.
 */
function overviewView(state) {
  return frame({
    notice: state.notice,
    content: html`<p>Je bent ingelogd als <strong>${state.email}</strong>.</p>
      ${state.content || ''}
      <form method="post" action="/account/uitloggen/" class="account__logout">
        <input type="hidden" name="_csrf" value="${state.csrf}">
        <button class="btn" type="submit">Uitloggen</button>
      </form>`,
  });
}

/**
 * Code per e-mail aanvragen of invullen, vóór een gevoelige actie.
 * @param {{csrf: string, next: string, sent: boolean, error?: string, notice?: string}} state CSRF-token, waar het daarna
 *   heen gaat, of er al een code is verstuurd, foutmelding en melding.
 * @returns {any} HTML.
 */
function codeView(state) {
  return frame({
    intro: html`<p>Voor je gegevens downloaden of je wachtwoord wijzigen vragen we een code die we naar je e-mailadres sturen. Zo is je wachtwoord alleen niet genoeg.</p>`,
    notice: state.notice,
    alert: state.error,
    content: html`${state.sent ? html`<form class="form form--theme" method="post" action="/account/code/" novalidate>
        <input type="hidden" name="_csrf" value="${state.csrf}">
        <input type="hidden" name="next" value="${state.next}">
        ${renderField({ name: 'code', label: 'Code uit de mail', type: 'text', autocomplete: 'one-time-code', max: 6 })}
        <div class="form__footer"><button class="btn" type="submit">Bevestigen</button></div>
      </form>` : ''}
      <form method="post" action="/account/code/versturen/" class="account__code-send">
        <input type="hidden" name="_csrf" value="${state.csrf}">
        <input type="hidden" name="next" value="${state.next}">
        <button class="btn" type="submit">${state.sent ? 'Stuur een nieuwe code' : 'Stuur me een code'}</button>
      </form>`,
  });
}

/**
 * Mijn gegevens met de knop om alles als Excel te downloaden.
 * @param {{content: any, stepUp: boolean}} state De gegevens en of de code al gegeven is.
 * @returns {any} HTML.
 */
function detailsView(state) {
  return frame({
    content: html`${state.content}
      <p>${state.stepUp
        ? html`<a class="btn" href="/account/gegevens/export.xlsx">Download mijn gegevens (Excel)</a>`
        : html`<a class="btn" href="/account/code/?verder=gegevens">Download mijn gegevens (Excel)</a>`}</p>
      <p class="account__links"><a href="/account/">Terug naar Mijn reizen</a></p>`,
  });
}

/**
 * Wachtwoord wijzigen (na de code per e-mail).
 * @param {{csrf: string, errors?: any}} state CSRF-token en fouten.
 * @returns {any} HTML.
 */
function passwordView(state) {
  const errors = state.errors || {};
  return frame({
    intro: html`<p>Kies een nieuw wachtwoord. Andere apparaten worden daarna uitgelogd.</p>`,
    alert: Object.keys(errors).length ? 'Controleer de gemarkeerde velden.' : '',
    content: html`<form class="form form--theme" method="post" action="/account/wachtwoord/" novalidate>
      <input type="hidden" name="_csrf" value="${state.csrf}">
      ${renderField({ name: 'password', label: 'Nieuw wachtwoord', type: 'password', error: errors.password, autocomplete: 'new-password', max: MAX_LENGTH, help: `Minimaal ${MIN_LENGTH} tekens.` })}
      ${renderField({ name: 'password2', label: 'Wachtwoord herhalen', type: 'password', error: errors.password2, autocomplete: 'new-password', max: MAX_LENGTH })}
      <div class="form__footer"><button class="btn" type="submit">Wachtwoord opslaan</button></div>
    </form>
    <p class="account__links"><a href="/account/">Terug naar Mijn reizen</a></p>`,
  });
}

module.exports = { codeView, detailsView, passwordView, loginView, registerView, mailSentView, verifyView, invalidLinkView, forgotView, resetView, overviewView, renderField };
