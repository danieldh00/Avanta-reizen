/**
 * Deelnemers in het CRM (`/app/deelnemers/`): lijst met zoeken, de pagina van één persoon met aanmeldingen en
 * toestemmingen, NAW wijzigen, bijzondere gegevens per blok tonen en wijzigen, en een art. 9-toestemming intrekken
 * (dat wist het blok). Bijzondere gegevens staan nooit in de lijst en op de detailpagina pas na *Toon*: dat is een
 * POST met CSRF en het auditmoment. Alles alleen voor rollen met het recht voor álle deelnemers (de reisleider krijgt
 * later alleen zijn eigen vertrekken); wijzigen vraagt `deelnemers.wijzigen`, elk blok bovendien zijn `gegevens.*`-recht.
 */
const express = require('express');
const { html, raw } = require('../site/html');
const { formatDate } = require('../site/format');
const { today } = require('../site/content');
const { FIELDS, validateFields } = require('../booking/fields');
const { roleHasRight } = require('../crm/rights');
const { PLAIN_FIELDS, BLOCKS, BLOCK_RIGHTS, BLOCK_CONSENTS, LEGACY_ART9_TEXT_VERSION } = require('./persons');
const { renderCrmPage, renderAlert, formatDateTime } = require('../crm/layout');
const ui = require('../crm/ui');

/** Aantal personen per pagina van de lijst. */
const PAGE_SIZE = 50;

/** Hoogstens zoveel zoekwoorden. */
const MAX_TERMS = 5;

/** Namen van de blokken voor het scherm en in het auditlog. */
const BLOCK_INFO = {
  identity_data: { label: 'Identiteit en paspoort', slug: 'identiteit' },
  special_data: { label: 'Kerkgenootschap', slug: 'religie' },
  health_data: { label: 'Bijzonderheden (gezondheid)', slug: 'gezondheid' },
  emergency_data: { label: 'Noodnummer', slug: 'noodnummer' },
  guardian_data: { label: 'Ouder of voogd (deelnemer onder 16)', slug: 'ouder' },
};

/** Omschrijving van de toestemmingen. */
const CONSENT_LABELS = {
  voorwaarden: 'Algemene voorwaarden en privacyverklaring',
  art9_religie: 'Kerkgenootschap vastleggen (art. 9)',
  art9_gezondheid: 'Gezondheid vastleggen en delen met de reisleiding (art. 9)',
  ouder_voogd: 'Aanmelding door ouder of voogd (deelnemer onder 16)',
};

/** Wie een toestemming gaf (kolom `consents.given_by`, migratie 29). */
const GIVEN_BY_LABELS = { deelnemer: 'Deelnemer', ouder_voogd: 'Ouder of voogd' };

/** Acties voor het auditlog (zie `ACTION_LABELS` in `crm/users.js`). */
const PERSON_ACTION_LABELS = {
  'deelnemer.gewijzigd': 'Deelnemer gewijzigd (NAW en contact)',
  ...Object.fromEntries(Object.values(BLOCK_INFO).flatMap((info) => [
    [`deelnemer.toon.${info.slug}`, `Deelnemer: ${info.label.toLowerCase()} ingezien`],
    [`deelnemer.blok.${info.slug}`, `Deelnemer: ${info.label.toLowerCase()} gewijzigd`],
  ])),
  ...Object.fromEntries(Object.keys(BLOCK_CONSENTS).map((block) => [
    `deelnemer.toestemming.ingetrokken.${BLOCK_INFO[block].slug}`, `Deelnemer: toestemming ${BLOCK_INFO[block].label.toLowerCase()} ingetrokken (gegevens gewist)`,
  ])),
};

/**
 * Of een toestemming in het CRM los in te trekken is. Alleen de art. 9-toestemmingen: intrekken wist hun blok. De
 * voorwaarden en de toestemming van de ouder of voogd horen bij de aanmelding zelf; die eindigen met annuleren of
 * wissen (recht `avg`), niet met deze knop.
 * @param {string} kind Soort toestemming.
 * @returns {boolean} Waar voor een art. 9-toestemming.
 */
function isWithdrawable(kind) {
  return Object.values(BLOCK_CONSENTS).includes(kind);
}

/** Formuliervelden op naam. */
const FIELD_BY_NAME = Object.fromEntries(FIELDS.map((field) => [field.name, field]));

/**
 * Leest de zoekwoorden uit de querystring en maakt er LIKE-patronen van (met escaping van `%`, `_` en `\`).
 * @param {*} value Invoer `q`.
 * @returns {{text: string, patterns: string[]}} De zoektekst en de patronen (elk woord moet voorkomen).
 */
function searchPatterns(value) {
  const text = typeof value === 'string' ? value.trim().slice(0, 100) : '';
  const terms = text.toLowerCase().split(/\s+/).filter(Boolean).slice(0, MAX_TERMS);
  return { text, patterns: terms.map((term) => `%${term.replace(/[\\%_]/g, '\\$&')}%`) };
}

/**
 * Eén bewerkbaar veld (tekst, datum, keuzelijst of tekstvak) met label en foutmelding.
 * @param {object} field Veld uit FIELDS.
 * @param {string} value Huidige waarde.
 * @param {string} [error] Foutmelding.
 * @returns {object} HTML.
 */
function renderEditField(field, value, error) {
  const id = `veld-${field.name}`;
  const common = html` id="${id}" name="${field.name}"${field.required ? raw(' required') : ''}${field.max ? html` maxlength="${field.max}"` : ''}${error ? html` aria-invalid="true" aria-describedby="${id}-fout"` : ''}`;
  let control;
  if (field.options) {
    control = html`<select${common}><option value="">–</option>${field.options.map((option) => html`<option value="${option.value}"${option.value === value ? raw(' selected') : ''}>${option.label}</option>`)}</select>`;
  } else if (field.type === 'textarea') {
    control = html`<textarea rows="4"${common}>${value}</textarea>`;
  } else {
    control = html`<input type="${field.type === 'date' || field.type === 'email' || field.type === 'tel' ? field.type : 'text'}" value="${value}" autocomplete="off"${common}>`;
  }
  return html`<div class="field">
    <span class="field__label"><label for="${id}">${field.label}</label></span>
    ${control}
    ${error ? html`<span class="field__error" id="${id}-fout">${error}</span>` : ''}
  </div>`;
}

/**
 * Maakt de routes voor deelnemers.
 * @param {{db: object, auth: object, persons: object, now?: () => number}} options Database, sessie- en rechtenlaag, de personen (`persons/persons.js`) en (voor tests) de klok van de limieten.
 * @returns {express.Router} Router.
 */
function createPersonRoutes(options) {
  const { db, auth, persons } = options;
  // Pas hier laden: person-privacy-routes gebruikt BLOCK_INFO uit dit bestand.
  const { createPersonPrivacyRoutes, renderPrivacyPanel } = require('./person-privacy-routes');
  const router = express.Router();
  const canView = auth.requireGlobalRight('deelnemers');
  const canEdit = [canView, auth.requireRight('deelnemers.wijzigen')];

  /**
   * Zoekt een persoon op id (zie `persons.findPerson`).
   * @param {string} id Id uit de URL.
   * @returns {Promise<(object|null)>} Persoon, of null.
   */
  const findPerson = (id) => persons.findPerson(db, id);

  /**
   * 404-pagina binnen het CRM.
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @returns {void}
   */
  const notFound = (req, res) => res.status(404).send(renderCrmPage({
    title: 'Niet gevonden', user: req.user, csrf: req.session.csrf, path: '/app/deelnemers/', body: html`<p>Deze deelnemer bestaat niet. <a href="/app/deelnemers/">Naar de deelnemers</a></p>`,
  }));

  /**
   * Weigert met 403 als de gebruiker het recht van een blok niet heeft.
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @param {string} block Naam van het blok.
   * @returns {boolean} Waar als het verzoek is afgehandeld (geweigerd).
   */
  const refuseBlock = (req, res, block) => {
    if (roleHasRight(req.user.role, BLOCK_RIGHTS[block])) return false;
    res.status(403).type('text').send('Je hebt geen toegang tot deze gegevens.');
    return true;
  };

  /**
   * Of er voor een art. 9-blok een geldige (niet ingetrokken) toestemming is. Een regel uit een omgezette oude
   * aanmelding (`LEGACY_ART9_TEXT_VERSION`) telt niet: die toestemming is nooit los gegeven.
   * @param {{query: Function}} client Database of transactie-client.
   * @param {number} personId Id van de persoon.
   * @param {string} block Naam van het blok.
   * @returns {Promise<boolean>} Waar als het blok geen toestemming vraagt of er een is.
   */
  const hasConsentFor = async (client, personId, block) => {
    if (!BLOCK_CONSENTS[block]) return true;
    const [row] = await client.query(
      'SELECT EXISTS (SELECT 1 FROM consents WHERE person_id = $1 AND kind = $2 AND withdrawn_at IS NULL AND text_version <> $3) AS present',
      [personId, BLOCK_CONSENTS[block], LEGACY_ART9_TEXT_VERSION],
    );
    return row.present;
  };

  router.get('/deelnemers/', canView, async (req, res, next) => {
    try {
      const { text, patterns } = searchPatterns(req.query.q);
      const onlyDuplicates = req.query.dubbel === '1';
      const page = Math.min(Math.max(Number.parseInt(req.query.pagina, 10) || 1, 1), 10000);
      const [rows, [totals]] = await Promise.all([
        db.query(
          `SELECT p.id, p.first_names, p.call_name, p.last_name, p.email, p.mobile, p.city, p.duplicate_of, p.last_activity_at, p.anonymized_at,
                  (SELECT count(*)::int FROM bookings b WHERE b.person_id = p.id) AS booking_count
             FROM persons p
            WHERE NOT EXISTS (
                    SELECT 1 FROM unnest($1::text[]) AS term
                     WHERE lower(p.last_name || ' ' || p.first_names || ' ' || p.call_name || ' ' || p.email || ' ' || p.city) NOT LIKE term
                  )
              AND ($2::boolean IS FALSE OR p.duplicate_of IS NOT NULL)
            ORDER BY lower(p.last_name), lower(p.first_names), p.id
            LIMIT $3 OFFSET $4`,
          [patterns, onlyDuplicates, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE],
        ),
        // Aantallen binnen de zoektekst, voor de filterknoppen.
        db.query(
          `SELECT count(*)::int AS total, count(p.duplicate_of)::int AS duplicates
             FROM persons p
            WHERE NOT EXISTS (
                    SELECT 1 FROM unnest($1::text[]) AS term
                     WHERE lower(p.last_name || ' ' || p.first_names || ' ' || p.call_name || ' ' || p.email || ' ' || p.city) NOT LIKE term
                  )`,
          [patterns],
        ),
      ]);
      const list = rows.slice(0, PAGE_SIZE);
      return res.send(renderCrmPage({
        title: 'Deelnemers',
        user: req.user,
        csrf: req.session.csrf,
        path: '/app/deelnemers/',
        body: html`${ui.renderFilterTabs({
          base: '/app/deelnemers/',
          name: 'dubbel',
          current: onlyDuplicates ? '1' : '',
          params: { q: text },
          options: [{ value: '', label: 'Alle', count: totals.total }, { value: '1', label: 'Mogelijk dubbel', count: totals.duplicates }],
        })}
          ${ui.renderSearch({ action: '/app/deelnemers/', label: 'Zoek op naam, e-mailadres of woonplaats', value: text, hidden: { dubbel: onlyDuplicates ? '1' : '' } })}
          ${ui.renderTable({
          caption: 'Deelnemers',
          empty: 'Geen deelnemers gevonden.',
          rows: list,
          columns: [
            { label: 'Naam', cell: (person) => html`<a href="/app/deelnemers/${person.id}/">${person.anonymized_at ? person.last_name : html`${person.last_name}, ${person.call_name || person.first_names}`}</a>${person.anonymized_at ? html` <span class="crm-badge">geanonimiseerd</span>` : ''}${person.duplicate_of ? html` <span class="crm-badge">mogelijk dubbel</span>` : ''}` },
            { label: 'E-mailadres', cell: (person) => person.email },
            { label: 'Mobiel', cell: (person) => person.mobile },
            { label: 'Woonplaats', cell: (person) => person.city },
            { label: 'Aanmeldingen', numeric: true, cell: (person) => person.booking_count },
            { label: 'Laatste activiteit', cell: (person) => formatDateTime(person.last_activity_at) },
          ],
        })}
          ${ui.renderPager({ base: '/app/deelnemers/', params: { q: text, dubbel: onlyDuplicates ? '1' : '' }, page, hasNext: rows.length > PAGE_SIZE })}`,
      }));
    } catch (error) {
      return next(error);
    }
  });

  /**
   * De pagina van één deelnemer.
   * @param {object} req Express-verzoek.
   * @param {object} person De persoon.
   * @param {{values?: object, errors?: object, shown?: string, blockValues?: object, blockErrors?: object, notice?: string, eraseError?: string}} [state]
   *   Ingevulde NAW-waarden en fouten, het geopende blok met zijn waarden en fouten, en een melding.
   * @returns {Promise<string>} HTML-pagina.
   */
  const renderPerson = async (req, person, state = {}) => {
    const values = state.values || person;
    const errors = state.errors || {};
    const canChange = roleHasRight(req.user.role, 'deelnemers.wijzigen') && !person.anonymized_at;
    const canSeeBookings = roleHasRight(req.user.role, 'aanmeldingen');
    const [bookings, consents, duplicates] = await Promise.all([
      db.query(
        `SELECT id, reference, trip_title, trip_code, departure_date, status, created_at FROM bookings
          WHERE person_id = $1 ORDER BY created_at DESC, id DESC`,
        [person.id],
      ),
      db.query('SELECT id, kind, text_version, given_at, given_by, withdrawn_at, booking_id FROM consents WHERE person_id = $1 ORDER BY given_at DESC, id DESC', [person.id]),
      db.query('SELECT id, first_names, last_name FROM persons WHERE duplicate_of = $1 ORDER BY id', [person.id]),
    ]);
    const [original] = person.duplicate_of
      ? await db.query('SELECT id, first_names, last_name FROM persons WHERE id = $1', [person.duplicate_of])
      : [];
    const hidden = html`<input type="hidden" name="_csrf" value="${req.session.csrf}">`;
    const renderBlock = (block) => {
      const info = BLOCK_INFO[block];
      if (!roleHasRight(req.user.role, BLOCK_RIGHTS[block])) {
        return html`<section class="crm-block"><h3>${info.label}</h3><p>Geen toegang met jouw rol.</p></section>`;
      }
      if (state.shown !== block) {
        return html`<section class="crm-block"><h3>${info.label}</h3>
          <p>${person[block] ? 'Ingevuld.' : 'Leeg.'} Inzien wordt vastgelegd in het auditlog.</p>
          <form method="post" action="/app/deelnemers/${person.id}/toon/">${hidden}<input type="hidden" name="block" value="${block}">
            <button class="btn btn--outline btn--small" type="submit">Toon</button></form></section>`;
      }
      const data = state.blockValues || persons.openBlock(block, person);
      const blockErrors = state.blockErrors || {};
      const fields = BLOCKS[block].map((name) => FIELD_BY_NAME[name]);
      if (!canChange) {
        return html`<section class="crm-block"><h3>${info.label}</h3><dl class="crm-facts">${fields.map((field) => html`<dt>${field.label}</dt><dd>${data[field.name] || '–'}</dd>`)}</dl></section>`;
      }
      return html`<section class="crm-block"><h3>${info.label}</h3>
        ${renderAlert(blockErrors._form)}
        <form class="form" method="post" action="/app/deelnemers/${person.id}/blok/">${hidden}<input type="hidden" name="block" value="${block}">
          ${fields.map((field) => renderEditField(field, data[field.name] || '', blockErrors[field.name]))}
          <div><button class="btn btn--small" type="submit">Opslaan</button> <a href="/app/deelnemers/${person.id}/">Verbergen</a></div>
        </form></section>`;
    };
    return renderCrmPage({
      title: `${person.first_names} ${person.last_name}`,
      user: req.user,
      csrf: req.session.csrf,
      path: '/app/deelnemers/',
      body: html`<p><a href="/app/deelnemers/">Naar de deelnemers</a> · Aangemaakt ${formatDateTime(person.created_at)} · Laatste activiteit ${formatDateTime(person.last_activity_at)}</p>
        ${state.notice ? html`<p class="notice" role="status">${state.notice}</p>` : ''}
        ${person.anonymized_at ? html`<p class="notice" role="status">Deze persoon is geanonimiseerd op ${formatDateTime(person.anonymized_at)}: naam, adres, contact en bijzondere gegevens zijn gewist. De aanmeldingen blijven voor de boekhouding.</p>` : ''}
        ${original ? html`<div class="notice"><p>Mogelijk dezelfde persoon als <a href="/app/deelnemers/${original.id}/">${original.first_names} ${original.last_name}</a> (#${original.id}).</p>
          ${canChange ? html`<p><a class="btn btn--small" href="/app/deelnemers/${person.id}/samenvoegen/">Samenvoegen</a></p>
          <form method="post" action="/app/deelnemers/${person.id}/niet-dubbel/">${hidden}<button class="btn btn--outline btn--small" type="submit">Geen dubbel, markering weghalen</button></form>` : ''}</div>` : ''}
        ${duplicates.length ? html`<p class="notice">Mogelijk dubbel: ${duplicates.map((item, index) => html`${index ? ', ' : ''}<a href="/app/deelnemers/${item.id}/">${item.first_names} ${item.last_name}</a> (#${item.id})`)}.</p>` : ''}
        <div class="crm-columns">
          <section>
            <h2>Gegevens</h2>
            ${canChange ? html`${renderAlert(errors._form)}
            <form class="form crm-narrow" method="post" action="/app/deelnemers/${person.id}/">${hidden}
              ${PLAIN_FIELDS.map((name) => renderEditField(FIELD_BY_NAME[name], values[name] || '', errors[name]))}
              <div><button class="btn" type="submit">Opslaan</button></div>
            </form>` : html`<dl class="crm-facts">${PLAIN_FIELDS.map((name) => html`<dt>${FIELD_BY_NAME[name].label}</dt><dd>${person[name] || '–'}</dd>`)}</dl>`}
          </section>
          <section>
            <h2>Bijzondere gegevens</h2>
            ${Object.keys(BLOCKS).map(renderBlock)}
          </section>
        </div>
        <h2>Aanmeldingen</h2>
        ${bookings.length ? html`<div class="crm-table-wrap"><table class="crm-table">
          <thead><tr><th scope="col">Referentie</th><th scope="col">Reis</th><th scope="col">Vertrek</th><th scope="col">Status</th><th scope="col">Aangemeld</th></tr></thead>
          <tbody>${bookings.map((booking) => html`<tr><td>${canSeeBookings ? html`<a href="/app/aanmeldingen/${booking.id}/">${booking.reference}</a>` : booking.reference}</td><td>${booking.trip_title}${booking.trip_code ? ` (${booking.trip_code})` : ''}</td><td>${formatDate(booking.departure_date)}</td><td>${booking.status}</td><td>${formatDateTime(booking.created_at)}</td></tr>`)}</tbody>
        </table></div>` : html`<p>Nog geen aanmeldingen.</p>`}
        <h2>Toestemmingen</h2>
        ${consents.length ? html`<div class="crm-table-wrap"><table class="crm-table">
          <thead><tr><th scope="col">Toestemming</th><th scope="col">Gegeven door</th><th scope="col">Tekstversie</th><th scope="col">Gegeven</th><th scope="col">Ingetrokken</th><th scope="col"><span class="visually-hidden">Actie</span></th></tr></thead>
          <tbody>${consents.map((consent) => html`<tr><td>${CONSENT_LABELS[consent.kind] || consent.kind}</td><td>${GIVEN_BY_LABELS[consent.given_by] || consent.given_by}</td><td>${consent.text_version}</td><td>${consent.text_version === LEGACY_ART9_TEXT_VERSION ? html`niet los gegeven (aanmelding ${formatDateTime(consent.given_at)})` : formatDateTime(consent.given_at)}</td><td>${formatDateTime(consent.withdrawn_at)}</td>
            <td>${canChange && isWithdrawable(consent.kind) && !consent.withdrawn_at ? html`<form method="post" action="/app/deelnemers/${person.id}/toestemming/${consent.id}/intrekken/">${hidden}<button class="btn btn--outline btn--small" type="submit">Intrekken en gegevens wissen</button></form>` : ''}</td></tr>`)}</tbody>
        </table></div>` : html`<p>Geen toestemmingen vastgelegd.</p>`}
        ${renderPrivacyPanel(req, person, state.eraseError)}`,
    });
  };

  router.get('/deelnemers/:id(\\d{1,9})/', canView, async (req, res, next) => {
    try {
      const person = await findPerson(req.params.id);
      if (!person) return notFound(req, res);
      const notices = { '1': 'De gegevens zijn opgeslagen.', samengevoegd: 'De deelnemers zijn samengevoegd; het dubbel is verwijderd.', ingetrokken: 'De toestemming is ingetrokken en de bijbehorende gegevens zijn gewist.', gewist: 'De persoon is gewist (geanonimiseerd) en een reizigersaccount met hetzelfde e-mailadres is verwijderd.' };
      return res.send(await renderPerson(req, person, { notice: notices[req.query.opgeslagen] || '' }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/deelnemers/:id(\\d{1,9})/toon/', canView, auth.checkCsrf, async (req, res, next) => {
    try {
      const block = String(req.body.block || '');
      if (!Object.hasOwn(BLOCKS, block)) return res.status(400).type('text').send('Onbekend gegevensblok.');
      if (refuseBlock(req, res, block)) return undefined;
      const person = await findPerson(req.params.id);
      if (!person) return notFound(req, res);
      await auth.audit(req, { userId: req.user.id, action: `deelnemer.toon.${BLOCK_INFO[block].slug}`, entity: 'persons', entityId: person.id });
      return res.send(await renderPerson(req, person, { shown: block }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/deelnemers/:id(\\d{1,9})/', ...canEdit, auth.checkCsrf, async (req, res, next) => {
    try {
      const person = await findPerson(req.params.id);
      if (!person) return notFound(req, res);
      if (person.anonymized_at) return res.status(409).send(await renderPerson(req, person, { notice: 'Een geanonimiseerde persoon kan niet meer worden gewijzigd.' }));
      const { values, errors } = validateFields(PLAIN_FIELDS.map((name) => FIELD_BY_NAME[name]), req.body, { today: today() });
      if (Object.keys(errors).length) return res.status(422).send(await renderPerson(req, person, { values, errors }));
      await db.transaction(async (client) => {
        await client.query(
          `UPDATE persons SET gender = $2, first_names = $3, call_name = $4, last_name = $5, email = $6, mobile = $7, phone = $8,
             street = $9, postal_code = $10, city = $11, occupation = $12, updated_at = now() WHERE id = $1 AND anonymized_at IS NULL`,
          [person.id, values.gender, values.first_names, values.call_name, values.last_name, values.email.toLowerCase(), values.mobile,
            values.phone, values.street, values.postal_code.toUpperCase(), values.city, values.occupation],
        );
        await persons.refreshMatchKey(client, person.id);
        await auth.audit(req, { userId: req.user.id, action: 'deelnemer.gewijzigd', entity: 'persons', entityId: person.id }, client);
      });
      return res.redirect(303, `/app/deelnemers/${person.id}/?opgeslagen=1`);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/deelnemers/:id(\\d{1,9})/blok/', ...canEdit, auth.checkCsrf, async (req, res, next) => {
    try {
      const block = String(req.body.block || '');
      if (!Object.hasOwn(BLOCKS, block)) return res.status(400).type('text').send('Onbekend gegevensblok.');
      if (refuseBlock(req, res, block)) return undefined;
      const person = await findPerson(req.params.id);
      if (!person) return notFound(req, res);
      if (person.anonymized_at) return res.status(409).send(await renderPerson(req, person, { notice: 'Een geanonimiseerde persoon kan niet meer worden gewijzigd.' }));
      const { values, errors } = validateFields(BLOCKS[block].map((name) => FIELD_BY_NAME[name]), req.body, { today: today() });
      if (Object.keys(errors).length) return res.status(422).send(await renderPerson(req, person, { shown: block, blockValues: values, blockErrors: errors }));
      const filled = Object.values(values).some(Boolean);
      const saved = await db.transaction(async (client) => {
        // Persoon vergrendelen: intrekken (dat dezelfde rij vergrendelt) kan niet tussen de controle en het opslaan vallen.
        const [open] = await client.query('SELECT id FROM persons WHERE id = $1 AND anonymized_at IS NULL FOR UPDATE', [person.id]);
        if (!open) return false;
        if (filled && !(await hasConsentFor(client, person.id, block))) return false;
        await persons.writeBlock(client, person.id, block, values);
        if (block === 'identity_data') await persons.refreshMatchKey(client, person.id);
        await auth.audit(req, { userId: req.user.id, action: `deelnemer.blok.${BLOCK_INFO[block].slug}`, entity: 'persons', entityId: person.id }, client);
        return true;
      });
      if (!saved) {
        const blockErrors = { _form: 'Er is geen (geldige) toestemming van de deelnemer vastgelegd; deze gegevens mogen niet worden opgeslagen.' };
        return res.status(422).send(await renderPerson(req, person, { shown: block, blockValues: values, blockErrors }));
      }
      return res.redirect(303, `/app/deelnemers/${person.id}/?opgeslagen=1`);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/deelnemers/:id(\\d{1,9})/toestemming/:consentId(\\d{1,9})/intrekken/', ...canEdit, auth.checkCsrf, async (req, res, next) => {
    try {
      const personId = Number(req.params.id);
      const outcome = await db.transaction(async (client) => {
        // Eerst de persoon vergrendelen, net als bij het opslaan van een blok (geen opslaan tussen controle en wissen).
        await client.query('SELECT id FROM persons WHERE id = $1 FOR UPDATE', [personId]);
        // De toestemming alleen samen met de persoon uit de URL opzoeken.
        const [consent] = await client.query(
          'SELECT id, kind FROM consents WHERE id = $1 AND person_id = $2 AND kind = ANY($3::text[]) AND withdrawn_at IS NULL FOR UPDATE',
          [Number(req.params.consentId), personId, Object.values(BLOCK_CONSENTS)],
        );
        if (!consent) return 'weg';
        const block = Object.keys(BLOCK_CONSENTS).find((name) => BLOCK_CONSENTS[name] === consent.kind);
        await client.query('UPDATE consents SET withdrawn_at = now() WHERE person_id = $1 AND kind = $2 AND withdrawn_at IS NULL', [personId, consent.kind]);
        await persons.writeBlock(client, personId, block, {});
        await auth.audit(req, { userId: req.user.id, action: `deelnemer.toestemming.ingetrokken.${BLOCK_INFO[block].slug}`, entity: 'persons', entityId: personId }, client);
        return 'ok';
      });
      if (outcome === 'weg') return notFound(req, res);
      return res.redirect(303, `/app/deelnemers/${personId}/?opgeslagen=ingetrokken`);
    } catch (error) {
      return next(error);
    }
  });

  router.use(createPersonPrivacyRoutes({ db, auth, persons, renderPerson, now: options.now }));

  return router;
}

module.exports = { createPersonRoutes, searchPatterns, PERSON_ACTION_LABELS, BLOCK_INFO, CONSENT_LABELS, GIVEN_BY_LABELS, PAGE_SIZE };
