// @ts-check
/**
 * JSON-API van de categorieën en tags van het blog (`/app/api/blog-indeling/…`, recht `content`) voor de schermen in
 * Vue (fase V3 van de ombouw, `docs/VUE-OMBOUW.md`). Dezelfde logica als het oude scherm (`post-terms.js`): eerst de
 * vorm met een schema (`api/schema.js`, `.strict()`), daarna dezelfde veldcontrole als het formulier
 * (`validateTermFields`). Een nieuw adres geeft een 301 vanaf het oude adres en laadt de doorverwijzingen opnieuw. Elke
 * wijziging schrijft de audit in dezelfde transactie, met dezelfde acties als het oude scherm.
 *
 * Routes (binnen `/app/api`):
 * - `GET /blog-indeling/`: per soort (categorie, tag) de lijst met het aantal berichten, en de grenzen;
 * - `POST /blog-indeling/`: een nieuwe categorie of tag;
 * - `GET|PUT|DELETE /blog-indeling/:id/`: één categorie of tag (verwijderen laat de berichten staan).
 *
 * Schrijven heeft naast de algemene limiet van het CRM een eigen limiet per gebruiker (`WRITE_LIMIT`).
 */
const express = require('express');
const { routePath } = require('../route-path');
const { z } = require('../api/schema');
const { createWriteLimit, apiFieldNames, sortOrderSchema } = require('../api/module-helpers');
const { createPostTerms, validateTermFields, TERM_KINDS, TERM_LIMITS } = require('./post-terms');
const { MAX_SLUG_LENGTH } = require('../trips/slugs');

/** Schrijvende verzoeken per gebruiker per minuut. */
const WRITE_LIMIT = 60;

/** Veldnamen van de formuliercontrole (`post-terms.js`) naar de veldnamen van de API. */
const FIELD_NAMES = { name: 'naam', slug: 'adres', intro: 'inleiding', sort_order: 'volgorde', kind: 'soort' };

/** Velden die een categorie en een tag gemeen hebben. Lengte en tekens controleert `validateTermFields`. */
const termFields = {
  naam: z.string({ error: 'Vul een naam in.' }),
  adres: z.string({ error: 'Gebruik kleine letters, cijfers en streepjes.' }).max(MAX_SLUG_LENGTH * 2, 'Dit adres is te lang.').optional(),
  inleiding: z.string({ error: 'Vul tekst in.' }).max(TERM_LIMITS.intro * 2, `Maximaal ${TERM_LIMITS.intro} tekens.`).optional(),
  volgorde: sortOrderSchema.optional(),
};

/** Invoer van een nieuwe categorie of tag. */
const createSchema = z.object({ soort: z.enum(['categorie', 'tag'], { error: 'Kies categorie of tag.' }), ...termFields }).strict();

/** Invoer bij wijzigen (de soort verandert niet). */
const updateSchema = z.object(termFields).strict();

/**
 * Leest de vorm-gecontroleerde invoer als velden van het formulier en controleert die zoals het oude scherm.
 * @param {any} input Invoer uit `createSchema` of `updateSchema`.
 * @returns {{values: any, errors: Record<string, string>}} Waarden en fouten.
 */
const checkTerm = (input) => validateTermFields({
  name: input.naam, slug: input.adres || '', intro: input.inleiding || '',
  sort_order: input.volgorde === undefined ? '' : String(input.volgorde),
});

/**
 * Leesfuncties: dezelfde antwoorden als de GET-routes hieronder. Ook gebruikt door `post-term-routes.js` om het eerste
 * scherm mee te sturen in de pagina (`renderMountPoint`, `preload`), zodat dat scherm niet op een extra verzoek wacht.
 * @param {{db: any}} options Database.
 * @returns {{overview: () => Promise<any>, term: (id: number|string) => Promise<any|null>}} Antwoorden; null als het
 *   id niet bestaat.
 */
function createPostTermReads(options) {
  const terms = createPostTerms({ db: options.db });
  return {
    overview: async () => {
      const rows = await terms.list();
      return {
        soorten: Object.entries(TERM_KINDS).map(([kind, definition]) => ({
          soort: kind, naam: definition.label, meervoud: definition.plural, voorvoegsel: definition.prefix,
          items: rows.filter((row) => row.kind === kind).map((row) => ({ id: row.id, naam: row.name, adres: row.slug, berichten: row.post_count, volgorde: row.sort_order })),
        })),
        grenzen: { naam: TERM_LIMITS.name, inleiding: TERM_LIMITS.intro, adres: MAX_SLUG_LENGTH, aantal: TERM_LIMITS.terms },
      };
    },
    term: async (id) => {
      const term = await terms.get(id);
      if (!term) return null;
      const definition = TERM_KINDS[term.kind];
      return {
        id: term.id, soort: term.kind, soortNaam: definition.label, voorvoegsel: definition.prefix, naam: term.name,
        adres: term.slug, inleiding: term.intro || '', volgorde: term.sort_order, gewijzigd: term.updated_at,
      };
    },
  };
}

/**
 * Maakt de API-routes van de categorieën en tags.
 * @param {any} context Context van de API-router (`api/router.js`): `db`, `auth`, `requireRight`, `validate`,
 *   `sendApiError`, eventueel `redirects` (opnieuw laden na een nieuw adres) en `now` (tests).
 * @returns {express.Router} Router binnen `/app/api`.
 */
function createPostTermApi(context) {
  const { auth, sendApiError } = context;
  const terms = createPostTerms({ db: context.db });
  const reads = createPostTermReads({ db: context.db });
  const router = express.Router();
  const guard = context.requireRight('content');
  const write = [guard, createWriteLimit({ name: 'blog-indeling', limit: WRITE_LIMIT, now: context.now, sendApiError })];

  /**
   * Audit voor een actie, in de transactie van de wijziging.
   * @param {any} req Express-verzoek.
   * @param {string} action Actie (`TERM_ACTION_LABELS` in `post-term-routes.js`).
   * @param {(number|string|null)} [entityId] Id; bij iets nieuws komt het id uit de transactie.
   * @returns {Function} `(client, id?) => Promise`.
   */
  const auditFor = (req, action, entityId = req.params.id) => (client, id) => auth.audit(req, { userId: req.user.id, action, entity: 'post_terms', entityId: id || entityId || null }, client);

  /**
   * Stuurt `ongeldig` met de meldingen per veld.
   * @param {any} res Express-antwoord.
   * @param {Record<string, string>} errors Fouten met de namen van het formulier.
   * @returns {any} Het antwoord.
   */
  const invalid = (res, errors) => sendApiError(res, 'ongeldig', { fields: apiFieldNames(errors, FIELD_NAMES) });

  router.get('/blog-indeling/', guard, async (req, res) => {
    res.json(await reads.overview());
  });

  router.post('/blog-indeling/', write, context.validate(createSchema), async (req, res) => {
    const { values, errors } = checkTerm(req.input);
    if (Object.keys(errors).length) return invalid(res, errors);
    const outcome = await terms.create(req.input.soort, values, { userId: req.user.id, audit: auditFor(req, 'blog-indeling.nieuw', null) });
    if (outcome.errors) return invalid(res, outcome.errors);
    return res.status(201).json({ id: outcome.id });
  });

  router.get(routePath('/blog-indeling/:id(\\d{1,9})/'), guard, async (req, res) => {
    const term = await reads.term(req.params.id);
    return term ? res.json(term) : sendApiError(res, 'niet-gevonden');
  });

  router.put(routePath('/blog-indeling/:id(\\d{1,9})/'), write, context.validate(updateSchema), async (req, res) => {
    const { values, errors } = checkTerm(req.input);
    if (Object.keys(errors).length) return invalid(res, errors);
    const outcome = await terms.update(req.params.id, values, { userId: req.user.id, audit: auditFor(req, 'blog-indeling.gewijzigd') });
    if (outcome.status === 'weg') return sendApiError(res, 'niet-gevonden');
    if (outcome.status === 'fout') return invalid(res, outcome.errors);
    if (outcome.moved && context.redirects) await context.redirects.reload().catch(() => {});
    return res.json({ id: Number(req.params.id), verplaatst: Boolean(outcome.moved) });
  });

  router.delete(routePath('/blog-indeling/:id(\\d{1,9})/'), write, async (req, res) => {
    const outcome = await terms.remove(req.params.id, { audit: auditFor(req, 'blog-indeling.verwijderd') });
    if (outcome.status === 'weg') return sendApiError(res, 'niet-gevonden');
    return res.status(204).end();
  });

  return router;
}

module.exports = { createPostTermApi, createPostTermReads, WRITE_LIMIT };
