// @ts-check
/**
 * Veelgestelde vragen beheren in het CRM (`/app/faq/`, recht `content`). De schermen staan in Vue
 * (`app/web/src/modules/faq/`) en praten met `faq-api.js`; deze routes geven op de vaste adressen de pagina met het
 * koppelpunt, met de juiste titel en een 404 voor een onbekende vraag of categorie. De oude schermen van de server
 * zijn weg sinds de overgang naar `main` (fase V2 van de ombouw, `docs/VUE-OMBOUW.md` §5).
 */
const express = require('express');
const { routePath } = require('../route-path');
const { html } = require('../site/html');
const { renderCrmPage } = require('../crm/layout');
const { renderMountPoint } = require('../crm/web-bundle');
const { createFaqs } = require('./faqs');

/** Basispad van het scherm. */
const BASE = '/app/faq/';

/** Acties voor het auditlog (zie `ACTION_LABELS` in `crm/users.js`); `faq-api.js` schrijft ze. */
const FAQ_ACTION_LABELS = {
  'faq.vraag-nieuw': 'Veelgestelde vraag toegevoegd',
  'faq.vraag-gewijzigd': 'Veelgestelde vraag gewijzigd',
  'faq.vraag-verwijderd': 'Veelgestelde vraag verwijderd',
  'faq.categorie-nieuw': 'FAQ-categorie toegevoegd',
  'faq.categorie-gewijzigd': 'FAQ-categorie gewijzigd',
  'faq.categorie-verwijderd': 'FAQ-categorie verwijderd',
  'faq.volgorde-gewijzigd': 'Volgorde van de FAQ gewijzigd',
};

/**
 * Maakt de routes voor de FAQ. Zonder bundel (lokaal zonder bouwstap) toont de pagina dat het scherm niet beschikbaar
 * is; in het image is de bundel er altijd.
 * @param {{db: any, auth: any, webBundle?: {assetsFor: (name: string) => any}}} options Database, sessie- en
 *   rechtenlaag en de lezer van het manifest van de bundels.
 * @returns {express.Router} Router.
 */
function createFaqRoutes(options) {
  const { db, auth } = options;
  const faqs = createFaqs({ db });
  const router = express.Router();
  const guard = auth.requireRight('content');

  /**
   * Stuurt de pagina met het koppelpunt van de schermen in Vue.
   * @param {any} req Express-verzoek.
   * @param {any} res Express-antwoord.
   * @param {string} title Titel van de pagina (het scherm in Vue zet hem bij elke wissel opnieuw).
   * @returns {void}
   */
  const sendPage = (req, res, title) => {
    const bundle = options.webBundle ? options.webBundle.assetsFor('faq') : null;
    res.send(renderCrmPage({ title, user: req.user, csrf: req.session.csrf, path: BASE, bundle, body: renderMountPoint({ name: 'faq', base: BASE, available: Boolean(bundle) }) }));
  };

  /**
   * 404 binnen het CRM.
   * @param {any} req Express-verzoek.
   * @param {any} res Express-antwoord.
   * @returns {void}
   */
  const notFound = (req, res) => {
    res.status(404).send(renderCrmPage({ title: 'Niet gevonden', user: req.user, csrf: req.session.csrf, path: BASE, body: html`<p>Deze vraag of categorie bestaat niet. <a href="${BASE}">Naar de veelgestelde vragen</a></p>` }));
  };

  /**
   * Zet een asynchrone handler om in Express-middleware met foutafhandeling.
   * @param {Function} handler `(req, res) => Promise`.
   * @returns {Function} Middleware.
   */
  const handle = (handler) => async (req, res, next) => {
    try {
      return await handler(req, res);
    } catch (error) {
      return next(error);
    }
  };

  router.get('/faq/', guard, (req, res) => sendPage(req, res, 'Veelgestelde vragen'));
  router.get('/faq/nieuw/', guard, (req, res) => sendPage(req, res, 'Vraag toevoegen'));

  router.get(routePath('/faq/:id(\\d{1,9})/'), guard, handle(async (req, res) => {
    if (!await faqs.getQuestion(req.params.id)) return notFound(req, res);
    return sendPage(req, res, 'Vraag wijzigen');
  }));

  router.get(routePath('/faq/categorieen/:id(\\d{1,9})/'), guard, handle(async (req, res) => {
    const category = await faqs.getCategory(req.params.id);
    if (!category) return notFound(req, res);
    return sendPage(req, res, `Categorie: ${category.name}`);
  }));

  return router;
}

module.exports = { createFaqRoutes, FAQ_ACTION_LABELS, BASE };
