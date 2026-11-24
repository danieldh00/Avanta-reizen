// @ts-check
/**
 * Contactformulier onder de inhoud van `/contact/`. Een bericht komt in de tabel contact_messages (status 'nieuw'),
 * zodat het CRM het later kan tonen; daarna gaat er een melding naar kantoor (`mail/notifications.js`, als die aan staat). Komt een bezoeker vanaf een reis
 * (`/contact/?reis=<slug>`), dan wordt die reis bij het bericht bewaard.
 * Bescherming via `security/form-guard.js`: limiet per bezoeker, herkomst, honeypot en ondertekend tijdstempel; met
 * een actieve captcha (`security/captcha.js`) ook een onzichtbare controle door Google.
 * De pagina zelf wordt door `site/routes.js` opgebouwd; dit bestand levert het formulier en de verwerking.
 */
const express = require('express');
const { html, raw } = require('../site/html');
const { createContent } = require('../site/content');
const { createFormGuard } = require('../security/form-guard');
const { CONTACT_FIELDS, validateContact } = require('./fields');
const { captchaField } = require('../security/captcha');

/** Adres van de bedanktmelding na een geslaagde inzending. */
const THANKS_PATH = '/contact/?verzonden=1';

/**
 * Leest een reis-slug uit de querystring of het formulier; alleen redelijke tekens en lengte.
 * @param {*} value Waarde.
 * @returns {string} Slug of leeg.
 */
function tripSlugFrom(value) {
  const slug = typeof value === 'string' ? value.trim() : '';
  return slug && slug.length <= 200 && /^[a-z0-9][a-z0-9-]*$/i.test(slug) ? slug : '';
}

/**
 * Bouwt het contactformulier met verwerking.
 * @param {{db: any, formKey: Buffer, notifications?: any, captcha?: any, now?: () => number}} options Database,
 *   sleutel voor het formuliertoken, de meldingen aan kantoor, de captcha en (voor tests) de klok.
 * @returns {{middleware: Function[], findTrip: Function, renderForm: Function, renderThanks: Function, submit: Function}} Het formulier.
 */
function createContactForm(options) {
  const content = createContent(options.db);
  const guard = createFormGuard({
    purpose: 'contact',
    formKey: options.formKey,
    limit: 5,
    windowMs: 10 * 60 * 1000,
    limitMessage: 'Te veel berichten in korte tijd. Probeer het over tien minuten opnieuw.',
    now: options.now,
  });

  /**
   * Zoekt de (gepubliceerde) reis waar een bezoeker vandaan komt.
   * @param {*} value Slug uit querystring of formulier.
   * @returns {Promise<(any|null)>} De reis, of null.
   */
  const findTrip = async (value) => {
    const slug = tripSlugFrom(value);
    return slug ? content.tripBySlug(slug) : null;
  };

  /**
   * Eén formulierveld met label, invoer en foutmelding.
   * @param {any} field Veld uit CONTACT_FIELDS.
   * @param {Record<string, string>} values Ingevulde waarden.
   * @param {Record<string, string>} errors Fouten per veld.
   * @returns {any} HTML.
   */
  const renderField = (field, values, errors) => {
    const id = `contact-${field.name}`;
    const value = values[field.name] || '';
    const error = errors[field.name];
    const common = html` id="${id}" name="${field.name}"${field.required ? raw(' required') : ''}${field.max ? html` maxlength="${field.max}"` : ''}${error ? html` aria-describedby="${id}-fout" aria-invalid="true"` : ''}`;
    let control;
    if (field.type === 'checkbox') {
      control = html`<label class="choice choice--consent"><input type="checkbox" value="ja"${common}${value ? raw(' checked') : ''}> <span>${field.label} <a href="/privacy/" target="_blank" rel="noopener">privacy- en cookieverklaring</a>. <span class="required" aria-hidden="true">*</span></span></label>`;
    } else if (field.type === 'textarea') {
      control = html`<textarea rows="8"${common}>${value}</textarea>`;
    } else {
      control = html`<input type="${field.type || 'text'}" value="${value}"${common}${field.autocomplete ? html` autocomplete="${field.autocomplete}"` : ''}>`;
    }
    const label = field.type === 'checkbox' ? '' : html`<span class="field__label"><label for="${id}">${field.label}</label>${field.required ? html` <span class="required" aria-hidden="true">*</span>` : ''}</span>`;
    const wide = field.full || field.type === 'textarea' || field.type === 'checkbox';
    return html`<div class="field${wide ? ' full' : ''}">
      ${label}${control}
      ${error ? html`<span class="field__error" id="${id}-fout">${error}</span>` : ''}
    </div>`;
  };

  /**
   * Het formulier, eventueel met ingevulde waarden, fouten en de reis waar de bezoeker vandaan komt.
   * @param {{values?: Record<string, string>, errors?: Record<string, string>, trip?: (any|null)}} state Toestand.
   * @returns {any} HTML.
   */
  const renderForm = (state = {}) => {
    const errors = state.errors || {};
    const trip = state.trip || null;
    const values = { subject: trip ? `Vraag over ${trip.title}` : '', ...(state.values || {}) };
    return html`<div class="contact-form">
      ${Object.keys(errors).length ? html`<div class="form-alert" role="alert">${errors._form || 'Controleer de gemarkeerde velden.'}</div>` : ''}
      <form class="form form--theme" method="post" action="/contact/" novalidate aria-labelledby="contact-titel">
        ${trip ? html`<input type="hidden" name="reis" value="${trip.slug}">` : ''}
        ${guard.hiddenFields()}
        ${captchaField(options.captcha, 'contact')}
        <div class="form-grid">${CONTACT_FIELDS.map((field) => renderField(field, values, errors))}</div>
        <div class="form__footer"><button class="btn" type="submit">Versturen</button></div>
      </form>
    </div>`;
  };

  /**
   * De melding na het versturen.
   * @returns {any} HTML.
   */
  const renderThanks = () => html`<div class="contact-form">
      <p class="notice" role="status">Bedankt voor je bericht! We nemen zo snel mogelijk contact met je op.</p>
    </div>`;

  /**
   * Verwerkt een inzending. Een ingevulde honeypot krijgt dezelfde bedanktmelding, zonder opslag; een ongeldig,
   * verlopen of te snel token geeft het formulier opnieuw met de ingevulde waarden, een melding en een nieuw token.
   * @param {any} body Ingezonden velden.
   * @param {{ip?: string}} [request] Adres van de bezoeker (voor de captcha).
   * @returns {Promise<({redirect: string}|{values: any, errors: any, trip: (any|null), status?: number})>} Doorsturen, of het formulier met fouten.
   */
  const submit = async (body, request = {}) => {
    if (guard.isBot(body)) return { redirect: THANKS_PATH };
    const trip = await findTrip(body.reis);
    const { values, errors } = validateContact(body);
    const tokenProblem = guard.tokenProblem(body);
    if (tokenProblem) return { values, errors: { ...errors, _form: tokenProblem }, trip };
    if (Object.keys(errors).length) return { values, errors, trip };
    if (options.captcha) {
      const verdict = await options.captcha.check({ token: body.captchaToken, action: 'contact', remoteIp: request.ip });
      if (!verdict.ok) return { values, errors: { _form: verdict.message }, trip, status: verdict.unavailable ? 503 : 422 };
    }
    await options.db.query(
      `INSERT INTO contact_messages (name, email, phone, subject, message, trip_slug, consent_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())`,
      [values.name, values.email.toLowerCase(), values.phone, values.subject, values.message, trip ? trip.slug : null],
    );
    // De melding wacht niet op de mailserver en gooit nooit: de bezoeker krijgt direct de bedanktmelding.
    if (options.notifications) void options.notifications.contactMessage(values, trip);
    return { redirect: THANKS_PATH };
  };

  return {
    middleware: [guard.protect, express.urlencoded({ extended: false, limit: '16kb', parameterLimit: 20 })],
    findTrip,
    renderForm,
    renderThanks,
    submit,
  };
}

module.exports = { createContactForm, THANKS_PATH };
