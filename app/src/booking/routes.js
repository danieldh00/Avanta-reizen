/**
 * Aanmelden voor een reis (`/aanmelden/?id=<oud reis-id>`, zoals op de huidige site). De aanmelding komt in de tabel
 * bookings, de persoon in persons (`persons/persons.js`, ontdubbeld). Bijzondere en paspoortgegevens worden per categorie
 * versleuteld bij de persoon opgeslagen; art. 9-gegevens alleen met een eigen toestemmingsvinkje (tabel consents). Is de
 * deelnemer jonger dan 16, dan geeft een ouder of voogd de toestemming (`booking/fields.js`, migratie 29). Daarna gaat er
 * een melding naar kantoor en een bevestiging naar de reiziger en, onder de 16, naar de ouder (`mail/notifications.js`,
 * als die aan staan), alle zonder de bijzondere gegevens.
 * Bescherming via `security/form-guard.js`: limiet per bezoeker, herkomst, honeypot en ondertekend tijdstempel; met
 * een actieve captcha (`security/captcha.js`) ook een onzichtbare controle door Google.
 */
const express = require('express');
const { html, raw } = require('../site/html');
const { renderPage, renderPageHeader } = require('../site/layout');
const { createContent, today } = require('../site/content');
const { formatPrice, formatDate, isoDate, tripPath } = require('../site/format');
const { FIELD_GROUPS, validateBooking, GUARDIAN_AGE, SGR_CENTS, BOOKING_FEE_CENTS } = require('./fields');
const { createPersons } = require('../persons/persons');
const { createFormGuard } = require('../security/form-guard');
const { captchaField } = require('../security/captcha');
const seo = require('../site/seo');
const { createSiteContentStore } = require('../site/site-content');
const { DATA_DIR } = require('../paths');
const { createBookingSaver } = require('./save-booking');

/**
 * Bouwt de router voor aanmeldingen.
 * @param {{db: object, vault: object, formKey: Buffer, notifications?: object, captcha?: object, now?: () => number, siteContent?: {load: Function}, prefill?: Function, customerFor?: Function}} options
 *   Database, kluis, sleutel voor het formuliertoken, de meldingen aan kantoor, de captcha, een functie die bij een
 *   ingelogde reiziger de gewone gegevens van de vorige aanmelding geeft (`req => Promise<waarden>`, reizigersaccount
 *   J4), een functie die de ingelogde reiziger geeft (`req => Promise<{accountId, email}|null>`) en de vaste inhoud (kop van
 *   de pagina, standaard `DATA_DIR/site-content.json`). Het basisadres voor de canonical en de overige site-instellingen komen uit `res.locals.site`.
 * @returns {express.Router} De router.
 */
function createBookingRouter(options) {
  const router = express.Router({ strict: true });
  const content = createContent(options.db);
  const persons = createPersons({ vault: options.vault });
  const saver = createBookingSaver({ db: options.db, persons, now: options.now });
  const now = options.now || Date.now;
  const siteContent = options.siteContent || createSiteContentStore(DATA_DIR);
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
    const site = res.locals.site;
    const pageSeo = { canonicalUrl: seo.absoluteUrl(site.siteUrl, canonicalPath(trip)), imageUrl: site.imageUrl };
    res.status(status).set('Cache-Control', 'no-store').type('html').send(renderPage({ ...rest, indexable: false, path: '/reis/', seo: pageSeo, site }));
  };

  /**
   * De kop van de aanmeldpagina zoals de huidige site: foto, "Ja! Ik ga graag mee op reis" en "Aanmelden".
   * @returns {object} HTML.
   */
  const header = () => {
    const archive = siteContent.load().archives.aanmelden;
    return renderPageHeader({ title: archive.title, pretitle: archive.pretitle, imageUrl: archive.image });
  };

  /**
   * Een melding in plaats van het formulier (geen of een onbekende reis, volgeboekt, vertrokken), met een knop naar het
   * reisaanbod.
   * @param {string} reason De melding.
   * @returns {object} HTML.
   */
  const notice = (reason) => html`<div class="content-main">
    <div class="page-introduction">
      <h2>${reason}</h2>
      <a class="btn page-introduction--small" href="/reis/">Naar alle reizen</a>
    </div>
  </div>`;

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
      // Een toestemmingsvinkje voor art. 9 is vrijwillig; het vinkje voor de voorwaarden is verplicht en linkt naar de teksten.
      const links = field.consentFor ? '' : html` <a href="/algemene-voorwaarden/" target="_blank" rel="noopener">Voorwaarden</a> · <a href="/privacy/" target="_blank" rel="noopener">Privacy</a>`;
      control = html`<label class="choice"><input type="checkbox" id="${id}" name="${field.name}" value="ja"${value ? raw(' checked') : ''}${field.required ? raw(' required') : ''}${error ? html` aria-describedby="${id}-fout" aria-invalid="true"` : ''}> ${field.label}${links}</label>`;
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
   * @param {string} [notice] Melding boven het formulier (bijv. gegevens vooraf ingevuld).
   * @returns {object} HTML.
   */
  const renderForm = (trip, values, errors, notice = '') => {
    const hasErrors = Object.keys(errors).length > 0;
    const archive = siteContent.load().archives.aanmelden;
    return html`<div class="content-main">
      ${archive.introduction ? html`<div class="page-introduction">${archive.introduction}</div>` : ''}
      <section class="page-content"><div class="page-content__form apply__form">
      ${notice ? html`<p class="notice" role="status">${notice}</p>` : ''}
      ${hasErrors ? html`<div class="form-alert" role="alert">${errors._form || 'Controleer de gemarkeerde velden.'}</div>` : ''}
      <form class="form form--theme" method="post" action="/aanmelden/" novalidate aria-label="Aanmelden voor ${trip.title}">
        <input type="hidden" name="id" value="${trip.legacy_id || ''}">
        <input type="hidden" name="reis" value="${trip.slug}">
        ${guard.hiddenFields()}
        ${captchaField(options.captcha, 'aanmelden')}
        <section class="form-summary" aria-labelledby="reisgegevens">
          <h2 class="form__section-title" id="reisgegevens">Reisgegevens</h2>
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
        ${FIELD_GROUPS.map((group) => html`<fieldset${group.guardian ? html` data-guardian="${GUARDIAN_AGE}"` : ''}>
          <legend class="form__section-title">${group.title}</legend>
          ${group.intro ? html`<p class="field__help">${group.intro}</p>` : ''}
          <div class="form-grid">${group.fields.map((field) => renderField(field, values, errors))}</div>
        </fieldset>`)}
        <div class="form__footer"><button class="btn" type="submit">Verstuur aanmelding</button></div>
      </form>
      </div></section>
    </div>`;
  };

  router.get('/aanmelden/', async (req, res, next) => {
    try {
      // Zonder reis: dezelfde melding als de huidige site.
      if (!req.query.id && !req.query.reis) return send(res, { title: 'Aanmelden', header: header(), body: notice('Er is geen reis geselecteerd'), trip: null });
      const { trip, reason } = await findBookableTrip(req.query);
      if (!trip || reason) return send(res, { title: 'Aanmelden', header: header(), body: notice(reason), trip }, trip ? 409 : 404);
      // Ingelogde reiziger: de gewone gegevens van de vorige aanmelding alvast invullen (nooit bijzondere gegevens).
      const values = options.prefill ? await options.prefill(req) : {};
      const prefillNotice = values.first_names
        ? 'Je bent ingelogd: we hebben je gegevens van je vorige aanmelding alvast ingevuld. Controleer ze; bijzondere gegevens en je paspoort vragen we opnieuw.'
        : '';
      return send(res, { trip, title: `Aanmelden: ${trip.title}`, header: header(), body: renderForm(trip, values, {}, prefillNotice) });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/aanmelden/', express.urlencoded({ extended: false, limit: '32kb', parameterLimit: 80 }), guard.protect, async (req, res, next) => {
    try {
      const body = req.body || {};
      const { trip, reason } = await findBookableTrip(body);
      if (!trip || reason) {
        return send(res, { title: 'Aanmelden', header: header(), body: notice(reason), trip }, trip ? 409 : 404);
      }
      // Een ingevulde honeypot: stil doen alsof het gelukt is, zonder iets op te slaan.
      if (guard.isBot(body)) return res.redirect(303, '/bedankt-voor-je-aanmelding/');

      const { values, errors } = validateBooking(body, { today: today() });
      // Ongeldig, verlopen of te snel token: formulier opnieuw tonen met de waarden en een nieuw token, niets opslaan.
      const tokenProblem = guard.tokenProblem(body);
      if (tokenProblem) {
        return send(res, { trip, title: `Aanmelden: ${trip.title}`, header: header(), body: renderForm(trip, values, { ...errors, _form: tokenProblem }) }, 422);
      }
      if (Object.keys(errors).length) {
        return send(res, { trip, title: `Aanmelden: ${trip.title}`, header: header(), body: renderForm(trip, values, errors) }, 422);
      }
      // De captcha als laatste: alleen een verder geldige aanmelding kost een controle bij Google.
      if (options.captcha) {
        const verdict = await options.captcha.check({ token: body.captchaToken, action: 'aanmelden', remoteIp: req.ip });
        if (!verdict.ok) {
          return send(res, { trip, title: `Aanmelden: ${trip.title}`, header: header(), body: renderForm(trip, values, { _form: verdict.message }) }, verdict.unavailable ? 503 : 422);
        }
      }
      // Ingelogd met hetzelfde e-mailadres als het account: de aanmelding hoort bij dat account (J4, opnieuw boeken).
      const customer = options.customerFor ? await options.customerFor(req) : null;
      const accountId = customer && customer.email === values.email.toLowerCase() ? customer.accountId : null;
      const saved = await saver.saveBooking({ trip, values, accountId });
      if (!saved) return send(res, { title: 'Aanmelden', header: header(), body: notice('Deze reis is volgeboekt.'), trip }, 409);
      // De melding aan kantoor en de bevestiging aan de reiziger wachten niet op de mailserver en gooien nooit.
      if (options.notifications) {
        const { reference } = saved;
        void options.notifications.booking({ reference, trip, values });
        void options.notifications.bookingConfirmation({ reference, trip, values, depositCents: saved.depositCents });
        // Deelnemer onder de 16: de ouder of voogd krijgt een eigen bevestiging, zodat een valse opgave opvalt.
        if (values.consent_guardian === 'ja') void options.notifications.guardianConfirmation({ reference, trip, values });
      }
      return res.redirect(303, '/bedankt-voor-je-aanmelding/');
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createBookingRouter, SGR_CENTS, BOOKING_FEE_CENTS };
