/**
 * Aanmelding handmatig invoeren in het CRM (`/app/aanmeldingen/nieuw/`), voor een aanmelding die per telefoon, mail of
 * papieren formulier binnenkomt. Dezelfde velden en dezelfde controle als het openbare formulier (`fields.js`,
 * `validateBooking`), dus ook de regel voor een ouder of voogd onder de 16 en de losse toestemmingen voor bijzondere
 * gegevens; opslaan via dezelfde functie (`save-booking.js`). Kantoor vinkt een toestemming alleen aan als de deelnemer
 * (of ouder) die zelf heeft gegeven; de teksten op het scherm zeggen dat.
 *
 * Rechten: `aanmeldingen` voor alle reizen, plus `deelnemers.wijzigen`, `gegevens.identiteit` en `gegevens.gezondheid`
 * (geboortedatum, paspoort, bijzonderheden, noodnummer en ouder horen in die blokken). Het kerkgenootschap staat alleen
 * op het formulier met `gegevens.religie`; zonder dat recht negeert de server het veld.
 * Na het opslaan: een regel in de historie van de aanmelding (hoe hij binnenkwam), het auditlog en, als kantoor dat
 * aanvinkt, de bevestiging aan de deelnemer (en de ouder). Geen melding aan kantoor: kantoor voerde hem zelf in.
 */
const express = require('express');
const { html, raw } = require('../site/html');
const { formatDate, formatPrice, isoDate } = require('../site/format');
const { today } = require('../site/content');
const { FIELD_GROUPS, validateBooking, GUARDIAN_AGE } = require('./fields');
const { createBookingSaver } = require('./save-booking');
const { BLOCKS, BLOCK_RIGHTS } = require('../persons/persons');
const { roleHasRight, roleHasGlobalRight } = require('../crm/rights');
const { fullyBookedSql } = require('../trips/seats');
const { renderCrmPage, renderAlert } = require('../crm/layout');

/** Adres van het formulier (links) en het pad binnen de router van `/app`. */
const BASE = '/app/aanmeldingen/nieuw/';
const ROUTE = '/aanmeldingen/nieuw/';

/** Rechten die nodig zijn naast `aanmeldingen` (voor alle reizen). */
const MANUAL_RIGHTS = ['deelnemers.wijzigen', 'gegevens.identiteit', 'gegevens.gezondheid'];

/** Hoe een aanmelding binnenkwam; komt in de historie van de aanmelding. */
const SOURCES = {
  telefoon: 'Telefonisch',
  papier: 'Papieren formulier',
  mail: 'Per e-mail',
  persoonlijk: 'Persoonlijk',
};

/** Maximale lengte van de toelichting bij het invoeren. */
const NOTE_MAX = 1000;

/** Teksten van de vinkjes voor kantoor: kantoor legt vast wat de deelnemer of ouder zelf heeft gegeven. */
const OFFICE_LABELS = {
  consent: 'De deelnemer (of de ouder of voogd) gaat akkoord met de algemene voorwaarden en de privacyverklaring.',
  consent_religion: 'De deelnemer heeft zelf uitdrukkelijk toestemming gegeven om het kerkgenootschap vast te leggen.',
  consent_health: 'De deelnemer heeft zelf uitdrukkelijk toestemming gegeven om de bijzonderheden over de gezondheid vast te leggen en te delen met de reisleiding.',
  consent_guardian: 'De ouder of voogd heeft zelf toestemming gegeven voor deze aanmelding en voor de gegevens, ook de bijzondere gegevens waarvoor een vinkje is gezet.',
};

/** Acties voor het auditlog (zie `ACTION_LABELS` in `crm/users.js`). */
const MANUAL_ACTION_LABELS = {
  'aanmelding.handmatig': 'Aanmelding handmatig ingevoerd',
};

/**
 * Of een rol aanmeldingen handmatig mag invoeren.
 * @param {string} role Rol.
 * @returns {boolean} Waar met `aanmeldingen` (alle reizen) en de rechten uit `MANUAL_RIGHTS`.
 */
function canEnterManually(role) {
  return roleHasGlobalRight(role, 'aanmeldingen') && MANUAL_RIGHTS.every((right) => roleHasRight(role, right));
}

/**
 * De velden die een rol op het formulier krijgt: een bijzonder veld alleen met het recht voor zijn blok, en het
 * toestemmingsvinkje alleen als het veld erbij zichtbaar is.
 * @param {string} role Rol.
 * @returns {Set<string>} Namen van de velden die verborgen blijven.
 */
function hiddenFieldsFor(role) {
  const hidden = new Set();
  const fields = FIELD_GROUPS.flatMap((group) => group.fields);
  for (const field of fields) {
    const block = Object.keys(BLOCKS).find((name) => BLOCKS[name].includes(field.name));
    if (block && !roleHasRight(role, BLOCK_RIGHTS[block])) hidden.add(field.name);
  }
  for (const field of fields) {
    if (field.consentFor && hidden.has(field.consentFor)) hidden.add(field.name);
  }
  return hidden;
}

/**
 * Leest de toelichting: stuurtekens weg, regeleinden behouden, ingekort.
 * @param {*} value Invoer.
 * @returns {string} Tekst.
 */
function noteField(value) {
  // eslint-disable-next-line no-control-regex
  return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n/g, '\n').trim().slice(0, NOTE_MAX) : '';
}

/**
 * Eén formulierveld met label, hulptekst en foutmelding (zelfde opbouw als het openbare formulier).
 * @param {object} field Veld uit `FIELD_GROUPS`.
 * @param {Record<string, string>} values Ingevulde waarden.
 * @param {Record<string, string>} errors Fouten per veld.
 * @returns {object} HTML.
 */
function renderField(field, values, errors) {
  const id = `veld-${field.name}`;
  const value = values[field.name] || '';
  const error = errors[field.name];
  const describedBy = [field.help ? `${id}-hulp` : '', error ? `${id}-fout` : ''].filter(Boolean).join(' ');
  const common = html` id="${id}" name="${field.name}"${field.required ? raw(' required') : ''}${field.max ? html` maxlength="${field.max}"` : ''}${describedBy ? html` aria-describedby="${describedBy}"` : ''}${error ? raw(' aria-invalid="true"') : ''}`;
  let control;
  if (field.type === 'radio') {
    control = html`<div class="choice" role="radiogroup" aria-labelledby="${id}-label">${field.options.map((option) => html`<label><input type="radio" name="${field.name}" value="${option.value}"${value === option.value ? raw(' checked') : ''}${field.required ? raw(' required') : ''}> ${option.label}</label>`)}</div>`;
  } else if (field.type === 'checkbox') {
    control = html`<label class="choice"><input type="checkbox" id="${id}" name="${field.name}" value="ja"${value ? raw(' checked') : ''}${field.required ? raw(' required') : ''}${error ? html` aria-describedby="${id}-fout" aria-invalid="true"` : ''}> <span>${OFFICE_LABELS[field.name] || field.label}</span></label>`;
  } else if (field.type === 'textarea') {
    control = html`<textarea rows="3"${common}>${value}</textarea>`;
  } else {
    control = html`<input type="${field.type || 'text'}" value="${value}" autocomplete="off"${common}>`;
  }
  const label = field.type === 'checkbox' ? '' : html`<span class="field__label" id="${id}-label">${field.type === 'radio' ? field.label : html`<label for="${id}">${field.label}</label>`}${field.required ? html` <span class="required" aria-hidden="true">*</span>` : ''}</span>`;
  return html`<div class="field${field.full || field.type === 'textarea' || field.type === 'checkbox' || field.type === 'radio' ? ' full' : ''}">
    ${label}${control}
    ${field.help && field.type !== 'checkbox' ? html`<span class="field__help" id="${id}-hulp">${field.help}</span>` : ''}
    ${error ? html`<span class="field__error" id="${id}-fout">${error}</span>` : ''}
  </div>`;
}

/**
 * Maakt de routes om een aanmelding handmatig in te voeren.
 * @param {{db: object, auth: object, persons: object, notifications?: object, now?: () => number}} options Database,
 *   sessie- en rechtenlaag, de personenlaag (`createPersons`), de mails aan de reiziger (`mail/notifications.js`) en de
 *   klok (tests).
 * @returns {express.Router} Router.
 */
function createManualBookingRoutes(options) {
  const { db, auth, persons, notifications } = options;
  const router = express.Router();
  const saver = createBookingSaver({ db, persons, now: options.now });
  const loginGuard = auth.requireGlobalRight('aanmeldingen');

  /**
   * Weigert (403) wie naast `aanmeldingen` niet de rechten voor de bijzondere blokken heeft.
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @param {Function} next Volgende.
   * @returns {void}
   */
  const rightsGuard = (req, res, next) => {
    if (canEnterManually(req.user.role)) return next();
    return res.status(403).send(renderCrmPage({
      title: 'Geen toegang', user: req.user, csrf: req.session.csrf, path: '/app/aanmeldingen/',
      body: html`<p>Je hebt geen recht om aanmeldingen in te voeren. <a href="/app/aanmeldingen/">Naar de aanmeldingen</a></p>`,
    }));
  };
  const guard = [loginGuard, rightsGuard];

  /**
   * De reizen waarvoor kantoor iemand kan aanmelden: nog niet vertrokken, met of zonder publicatie.
   * @returns {Promise<object[]>} Reizen met `full`.
   */
  const upcomingTrips = () => db.query(
    `SELECT t.id, t.title, t.trip_code, t.departure_date, t.published, ${fullyBookedSql('t')} AS full
       FROM trips t WHERE t.departure_date >= $1::date
      ORDER BY t.departure_date, t.title, t.id`,
    [today()],
  );

  /**
   * Zoekt de reis uit het formulier en of er nog iemand bij kan.
   * @param {*} value Id uit de querystring of het formulier.
   * @returns {Promise<{trip: (object|null), reason: string}>} De reis en anders de reden.
   */
  const findTrip = async (value) => {
    if (!/^\d{1,9}$/.test(String(value || ''))) return { trip: null, reason: '' };
    const [trip] = await db.query(
      `SELECT t.id, t.slug, t.title, t.trip_code, t.departure_date, t.price_cents, t.extra_costs_cents, t.deposit_cents, t.published,
              ${fullyBookedSql('t')} AS full
         FROM trips t WHERE t.id = $1`,
      [Number(value)],
    );
    if (!trip) return { trip: null, reason: 'Deze reis bestaat niet (meer).' };
    if (isoDate(trip.departure_date) < today()) return { trip, reason: 'Deze reis is al vertrokken.' };
    if (trip.full) return { trip, reason: 'Deze reis is volgeboekt.' };
    return { trip, reason: '' };
  };

  /**
   * De pagina om een reis te kiezen.
   * @param {object} req Express-verzoek.
   * @param {string} [error] Foutmelding.
   * @returns {Promise<string>} HTML-pagina.
   */
  const renderTripChoice = async (req, error) => {
    const trips = await upcomingTrips();
    return renderCrmPage({
      title: 'Aanmelding invoeren',
      user: req.user,
      csrf: req.session.csrf,
      path: '/app/aanmeldingen/',
      body: html`<p>Voor een aanmelding die per telefoon, mail of op papier binnenkomt. Kies eerst de reis.</p>
        ${renderAlert(error)}
        ${trips.length ? html`<form class="form crm-narrow" method="get" action="${BASE}">
          <div class="field"><span class="field__label"><label for="veld-reis">Reis</label></span>
            <select id="veld-reis" name="reis" required><option value="">Kies een reis</option>${trips.map((trip) => html`<option value="${trip.id}"${trip.full ? raw(' disabled') : ''}>${formatDate(trip.departure_date)} · ${trip.title}${trip.trip_code ? ` (${trip.trip_code})` : ''}${trip.full ? ' · volgeboekt' : ''}${trip.published ? '' : ' · concept'}</option>`)}</select></div>
          <div class="crm-actions"><button class="btn" type="submit">Verder</button> <a class="btn btn--outline" href="/app/aanmeldingen/">Annuleren</a></div>
        </form>` : html`<p class="crm-empty">Er zijn geen reizen die nog moeten vertrekken.</p>`}`,
    });
  };

  /**
   * Het formulier voor één reis.
   * @param {object} req Express-verzoek.
   * @param {object} trip De reis.
   * @param {{values?: object, errors?: object}} [state] Ingevulde waarden en fouten.
   * @returns {string} HTML-pagina.
   */
  const renderForm = (req, trip, state = {}) => {
    const values = state.values || { mail_confirmation: 'ja' };
    const errors = state.errors || {};
    const hidden = hiddenFieldsFor(req.user.role);
    const hasErrors = Object.keys(errors).length > 0;
    return renderCrmPage({
      title: 'Aanmelding invoeren',
      user: req.user,
      csrf: req.session.csrf,
      path: '/app/aanmeldingen/',
      body: html`<p><a href="${BASE}">Andere reis kiezen</a></p>
        ${hasErrors ? renderAlert(errors._form || 'Controleer de gemarkeerde velden.') : ''}
        <form class="form crm-narrow crm-narrow--wide crm-manual" method="post" action="${BASE}" novalidate aria-label="Aanmelding invoeren voor ${trip.title}">
          <input type="hidden" name="_csrf" value="${req.session.csrf}">
          <input type="hidden" name="reis" value="${trip.id}">
          <section aria-labelledby="reisgegevens">
            <h2 id="reisgegevens">Reis</h2>
            <dl class="crm-facts">
              <dt>Reis</dt><dd>${trip.title}${trip.trip_code ? ` (${trip.trip_code})` : ''}</dd>
              <dt>Vertrek</dt><dd>${formatDate(trip.departure_date)}</dd>
              ${trip.price_cents ? html`<dt>Reissom</dt><dd>${formatPrice(trip.price_cents)}</dd>` : ''}
            </dl>
          </section>
          ${FIELD_GROUPS.map((group) => {
            const fields = group.fields.filter((field) => !hidden.has(field.name) && field.name !== 'email_confirm');
            if (!fields.length) return '';
            return html`<fieldset${group.guardian ? html` data-guardian="${GUARDIAN_AGE}"` : ''}>
              <legend>${group.title}</legend>
              ${group.guardian ? html`<p class="field__help">Alleen invullen als de deelnemer op de dag van aanmelden jonger is dan ${GUARDIAN_AGE} jaar.</p>` : ''}
              <div class="form-grid">${fields.map((field) => renderField(field, values, errors))}</div>
            </fieldset>`;
          })}
          <fieldset>
            <legend>Bij kantoor</legend>
            <div class="form-grid">
              <div class="field"><span class="field__label"><label for="veld-bron">Binnengekomen</label> <span class="required" aria-hidden="true">*</span></span>
                <select id="veld-bron" name="bron" required${errors.bron ? html` aria-invalid="true" aria-describedby="veld-bron-fout"` : ''}><option value="">Kies</option>${Object.entries(SOURCES).map(([key, label]) => html`<option value="${key}"${values.bron === key ? raw(' selected') : ''}>${label}</option>`)}</select>
                ${errors.bron ? html`<span class="field__error" id="veld-bron-fout">${errors.bron}</span>` : ''}</div>
              <div class="field full"><span class="field__label"><label for="veld-toelichting">Toelichting (niet verplicht)</label></span>
                <textarea id="veld-toelichting" name="toelichting" rows="2" maxlength="${NOTE_MAX}">${values.toelichting || ''}</textarea></div>
              <div class="field full"><label class="choice"><input type="checkbox" name="mail_confirmation" value="ja"${values.mail_confirmation === 'ja' ? raw(' checked') : ''}> <span>Bevestiging mailen naar de deelnemer (en bij een deelnemer onder de ${GUARDIAN_AGE} ook naar de ouder of voogd)</span></label></div>
            </div>
          </fieldset>
          <div class="crm-actions"><button class="btn" type="submit">Aanmelding opslaan</button> <a class="btn btn--outline" href="/app/aanmeldingen/">Annuleren</a></div>
        </form>`,
    });
  };

  router.get(ROUTE, guard, async (req, res, next) => {
    try {
      if (!req.query.reis) return res.send(await renderTripChoice(req));
      const { trip, reason } = await findTrip(req.query.reis);
      if (!trip || reason) return res.status(trip ? 409 : 404).send(await renderTripChoice(req, reason || 'Deze reis bestaat niet (meer).'));
      return res.send(renderForm(req, trip));
    } catch (error) {
      return next(error);
    }
  });

  router.post(ROUTE, guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const body = req.body || {};
      const { trip, reason } = await findTrip(body.reis);
      if (!trip || reason) return res.status(trip ? 409 : 404).send(await renderTripChoice(req, reason || 'Deze reis bestaat niet (meer).'));
      // Wat deze gebruiker niet mag zien, mag hij ook niet invoeren: die velden tellen niet mee.
      const hidden = hiddenFieldsFor(req.user.role);
      const input = Object.fromEntries(Object.entries(body).filter(([name]) => !hidden.has(name)));
      // Kantoor typt het e-mailadres één keer over; de bevestiging is voor de bezoeker van het openbare formulier.
      input.email_confirm = input.email;
      const { values, errors } = validateBooking(input, { today: today() });
      const source = Object.hasOwn(SOURCES, body.bron) ? body.bron : '';
      if (!source) errors.bron = 'Kies hoe de aanmelding binnenkwam.';
      const note = noteField(body.toelichting);
      const mailConfirmation = body.mail_confirmation === 'ja';
      const shown = { ...values, bron: source, toelichting: note, mail_confirmation: mailConfirmation ? 'ja' : '' };
      if (Object.keys(errors).length) return res.status(422).send(renderForm(req, trip, { values: shown, errors }));
      const saved = await saver.saveBooking({
        trip,
        values,
        afterSave: async (client, result) => {
          const historyNote = [`Handmatig ingevoerd (${SOURCES[source].toLowerCase()})`, note].filter(Boolean).join(': ');
          await client.query('INSERT INTO booking_events (booking_id, from_status, to_status, user_id, note) VALUES ($1, NULL, $2, $3, $4)', [result.bookingId, 'nieuw', req.user.id, historyNote]);
          await auth.audit(req, { userId: req.user.id, action: 'aanmelding.handmatig', entity: 'bookings', entityId: result.bookingId }, client);
        },
      });
      if (!saved) return res.status(409).send(renderForm(req, trip, { values: shown, errors: { _form: 'Deze reis is intussen volgeboekt.' } }));
      // De bevestiging wacht niet op de mailserver en gooit nooit.
      if (notifications && mailConfirmation) {
        void notifications.bookingConfirmation({ reference: saved.reference, trip, values, depositCents: saved.depositCents });
        if (values.consent_guardian === 'ja') void notifications.guardianConfirmation({ reference: saved.reference, trip, values });
      }
      return res.redirect(303, `/app/aanmeldingen/${saved.bookingId}/?opgeslagen=handmatig`);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createManualBookingRoutes, canEnterManually, hiddenFieldsFor, MANUAL_ACTION_LABELS, SOURCES };
