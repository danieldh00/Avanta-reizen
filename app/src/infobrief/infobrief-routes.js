// @ts-check
/**
 * Infobrieven in het CRM (`/app/infobrieven/`, recht `infobrief`; niet voor rollen die tot eigen vertrekken beperkt
 * zijn): per vertrek een infobrief opstellen (onderwerp en opgemaakte tekst met de teksteditor), een voorbeeld bekijken,
 * een testmail naar jezelf sturen en hem dan één keer versturen naar alle deelnemers van dat vertrek en de ouder of
 * voogd van deelnemers onder de 16. Het versturen gebeurt in de achtergrond (`sender.js`); dit scherm toont het
 * verzendoverzicht met de status per ontvanger, wie wanneer verstuurde, en een export (.xlsx) zonder adressen.
 * Elke actie komt in het auditlog, zonder inhoud of adressen.
 */
const express = require('express');
const { html } = require('../site/html');
const { formatDate } = require('../site/format');
const { createXlsx, XLSX_TYPE } = require('../export/xlsx');
const { createRateLimiter } = require('../security/rate-limit');
const { mailFailure } = require('../mail/mailer');
const { LOGO_CID } = require('../mail/layout');
const { renderCrmPage, renderAlert, formatDateTime } = require('../crm/layout');
const { fieldRow, invalidAttributes, RICHTEXT_HELP } = require('../cms/block-editor');
const ui = require('../crm/ui');
const infobrieven = require('./infobrieven');

/** Adres van het overzicht (voor links) en het pad binnen de router van `/app`. */
const BASE = '/app/infobrieven/';
const ROUTE = '/infobrieven/';

/** Pad met het id van een infobrief (alleen cijfers). */
const ID = ':id(\\d{1,9})';

/** Hoogstens zoveel testmails per gebruiker per tien minuten. */
const TESTMAIL_LIMIT = 10;

/** Hoogstens zoveel exports van het verzendoverzicht per gebruiker per tien minuten. */
const EXPORT_LIMIT = 30;

/** Melding als een vertrek meer aanmeldingen heeft dan één infobrief aankan (`MAX_BOOKINGS`). */
const TOO_MANY = `Dit vertrek heeft meer dan ${infobrieven.MAX_BOOKINGS} aanmeldingen; zo'n infobrief verstuurt het CRM niet in één keer.`;

/** Acties voor het auditlog (zie `ACTION_LABELS` in `crm/users.js`). */
const INFOBRIEF_ACTION_LABELS = {
  'infobrief.aangemaakt': 'Infobrief aangemaakt',
  'infobrief.gewijzigd': 'Infobrief gewijzigd',
  'infobrief.verwijderd': 'Concept van een infobrief verwijderd',
  'infobrief.testmail': 'Testmail van een infobrief verstuurd',
  'infobrief.verstuurd': 'Infobrief verstuurd aan de deelnemers',
  'infobrief.opnieuw': 'Mislukte ontvangers van een infobrief opnieuw verstuurd',
  'infobrief.export': 'Verzendoverzicht van een infobrief geëxporteerd (.xlsx)',
};

/** Meldingen na een geslaagde actie (`?opgeslagen=…`). */
const NOTICES = {
  opgeslagen: 'Het concept is opgeslagen.',
  testmail: 'De testmail is verstuurd naar je eigen e-mailadres.',
  verstuurd: 'De infobrief staat in de wachtrij en gaat nu in de achtergrond weg. Ververs deze pagina om de voortgang te zien.',
  opnieuw: 'De mislukte ontvangers staan opnieuw in de wachtrij.',
};

/**
 * Naam van een reis in een keuzelijst of kop: titel, reiscode en vertrekdatum.
 * @param {{title?: string, trip_title?: string, trip_code?: string, departure_date?: any}} trip Reis (of infobrief met reis).
 * @returns {string} Tekst.
 */
function tripLabel(trip) {
  const title = trip.title || trip.trip_title || '';
  const departure = formatDate(trip.departure_date);
  return `${title}${trip.trip_code ? ` (${trip.trip_code})` : ''}${departure ? `, vertrek ${departure}` : ''}`;
}

/**
 * Bestandsnaam van het verzendoverzicht: alleen kleine letters, cijfers en streepjes.
 * @param {{id: number, trip_code?: string}} infobrief De infobrief.
 * @returns {string} Bestandsnaam met `.xlsx`.
 */
function overviewFileName(infobrief) {
  const code = String(infobrief.trip_code || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `verzendoverzicht-infobrief-${infobrief.id}${code ? `-${code}` : ''}.xlsx`;
}

/**
 * Maakt de routes voor de infobrieven.
 * @param {{db: any, auth: any, persons: {openBlock: Function}, settings: {get: (key: string) => any}, mailer: {configured: () => boolean, send: Function}, sender: {kick: () => void}, now?: () => number}} options
 *   Database, sessie- en rechtenlaag, personen, instellingen, mailer, de verzender in de achtergrond en (voor tests)
 *   de klok van de limieten.
 * @returns {express.Router} Router.
 */
function createInfobriefRoutes(options) {
  const { db, auth, persons, settings, mailer, sender } = options;
  const router = express.Router();
  const guard = auth.requireGlobalRight('infobrief');
  const testLimiter = createRateLimiter({ limit: TESTMAIL_LIMIT, windowMs: 10 * 60 * 1000, now: options.now });
  const exportLimiter = createRateLimiter({ limit: EXPORT_LIMIT, windowMs: 10 * 60 * 1000, now: options.now });

  /**
   * Een CRM-pagina onder Infobrieven.
   * @param {any} req Express-verzoek.
   * @param {string} title Titel.
   * @param {any} body Inhoud.
   * @returns {string} HTML-pagina.
   */
  const page = (req, title, body) => renderCrmPage({ title, user: req.user, csrf: req.session.csrf, path: BASE, body });

  /**
   * 404-pagina binnen het CRM.
   * @param {any} req Express-verzoek.
   * @param {any} res Express-antwoord.
   * @returns {void}
   */
  const notFound = (req, res) => res.status(404).send(page(req, 'Niet gevonden', html`<p>Deze infobrief bestaat niet (meer). <a href="${BASE}">Naar de infobrieven</a></p>`));

  /**
   * Leest de infobrief uit de URL, of stuurt een 404.
   * @param {any} req Express-verzoek.
   * @param {any} res Express-antwoord.
   * @returns {Promise<any>} Infobrief, of null als de 404 al is verstuurd.
   */
  const load = async (req, res) => {
    const infobrief = await infobrieven.findInfobrief(db, Number(req.params.id));
    if (!infobrief) notFound(req, res);
    return infobrief;
  };

  router.get(ROUTE, guard, async (req, res, next) => {
    try {
      const tripId = /^\d{1,9}$/.test(String(req.query.reis || '')) ? Number(req.query.reis) : null;
      const pageNumber = Math.min(Math.max(Number.parseInt(String(req.query.pagina), 10) || 1, 1), 10000);
      const [list, trips] = await Promise.all([infobrieven.listInfobrieven(db, { tripId, page: pageNumber }), infobrieven.listTrips(db)]);
      const hidden = html`<input type="hidden" name="_csrf" value="${req.session.csrf}">`;
      return res.send(page(req, 'Infobrieven', html`<p>De infobrief is de mail aan alle deelnemers van een vertrek (en de ouder of voogd van deelnemers onder de 16). Stel hem op als concept, bekijk het voorbeeld, stuur een testmail naar jezelf en verstuur hem dan. Per infobrief zie je daarna aan wie hij is verzonden.</p>
        ${mailer.configured() ? '' : renderAlert('Er is nog geen mailserver ingesteld (Beheer > E-mail > Mailserver). Je kunt een infobrief opstellen, maar nog niet versturen.')}
        <section class="crm-block">
          <h2>Nieuwe infobrief</h2>
          ${trips.length ? html`<form class="form crm-narrow" method="post" action="${BASE}nieuw/">${hidden}
            <div class="field"><span class="field__label"><label for="veld-reis">Vertrek</label></span>
              <select id="veld-reis" name="reis" required>${trips.map((trip) => html`<option value="${trip.id}"${trip.id === tripId ? html` selected` : ''}>${tripLabel(trip)} – ${trip.participant_count} ${trip.participant_count === 1 ? 'aanmelding' : 'aanmeldingen'}</option>`)}</select>
              <span class="field__help">Komende vertrekken eerst; vertrekken van langer dan twee maanden geleden staan er niet meer bij.</span></div>
            <div><button class="btn" type="submit">Infobrief opstellen</button></div>
          </form>` : html`<p>Er zijn nog geen vertrekken met aanmeldingen.</p>`}
        </section>
        ${tripId ? html`<p>Alleen de infobrieven van één reis. <a href="${BASE}">Alle infobrieven</a></p>` : ''}
        ${ui.renderTable({
          caption: 'Infobrieven',
          empty: 'Nog geen infobrieven.',
          rows: list.rows,
          columns: [
            { label: 'Onderwerp', wrap: true, cell: (/** @type {any} */ row) => html`<a href="${BASE}${row.id}/">${row.subject || '(nog geen onderwerp)'}</a>` },
            { label: 'Vertrek', wrap: true, cell: (/** @type {any} */ row) => html`<a href="${BASE}?reis=${row.trip_id}">${tripLabel(row)}</a>` },
            { label: 'Status', cell: (/** @type {any} */ row) => ui.renderStatus(row.status, infobrieven.STATUSES[row.status] || row.status) },
            { label: 'Verzonden', cell: (/** @type {any} */ row) => (row.status === 'concept' ? '–' : `${row.sent_count}${row.failed_count ? ` (${row.failed_count} mislukt)` : ''}`) },
            { label: 'Wanneer', cell: (/** @type {any} */ row) => (row.send_started_at ? html`${formatDateTime(row.send_started_at)}${row.sent_by_name ? html`<br>${row.sent_by_name}` : ''}` : `gewijzigd ${formatDateTime(row.updated_at)}`) },
          ],
        })}
        ${ui.renderPager({ base: BASE, params: { reis: tripId ? String(tripId) : '' }, page: pageNumber, hasNext: list.hasNext })}`));
    } catch (error) {
      return next(error);
    }
  });

  router.post(`${ROUTE}nieuw/`, guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const tripId = /^\d{1,9}$/.test(String(req.body.reis || '')) ? Number(req.body.reis) : 0;
      const id = await db.transaction(async (client) => {
        const created = await infobrieven.createInfobrief(client, { tripId, userId: req.user.id });
        if (created) await auth.audit(req, { userId: req.user.id, action: 'infobrief.aangemaakt', entity: 'infobrieven', entityId: created }, client);
        return created;
      });
      if (!id) return res.status(404).send(page(req, 'Niet gevonden', html`<p>Deze reis bestaat niet. <a href="${BASE}">Naar de infobrieven</a></p>`));
      return res.redirect(303, `${BASE}${id}/`);
    } catch (error) {
      return next(error);
    }
  });

  /**
   * De pagina van één infobrief: als concept het formulier, voorbeeld, testmail en versturen; daarna het
   * verzendoverzicht.
   * @param {any} req Express-verzoek.
   * @param {any} infobrief De infobrief (`findInfobrief`).
   * @param {{notice?: string, error?: string, values?: any, errors?: Record<string, string>}} [state] Melding, fout en
   *   (na een mislukte controle) de ingevulde waarden.
   * @returns {Promise<string>} HTML-pagina.
   */
  const renderInfobrief = async (req, infobrief, state = {}) => {
    const hidden = html`<input type="hidden" name="_csrf" value="${req.session.csrf}">`;
    const action = `${BASE}${infobrief.id}/`;
    const facts = [
      ['Vertrek', tripLabel(infobrief)],
      ['Status', ui.renderStatus(infobrief.status, infobrieven.STATUSES[infobrief.status] || infobrief.status)],
      ['Aangemaakt', `${formatDateTime(infobrief.created_at)}${infobrief.created_by_name ? ` · ${infobrief.created_by_name}` : ''}`],
      ['Laatst gewijzigd', `${formatDateTime(infobrief.updated_at)}${infobrief.updated_by_name ? ` · ${infobrief.updated_by_name}` : ''}`],
      ...(infobrief.send_started_at ? [['Verstuurd', `${formatDateTime(infobrief.send_started_at)}${infobrief.sent_by_name ? ` · ${infobrief.sent_by_name}` : ''}`]] : []),
      ...(infobrief.send_finished_at ? [['Klaar', formatDateTime(infobrief.send_finished_at)]] : []),
    ];
    const preview = html`<h2>Voorbeeld</h2>
      <iframe class="crm-mail-preview" src="${action}voorbeeld/" title="Voorbeeld van de infobrief" sandbox=""></iframe>
      <p class="field__help">Zo ziet een deelnemer de mail; de aanhef krijgt de roepnaam. <a href="${action}voorbeeld/?rol=ouder_voogd" target="_blank" rel="noopener">Bekijk de versie voor de ouder of voogd</a>.</p>`;
    const header = html`<p><a href="${BASE}">Naar de infobrieven</a></p>
      ${state.notice ? html`<p class="notice" role="status">${state.notice}</p>` : ''}
      ${renderAlert(state.error)}
      <dl class="crm-facts">${facts.map(([label, value]) => html`<dt>${label}</dt><dd>${value}</dd>`)}</dl>`;
    const title = infobrief.subject ? `Infobrief: ${infobrief.subject}` : 'Infobrief';

    if (infobrief.status === 'concept') {
      const values = state.values || { subject: infobrief.subject, bodyHtml: infobrief.body_html, includeNew: infobrief.include_new, includeGuardians: infobrief.include_guardians };
      const errors = state.errors || {};
      const { list: candidates, tooMany } = await infobrieven.recipientCandidates(db, { trip_id: infobrief.trip_id, include_new: infobrief.include_new, include_guardians: infobrief.include_guardians }, persons);
      const counts = infobrieven.countCandidates(candidates);
      const skipped = candidates.filter((item) => item.status === 'overgeslagen');
      const blocker = (tooMany ? TOO_MANY : '') || infobrieven.readyToSend(infobrief) || (mailer.configured() ? '' : 'Er is nog geen mailserver ingesteld (Beheer > E-mail > Mailserver).') || (counts.total ? '' : 'Er is nog niemand met een e-mailadres om deze infobrief naar te sturen.');
      return page(req, title, html`${header}
        <form class="form crm-block" method="post" action="${action}">${hidden}
          ${fieldRow({ id: 'veld-onderwerp', label: 'Onderwerp', error: errors.onderwerp, control: html`<input id="veld-onderwerp" name="onderwerp" type="text" value="${values.subject}" maxlength="${infobrieven.LIMITS.subject}"${invalidAttributes('veld-onderwerp', errors.onderwerp)}>` })}
          ${fieldRow({ id: 'veld-tekst', label: 'Tekst', error: errors.tekst, help: `${RICHTEXT_HELP} De aanhef (Beste …) en de reis zet het CRM er zelf boven.`, control: html`<textarea id="veld-tekst" name="tekst" rows="16" class="cms-richtext"${invalidAttributes('veld-tekst', errors.tekst)}>${values.bodyHtml}</textarea>` })}
          <label class="choice"><input type="checkbox" name="ouders" value="ja"${values.includeGuardians ? html` checked` : ''}> <span>Ook naar de ouder of voogd (deelnemers onder de 16)</span></label>
          <label class="choice"><input type="checkbox" name="nieuw" value="ja"${values.includeNew ? html` checked` : ''}> <span>Ook naar aanmeldingen met status Nieuw (nog niet bevestigd door kantoor)</span></label>
          ${ui.renderSaveBar({ label: 'Opslaan', note: 'Opslaan voordat je het voorbeeld bekijkt of een testmail stuurt.' })}
        </form>
        <div class="crm-columns">
          <section>${preview}</section>
          <section>
            <h2>Testmail</h2>
            <form class="form crm-narrow" method="post" action="${action}testmail/">${hidden}
              <p>Stuurt de opgeslagen versie naar je eigen adres (${req.user.email}), met [Test] voor het onderwerp.</p>
              <div><button class="btn btn--outline" type="submit">Stuur een testmail naar mij</button></div>
            </form>
            <h2>Versturen</h2>
            <p>Deze infobrief gaat naar <strong>${counts.total}</strong> ${counts.total === 1 ? 'ontvanger' : 'ontvangers'}: ${counts.participants} ${counts.participants === 1 ? 'deelnemer' : 'deelnemers'} en ${counts.guardians} ${counts.guardians === 1 ? 'ouder of voogd' : 'ouders of voogden'}. Geannuleerde aanmeldingen krijgen hem niet.</p>
            ${skipped.length ? html`<details><summary>${skipped.length} overgeslagen</summary><ul>${skipped.map((item) => html`<li>${item.name}: ${item.note}</li>`)}</ul></details>` : ''}
            ${blocker ? html`<p class="field__help">${blocker}</p>` : html`<form class="form crm-narrow" method="post" action="${action}versturen/">${hidden}
              <input type="hidden" name="aantal" value="${counts.total}">
              <label class="choice"><input type="checkbox" name="bevestig" value="ja" required> <span>Ja, verstuur deze infobrief nu naar ${counts.total} ${counts.total === 1 ? 'ontvanger' : 'ontvangers'}. Daarna kan hij niet meer worden gewijzigd.</span></label>
              <div><button class="btn" type="submit">Infobrief versturen</button></div>
            </form>`}
            <h2>Verwijderen</h2>
            <form class="form crm-narrow" method="post" action="${action}verwijderen/">${hidden}
              <label class="choice"><input type="checkbox" name="bevestig" value="ja" required> <span>Ja, verwijder dit concept</span></label>
              <div><button class="btn btn--outline" type="submit">Concept verwijderen</button></div>
            </form>
          </section>
        </div>`);
    }

    const overview = await infobrieven.recipientOverview(db, infobrief.id);
    const countText = Object.entries(overview.counts).filter(([, count]) => count > 0)
      .map(([status, count]) => `${count} ${infobrieven.RECIPIENT_STATUSES[status].toLowerCase()}`).join(', ');
    return page(req, title, html`${header}
      ${infobrief.status === 'verzenden' && !mailer.configured() ? renderAlert('Er is geen mailserver ingesteld: de wachtrij gaat pas weg als die er is (Beheer > E-mail > Mailserver).') : ''}
      <div class="crm-columns">
        <section>${preview}</section>
        <section>
          <h2>Verzendoverzicht</h2>
          <p>${countText || 'Geen ontvangers.'}${infobrief.status === 'verzenden' ? ' De infobrief wordt nog verzonden; ververs de pagina om de voortgang te zien.' : ''}</p>
          ${ui.renderActions([
            { label: 'Download (.xlsx)', href: `${action}verzendoverzicht.xlsx` },
          ])}
          ${overview.counts.mislukt ? html`<form class="form crm-narrow" method="post" action="${action}opnieuw/">${hidden}
            <p>${overview.counts.mislukt} ${overview.counts.mislukt === 1 ? 'mail is' : 'mails zijn'} mislukt. Controleer de mailserver of het adres bij de deelnemer en probeer het opnieuw.</p>
            <div><button class="btn btn--outline" type="submit">Mislukte opnieuw versturen</button></div>
          </form>` : ''}
          ${overview.counts.onzeker ? html`<p class="field__help">Bij "niet zeker verzonden" werd het versturen onderbroken (bijvoorbeeld door een herstart). Die worden niet vanzelf opnieuw verstuurd, zodat niemand de brief twee keer krijgt.</p>` : ''}
        </section>
      </div>
      ${ui.renderTable({
        caption: 'Ontvangers',
        empty: 'Geen ontvangers.',
        rows: overview.rows,
        columns: [
          { label: 'Ontvanger', wrap: true, cell: (/** @type {any} */ row) => (row.booking_id && !row.anonymized_at ? html`<a href="/app/aanmeldingen/${row.booking_id}/">${infobrieven.recipientName(row)}</a>` : infobrieven.recipientName(row)) },
          { label: 'Rol', cell: (/** @type {any} */ row) => infobrieven.ROLE_LABELS[row.role] || row.role },
          { label: 'Status', cell: (/** @type {any} */ row) => ui.renderStatus(row.status, infobrieven.RECIPIENT_STATUSES[row.status] || row.status) },
          { label: 'Opmerking', wrap: true, cell: (/** @type {any} */ row) => row.note || '–' },
          { label: 'Verzonden op', cell: (/** @type {any} */ row) => (row.sent_at ? formatDateTime(row.sent_at) : '–') },
        ],
      })}`);
  };

  router.get(`${ROUTE}${ID}/`, guard, async (req, res, next) => {
    try {
      const infobrief = await load(req, res);
      if (!infobrief) return undefined;
      const notice = Object.hasOwn(NOTICES, String(req.query.opgeslagen)) ? NOTICES[String(req.query.opgeslagen)] : '';
      return res.send(await renderInfobrief(req, infobrief, { notice }));
    } catch (error) {
      return next(error);
    }
  });

  router.post(`${ROUTE}${ID}/`, guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const infobrief = await load(req, res);
      if (!infobrief) return undefined;
      if (infobrief.status !== 'concept') return res.status(409).send(await renderInfobrief(req, infobrief, { error: 'Deze infobrief is al verstuurd en kan niet meer worden gewijzigd.' }));
      const { values, errors } = infobrieven.parseInput(req.body);
      if (Object.keys(errors).length) {
        return res.status(422).send(await renderInfobrief(req, infobrief, { error: 'Het concept is niet opgeslagen. Controleer de velden.', values: { ...values, bodyHtml: errors.tekst ? String(req.body.tekst || '').slice(0, infobrieven.LIMITS.body) : values.bodyHtml }, errors }));
      }
      const saved = await db.transaction(async (client) => {
        const ok = await infobrieven.updateInfobrief(client, infobrief.id, values, req.user.id);
        if (ok) await auth.audit(req, { userId: req.user.id, action: 'infobrief.gewijzigd', entity: 'infobrieven', entityId: infobrief.id }, client);
        return ok;
      });
      if (!saved) return res.status(409).send(await renderInfobrief(req, await infobrieven.findInfobrief(db, infobrief.id), { error: 'Deze infobrief is intussen verstuurd en kan niet meer worden gewijzigd.' }));
      return res.redirect(303, `${BASE}${infobrief.id}/?opgeslagen=opgeslagen`);
    } catch (error) {
      return next(error);
    }
  });

  router.get(`${ROUTE}${ID}/voorbeeld/`, guard, async (req, res, next) => {
    try {
      const infobrief = await load(req, res);
      if (!infobrief) return undefined;
      const role = req.query.rol === 'ouder_voogd' ? 'ouder_voogd' : 'deelnemer';
      const mail = infobrieven.buildMail({ infobrief, recipient: { role, callName: role === 'ouder_voogd' ? '[roepnaam van de deelnemer]' : '[roepnaam]' }, settings });
      const logo = mail.attachments.find((attachment) => attachment.cid === LOGO_CID);
      const markup = logo ? mail.html.replace(`cid:${LOGO_CID}`, `data:image/png;base64,${logo.content.toString('base64')}`) : mail.html;
      // Een eigen, strengere policy: geen scripts, alleen inline stijlen en afbeeldingen, en alleen in een frame van het CRM.
      return res.set({
        'Content-Security-Policy': "default-src 'none'; img-src 'self' data: https:; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
        'Cache-Control': 'no-store',
      }).type('html').send(markup);
    } catch (error) {
      return next(error);
    }
  });

  router.post(`${ROUTE}${ID}/testmail/`, guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const infobrief = await load(req, res);
      if (!infobrief) return undefined;
      if (!mailer.configured()) return res.status(409).send(await renderInfobrief(req, infobrief, { error: 'Er is nog geen mailserver ingesteld (Beheer > E-mail > Mailserver).' }));
      const notReady = infobrieven.readyToSend(infobrief);
      if (notReady) return res.status(422).send(await renderInfobrief(req, infobrief, { error: notReady }));
      if (!testLimiter.hit(`gebruiker:${req.user.id}`)) {
        return res.status(429).send(await renderInfobrief(req, infobrief, { error: `Je hebt het maximum van ${TESTMAIL_LIMIT} testmails per tien minuten bereikt. Probeer het straks opnieuw.` }));
      }
      const firstName = String(req.user.name || '').trim().split(/\s+/)[0] || 'collega';
      const mail = infobrieven.buildMail({ infobrief, recipient: { role: 'deelnemer', callName: firstName, test: true }, settings });
      try {
        await mailer.send({ kind: 'infobrief-test', to: req.user.email, subject: mail.subject, text: mail.text, html: mail.html, attachments: mail.attachments });
      } catch (error) {
        return res.status(502).send(await renderInfobrief(req, infobrief, { error: mailFailure(error) }));
      }
      await auth.audit(req, { userId: req.user.id, action: 'infobrief.testmail', entity: 'infobrieven', entityId: infobrief.id });
      return res.redirect(303, `${BASE}${infobrief.id}/?opgeslagen=testmail`);
    } catch (error) {
      return next(error);
    }
  });

  router.post(`${ROUTE}${ID}/versturen/`, guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const infobrief = await load(req, res);
      if (!infobrief) return undefined;
      if (req.body.bevestig !== 'ja') return res.status(422).send(await renderInfobrief(req, infobrief, { error: 'Vink aan dat je de infobrief wilt versturen.' }));
      if (!mailer.configured()) return res.status(409).send(await renderInfobrief(req, infobrief, { error: 'Er is nog geen mailserver ingesteld (Beheer > E-mail > Mailserver).' }));
      const outcome = await db.transaction(async (client) => {
        // Onder het slot van de infobrief: twee keer op de knop drukken (of twee tabbladen) zet hem één keer in de wachtrij.
        const locked = await infobrieven.findInfobrief(client, infobrief.id, { lock: true });
        if (!locked || locked.status !== 'concept') return { error: 'Deze infobrief is al verstuurd.', status: 409 };
        const notReady = infobrieven.readyToSend(locked);
        if (notReady) return { error: notReady, status: 422 };
        const { list, tooMany } = await infobrieven.recipientCandidates(client, locked, persons);
        if (tooMany) return { error: TOO_MANY, status: 422 };
        const counts = infobrieven.countCandidates(list);
        if (!counts.total) return { error: 'Er is niemand met een e-mailadres om deze infobrief naar te sturen.', status: 422 };
        // Het aantal op het scherm moet nog kloppen; anders eerst opnieuw laten bevestigen.
        if (String(counts.total) !== String(req.body.aantal)) return { error: `Het aantal ontvangers is intussen veranderd (nu ${counts.total}). Controleer het en bevestig opnieuw.`, status: 409 };
        await infobrieven.queueInfobrief(client, locked.id, list, req.user.id);
        await auth.audit(req, { userId: req.user.id, action: 'infobrief.verstuurd', entity: 'infobrieven', entityId: locked.id }, client);
        return { ok: true };
      });
      if (!outcome.ok) return res.status(outcome.status).send(await renderInfobrief(req, await infobrieven.findInfobrief(db, infobrief.id), { error: outcome.error }));
      sender.kick();
      return res.redirect(303, `${BASE}${infobrief.id}/?opgeslagen=verstuurd`);
    } catch (error) {
      return next(error);
    }
  });

  router.post(`${ROUTE}${ID}/opnieuw/`, guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const infobrief = await load(req, res);
      if (!infobrief) return undefined;
      if (infobrief.status === 'concept') return res.status(409).send(await renderInfobrief(req, infobrief, { error: 'Dit concept is nog niet verstuurd.' }));
      const count = await db.transaction(async (client) => {
        await infobrieven.findInfobrief(client, infobrief.id, { lock: true });
        const retried = await infobrieven.retryFailed(client, infobrief.id);
        if (retried) await auth.audit(req, { userId: req.user.id, action: 'infobrief.opnieuw', entity: 'infobrieven', entityId: infobrief.id }, client);
        return retried;
      });
      if (!count) return res.status(409).send(await renderInfobrief(req, infobrief, { error: 'Er zijn geen mislukte ontvangers (meer).' }));
      sender.kick();
      return res.redirect(303, `${BASE}${infobrief.id}/?opgeslagen=opnieuw`);
    } catch (error) {
      return next(error);
    }
  });

  router.post(`${ROUTE}${ID}/verwijderen/`, guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const infobrief = await load(req, res);
      if (!infobrief) return undefined;
      if (req.body.bevestig !== 'ja') return res.status(422).send(await renderInfobrief(req, infobrief, { error: 'Vink aan dat je het concept wilt verwijderen.' }));
      const removed = await db.transaction(async (client) => {
        const ok = await infobrieven.deleteInfobrief(client, infobrief.id);
        if (ok) await auth.audit(req, { userId: req.user.id, action: 'infobrief.verwijderd', entity: 'infobrieven', entityId: infobrief.id }, client);
        return ok;
      });
      if (!removed) return res.status(409).send(await renderInfobrief(req, await infobrieven.findInfobrief(db, infobrief.id), { error: 'Een verstuurde infobrief blijft bewaard en kan niet worden verwijderd.' }));
      return res.redirect(303, BASE);
    } catch (error) {
      return next(error);
    }
  });

  router.get(`${ROUTE}${ID}/verzendoverzicht.xlsx`, guard, async (req, res, next) => {
    try {
      const infobrief = await load(req, res);
      if (!infobrief) return undefined;
      if (!exportLimiter.hit(`gebruiker:${req.user.id}`)) return res.status(429).type('text').send(`Je hebt het maximum van ${EXPORT_LIMIT} exports per tien minuten bereikt. Probeer het straks opnieuw.`);
      const overview = await infobrieven.recipientOverview(db, infobrief.id);
      const file = createXlsx([
        {
          name: 'Verzendoverzicht',
          rows: [
            ['Ontvanger', 'Referentie', 'Rol', 'Status', 'Opmerking', 'Verzonden op'],
            ...overview.rows.map((row) => [
              infobrieven.recipientName(row), row.anonymized_at ? '' : row.reference || '', infobrieven.ROLE_LABELS[row.role] || row.role,
              infobrieven.RECIPIENT_STATUSES[row.status] || row.status, row.note, row.sent_at ? formatDateTime(row.sent_at) : '',
            ]),
          ],
        },
        {
          name: 'Over deze infobrief',
          rows: [
            ['Onderdeel', 'Waarde'],
            ['Onderwerp', infobrief.subject],
            ['Vertrek', tripLabel(infobrief)],
            ['Status', infobrieven.STATUSES[infobrief.status] || infobrief.status],
            ['Verstuurd op', infobrief.send_started_at ? formatDateTime(infobrief.send_started_at) : ''],
            ['Verstuurd door', infobrief.sent_by_name || ''],
            ['Klaar op', infobrief.send_finished_at ? formatDateTime(infobrief.send_finished_at) : ''],
            ['Let op', 'Vertrouwelijk: persoonsgegevens. Zonder e-mailadressen.'],
          ],
        },
      ]);
      await auth.audit(req, { userId: req.user.id, action: 'infobrief.export', entity: 'infobrieven', entityId: infobrief.id });
      return res.set({
        'Content-Type': XLSX_TYPE,
        'Content-Disposition': `attachment; filename="${overviewFileName(infobrief)}"`,
        'Cache-Control': 'no-store',
      }).send(file);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createInfobriefRoutes, INFOBRIEF_ACTION_LABELS, TESTMAIL_LIMIT, EXPORT_LIMIT, tripLabel, overviewFileName };
