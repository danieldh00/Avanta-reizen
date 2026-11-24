// @ts-check
/**
 * Openbare routes voor online betalen (migratie 28): de betaalpagina `/betalen/<id>-<token>/` met het openstaande
 * bedrag en een knop naar Mollie, de terugkeerpagina `…/klaar/` en de webhook `/betalen/webhook/`. De pagina toont
 * alleen referentie, reis, termijn en bedrag (geen naam of adres). De knop is een POST met herkomstcontrole en
 * limiet; daarna een tussenpagina met een link naar Mollie, omdat de CSP (`form-action 'self'`) een doorverwijzing na
 * een formulier naar een ander domein blokkeert. De webhook vertrouwt de inhoud nooit: hij vraagt de betaling zelf op.
 */
const express = require('express');
const { html } = require('../site/html');
const { renderPage, renderPageHeader } = require('../site/layout');
const { formatDate } = require('../site/format');
const { isCrossSite } = require('../security/form-guard');
const { clientKey, createRateLimiter } = require('../security/rate-limit');
const payments = require('./payments');

/** Betalingen starten: hoogstens zoveel per bezoeker en per aanmelding per venster. */
const START_LIMIT = 10;
const START_WINDOW_MS = 10 * 60 * 1000;

/** Webhook en terugkeerpagina: hoogstens zoveel per bezoeker per minuut. */
const WEBHOOK_LIMIT = 120;

/** Meldingen op de betaalpagina. */
const MESSAGES = {
  uit: 'Online betalen is op dit moment niet beschikbaar. Maak het bedrag over zoals in de bevestiging staat.',
  geannuleerd: 'Voor deze aanmelding kan niet (meer) online betaald worden. Neem bij vragen contact met ons op.',
  'niets-open': 'Er staat voor deze aanmelding niets open. Dank je wel!',
  bezig: 'Er is al een betaling voor deze aanmelding in behandeling. Wacht even af; je krijgt bericht als er iets niet goed gaat.',
  mislukt: 'Het betaalscherm kon niet worden geopend. Probeer het over een paar minuten opnieuw, of maak het bedrag over.',
};

/**
 * Maakt de openbare routes.
 * @param {{db: any, onlinePayments: any, settings: any, now?: () => number}} options Database, online betalen,
 *   instellingen en klok.
 * @returns {express.Router} Router.
 */
function createOnlinePaymentRoutes(options) {
  const { onlinePayments, settings } = options;
  const router = express.Router();
  const startLimiter = createRateLimiter({ limit: START_LIMIT, windowMs: START_WINDOW_MS, now: options.now });
  const hookLimiter = createRateLimiter({ limit: WEBHOOK_LIMIT, windowMs: 60 * 1000, now: options.now });
  const form = express.urlencoded({ extended: false, limit: '2kb', parameterLimit: 5 });

  /**
   * Stuurt een betaalpagina (noindex, geen cache, geen referrer naar Mollie). 'same-origin' en niet 'no-referrer',
   * omdat Chrome anders bij het betaalformulier `Origin: null` stuurt en de herkomstcontrole het weigert.
   * @param {any} res Express-antwoord.
   * @param {any} body Inhoud.
   * @param {number} [status] HTTP-status.
   * @returns {void}
   */
  const send = (res, body, status = 200) => {
    res.status(status).set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'same-origin' }).type('html').send(renderPage({
      title: 'Betalen', path: '/betalen/', site: res.locals.site, indexable: false,
      header: renderPageHeader({ title: 'Betalen', pretitle: 'Avanta reizen' }),
      body: html`<div class="content-main"><section class="page-content"><div class="page-content__form account">${body}</div></section></div>`,
    }));
  };

  /**
   * Een melding zonder knop.
   * @param {any} res Express-antwoord.
   * @param {string} message Melding.
   * @param {number} [status] HTTP-status.
   * @returns {void}
   */
  const notice = (res, message, status = 200) => send(res, html`<p class="notice" role="status">${message}</p>`, status);

  /**
   * De aanmelding uit de link, of een 404 als de link niet klopt.
   * @param {any} req Express-verzoek.
   * @param {any} res Express-antwoord.
   * @returns {(number|null)} Id, of null (antwoord al verstuurd).
   */
  const bookingFromLink = (req, res) => {
    const bookingId = onlinePayments.bookingIdFrom(req.params.link);
    if (bookingId === null) {
      notice(res, 'Deze betaallink klopt niet. Gebruik de link uit de laatste mail van Avanta reizen.', 404);
      return null;
    }
    return bookingId;
  };

  // Eerst de webhook: anders zou `/betalen/:link/` hem afvangen.
  router.post('/betalen/webhook/', form, async (req, res, next) => {
    try {
      if (!hookLimiter.hit(`webhook:${clientKey(req)}`)) return res.status(429).type('text').send('Te veel verzoeken.');
      const outcome = await onlinePayments.refresh(String((req.body && req.body.id) || ''));
      // Mollie probeert het later opnieuw bij een fout; een onbekend id krijgt gewoon 200 (niets te melden).
      if (outcome.status === 'mislukt') return res.status(503).type('text').send('Later opnieuw.');
      return res.status(200).type('text').send('ok');
    } catch (error) {
      return next(error);
    }
  });

  router.get('/betalen/:link/', async (req, res, next) => {
    try {
      const bookingId = bookingFromLink(req, res);
      if (bookingId === null) return undefined;
      const state = await onlinePayments.loadState(options.db, bookingId);
      if (!state) return notice(res, 'Deze betaallink klopt niet. Gebruik de link uit de laatste mail van Avanta reizen.', 404);
      const blocked = onlinePayments.blockedReason(state);
      if (blocked) return notice(res, MESSAGES[blocked]);
      const { booking, summary, kind, amountCents } = state;
      const due = kind === 'aanbetaling' ? summary.depositDueOn : summary.balanceDueOn;
      return send(res, html`
        <div class="account__intro"><p>Hier betaal je de ${kind} voor je reis online.</p></div>
        <dl class="pay-summary">
          <dt>Referentie</dt><dd>${booking.reference}</dd>
          <dt>Reis</dt><dd>${booking.trip_title}${booking.departure_date ? `, vertrek ${formatDate(booking.departure_date)}` : ''}</dd>
          <dt>Nu te betalen (${kind})</dt><dd><strong>${payments.formatAmount(amountCents)}</strong></dd>
          ${due ? html`<dt>Uiterlijk</dt><dd>${formatDate(due)}</dd>` : ''}
        </dl>
        ${onlinePayments.enabled()
          ? html`<form class="form form--theme" method="post" action="${onlinePayments.pathFor(bookingId)}"><div class="form__footer"><button class="btn" type="submit">Betalen met iDEAL</button></div></form>
            <p>Je gaat naar het beveiligde betaalscherm van onze betaalprovider Mollie.</p>`
          : html`<p class="notice" role="status">${MESSAGES.uit}</p><p>${settings.get('bookingPaymentText')}</p>`}`);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/betalen/:link/', form, async (req, res, next) => {
    try {
      if (isCrossSite(req)) return res.status(403).type('text').send('Verzoek geweigerd.');
      const bookingId = bookingFromLink(req, res);
      if (bookingId === null) return undefined;
      if (!startLimiter.hit(`bezoeker:${clientKey(req)}`) || !startLimiter.hit(`aanmelding:${bookingId}`)) {
        return notice(res, 'Je hebt het betaalscherm al vaak geopend. Probeer het over tien minuten opnieuw.', 429);
      }
      const outcome = await onlinePayments.start(bookingId);
      if (outcome.status === 'weg') return notice(res, 'Deze betaallink klopt niet. Gebruik de link uit de laatste mail van Avanta reizen.', 404);
      if (outcome.status !== 'ok') return notice(res, MESSAGES[outcome.status], outcome.status === 'mislukt' ? 502 : (outcome.status === 'uit' ? 503 : 409));
      return send(res, html`<meta http-equiv="refresh" content="0; url=${outcome.checkoutUrl}">
        <p>Je gaat naar het betaalscherm van Mollie.</p>
        <p><a class="btn" href="${outcome.checkoutUrl}" rel="noreferrer">Doorgaan naar betalen</a></p>`);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/betalen/:link/klaar/', async (req, res, next) => {
    try {
      const bookingId = bookingFromLink(req, res);
      if (bookingId === null) return undefined;
      if (!hookLimiter.hit(`terug:${clientKey(req)}`)) return notice(res, 'Even geduld; probeer het straks opnieuw.', 429);
      // Niet wachten op de webhook: de stand nu zelf opvragen (als die er nog niet was).
      const last = await onlinePayments.latest(bookingId);
      let state = last ? last.status : '';
      if (last && !['paid', 'canceled', 'expired', 'failed'].includes(state) && onlinePayments.enabled()) {
        const outcome = await onlinePayments.refresh(last.provider_ref);
        if (outcome.status === 'ok') state = outcome.state;
      }
      if (state === 'paid') return notice(res, 'Dank je wel, je betaling is ontvangen.');
      if (['canceled', 'expired', 'failed'].includes(state)) {
        return send(res, html`<p class="notice" role="status">De betaling is niet gelukt of afgebroken; er is niets afgeschreven.</p>
          <p><a class="btn" href="${onlinePayments.pathFor(bookingId)}">Opnieuw proberen</a></p>`);
      }
      return notice(res, 'Dank je wel. Zodra de betaling bij ons binnen is, verwerken we hem; dat duurt meestal maar even.');
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createOnlinePaymentRoutes, START_LIMIT, WEBHOOK_LIMIT };
