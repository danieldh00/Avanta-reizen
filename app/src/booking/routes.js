/**
 * Aanmelden voor een reis (`/aanmelden/?id=<oud reis-id>`, zoals op de huidige site). De aanmelding komt in de tabel
 * bookings, de basis voor het CRM. Bijzondere en paspoortgegevens worden versleuteld opgeslagen.
 * Bescherming via `security/form-guard.js`: limiet per bezoeker, herkomst, honeypot en ondertekend tijdstempel.
 */
const crypto = require('node:crypto');
const express = require('express');
const { html, raw } = require('../site/html');
const { renderPage, renderPageHeader } = require('../site/layout');
const { createContent, today } = require('../site/content');
const { formatPrice, formatDate, isoDate, tripPath } = require('../site/format');
const { FIELD_GROUPS, FIELDS, validateBooking } = require('./fields');
const { createFormGuard } = require('../security/form-guard');
const seo = require('../site/seo');

const SGR_CENTS = 500;
const BOOKING_FEE_CENTS = 1500;

/**
 * Bouwt de router voor aanmeldingen.
 * @param {{db: object, vault: object, formKey: Buffer, siteUrl?: string, now?: () => number}} options Database, kluis, sleutel voor het
 *   formuliertoken en basisadres voor de canonical (standaard `SITE_URL`).
 * @returns {express.Router} De router.
 */
function createBookingRouter(options) {
  const router = express.Router({ strict: true });
  const content = createContent(options.db);
  const now = options.now || Date.now;
  const siteUrl = seo.normalizeSiteUrl(options.siteUrl ?? process.env.SITE_URL);
  const guard = createFormGuard({
    purpose: 'aanmelden',
    formKey: options.formKey,
    limit: 5,
    windowMs: 10 * 60 * 1000,
    limitMessage: 'Te veel aanmeldingen in korte tijd. Probeer het over tien minuten opnieuw.',
    now,
  });

  /**
   * Zoekt de reis waarvoor iemand zich aanmeldt en of dat (nog) kan.
   * @param {object} query Querystring of formulier (id of reis).
   * @returns {Promise<{trip: (object|null), reason: string}>} De reis en anders de reden.
   */
  const findBookableTrip = async (query) => {
    const legacyId = Number.parseInt(query.id, 10);
    let trip = Number.isSafeInteger(legacyId) && legacyId > 0 ? await content.tripByLegacyId(legacyId) : null;
    if (!trip && typeof query.reis === 'string' && query.reis.length <= 200) trip = await content.tripBySlug(query.reis);
    if (!trip) return { trip: null, reason: 'Deze reis bestaat niet (meer).' };
    if (trip.fully_booked) return { trip, reason: 'Deze reis is volgeboekt.' };
    if (isoDate(trip.departure_date) < today()) return { trip, reason: 'Deze reis is al vertrokken.' };
    return { trip, reason: '' };
  };

  /**
   * Canonical-pad van de aanmeldpagina: met het oude reis-id (zoals de links op de site), anders met de slug.
   * @param {(object|null)} trip De reis, of null.
   * @returns {string} Pad met querystring.
   */
  const canonicalPath = (trip) => {
    if (!trip) return '/aanmelden/';
    return trip.legacy_id ? `/aanmelden/?id=${trip.legacy_id}` : `/aanmelden/?reis=${encodeURIComponent(trip.slug)}`;
  };

  /**
   * Stuurt een pagina; altijd noindex, met een canonical naar de aanmeldpagina van de reis.
   * @param {object} res Express-antwoord.
   * @param {object} page Gegevens voor renderPage, met eventueel `trip` voor de canonical.
   * @param {number} [status] HTTP-status.
   * @returns {void}
   */
  const send = (res, page, status = 200) => {
    const { trip, ...rest } = page;
    const pageSeo = { canonicalUrl: seo.absoluteUrl(siteUrl, canonicalPath(trip)), imageUrl: seo.absoluteUrl(siteUrl, '/images/logo.png') };
    res.status(status).set('Cache-Control', 'no-store').type('html').send(renderPage({ indexable: false, path: '/reis/', seo: pageSeo, contact: res.locals.contact, ...rest }));
  };

  /**
   * Eén formulierveld met label, hulptekst en foutmelding.
   * @param {object} field Veld uit FIELDS.
   * @param {Record<string, string>} values Ingevulde waarden.
   * @param {Record<string, string>} errors Fouten per veld.
   * @returns {object} HTML.
   */
  const renderField = (field, values, errors) => {
    const id = `veld-${field.name}`;
    const value = values[field.name] || '';
    const error = errors[field.name];
    const describedBy = [field.help ? `${id}-hulp` : '', error ? `${id}-fout` : ''].filter(Boolean).join(' ');
    const common = html` id="${id}" name="${field.name}"${field.required ? raw(' required') : ''}${field.max ? html` maxlength="${field.max}"` : ''}${describedBy ? html` aria-describedby="${describedBy}"` : ''}${error ? raw(' aria-invalid="true"') : ''}`;
    let control;
    if (field.type === 'radio') {
      control = html`<div class="choice" role="radiogroup" aria-labelledby="${id}-label">${field.options.map((option) => html`<label><input type="radio" name="${field.name}" value="${option.value}"${value === option.value ? raw(' checked') : ''}${field.required ? raw(' required') : ''}> ${option.label}</label>`)}</div>`;
    } else if (field.type === 'checkbox') {
      control = html`<label class="choice"><input type="checkbox" id="${id}" name="${field.name}" value="ja"${value ? raw(' checked') : ''} required> ${field.label} <a href="/algemene-voorwaarden/" target="_blank" rel="noopener">Voorwaarden</a> · <a href="/privacy/" target="_blank" rel="noopener">Privacy</a></label>`;
    } else if (field.type === 'textarea') {
      control = html`<textarea rows="4"${common}>${value}</textarea>`;
    } else {
      const autocomplete = { first_names: 'given-name', last_name: 'family-name', email: 'email', email_confirm: 'email', mobile: 'tel', phone: 'tel', street: 'street-address', postal_code: 'postal-code', city: 'address-level2', birth_date: 'bday' }[field.name];
      control = html`<input type="${field.type || 'text'}" value="${value}"${common}${autocomplete ? html` autocomplete="${autocomplete}"` : ''}>`;
    }
    const label = field.type === 'checkbox' ? '' : html`<span class="field__label" id="${id}-label">${field.type === 'radio' ? field.label : html`<label for="${id}">${field.label}</label>`}${field.required ? html` <span class="required" aria-hidden="true">*</span>` : ''}</span>`;
    return html`<div class="field${field.full || field.type === 'textarea' || field.type === 'checkbox' || field.type === 'radio' ? ' full' : ''}">
      ${label}${control}
      ${field.help ? html`<span class="field__help" id="${id}-hulp">${field.help}</span>` : ''}
      ${error ? html`<span class="field__error" id="${id}-fout">${error}</span>` : ''}
    </div>`;
  };

  /**
   * Het hele formulier met de reisgegevens bovenaan.
   * @param {object} trip De reis.
   * @param {Record<string, string>} values Ingevulde waarden.
   * @param {Record<string, string>} errors Fouten per veld.
   * @returns {object} HTML.
   */
  const renderForm = (trip, values, errors) => {
    const hasErrors = Object.keys(errors).length > 0;
    return html`<div class="container container--narrow section">
      <p>Doorloop onderstaande stappen om je aan te melden voor de reis.</p>
      ${hasErrors ? html`<div class="form-alert" role="alert">${errors._form || 'Controleer de gemarkeerde velden.'}</div>` : ''}
      <form class="form" method="post" action="/aanmelden/" novalidate>
        <input type="hidden" name="id" value="${trip.legacy_id || ''}">
        <input type="hidden" name="reis" value="${trip.slug}">
        ${guard.hiddenFields()}
        <section class="form-summary" aria-label="Reisgegevens">
          <dl>
            <dt>Reis</dt><dd><a href="${tripPath(trip.slug)}">${trip.title}</a></dd>
            ${trip.trip_code ? html`<dt>Reiscode</dt><dd>${trip.trip_code}</dd>` : ''}
            <dt>Datum</dt><dd>${formatDate(trip.departure_date)}</dd>
            ${trip.price_cents ? html`<dt>Reissom</dt><dd>${formatPrice(trip.price_cents)}</dd>` : ''}
            ${trip.extra_costs_cents ? html`<dt>Bijkomende kosten</dt><dd>${formatPrice(trip.extra_costs_cents)} (ter plaatse)</dd>` : ''}
            <dt>SGR-garantie</dt><dd>${formatPrice(SGR_CENTS)}</dd>
            <dt>Boekingskosten</dt><dd>${formatPrice(BOOKING_FEE_CENTS)} (vervalt bij betaling van het totaalbedrag)</dd>
          </dl>
        </section>
        ${FIELD_GROUPS.map((group) => html`<fieldset>
          <legend>${group.title}</legend>
          ${group.intro ? html`<p class="field__help">${group.intro}</p>` : ''}
          <div class="form-grid">${group.fields.map((field) => renderField(field, values, errors))}</div>
        </fieldset>`)}
        <div><button class="btn btn--large" type="submit">Verstuur aanmelding</button></div>
      </form>
    </div>`;
  };

  router.get('/aanmelden/', async (req, res, next) => {
    try {
      if (!req.query.id && !req.query.reis) return res.redirect(302, '/reis/');
      const { trip, reason } = await findBookableTrip(req.query);
      if (!trip || reason) {
        return send(res, {
          title: 'Aanmelden',
          header: renderPageHeader({ title: 'Aanmelden' }),
          body: html`<div class="container section"><p class="notice">${reason}</p><p><a class="btn" href="/reis/">Bekijk ons reisaanbod</a></p></div>`,
          trip,
        }, trip ? 409 : 404);
      }
      return send(res, { trip, title: `Aanmelden: ${trip.title}`, header: renderPageHeader({ title: 'Aanmelden', subtitle: trip.title }), body: renderForm(trip, {}, {}) });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/aanmelden/', express.urlencoded({ extended: false, limit: '32kb', parameterLimit: 80 }), guard.protect, async (req, res, next) => {
    try {
      const body = req.body || {};
      const { trip, reason } = await findBookableTrip(body);
      if (!trip || reason) {
        return send(res, { title: 'Aanmelden', header: renderPageHeader({ title: 'Aanmelden' }), body: html`<div class="container section"><p class="notice">${reason}</p></div>`, trip }, trip ? 409 : 404);
      }
      // Een ingevulde honeypot: stil doen alsof het gelukt is, zonder iets op te slaan.
      if (guard.isBot(body)) return res.redirect(303, '/bedankt-voor-je-aanmelding/');

      const { values, errors } = validateBooking(body, { today: today() });
      // Ongeldig, verlopen of te snel token: formulier opnieuw tonen met de waarden en een nieuw token, niets opslaan.
      const tokenProblem = guard.tokenProblem(body);
      if (tokenProblem) {
        return send(res, { trip, title: `Aanmelden: ${trip.title}`, header: renderPageHeader({ title: 'Aanmelden', subtitle: trip.title }), body: renderForm(trip, values, { ...errors, _form: tokenProblem }) }, 422);
      }
      if (Object.keys(errors).length) {
        return send(res, { trip, title: `Aanmelden: ${trip.title}`, header: renderPageHeader({ title: 'Aanmelden', subtitle: trip.title }), body: renderForm(trip, values, errors) }, 422);
      }
      const sensitive = Object.fromEntries(FIELDS.filter((field) => field.sensitive).map((field) => [field.name, values[field.name]]));
      // Referentiejaar volgens de Nederlandse datum, niet de tijdzone van de server (rond de jaarwisseling verschilt dat).
      const year = new Date(now()).toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' }).slice(0, 4);
      const yes = (name) => values[name] === 'ja';
      const sealed = options.vault.seal(sensitive);
      // De referentie is uniek; bij de (kleine) kans op een botsing opnieuw proberen met een nieuwe referentie.
      for (let attempt = 1; ; attempt++) {
        const reference = `AV-${year}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        try {
          await insertBooking(reference, trip, values, yes, sealed);
          break;
        } catch (error) {
          if (error.code !== '23505' || error.constraint !== 'bookings_reference_key' || attempt >= 3) throw error;
        }
      }
      return res.redirect(303, '/bedankt-voor-je-aanmelding/');
    } catch (error) {
      return next(error);
    }
  });

  /**
   * Slaat een aanmelding op.
   * @param {string} reference Referentie (AV-jjjj-XXXXXXXX).
   * @param {object} trip De reis.
   * @param {object} values Gecontroleerde velden.
   * @param {(name: string) => boolean} yes Of een ja/nee-veld ja is.
   * @param {string} sealed Versleutelde bijzondere gegevens.
   * @returns {Promise<void>}
   */
  const insertBooking = async (reference, trip, values, yes, sealed) => {
    await options.db.query(
      `INSERT INTO bookings (reference, trip_id, trip_code, trip_title, departure_date, gender, first_names, call_name, last_name,
         email, mobile, phone, street, postal_code, city, occupation, travel_with, earlier_trip, credit_card, driver_interest,
         driver_before, driver_when, payment_method, payment_choice, price_cents, sensitive_data, consent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26, now())`,
      [reference, trip.id, trip.trip_code, trip.title, isoDate(trip.departure_date), values.gender, values.first_names, values.call_name,
        values.last_name, values.email.toLowerCase(), values.mobile, values.phone, values.street, values.postal_code.toUpperCase(),
        values.city, values.occupation, values.travel_with, yes('earlier_trip'), yes('credit_card'), yes('driver_interest'),
        yes('driver_before'), values.driver_when, 'handmatig', values.payment_choice, trip.price_cents, sealed],
    );
  };

  return router;
}

module.exports = { createBookingRouter, SGR_CENTS, BOOKING_FEE_CENTS };
