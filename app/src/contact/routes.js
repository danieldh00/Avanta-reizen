/**
 * Contactformulier onder de inhoud van `/contact/`. Een bericht komt in de tabel contact_messages (status 'nieuw'),
 * zodat het CRM het later kan tonen; er wordt (nog) geen mail verstuurd. Komt een bezoeker vanaf een reis
 * (`/contact/?reis=<slug>`), dan wordt die reis bij het bericht bewaard.
 * Bescherming via `security/form-guard.js`: limiet per bezoeker, herkomst, honeypot en ondertekend tijdstempel.
 * De pagina zelf wordt door `site/routes.js` opgebouwd; dit bestand levert het formulier en de verwerking.
 */
const express = require('express');
const { html, raw } = require('../site/html');
const { createContent } = require('../site/content');
const { createFormGuard } = require('../security/form-guard');
const { CONTACT_FIELDS, validateContact } = require('./fields');

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
 * @param {{db: object, formKey: Buffer, now?: () => number}} options Database, sleutel voor het formuliertoken en (voor tests) de klok.
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
   * @returns {Promise<(object|null)>} De reis, of null.
   */
  const findTrip = async (value) => {
    const slug = tripSlugFrom(value);
    return slug ? content.tripBySlug(slug) : null;
  };

  /**
   * Eén formulierveld met label, invoer en foutmelding.
   * @param {object} field Veld uit CONTACT_FIELDS.
   * @param {Record<string, string>} values Ingevulde waarden.
   * @param {Record<string, string>} errors Fouten per veld.
   * @returns {object} HTML.
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
   * @param {{values?: Record<string, string>, errors?: Record<string, string>, trip?: (object|null)}} state Toestand.
   * @returns {object} HTML.
   */
  const renderForm = (state = {}) => {
    const errors = state.errors || {};
    const trip = state.trip || null;
    const values = { subject: trip ? `Vraag over ${trip.title}` : '', ...(state.values || {}) };
    return html`<section class="container container--narrow section contact-form" aria-labelledby="contact-titel">
      <h2 id="contact-titel">Stuur ons een bericht</h2>
      ${Object.keys(errors).length ? html`<div class="form-alert" role="alert">Controleer de gemarkeerde velden.</div>` : ''}
      <form class="form" method="post" action="/contact/" novalidate>
        ${trip ? html`<input type="hidden" name="reis" value="${trip.slug}">` : ''}
        ${guard.hiddenFields()}
        <div class="form-grid">${CONTACT_FIELDS.map((field) => renderField(field, values, errors))}</div>
        <div><button class="btn btn--large" type="submit">Versturen</button></div>
      </form>
    </section>`;
  };

  /**
   * De melding na het versturen.
   * @returns {object} HTML.
   */
  const renderThanks = () => html`<section class="container container--narrow section contact-form">
      <p class="notice" role="status">Bedankt voor je bericht! We nemen zo snel mogelijk contact met je op.</p>
    </section>`;

  /**
   * Verwerkt een inzending. Bots (honeypot, ongeldig of te snel token) krijgen dezelfde bedanktmelding, zonder opslag.
   * @param {object} body Ingezonden velden.
   * @returns {Promise<({redirect: string}|{values: object, errors: object, trip: (object|null)})>} Doorsturen, of het formulier met fouten.
   */
  const submit = async (body) => {
    if (guard.isSuspicious(body)) return { redirect: THANKS_PATH };
    const trip = await findTrip(body.reis);
    const { values, errors } = validateContact(body);
    if (Object.keys(errors).length) return { values, errors, trip };
    await options.db.query(
      `INSERT INTO contact_messages (name, email, phone, subject, message, trip_slug, consent_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())`,
      [values.name, values.email.toLowerCase(), values.phone, values.subject, values.message, trip ? trip.slug : null],
    );
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
