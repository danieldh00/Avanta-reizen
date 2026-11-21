/**
 * Betalingen van één aanmelding in het CRM (`/app/betalingen/<aanmelding>/`, recht `betalingen`): de verwachte
 * bedragen, de ontvangen betalingen, het saldo en de vervaldatums (berekend in `crm/payments.js`). Kantoor registreert
 * een betaling (bank, iDEAL, contant of een correctie), voegt een korting, annuleringskosten of een ander bedrag toe en
 * haalt een bedrag weg (gemarkeerd, blijft zichtbaar). Betalingen worden nooit gewijzigd of verwijderd. Na een betaling
 * of een gewijzigd bedrag schuift de aanmelding automatisch door naar aanbetaald of betaald (alleen vanaf bevestigd, met een regel in de historie).
 * Elke wijziging komt in het auditlog, zonder bedragen of namen. De reisleider heeft geen recht `betalingen`.
 */
const express = require('express');
const { html, raw } = require('../site/html');
const { formatDate } = require('../site/format');
const { isValidDate } = require('../booking/fields');
const { roleHasGlobalRight } = require('./rights');
const { renderCrmPage, renderAlert, formatDateTime } = require('./layout');
const { STATUSES } = require('./booking-routes');
const payments = require('./payments');

/** Acties voor het auditlog (zie `ACTION_LABELS` in `crm/users.js`). */
const PAYMENT_ACTION_LABELS = {
  'betaling.geregistreerd': 'Betaling geregistreerd bij een aanmelding',
  'betaling.bedrag': 'Bedrag toegevoegd aan een aanmelding',
  'betaling.bedrag-weg': 'Bedrag weggehaald bij een aanmelding',
};

/** Kolommen van de aanmelding die deze pagina nodig heeft (geen bijzondere gegevens). */
const BOOKING_COLUMNS = `id, reference, trip_title, trip_code, departure_date, status, created_at, first_names, call_name, last_name,
  payment_choice, deposit_cents, person_id`;

/**
 * Leest een tekstveld: stuurtekens weg, regeleinden spatie, ingekort.
 * @param {*} value Invoer.
 * @param {number} max Maximale lengte.
 * @returns {string} Tekst.
 */
function textField(value, max) {
  // eslint-disable-next-line no-control-regex
  return typeof value === 'string' ? value.replace(/[\u0000-\u001F\u007F]+/g, ' ').trim().slice(0, max) : '';
}

/**
 * Kenmerk van de stand van de regels, om een dubbel of verouderd formulier te herkennen (dubbelklik, twee tabbladen).
 * @param {{charges: object[], payments: object[]}} lines Regels.
 * @returns {string} Kenmerk.
 */
function linesVersion(lines) {
  const maxId = (rows) => rows.reduce((max, row) => Math.max(max, row.id), 0);
  return `${maxId(lines.payments)}.${maxId(lines.charges)}.${lines.charges.length}`;
}

/**
 * Controleert het formulier van een betaling.
 * @param {object} body Formulier.
 * @param {string} today Vandaag (jjjj-mm-dd).
 * @returns {{values: object, error: string}} Waarden en een foutmelding (leeg als alles klopt).
 */
function validatePayment(body, today) {
  const method = Object.hasOwn(payments.PAYMENT_METHODS, body.wijze) ? body.wijze : '';
  const amountCents = payments.parseAmount(body.bedrag);
  const receivedOn = typeof body.datum === 'string' ? body.datum : '';
  const note = textField(body.toelichting, payments.NOTE_MAX);
  const values = { method, amountCents, receivedOn, note, amountText: textField(body.bedrag, 20) };
  if (!method) return { values, error: 'Kies hoe er is betaald.' };
  if (amountCents === null || amountCents === 0) return { values, error: 'Vul een bedrag in, bijvoorbeeld 250,00.' };
  if (amountCents < 0 && method !== 'correctie') return { values, error: 'Een negatief bedrag (terugbetaling of vergissing) kan alleen als correctie.' };
  if (method === 'correctie' && !note) return { values, error: 'Vul bij een correctie een toelichting in.' };
  if (!isValidDate(receivedOn) || receivedOn < '2000-01-01' || receivedOn > today) return { values, error: 'Vul de datum van ontvangst in (niet in de toekomst).' };
  return { values, error: '' };
}

/**
 * Controleert het formulier van een bedrag dat kantoor toevoegt.
 * @param {object} body Formulier.
 * @returns {{values: object, error: string}} Waarden (korting als negatief bedrag) en een foutmelding.
 */
function validateCharge(body) {
  const kind = payments.MANUAL_CHARGE_KINDS.includes(body.soort) ? body.soort : '';
  const amount = payments.parseAmount(body.bedrag);
  const description = textField(body.omschrijving, payments.DESCRIPTION_MAX);
  const values = { kind, description, amountText: textField(body.bedrag, 20), amountCents: null };
  if (!kind) return { values, error: 'Kies het soort bedrag.' };
  if (amount === null || amount === 0) return { values, error: 'Vul een bedrag in, bijvoorbeeld 50,00.' };
  if (kind !== 'overig' && amount < 0) return { values, error: 'Vul het bedrag zonder minteken in; een korting gaat er vanzelf af.' };
  if (kind === 'overig' && !description) return { values, error: 'Vul een omschrijving in.' };
  values.amountCents = kind === 'korting' ? -amount : amount;
  return { values, error: '' };
}

/**
 * Maakt de routes voor de betalingen van een aanmelding.
 * @param {{db: object, auth: object, settings: object, now?: () => number}} options Database, sessie- en rechtenlaag,
 *   instellingen (termijnen) en de klok (tests).
 * @returns {express.Router} Router.
 */
function createPaymentRoutes(options) {
  const { db, auth, settings } = options;
  const now = options.now || Date.now;
  const router = express.Router();
  const guard = auth.requireGlobalRight('betalingen');
  const today = () => payments.localDay(now());

  /**
   * Zoekt een aanmelding op id.
   * @param {{query: Function}} client Database of transactie-client.
   * @param {(string|number)} id Id uit de URL (alleen cijfers).
   * @param {{lock?: boolean}} [mode] De rij vergrendelen (alle wijzigingen van één aanmelding gaan na elkaar).
   * @returns {Promise<(object|null)>} Aanmelding, of null.
   */
  const findBooking = async (client, id, mode = {}) => {
    const [booking] = await client.query(`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE id = $1${mode.lock ? ' FOR UPDATE' : ''}`, [Number(id)]);
    return booking || null;
  };

  /**
   * 404-pagina binnen het CRM.
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @returns {void}
   */
  const notFound = (req, res) => res.status(404).send(renderCrmPage({
    title: 'Niet gevonden', user: req.user, csrf: req.session.csrf, path: '/app/betalingen/', body: html`<p>Deze aanmelding bestaat niet.</p>`,
  }));

  /**
   * De betaalpagina van een aanmelding.
   * @param {object} req Express-verzoek.
   * @param {object} booking Aanmelding.
   * @param {{error?: string, notice?: string, payment?: object, charge?: object}} [state] Melding, fout en ingevulde formulieren.
   * @returns {Promise<string>} HTML-pagina.
   */
  const renderPage = async (req, booking, state = {}) => {
    const lines = await payments.loadLines(db, booking.id);
    const day = today();
    const summary = payments.summarize({ booking, ...lines, terms: payments.termsFrom(settings), today: day });
    const hidden = html`<input type="hidden" name="_csrf" value="${req.session.csrf}"><input type="hidden" name="stand" value="${linesVersion(lines)}">`;
    const payment = state.payment || { method: 'bank', receivedOn: day, amountText: '', note: '' };
    const charge = state.charge || { kind: 'korting', amountText: '', description: '' };
    const canSeeBooking = roleHasGlobalRight(req.user.role, 'aanmeldingen');
    const facts = [
      ['Deelnemer', `${booking.last_name}, ${booking.call_name || booking.first_names}`],
      ['Reis', `${booking.trip_title}${booking.trip_code ? ` (${booking.trip_code})` : ''}`],
      ['Vertrek', formatDate(booking.departure_date) || '–'],
      ['Status aanmelding', STATUSES[booking.status] || booking.status],
      ['Gekozen betaling', booking.payment_choice === 'totaal' ? 'Totaalbedrag' : 'Aanbetaling'],
    ];
    const due = [
      ['Betaalstatus', html`<span class="crm-status crm-status--${summary.state}">${payments.PAYMENT_STATES[summary.state]}</span>${summary.overdue ? html` <span class="crm-badge">${summary.overdue} te laat</span>` : ''}`],
      ['Totaal', payments.formatAmount(summary.totalCents)],
      ['Betaald', payments.formatAmount(summary.paidCents)],
      ['Openstaand', payments.formatAmount(summary.balanceCents)],
      ['Aanbetaling', html`${payments.formatAmount(summary.depositRequiredCents)} uiterlijk ${formatDate(summary.depositDueOn)}${summary.depositOpenCents ? ` (nog ${payments.formatAmount(summary.depositOpenCents)})` : ' (voldaan)'}`],
      ['Restant uiterlijk', summary.balanceDueOn ? formatDate(summary.balanceDueOn) : 'geen vertrekdatum'],
    ];
    return renderCrmPage({
      title: `Betalingen ${booking.reference}`,
      user: req.user,
      csrf: req.session.csrf,
      path: '/app/betalingen/',
      body: html`<p>${canSeeBooking ? html`<a href="/app/aanmeldingen/${booking.id}/">Naar de aanmelding</a>` : ''}</p>
        ${state.notice ? html`<p class="notice" role="status">${state.notice}</p>` : ''}
        ${renderAlert(state.error)}
        <div class="crm-columns">
          <section>
            <h2>Stand</h2>
            <dl class="crm-facts">${due.map(([label, value]) => html`<dt>${label}</dt><dd>${value}</dd>`)}</dl>
            ${payments.statusMismatch(booking.status, summary.state) ? html`<p class="form-alert" role="status">${payments.statusMismatch(booking.status, summary.state)} Pas de status zo nodig aan bij de aanmelding.</p>` : ''}
            ${booking.status === 'nieuw' && summary.paidCents > 0 ? html`<p class="field__help">Deze aanmelding is nog niet bevestigd; na het bevestigen schuift de status mee met de betalingen.</p>` : ''}
          </section>
          <section>
            <h2>Aanmelding</h2>
            <dl class="crm-facts">${facts.map(([label, value]) => html`<dt>${label}</dt><dd>${value}</dd>`)}</dl>
          </section>
        </div>
        <h2>Bedragen</h2>
        <div class="crm-table-wrap"><table class="crm-table">
          <thead><tr><th scope="col">Soort</th><th scope="col">Omschrijving</th><th scope="col">Bedrag</th><th scope="col">Toegevoegd</th><th scope="col"><span class="visually-hidden">Actie</span></th></tr></thead>
          <tbody>${lines.charges.map((line) => html`<tr>
            <td>${payments.CHARGE_KINDS[line.kind] || line.kind}</td>
            <td>${line.description || '–'}</td>
            <td>${payments.formatAmount(line.amount_cents)}</td>
            <td>${formatDateTime(line.created_at)}${line.user_name ? ` · ${line.user_name}` : ' · bij aanmelden'}</td>
            <td><form method="post" action="/app/betalingen/${booking.id}/bedragen/${line.id}/weg/">${hidden}<button class="btn btn--small btn--outline" type="submit">Weghalen</button></form></td>
          </tr>`)}</tbody>
          <tfoot><tr><th scope="row" colspan="2">Totaal</th><td>${payments.formatAmount(summary.totalCents)}</td><td colspan="2"></td></tr></tfoot>
        </table></div>
        ${lines.removedCharges.length ? html`<details class="crm-removed"><summary>Weggehaalde bedragen (${lines.removedCharges.length})</summary>
          <ul>${lines.removedCharges.map((line) => html`<li>${payments.CHARGE_KINDS[line.kind] || line.kind}${line.description ? ` (${line.description})` : ''}: ${payments.formatAmount(line.amount_cents)}, weggehaald ${formatDateTime(line.removed_at)}${line.removed_by_name ? ` door ${line.removed_by_name}` : ''}</li>`)}</ul>
        </details>` : ''}
        <h2>Ontvangen betalingen</h2>
        ${lines.payments.length ? html`<div class="crm-table-wrap"><table class="crm-table">
          <thead><tr><th scope="col">Ontvangen op</th><th scope="col">Bedrag</th><th scope="col">Wijze</th><th scope="col">Toelichting</th><th scope="col">Geregistreerd</th></tr></thead>
          <tbody>${lines.payments.map((line) => html`<tr>
            <td>${formatDate(line.received_on)}</td>
            <td>${payments.formatAmount(line.amount_cents)}</td>
            <td>${payments.PAYMENT_METHODS[line.method] || line.method}</td>
            <td>${line.note || '–'}</td>
            <td>${formatDateTime(line.created_at)}${line.user_name ? ` · ${line.user_name}` : ''}</td>
          </tr>`)}</tbody>
        </table></div>` : html`<p>Nog geen betalingen ontvangen.</p>`}
        <div class="crm-columns">
          <section>
            <h2>Betaling registreren</h2>
            <form class="form crm-narrow" method="post" action="/app/betalingen/${booking.id}/betaling/">${hidden}
              <div class="field"><span class="field__label"><label for="veld-bedrag">Bedrag (€)</label></span>
                <input id="veld-bedrag" name="bedrag" inputmode="decimal" maxlength="20" required value="${payment.amountText}"></div>
              <div class="field"><span class="field__label"><label for="veld-wijze">Wijze</label></span>
                <select id="veld-wijze" name="wijze">${Object.entries(payments.PAYMENT_METHODS).map(([key, label]) => html`<option value="${key}"${key === payment.method ? raw(' selected') : ''}>${label}</option>`)}</select></div>
              <div class="field"><span class="field__label"><label for="veld-datum">Ontvangen op</label></span>
                <input id="veld-datum" name="datum" type="date" max="${day}" required value="${payment.receivedOn}"></div>
              <div class="field"><span class="field__label"><label for="veld-toelichting">Toelichting (verplicht bij een correctie)</label></span>
                <input id="veld-toelichting" name="toelichting" maxlength="${payments.NOTE_MAX}" value="${payment.note}"></div>
              <p class="field__help">Een betaling is niet te wijzigen of te verwijderen. Een vergissing of terugbetaling registreer je als correctie, met een minteken.</p>
              <div><button class="btn" type="submit">Betaling registreren</button></div>
            </form>
          </section>
          <section>
            <h2>Bedrag toevoegen</h2>
            <form class="form crm-narrow" method="post" action="/app/betalingen/${booking.id}/bedragen/">${hidden}
              <div class="field"><span class="field__label"><label for="veld-soort">Soort</label></span>
                <select id="veld-soort" name="soort">${payments.MANUAL_CHARGE_KINDS.map((kind) => html`<option value="${kind}"${kind === charge.kind ? raw(' selected') : ''}>${payments.CHARGE_KINDS[kind]}</option>`)}</select></div>
              <div class="field"><span class="field__label"><label for="veld-bedrag-regel">Bedrag (€)</label></span>
                <input id="veld-bedrag-regel" name="bedrag" inputmode="decimal" maxlength="20" required value="${charge.amountText}"></div>
              <div class="field"><span class="field__label"><label for="veld-omschrijving">Omschrijving (verplicht bij overig)</label></span>
                <input id="veld-omschrijving" name="omschrijving" maxlength="${payments.DESCRIPTION_MAX}" value="${charge.description}"></div>
              <p class="field__help">Een korting gaat van het totaal af. Bij overig mag het bedrag ook negatief zijn.</p>
              <div><button class="btn btn--outline" type="submit">Bedrag toevoegen</button></div>
            </form>
          </section>
        </div>`,
    });
  };

  /**
   * Schuift de aanmelding mee met de betaalstand na een wijziging (alleen vooruit, vanaf bevestigd), met een regel in
   * de historie en het auditlog. Leest de regels opnieuw binnen de transactie.
   * @param {object} req Express-verzoek.
   * @param {{query: Function}} client Transactie-client (aanmelding vergrendeld).
   * @param {object} booking Aanmelding zoals vergrendeld gelezen.
   * @param {string} note Toelichting in de historie.
   * @returns {Promise<(string|null)>} De nieuwe status, of null als hij blijft.
   */
  const advanceStatus = async (req, client, booking, note) => {
    const summary = payments.summarize({ booking, ...(await payments.loadLines(client, booking.id)), terms: payments.termsFrom(settings), today: today() });
    const to = payments.nextBookingStatus(booking.status, summary.state);
    if (!to) return null;
    await client.query('UPDATE bookings SET status = $2, status_changed_at = now() WHERE id = $1', [booking.id, to]);
    await client.query('INSERT INTO booking_events (booking_id, from_status, to_status, user_id, note) VALUES ($1, $2, $3, $4, $5)', [booking.id, booking.status, to, req.user.id, note]);
    await auth.audit(req, { userId: req.user.id, action: 'aanmelding.status', entity: 'bookings', entityId: booking.id }, client);
    return to;
  };

  /**
   * Voert een wijziging uit onder slot van de aanmelding, met de controle op een verouderd formulier.
   * @param {object} req Express-verzoek.
   * @param {(client: object, booking: object, lines: object) => Promise<(object|undefined)>} change De wijziging;
   *   geeft eventueel `{status}` terug voor een uitkomst anders dan ok.
   * @returns {Promise<{status: string, booking?: object}>} Uitkomst.
   */
  const withBooking = (req, change) => db.transaction(async (client) => {
    const booking = await findBooking(client, req.params.id, { lock: true });
    if (!booking) return { status: 'weg' };
    const lines = await payments.loadLines(client, booking.id);
    if (String(req.body.stand || '') !== linesVersion(lines)) return { status: 'verouderd', booking };
    const outcome = await change(client, booking, lines);
    return { status: 'ok', booking, ...outcome };
  });

  /**
   * Antwoord bij een uitkomst die geen succes is.
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @param {{status: string, booking?: object}} outcome Uitkomst.
   * @param {object} [state] Ingevulde formulieren.
   * @returns {Promise<(object|null)>} Het verstuurde antwoord, of null bij succes.
   */
  const failure = async (req, res, outcome, state = {}) => {
    if (outcome.status === 'weg') return notFound(req, res);
    if (outcome.status === 'regel-weg') {
      return res.status(404).send(await renderPage(req, outcome.booking, { error: 'Dit bedrag hoort niet bij deze aanmelding of is al weggehaald.' }));
    }
    if (outcome.status === 'verouderd') {
      return res.status(409).send(await renderPage(req, outcome.booking, { ...state, error: 'De betalingen van deze aanmelding zijn intussen gewijzigd (of het formulier is twee keer verstuurd). Controleer de stand en probeer het zo nodig opnieuw.' }));
    }
    return null;
  };

  router.get('/betalingen/:id(\\d{1,9})/', guard, async (req, res, next) => {
    try {
      const booking = await findBooking(db, req.params.id);
      if (!booking) return notFound(req, res);
      const notices = { betaling: 'De betaling is geregistreerd.', bedrag: 'Het bedrag is toegevoegd.', weg: 'Het bedrag is weggehaald.' };
      let notice = notices[req.query.opgeslagen] || '';
      if (notice && Object.hasOwn(STATUSES, req.query.status)) notice += ` De aanmelding staat nu op ${STATUSES[req.query.status].toLowerCase()}.`;
      return res.send(await renderPage(req, booking, { notice }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/betalingen/:id(\\d{1,9})/betaling/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const { values, error } = validatePayment(req.body, today());
      if (error) {
        const booking = await findBooking(db, req.params.id);
        if (!booking) return notFound(req, res);
        return res.status(422).send(await renderPage(req, booking, { error, payment: values }));
      }
      const outcome = await withBooking(req, async (client, booking, lines) => {
        const [saved] = await client.query(
          'INSERT INTO payments (booking_id, amount_cents, method, received_on, note, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
          [booking.id, values.amountCents, values.method, values.receivedOn, values.note, req.user.id],
        );
        await auth.audit(req, { userId: req.user.id, action: 'betaling.geregistreerd', entity: 'bookings', entityId: booking.id }, client);
        return { newStatus: await advanceStatus(req, client, booking, `Automatisch na een betaling van ${payments.formatAmount(values.amountCents)}.`) };
      });
      const sent = await failure(req, res, outcome, { payment: values });
      if (sent) return sent;
      return res.redirect(303, `/app/betalingen/${outcome.booking.id}/?opgeslagen=betaling${outcome.newStatus ? `&status=${outcome.newStatus}` : ''}`);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/betalingen/:id(\\d{1,9})/bedragen/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const { values, error } = validateCharge(req.body);
      if (error) {
        const booking = await findBooking(db, req.params.id);
        if (!booking) return notFound(req, res);
        return res.status(422).send(await renderPage(req, booking, { error, charge: values }));
      }
      const outcome = await withBooking(req, async (client, booking) => {
        await client.query(
          'INSERT INTO booking_charges (booking_id, kind, description, amount_cents, created_by) VALUES ($1, $2, $3, $4, $5)',
          [booking.id, values.kind, values.description, values.amountCents, req.user.id],
        );
        await auth.audit(req, { userId: req.user.id, action: 'betaling.bedrag', entity: 'bookings', entityId: booking.id }, client);
        return { newStatus: await advanceStatus(req, client, booking, 'Automatisch na een gewijzigd bedrag.') };
      });
      const sent = await failure(req, res, outcome, { charge: values });
      if (sent) return sent;
      return res.redirect(303, `/app/betalingen/${outcome.booking.id}/?opgeslagen=bedrag${outcome.newStatus ? `&status=${outcome.newStatus}` : ''}`);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/betalingen/:id(\\d{1,9})/bedragen/:chargeId(\\d{1,9})/weg/', guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const outcome = await withBooking(req, async (client, booking) => {
        // Alleen een regel van deze aanmelding; een id van een andere aanmelding geeft 404.
        // Weghalen = markeren: de regel blijft zichtbaar onder "Weggehaalde bedragen" en telt niet meer mee.
        const removed = await client.query(
          'UPDATE booking_charges SET removed_at = now(), removed_by = $3 WHERE id = $1 AND booking_id = $2 AND removed_at IS NULL RETURNING id',
          [Number(req.params.chargeId), booking.id, req.user.id],
        );
        if (!removed.length) return { status: 'regel-weg' };
        await auth.audit(req, { userId: req.user.id, action: 'betaling.bedrag-weg', entity: 'bookings', entityId: booking.id }, client);
        return { newStatus: await advanceStatus(req, client, booking, 'Automatisch na een weggehaald bedrag.') };
      });
      const sent = await failure(req, res, outcome);
      if (sent) return sent;
      return res.redirect(303, `/app/betalingen/${outcome.booking.id}/?opgeslagen=weg${outcome.newStatus ? `&status=${outcome.newStatus}` : ''}`);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createPaymentRoutes, validatePayment, validateCharge, linesVersion, PAYMENT_ACTION_LABELS };
