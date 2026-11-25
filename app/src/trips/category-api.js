// @ts-check
/**
 * JSON-API van de reistypes en landen (`/app/api/reistypes-en-landen/…`, recht `reizen`) voor de schermen in Vue (fase
 * V3 van de ombouw, `docs/VUE-OMBOUW.md`). Dezelfde logica als het oude scherm (`categories.js`): eerst de vorm met een
 * schema (`api/schema.js`, `.strict()`), daarna dezelfde veldcontrole en opschoning als het formulier
 * (`validateCategory`, `sanitizeHtml`). Een nieuwe of samengevoegde slug geeft een 301 en laadt de doorverwijzingen
 * opnieuw. Elke wijziging schrijft de audit in dezelfde transactie, met dezelfde acties als het oude scherm.
 *
 * Routes (binnen `/app/api`):
 * - `GET /reistypes-en-landen/`: alle reistypes, landen en overige categorieën met hun tellingen, de soorten, de
 *   iconen (vormen om te tekenen) en de grenzen;
 * - `POST /reistypes-en-landen/`: een nieuwe;
 * - `GET|PUT|DELETE /reistypes-en-landen/:id/`: één (verwijderen alleen als er geen reizen en foto's aan hangen);
 * - `PUT /reistypes-en-landen/:id/foto/`: foto uit de bibliotheek kiezen of weghalen;
 * - `GET /reistypes-en-landen/:id/fotos/`: foto's voor de kiezer (bij een land standaard die van dat land);
 * - `POST /reistypes-en-landen/:id/samenvoegen/`: samenvoegen met een andere van dezelfde soort.
 *
 * Schrijven heeft naast de algemene limiet van het CRM een eigen limiet per gebruiker (`WRITE_LIMIT`).
 */
const express = require('express');
const { routePath } = require('../route-path');
const { z, idParam } = require('../api/schema');
const { createWriteLimit, apiFieldNames, photoQuerySchema, photoPickerPage } = require('../api/module-helpers');
const { categoryPath } = require('../site/format');
const { ICONS, categoryIconName } = require('../site/icons');
const { createMediaLibrary } = require('../media/library');
const { createCategories, validateCategory, KINDS, ICON_CHOICES, LIMITS } = require('./categories');

/** Schrijvende verzoeken per gebruiker per minuut. */
const WRITE_LIMIT = 60;

/** Meervoud van de soorten (zelfde koppen als het oude scherm). */
const KIND_TITLES = { type: 'Reistypes', bestemming: 'Landen', overig: 'Overige categorieën' };

/** Veldnamen van de formuliercontrole (`categories.js`) naar de veldnamen van de API. */
const FIELD_NAMES = { name: 'naam', slug: 'adres', kind: 'soort', icon: 'icoon', intro: 'inleiding', body_html: 'tekst', sort_order: 'volgorde' };

/** Een tekst met een ruime bovengrens (de echte grens en melding komen uit `validateCategory`). */
const text = (max, message) => z.string({ error: message }).max(max, message);

/** Invoer van een reistype of land. */
const categorySchema = z.object({
  naam: text(LIMITS.name * 4, 'Vul een naam in.'),
  adres: text(200, 'Gebruik alleen kleine letters, cijfers en streepjes (maximaal 80 tekens).').optional(),
  soort: text(20, 'Kies een soort.'),
  icoon: text(60, 'Kies een icoon uit de lijst.').optional(),
  inleiding: text(LIMITS.intro * 2, `Maximaal ${LIMITS.intro} tekens.`).optional(),
  tekst: text(LIMITS.body * 2, 'De tekst is te lang.').optional(),
  volgorde: z.number({ error: 'Vul een heel getal in tussen -9999 en 9999.' }).int('Vul een heel getal in tussen -9999 en 9999.').min(-9999, 'Vul een heel getal in tussen -9999 en 9999.').max(9999, 'Vul een heel getal in tussen -9999 en 9999.').optional(),
  homepage: z.boolean({ error: 'Kies ja of nee.' }).optional(),
}).strict();

/** Foto kiezen (een id) of weghalen (null). */
const photoSchema = z.object({ fotoId: idParam.nullable() }).strict();

/** Samenvoegen met een andere categorie. */
const mergeSchema = z.object({ doelId: z.number({ error: 'Kies met welke categorie je wilt samenvoegen.' }).int().positive().max(2147483647) }).strict();

/**
 * Leest de vorm-gecontroleerde invoer als velden van het formulier en controleert die zoals het oude scherm.
 * @param {any} input Invoer uit `categorySchema`.
 * @returns {{values: any, errors: Record<string, string>}} Waarden en fouten.
 */
const checkCategory = (input) => validateCategory({
  name: input.naam, slug: input.adres || '', kind: input.soort, icon: input.icoon || '', intro: input.inleiding || '',
  body_html: input.tekst || '', sort_order: input.volgorde === undefined ? '' : String(input.volgorde), show_on_home: input.homepage ? '1' : '',
});

/**
 * Een categorie in de lijst.
 * @param {any} row Rij uit `categories.list`.
 * @returns {any} Categorie voor de API.
 */
const listItem = (row) => ({
  id: row.id, naam: row.name, adres: row.slug, soort: row.kind, icoon: row.kind === 'type' ? categoryIconName(row) : null, code: row.iso_code || null,
  volgorde: row.sort_order, homepage: Boolean(row.show_on_home), reizen: row.trip_count, komend: row.upcoming_count, fotos: row.photo_count,
});

/**
 * Leesfuncties: dezelfde antwoorden als de GET-routes hieronder. Ook gebruikt door `category-routes.js` om het eerste
 * scherm mee te sturen in de pagina (`renderMountPoint`, `preload`), zodat dat scherm niet op een extra verzoek wacht.
 * @param {{db: any, mediaLibrary?: any}} options Database en eventueel de fotobibliotheek.
 * @returns {{overview: () => Promise<any>, category: (id: number|string) => Promise<any|null>,
 *   photos: (category: any, query: {text?: string, page?: number, all?: boolean}) => Promise<any>}} Antwoorden; null
 *   als het id niet bestaat. `photos` krijgt de categorie uit `category`.
 */
function createCategoryReads(options) {
  const { db } = options;
  const categories = createCategories({ db });
  const library = options.mediaLibrary || createMediaLibrary({ db, mediaDir: '' });
  return {
    overview: async () => {
      const rows = await categories.list();
      return {
        soorten: Object.entries(KINDS).map(([kind, label]) => ({ soort: kind, naam: label, meervoud: KIND_TITLES[kind] })),
        items: rows.map(listItem),
        iconen: Object.fromEntries(ICON_CHOICES.map((name) => [name, ICONS[name] || []])),
        grenzen: { naam: LIMITS.name, inleiding: LIMITS.intro, tekst: LIMITS.body },
      };
    },
    category: async (id) => {
      const category = await categories.get(id);
      if (!category) return null;
      const others = await categories.list({ kind: category.kind });
      return {
        id: category.id, naam: category.name, adres: category.slug, pad: categoryPath(category.slug), soort: category.kind,
        icoon: category.icon || '', code: category.iso_code || null, inleiding: category.intro || '', tekst: category.body_html || '',
        volgorde: category.sort_order, homepage: Boolean(category.show_on_home), foto: category.image_url || null,
        reizen: category.trip_count, fotos: category.photo_count, gewijzigd: category.updated_at,
        samenvoegenMet: others.filter((row) => row.id !== category.id).map((row) => ({ id: row.id, naam: row.name, adres: row.slug })),
      };
    },
    photos: (category, query) => {
      const countryId = category.soort === 'bestemming' && !query.all ? category.id : null;
      return photoPickerPage(library, { text: query.text, page: query.page, countryId });
    },
  };
}

/**
 * Maakt de API-routes van de reistypes en landen.
 * @param {any} context Context van de API-router (`api/router.js`): `db`, `auth`, `requireRight`, `validate`,
 *   `sendApiError`, eventueel `redirects` (opnieuw laden na een 301), `mediaLibrary` en `now` (tests).
 * @returns {express.Router} Router binnen `/app/api`.
 */
function createCategoryApi(context) {
  const { db, auth, sendApiError } = context;
  const categories = createCategories({ db });
  const reads = createCategoryReads({ db, mediaLibrary: context.mediaLibrary });
  const router = express.Router();
  const guard = context.requireRight('reizen');
  const write = [guard, createWriteLimit({ name: 'reistypes-en-landen', limit: WRITE_LIMIT, now: context.now, sendApiError })];
  const one = (suffix = '') => routePath(`/reistypes-en-landen/:id(\\d{1,9})/${suffix}`);

  /**
   * Audit voor een actie, in de transactie van de wijziging.
   * @param {any} req Express-verzoek.
   * @param {string} action Actie (`CATEGORY_ACTION_LABELS` in `category-routes.js`).
   * @returns {Function} `(client, id?) => Promise`.
   */
  const auditFor = (req, action) => (client, id) => auth.audit(req, { userId: req.user.id, action, entity: 'trip_categories', entityId: id || req.params.id || null }, client);

  /**
   * Laadt de doorverwijzingen opnieuw na een nieuwe 301 (een fout daarin laat de wijziging zelf staan).
   * @returns {Promise<void>}
   */
  const reloadRedirects = async () => {
    if (context.redirects) await context.redirects.reload().catch(() => {});
  };

  /**
   * Stuurt `ongeldig` met de meldingen per veld.
   * @param {any} res Express-antwoord.
   * @param {Record<string, string>} errors Fouten met de namen van het formulier.
   * @returns {any} Het antwoord.
   */
  const invalid = (res, errors) => sendApiError(res, 'ongeldig', { fields: apiFieldNames(errors, FIELD_NAMES) });

  router.get('/reistypes-en-landen/', guard, async (req, res) => {
    res.json(await reads.overview());
  });

  router.post('/reistypes-en-landen/', write, context.validate(categorySchema), async (req, res) => {
    const { values, errors } = checkCategory(req.input);
    if (Object.keys(errors).length) return invalid(res, errors);
    const outcome = await categories.create(values, { userId: req.user.id, audit: auditFor(req, 'categorie.aangemaakt') });
    if (outcome.errors) return invalid(res, outcome.errors);
    await reloadRedirects();
    return res.status(201).json({ id: outcome.id });
  });

  router.get(one(), guard, async (req, res) => {
    const category = await reads.category(req.params.id);
    return category ? res.json(category) : sendApiError(res, 'niet-gevonden');
  });

  router.put(one(), write, context.validate(categorySchema), async (req, res) => {
    const { values, errors } = checkCategory(req.input);
    if (Object.keys(errors).length) return invalid(res, errors);
    const outcome = await categories.update(req.params.id, values, { userId: req.user.id, audit: auditFor(req, 'categorie.gewijzigd') });
    if (outcome.status === 'weg') return sendApiError(res, 'niet-gevonden');
    if (outcome.status === 'fout') return invalid(res, outcome.errors);
    if (outcome.moved) await reloadRedirects();
    return res.json({ id: Number(req.params.id), verplaatst: Boolean(outcome.moved) });
  });

  router.delete(one(), write, async (req, res) => {
    const outcome = await categories.remove(req.params.id, auditFor(req, 'categorie.verwijderd'));
    if (outcome === 'weg') return sendApiError(res, 'niet-gevonden');
    if (outcome === 'gebruikt') return sendApiError(res, 'ongeldig', { message: 'Er hangen reizen of foto\'s aan. Voeg samen in plaats van te verwijderen.' });
    return res.status(204).end();
  });

  router.put(one('foto/'), write, context.validate(photoSchema), async (req, res) => {
    const outcome = await categories.setImage(req.params.id, req.input.fotoId, auditFor(req, 'categorie.foto'));
    if (outcome === 'weg') return sendApiError(res, 'niet-gevonden');
    if (outcome === 'foto-weg') return sendApiError(res, 'ongeldig', { message: 'Deze foto bestaat niet meer. Kies een andere.', fields: { fotoId: 'Deze foto bestaat niet meer. Kies een andere.' } });
    const category = await categories.get(req.params.id);
    return res.json({ foto: category ? category.image_url || null : null });
  });

  router.get(one('fotos/'), guard, context.validate(photoQuerySchema, 'query'), async (req, res) => {
    const category = await reads.category(req.params.id);
    if (!category) return sendApiError(res, 'niet-gevonden');
    return res.json(await reads.photos(category, { text: req.input.zoek, page: req.input.pagina, all: req.input.alle === '1' }));
  });

  router.post(one('samenvoegen/'), write, context.validate(mergeSchema), async (req, res) => {
    const outcome = await categories.merge(req.params.id, req.input.doelId, { userId: req.user.id, audit: auditFor(req, 'categorie.samengevoegd') });
    if (outcome.status === 'weg') return sendApiError(res, 'niet-gevonden');
    const problems = {
      zelfde: 'Kies een andere categorie dan deze.',
      'doel-weg': 'De gekozen categorie bestaat niet meer.',
      'andere-soort': 'Samenvoegen kan alleen met een categorie van dezelfde soort. Wijzig eerst de soort.',
    };
    if (problems[outcome.status]) return sendApiError(res, 'ongeldig', { message: problems[outcome.status], fields: { doelId: problems[outcome.status] } });
    await reloadRedirects();
    return res.json({ doelId: outcome.target.id });
  });

  return router;
}

module.exports = { createCategoryApi, createCategoryReads, WRITE_LIMIT };
