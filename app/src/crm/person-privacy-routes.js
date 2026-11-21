/**
 * AVG-verzoeken bij een deelnemer (`/app/deelnemers/:id/`, recht `avg`): *Gegevens exporteren* (inzage, art. 15) als
 * .xlsx met alle velden, aanmeldingen, historie en toestemmingen, en *Persoon wissen* (art. 17) = anonimiseren met
 * `anonymizePerson` uit `crm/retention.js`, plus het reizigersaccount met hetzelfde e-mailadres. Bijzondere blokken
 * komen alleen in de export als de gebruiker het recht van dat blok heeft; anders staat er dat ze zijn weggelaten.
 * Beide acties staan in het auditlog (nooit de waarden), de export eerst: wat niet gelogd kan worden, gaat niet de deur uit.
 */
const express = require('express');
const { html } = require('../site/html');
const { FIELDS } = require('../booking/fields');
const { createXlsx, XLSX_TYPE } = require('../export/xlsx');
const { createRateLimiter } = require('../security/rate-limit');
const { roleHasRight } = require('./rights');
const { PLAIN_FIELDS, BLOCKS, BLOCK_RIGHTS } = require('./persons');
const { BLOCK_INFO } = require('./person-routes');
const { anonymizePerson } = require('./retention');
const { renderCrmPage, renderAlert } = require('./layout');

/** Hoogstens zoveel inzage-exports per gebruiker per tien minuten. */
const EXPORT_LIMIT = 20;

/** Het woord dat de gebruiker moet typen om een persoon te wissen. */
const ERASE_WORD = 'WISSEN';

/** Acties voor het auditlog (zie `ACTION_LABELS` in `crm/users.js`). */
const PRIVACY_ACTION_LABELS = {
  'deelnemer.inzage': 'Deelnemer: gegevens geëxporteerd (inzageverzoek)',
  ...Object.fromEntries(Object.values(BLOCK_INFO).map((info) => [`deelnemer.inzage.${info.slug}`, `Deelnemer: ${info.label.toLowerCase()} in inzage-export`])),
  'deelnemer.gewist': 'Deelnemer gewist (geanonimiseerd op verzoek)',
};

/** Formuliervelden op naam (labels voor de export). */
const FIELD_BY_NAME = Object.fromEntries(FIELDS.map((field) => [field.name, field]));

/** Kolommen van de aanmeldingen in de export: kolomnaam en kop. */
const BOOKING_COLUMNS = [
  ['reference', 'Referentie'], ['trip_title', 'Reis'], ['trip_code', 'Reiscode'], ['departure_date', 'Vertrek'], ['status', 'Status'],
  ['created_at', 'Aangemeld'], ['confirmed_at', 'Bevestigd'], ['cancelled_at', 'Geannuleerd'], ['cancel_reason', 'Reden annulering'],
  ['gender', 'Aanhef'], ['first_names', 'Voornamen'], ['call_name', 'Roepnaam'], ['last_name', 'Achternaam'], ['email', 'E-mailadres'],
  ['mobile', 'Mobiel'], ['phone', 'Telefoon'], ['street', 'Straat en huisnummer'], ['postal_code', 'Postcode'], ['city', 'Woonplaats'],
  ['occupation', 'Beroep of opleiding'], ['travel_with', 'Reist samen met'], ['earlier_trip', 'Eerder meegeweest'], ['credit_card', 'Creditcard'],
  ['driver_interest', 'Wil chauffeur zijn'], ['driver_before', 'Eerder chauffeur'], ['driver_when', 'Wanneer chauffeur'],
  ['payment_choice', 'Betaalkeuze'], ['price_cents', 'Reissom (euro)'],
];

/** Omschrijving van de toestemmingen. */
const CONSENT_LABELS = {
  voorwaarden: 'Algemene voorwaarden en privacyverklaring',
  art9_religie: 'Kerkgenootschap vastleggen (art. 9)',
  art9_gezondheid: 'Gezondheid vastleggen en delen met de reisleiding (art. 9)',
};

/**
 * Zet een waarde uit de database om naar tekst voor de export (datum/tijd in Nederlandse tijd, ja/nee, bedragen).
 * @param {string} column Kolomnaam.
 * @param {*} value Waarde.
 * @returns {(string|number)} Celwaarde.
 */
function cellValue(column, value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'ja' : 'nee';
  if (column === 'price_cents') return Number(value) / 100;
  if (value instanceof Date) {
    return column === 'departure_date'
      ? value.toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' })
      : value.toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' });
  }
  return typeof value === 'number' ? value : String(value);
}

/**
 * Maakt de werkmap voor een inzageverzoek.
 * @param {{person: object, blocks: Record<string, (object|null)>, bookings: object[], events: object[], consents: object[],
 *   account: (object|null), userName: string, now: Date}} input De persoon, per blok de geopende velden (null = weggelaten,
 *   `{_unreadable: true}` = niet te ontsleutelen), aanmeldingen, historie, toestemmingen, reizigersaccount, wie exporteert en wanneer.
 * @returns {Buffer} Het .xlsx-bestand.
 */
function buildInspectionWorkbook(input) {
  const { person } = input;
  const personRows = [['Gegeven', 'Waarde']];
  for (const name of PLAIN_FIELDS) personRows.push([FIELD_BY_NAME[name].label, person[name] || '']);
  for (const block of Object.keys(BLOCKS)) {
    const data = input.blocks[block];
    if (data === null) {
      personRows.push([BLOCK_INFO[block].label, 'Niet opgenomen: de exporteur heeft geen recht op deze gegevens; vraag de beheerder om een volledige export.']);
    } else if (data._unreadable) {
      personRows.push([BLOCK_INFO[block].label, 'Niet te ontsleutelen (andere hoofdsleutel); meld dit bij de beheerder.']);
    } else {
      for (const name of BLOCKS[block]) personRows.push([FIELD_BY_NAME[name].label, data[name] || '']);
    }
  }
  personRows.push(['In het CRM sinds', cellValue('created_at', person.created_at)]);
  personRows.push(['Laatste activiteit', cellValue('last_activity_at', person.last_activity_at)]);
  personRows.push(['Reizigersaccount', input.account ? `ja, aangemaakt ${cellValue('created_at', input.account.created_at)}` : 'nee']);
  const bookingRows = [BOOKING_COLUMNS.map(([, label]) => label), ...input.bookings.map((booking) => BOOKING_COLUMNS.map(([column]) => cellValue(column, booking[column])))];
  const eventRows = [['Referentie', 'Tijdstip', 'Van', 'Naar', 'Notitie'], ...input.events.map((event) => [event.reference, cellValue('created_at', event.created_at), event.from_status || '', event.to_status || '', event.note || ''])];
  const consentRows = [['Toestemming', 'Tekstversie', 'Gegeven', 'Ingetrokken'], ...input.consents.map((consent) => [CONSENT_LABELS[consent.kind] || consent.kind, consent.text_version, cellValue('given_at', consent.given_at), cellValue('withdrawn_at', consent.withdrawn_at)])];
  const aboutRows = [
    ['Over deze export', ''],
    ['Wat', 'Alle gegevens die Avanta Reizen in het CRM van deze persoon bewaart (inzageverzoek, art. 15 AVG).'],
    ['Gemaakt door', input.userName],
    ['Gemaakt op', cellValue('created_at', input.now)],
    ['Bewaartermijnen', 'Zie de privacyverklaring; bijzondere gegevens worden kort na de reis gewist, de persoon na de bewaartermijn geanonimiseerd.'],
  ];
  return createXlsx([
    { name: 'Persoon', rows: personRows },
    { name: 'Aanmeldingen', rows: bookingRows },
    { name: 'Historie', rows: eventRows },
    { name: 'Toestemmingen', rows: consentRows },
    { name: 'Over deze export', rows: aboutRows },
  ]);
}

/**
 * Bestandsnaam van de export (zonder naam van de persoon, die kan in een downloadmap of mail blijven hangen).
 * @param {number} personId Id van de persoon.
 * @param {Date} now Tijdstip.
 * @returns {string} Bijv. `inzage-deelnemer-12-2027-05-21.xlsx`.
 */
function inspectionFileName(personId, now) {
  return `inzage-deelnemer-${Number(personId)}-${now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' })}.xlsx`;
}

/**
 * Het paneel *AVG-verzoeken* op de pagina van een deelnemer (alleen met recht `avg`).
 * @param {object} req Express-verzoek.
 * @param {object} person De persoon.
 * @param {string} [error] Foutmelding bij wissen.
 * @returns {object} HTML (leeg zonder recht).
 */
function renderPrivacyPanel(req, person, error) {
  if (!roleHasRight(req.user.role, 'avg')) return '';
  const hidden = html`<input type="hidden" name="_csrf" value="${req.session.csrf}">`;
  return html`<h2 id="avg">AVG-verzoeken</h2>
    <div class="crm-columns">
      <section class="crm-block"><h3>Inzage</h3>
        <p>Alle gegevens van deze persoon als Excel-bestand, om aan de persoon te sturen. Wordt vastgelegd in het auditlog.</p>
        <form method="post" action="/app/deelnemers/${person.id}/inzage/">${hidden}<button class="btn btn--outline btn--small" type="submit">Gegevens exporteren (.xlsx)</button></form>
      </section>
      <section class="crm-block"><h3>Persoon wissen</h3>
        ${person.anonymized_at ? html`<p>Al geanonimiseerd.</p>` : html`${renderAlert(error)}
        <p>Wist naam, adres, contact en bijzondere gegevens, ook bij de aanmeldingen, en verwijdert het reizigersaccount met dit e-mailadres. De aanmeldingen blijven zonder persoonsgegevens voor de boekhouding. Niet terug te draaien.</p>
        <form class="form" method="post" action="/app/deelnemers/${person.id}/wissen/">${hidden}
          <div class="field"><span class="field__label"><label for="veld-bevestiging">Typ ${ERASE_WORD} ter bevestiging</label></span>
            <input id="veld-bevestiging" name="bevestiging" type="text" autocomplete="off" maxlength="20" required></div>
          <label class="choice"><input type="checkbox" name="lopend" value="ja"> <span>Ook wissen als er nog een lopende of toekomstige reis is (kantoor kan de reiziger dan niet meer bereiken)</span></label>
          <div><button class="btn btn--small" type="submit">Persoon wissen</button></div>
        </form>`}
      </section>
    </div>`;
}

/**
 * Maakt de routes voor inzage en wissen.
 * @param {{db: object, auth: object, persons: object, renderPerson: Function, now?: () => number}} options Database,
 *   sessie- en rechtenlaag, de personen (`crm/persons.js`), de weergave van de deelnemerspagina (voor een fout bij
 *   wissen) en (voor tests) de klok.
 * @returns {express.Router} Router.
 */
function createPersonPrivacyRoutes(options) {
  const { db, auth, persons } = options;
  const router = express.Router();
  const guard = [auth.requireGlobalRight('deelnemers'), auth.requireRight('avg')];
  const limiter = createRateLimiter({ limit: EXPORT_LIMIT, windowMs: 10 * 60 * 1000, now: options.now });
  const clock = () => new Date(options.now ? options.now() : Date.now());

  /**
   * 404-pagina binnen het CRM.
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @returns {void}
   */
  const notFound = (req, res) => res.status(404).send(renderCrmPage({
    title: 'Niet gevonden', user: req.user, csrf: req.session.csrf, path: '/app/deelnemers/', body: html`<p>Deze deelnemer bestaat niet. <a href="/app/deelnemers/">Naar de deelnemers</a></p>`,
  }));

  router.post('/deelnemers/:id(\\d{1,9})/inzage/', ...guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const person = await persons.findPerson(db, req.params.id);
      if (!person) return notFound(req, res);
      if (!limiter.hit(`gebruiker:${req.user.id}`)) {
        return res.status(429).send(renderCrmPage({
          title: 'Even wachten', user: req.user, csrf: req.session.csrf, path: '/app/deelnemers/',
          body: html`${renderAlert(`Je hebt het maximum van ${EXPORT_LIMIT} exports per tien minuten bereikt. Probeer het straks opnieuw.`)}<p><a href="/app/deelnemers/${person.id}/">Terug</a></p>`,
        }));
      }
      const blocks = {};
      const included = [];
      for (const block of Object.keys(BLOCKS)) {
        if (!roleHasRight(req.user.role, BLOCK_RIGHTS[block])) {
          blocks[block] = null;
          continue;
        }
        try {
          blocks[block] = persons.openBlock(block, person);
          // Alleen een blok dat echt in de export staat, komt in het auditlog.
          if (person[block]) included.push(block);
        } catch {
          blocks[block] = { _unreadable: true };
        }
      }
      const [bookings, events, consents, accounts] = await Promise.all([
        db.query(`SELECT ${BOOKING_COLUMNS.map(([column]) => column).join(', ')} FROM bookings WHERE person_id = $1 ORDER BY created_at, id`, [person.id]),
        db.query(
          `SELECT b.reference, e.created_at, e.from_status, e.to_status, e.note FROM booking_events e JOIN bookings b ON b.id = e.booking_id
            WHERE b.person_id = $1 ORDER BY e.created_at, e.id`,
          [person.id],
        ),
        db.query('SELECT kind, text_version, given_at, withdrawn_at FROM consents WHERE person_id = $1 ORDER BY given_at, id', [person.id]),
        person.email ? db.query('SELECT created_at FROM customer_accounts WHERE email = $1', [person.email.toLowerCase()]) : [],
      ]);
      const now = clock();
      const file = buildInspectionWorkbook({ person, blocks, bookings, events, consents, account: accounts[0] || null, userName: req.user.name, now });
      await db.transaction(async (client) => {
        await auth.audit(req, { userId: req.user.id, action: 'deelnemer.inzage', entity: 'persons', entityId: person.id }, client);
        for (const block of included) await auth.audit(req, { userId: req.user.id, action: `deelnemer.inzage.${BLOCK_INFO[block].slug}`, entity: 'persons', entityId: person.id }, client);
      });
      return res.set({
        'Content-Type': XLSX_TYPE,
        'Content-Disposition': `attachment; filename="${inspectionFileName(person.id, now)}"`,
        'Cache-Control': 'no-store',
      }).send(file);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/deelnemers/:id(\\d{1,9})/wissen/', ...guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const person = await persons.findPerson(db, req.params.id);
      if (!person) return notFound(req, res);
      if (person.anonymized_at) return res.redirect(303, `/app/deelnemers/${person.id}/`);
      if (String(req.body.bevestiging || '').trim() !== ERASE_WORD) {
        return res.status(422).send(await options.renderPerson(req, person, { eraseError: `Typ ${ERASE_WORD} om te bevestigen.` }));
      }
      const outcome = await db.transaction(async (client) => {
        const [locked] = await client.query('SELECT id, email FROM persons WHERE id = $1 AND anonymized_at IS NULL FOR UPDATE', [person.id]);
        if (!locked) return 'al-gewist';
        // Een reis die nog moet komen of loopt: kantoor kan de reiziger daarna niet meer bereiken, dus alleen bewust.
        const [active] = await client.query(
          `SELECT count(*)::int AS n FROM bookings b LEFT JOIN trips t ON t.id = b.trip_id
            WHERE b.person_id = $1 AND b.status <> 'geannuleerd'
              AND coalesce(t.departure_date, b.departure_date) + (GREATEST(coalesce(t.duration_days, 1), 1) - 1) >= (now() AT TIME ZONE 'Europe/Amsterdam')::date`,
          [person.id],
        );
        if (active.n && req.body.lopend !== 'ja') return 'lopend';
        if (locked.email) await client.query('DELETE FROM customer_accounts WHERE email = $1', [locked.email.toLowerCase()]);
        await anonymizePerson(client, person.id);
        await auth.audit(req, { userId: req.user.id, action: 'deelnemer.gewist', entity: 'persons', entityId: person.id }, client);
        return 'gewist';
      });
      if (outcome === 'lopend') {
        return res.status(422).send(await options.renderPerson(req, person, { eraseError: 'Deze persoon heeft nog een lopende of toekomstige aanmelding. Annuleer die eerst, of vink aan dat je toch wilt wissen.' }));
      }
      // Tegelijk door iemand anders (of de opschoning) gewist: geen melding alsof deze actie het deed.
      if (outcome === 'al-gewist') return res.redirect(303, `/app/deelnemers/${person.id}/`);
      return res.redirect(303, `/app/deelnemers/${person.id}/?opgeslagen=gewist`);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createPersonPrivacyRoutes, renderPrivacyPanel, buildInspectionWorkbook, inspectionFileName, PRIVACY_ACTION_LABELS, ERASE_WORD, EXPORT_LIMIT };
