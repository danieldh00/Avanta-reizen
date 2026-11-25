// @ts-check
/**
 * JSON-API van de veelgestelde vragen (`/app/api/faq/…`, recht `content`) voor de schermen in Vue (fase V2 van de
 * ombouw, `docs/VUE-OMBOUW.md`). Dezelfde logica als de oude schermen (`faqs.js`): de invoer wordt eerst op vorm
 * gecontroleerd met een schema (`api/schema.js`, `.strict()`) en daarna met dezelfde veldcontrole en opschoning als de
 * formulieren (`validateQuestionFields`, `validateCategoryFields`, `sanitizeHtml`). Elke wijziging schrijft de audit in
 * dezelfde transactie, met dezelfde acties als de oude schermen.
 *
 * Routes (binnen `/app/api`):
 * - `GET /faq/`: categorieën met hun vragen, vragen zonder categorie en de grenzen;
 * - `GET|PUT|DELETE /faq/vragen/:id/`, `POST /faq/vragen/`: één vraag;
 * - `GET|PUT|DELETE /faq/categorieen/:id/`, `POST /faq/categorieen/`: één categorie (verwijderen alleen als hij leeg is);
 * - `PUT /faq/volgorde/`: volgorde van alle categorieën; `PUT /faq/categorieen/:id/volgorde/`: volgorde van de vragen
 *   in een categorie.
 *
 * Schrijven heeft naast de algemene limiet van het CRM een eigen limiet per gebruiker (`WRITE_LIMIT`).
 */
const express = require('express');
const { routePath } = require('../route-path');
const { createRateLimiter } = require('../security/rate-limit');
const { z, idParam } = require('../api/schema');
const { createFaqs, validateCategoryFields, validateQuestionFields, FAQ_LIMITS } = require('./faqs');

/** Schrijvende verzoeken per gebruiker per minuut. */
const WRITE_LIMIT = 60;

/** Veldnamen van de formuliercontrole (`faqs.js`) naar de veldnamen van de API. */
const FIELD_NAMES = { question: 'vraag', category_id: 'categorieId', answer: 'antwoord', sort_order: 'volgorde', name: 'naam' };

/** Volgorde: een heel getal zoals in het formulier (hoogstens zes cijfers). */
const sortOrder = z.number({ error: 'Vul een heel getal in.' }).int('Vul een heel getal in.').min(-999999, 'Vul een heel getal in.').max(999999, 'Vul een heel getal in.');

/** Invoer van een vraag. Lengte en inhoud controleert `validateQuestionFields`. */
const questionSchema = z.object({
  vraag: z.string({ error: 'Vul een vraag in.' }),
  antwoord: z.string({ error: 'Vul een antwoord in.' }),
  categorieId: z.number({ error: 'Kies een categorie.' }).int('Kies een categorie.').positive('Kies een categorie.').max(2147483647, 'Kies een categorie.'),
  volgorde: sortOrder.optional(),
}).strict();

/** Invoer van een categorie. Lengte en tekens controleert `validateCategoryFields`. */
const categorySchema = z.object({
  naam: z.string({ error: 'Vul een naam in.' }),
  volgorde: sortOrder.optional(),
}).strict();

/** Lijst met id's in een nieuwe volgorde (hoogstens zoveel als er kunnen zijn). */
const idList = (max) => z.array(idParam, { error: 'Geef een lijst met id\'s.' }).max(max, 'Te veel id\'s.');

/** Volgorde van alle categorieën. */
const categoryOrderSchema = z.object({ categorieen: idList(FAQ_LIMITS.categories) }).strict();

/** Volgorde van de vragen in één categorie. */
const questionOrderSchema = z.object({ vragen: idList(FAQ_LIMITS.questions) }).strict();

/**
 * Zet de fouten van de formuliercontrole om naar de veldnamen van de API.
 * @param {Record<string, string>} errors Fouten met de namen van het formulier.
 * @returns {Record<string, string>} Fouten met de namen van de API.
 */
function apiFields(errors) {
  /** @type {Record<string, string>} */
  const fields = {};
  for (const [name, message] of Object.entries(errors)) fields[FIELD_NAMES[name] || name] = message;
  return fields;
}

/**
 * Een vraag in het overzicht.
 * @param {any} row Rij uit `faqs.overview`.
 * @returns {{id: number, vraag: string, volgorde: number}} Vraag voor de API.
 */
const listQuestion = (row) => ({ id: row.id, vraag: row.question, volgorde: row.sort_order });

/**
 * Leesfuncties: dezelfde antwoorden als de GET-routes hieronder. Ook gebruikt door `faq-routes.js` om het eerste scherm
 * mee te sturen in de pagina (`renderMountPoint`, `preload`), zodat dat scherm niet op een extra verzoek wacht.
 * @param {{db: any}} options Database.
 * @returns {{overview: () => Promise<any>, question: (id: number|string) => Promise<any|null>, category: (id: number|string) => Promise<any|null>}}
 *   Antwoorden; null als het id niet bestaat.
 */
function createFaqReads(options) {
  const faqs = createFaqs({ db: options.db });
  return {
    overview: async () => {
      const { categories, loose } = await faqs.overview();
      return {
        categorieen: categories.map((category) => ({ id: category.id, naam: category.name, volgorde: category.sort_order, vragen: category.questions.map(listQuestion) })),
        los: loose.map(listQuestion),
        grenzen: { categorieen: FAQ_LIMITS.categories, vragen: FAQ_LIMITS.questions, naam: FAQ_LIMITS.category, vraag: FAQ_LIMITS.question, antwoord: FAQ_LIMITS.answer },
      };
    },
    question: async (id) => {
      const question = await faqs.getQuestion(id);
      return question && {
        id: question.id, vraag: question.question, antwoord: question.answer_html, categorieId: question.category_id,
        volgorde: question.sort_order, gewijzigd: question.updated_at,
      };
    },
    category: async (id) => {
      const category = await faqs.getCategory(id);
      return category && { id: category.id, naam: category.name, volgorde: category.sort_order, aantalVragen: category.question_count };
    },
  };
}

/**
 * Maakt de API-routes van de FAQ.
 * @param {any} context Context van de API-router (`api/router.js`): `db`, `auth`, `requireRight`, `validate`,
 *   `sendApiError` en eventueel `now` (tests).
 * @returns {express.Router} Router binnen `/app/api`.
 */
function createFaqApi(context) {
  const { auth, sendApiError } = context;
  const faqs = createFaqs({ db: context.db });
  const reads = createFaqReads({ db: context.db });
  const router = express.Router();
  const guard = context.requireRight('content');
  const writeLimiter = createRateLimiter({ limit: WRITE_LIMIT, windowMs: 60 * 1000, now: context.now });

  /**
   * Middleware: telt een schrijvend verzoek van de gebruiker; boven de limiet `te-veel` (429).
   * @param {any} req Express-verzoek.
   * @param {any} res Express-antwoord.
   * @param {Function} next Volgende stap.
   * @returns {any} Niets, of het foutantwoord.
   */
  const writeLimit = (req, res, next) => {
    if (writeLimiter.hit(`faq:${req.user.id}`)) return next();
    res.set('Retry-After', '60');
    return sendApiError(res, 'te-veel');
  };

  /** Alles wat schrijft: recht, limiet. */
  const write = [guard, writeLimit];

  /**
   * Audit voor een actie, in de transactie van de wijziging.
   * @param {any} req Express-verzoek.
   * @param {string} action Actie (`FAQ_ACTION_LABELS` in `faq-routes.js`).
   * @param {string} entity Tabel.
   * @param {(number|string|null)} [entityId] Id; bij iets nieuws komt het id uit de transactie.
   * @returns {Function} `(client, id?) => Promise`.
   */
  const auditFor = (req, action, entity, entityId = req.params.id) => (client, id) => auth.audit(req, { userId: req.user.id, action, entity, entityId: id || entityId || null }, client);

  /**
   * Leest de vorm-gecontroleerde vraag als velden van het formulier en controleert die zoals het oude scherm.
   * @param {any} input Invoer uit `questionSchema`.
   * @returns {{values: any, errors: Record<string, string>}} Waarden en fouten.
   */
  const checkQuestion = (input) => validateQuestionFields({
    question: input.vraag, answer: input.antwoord, category_id: String(input.categorieId),
    sort_order: input.volgorde === undefined ? '' : String(input.volgorde),
  });

  /**
   * Leest de vorm-gecontroleerde categorie als velden van het formulier en controleert die zoals het oude scherm.
   * @param {any} input Invoer uit `categorySchema`.
   * @returns {{values: any, errors: Record<string, string>}} Waarden en fouten.
   */
  const checkCategory = (input) => validateCategoryFields({ name: input.naam, sort_order: input.volgorde === undefined ? '' : String(input.volgorde) });

  /**
   * Stuurt `ongeldig` met de meldingen per veld.
   * @param {any} res Express-antwoord.
   * @param {Record<string, string>} errors Fouten met de namen van het formulier.
   * @returns {any} Het antwoord.
   */
  const invalid = (res, errors) => sendApiError(res, 'ongeldig', { fields: apiFields(errors) });

  router.get('/faq/', guard, async (req, res) => {
    res.json(await reads.overview());
  });

  router.get(routePath('/faq/vragen/:id(\\d{1,9})/'), guard, async (req, res) => {
    const question = await reads.question(req.params.id);
    return question ? res.json(question) : sendApiError(res, 'niet-gevonden');
  });

  router.post('/faq/vragen/', write, context.validate(questionSchema), async (req, res) => {
    const { values, errors } = checkQuestion(req.input);
    if (Object.keys(errors).length) return invalid(res, errors);
    const outcome = await faqs.createQuestion(values, { userId: req.user.id, audit: auditFor(req, 'faq.vraag-nieuw', 'faqs', null) });
    if (outcome.errors) return invalid(res, outcome.errors);
    return res.status(201).json({ id: outcome.id });
  });

  router.put(routePath('/faq/vragen/:id(\\d{1,9})/'), write, context.validate(questionSchema), async (req, res) => {
    const { values, errors } = checkQuestion(req.input);
    if (Object.keys(errors).length) return invalid(res, errors);
    const outcome = await faqs.updateQuestion(req.params.id, values, { userId: req.user.id, audit: auditFor(req, 'faq.vraag-gewijzigd', 'faqs') });
    if (outcome.status === 'weg') return sendApiError(res, 'niet-gevonden');
    if (outcome.status === 'fout') return invalid(res, outcome.errors);
    return res.json({ id: Number(req.params.id) });
  });

  router.delete(routePath('/faq/vragen/:id(\\d{1,9})/'), write, async (req, res) => {
    const outcome = await faqs.removeQuestion(req.params.id, { audit: auditFor(req, 'faq.vraag-verwijderd', 'faqs') });
    if (outcome.status === 'weg') return sendApiError(res, 'niet-gevonden');
    return res.status(204).end();
  });

  router.put('/faq/volgorde/', write, context.validate(categoryOrderSchema), async (req, res) => {
    const outcome = await faqs.reorderCategories(req.input.categorieen, { userId: req.user.id, audit: auditFor(req, 'faq.volgorde-gewijzigd', 'faq_categories', null) });
    if (outcome.status === 'fout') return sendApiError(res, 'ongeldig', { message: 'De lijst klopt niet meer. Laad de pagina opnieuw.', fields: { categorieen: 'Geef alle categorieën precies één keer.' } });
    return res.json({ ok: true });
  });

  router.get(routePath('/faq/categorieen/:id(\\d{1,9})/'), guard, async (req, res) => {
    const category = await reads.category(req.params.id);
    return category ? res.json(category) : sendApiError(res, 'niet-gevonden');
  });

  router.post('/faq/categorieen/', write, context.validate(categorySchema), async (req, res) => {
    const { values, errors } = checkCategory(req.input);
    if (Object.keys(errors).length) return invalid(res, errors);
    const outcome = await faqs.createCategory(values, { userId: req.user.id, audit: auditFor(req, 'faq.categorie-nieuw', 'faq_categories', null) });
    if (outcome.errors) return invalid(res, outcome.errors);
    return res.status(201).json({ id: outcome.id });
  });

  router.put(routePath('/faq/categorieen/:id(\\d{1,9})/'), write, context.validate(categorySchema), async (req, res) => {
    const { values, errors } = checkCategory(req.input);
    if (Object.keys(errors).length) return invalid(res, errors);
    const outcome = await faqs.updateCategory(req.params.id, values, { userId: req.user.id, audit: auditFor(req, 'faq.categorie-gewijzigd', 'faq_categories') });
    if (outcome.status === 'weg') return sendApiError(res, 'niet-gevonden');
    if (outcome.status === 'fout') return invalid(res, outcome.errors);
    return res.json({ id: Number(req.params.id), hernoemd: Boolean(outcome.renamed) });
  });

  router.delete(routePath('/faq/categorieen/:id(\\d{1,9})/'), write, async (req, res) => {
    const outcome = await faqs.removeCategory(req.params.id, { audit: auditFor(req, 'faq.categorie-verwijderd', 'faq_categories') });
    if (outcome.status === 'weg') return sendApiError(res, 'niet-gevonden');
    if (outcome.status === 'vol') return sendApiError(res, 'ongeldig', { message: 'Er staan nog vragen in deze categorie. Verplaats of verwijder die eerst.' });
    return res.status(204).end();
  });

  router.put(routePath('/faq/categorieen/:id(\\d{1,9})/volgorde/'), write, context.validate(questionOrderSchema), async (req, res) => {
    const outcome = await faqs.reorderQuestions(req.params.id, req.input.vragen, { userId: req.user.id, audit: auditFor(req, 'faq.volgorde-gewijzigd', 'faqs', null) });
    if (outcome.status === 'weg') return sendApiError(res, 'niet-gevonden');
    if (outcome.status === 'fout') return sendApiError(res, 'ongeldig', { message: 'De lijst klopt niet meer. Laad de pagina opnieuw.', fields: { vragen: 'Geef alle vragen van deze categorie precies één keer.' } });
    return res.json({ ok: true });
  });

  return router;
}

module.exports = { createFaqApi, createFaqReads, WRITE_LIMIT };
