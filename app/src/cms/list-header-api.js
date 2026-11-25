// @ts-check
/**
 * JSON-API van de koppen van de lijstpagina's (`/app/api/lijstpaginas/…`, recht `content`) voor de schermen in Vue
 * (fase V3 van de ombouw, `docs/VUE-OMBOUW.md`). Dezelfde logica als het oude scherm (`list-headers.js`): eerst de vorm
 * met een schema (`api/schema.js`, `.strict()`), daarna dezelfde veldcontrole als het formulier
 * (`validateListHeaderFields`). Na elke wijziging toont de site meteen de nieuwe kop (de gedeelde kopie in het geheugen
 * wordt ververst). Elke wijziging schrijft de audit in dezelfde transactie, met dezelfde acties als het oude scherm.
 *
 * Routes (binnen `/app/api`), alleen voor de vaste sleutels (`reis`, `reisleider`, `blog`, `faq`, `aanmelden`):
 * - `GET /lijstpaginas/`: alle koppen met de bron van de inhoud en de grenzen;
 * - `GET|PUT /lijstpaginas/:sleutel/`: één kop lezen of de teksten wijzigen;
 * - `PUT /lijstpaginas/:sleutel/foto/`: foto uit de bibliotheek kiezen of weghalen;
 * - `GET /lijstpaginas/:sleutel/fotos/`: foto's voor de kiezer.
 *
 * Schrijven heeft naast de algemene limiet van het CRM een eigen limiet per gebruiker (`WRITE_LIMIT`).
 */
const express = require('express');
const { routePath } = require('../route-path');
const { z, idParam } = require('../api/schema');
const { createWriteLimit, apiFieldNames, photoQuerySchema, photoPickerPage } = require('../api/module-helpers');
const { createMediaLibrary } = require('../media/library');
const { createListHeaders, validateListHeaderFields, LIST_HEADER_LIMITS } = require('./list-headers');

/** Schrijvende verzoeken per gebruiker per minuut. */
const WRITE_LIMIT = 60;

/** Route-patroon van een kop: alleen de vaste sleutels (gelijk aan `list-header-routes.js`). */
const KEY_PATTERN = ':key(reis|reisleider|blog|faq|aanmelden)';

/** Waar de kop vandaan komt (gelijk aan het oude overzicht). */
const SOURCE_LABELS = { standaard: 'Standaardtekst', bestand: 'Overgenomen van de huidige site', crm: 'Gewijzigd in het CRM' };

/** Veldnamen van de formuliercontrole (`list-headers.js`) naar de veldnamen van de API. */
const FIELD_NAMES = { pretitle: 'pretitel', title: 'titel', introduction: 'inleiding' };

/** Invoer van een kop. Lengte en tekens controleert `validateListHeaderFields`. */
const headerSchema = z.object({
  pretitel: z.string({ error: 'Vul tekst in.' }).max(LIST_HEADER_LIMITS.pretitle * 4, `Maximaal ${LIST_HEADER_LIMITS.pretitle} tekens.`).optional(),
  titel: z.string({ error: 'Vul een titel in.' }).max(LIST_HEADER_LIMITS.title * 4, `Maximaal ${LIST_HEADER_LIMITS.title} tekens.`),
  inleiding: z.string({ error: 'Vul tekst in.' }).max(LIST_HEADER_LIMITS.introduction * 4, `Maximaal ${LIST_HEADER_LIMITS.introduction} tekens.`).optional(),
}).strict();

/** Foto kiezen (een id) of weghalen (null). */
const photoSchema = z.object({ fotoId: idParam.nullable() }).strict();

/**
 * Een kop voor de API.
 * @param {any} header Kop uit `listHeaders.list()`.
 * @returns {any} Kop.
 */
const apiHeader = (header) => ({
  sleutel: header.key, naam: header.label, pad: header.path || null, pretitel: header.pretitle, titel: header.title,
  inleiding: header.introduction, foto: header.image || null, bron: header.source, bronNaam: SOURCE_LABELS[header.source] || header.source,
});

/**
 * Maakt de API-routes van de koppen van de lijstpagina's.
 * @param {any} context Context van de API-router (`api/router.js`): `db`, `auth`, `requireRight`, `validate`,
 *   `sendApiError`, `listHeaders` (de gedeelde koppen van de site), eventueel `mediaLibrary` en `now` (tests).
 * @returns {express.Router} Router binnen `/app/api`.
 */
function createListHeaderApi(context) {
  const { db, auth, sendApiError } = context;
  const headers = context.listHeaders || createListHeaders({ db });
  const library = context.mediaLibrary || createMediaLibrary({ db, mediaDir: '' });
  const router = express.Router();
  const guard = context.requireRight('content');
  const write = [guard, createWriteLimit({ name: 'lijstpaginas', limit: WRITE_LIMIT, now: context.now, sendApiError })];
  const one = (suffix = '') => routePath(`/lijstpaginas/${KEY_PATTERN}/${suffix}`);

  /**
   * Gebruiker en audit voor een wijziging, in de transactie van de wijziging.
   * @param {any} req Express-verzoek.
   * @param {string} action Actie (`LIST_HEADER_ACTION_LABELS` in `list-header-routes.js`).
   * @returns {{userId: number, audit: (client: object) => Promise<void>}} Context.
   */
  const contextFor = (req, action) => ({
    userId: req.user.id,
    audit: (client) => auth.audit(req, { userId: req.user.id, action, entity: 'list_headers', entityId: req.params.key }, client),
  });

  /**
   * Eén kop uit het overzicht.
   * @param {string} key Sleutel.
   * @returns {Promise<any>} Kop.
   */
  const headerOf = async (key) => (await headers.list()).find((/** @type {any} */ item) => item.key === key);

  router.get('/lijstpaginas/', guard, async (req, res) => {
    res.json({ koppen: (await headers.list()).map(apiHeader), grenzen: { pretitel: LIST_HEADER_LIMITS.pretitle, titel: LIST_HEADER_LIMITS.title, inleiding: LIST_HEADER_LIMITS.introduction } });
  });

  router.get(one(), guard, async (req, res) => {
    res.json(apiHeader(await headerOf(req.params.key)));
  });

  router.put(one(), write, context.validate(headerSchema), async (req, res) => {
    const { values, errors } = validateListHeaderFields({ pretitle: req.input.pretitel || '', title: req.input.titel, introduction: req.input.inleiding || '' });
    if (Object.keys(errors).length) return sendApiError(res, 'ongeldig', { fields: apiFieldNames(errors, FIELD_NAMES) });
    await headers.update(req.params.key, values, contextFor(req, 'lijstkop.gewijzigd'));
    return res.json(apiHeader(await headerOf(req.params.key)));
  });

  router.put(one('foto/'), write, context.validate(photoSchema), async (req, res) => {
    const outcome = await headers.setImage(req.params.key, req.input.fotoId, contextFor(req, 'lijstkop.foto'));
    if (outcome === 'foto-weg') return sendApiError(res, 'ongeldig', { message: 'Deze foto bestaat niet meer. Kies een andere.', fields: { fotoId: 'Deze foto bestaat niet meer. Kies een andere.' } });
    return res.json(apiHeader(await headerOf(req.params.key)));
  });

  router.get(one('fotos/'), guard, context.validate(photoQuerySchema, 'query'), async (req, res) => {
    res.json(await photoPickerPage(library, { text: req.input.zoek, page: req.input.pagina, countryId: null }));
  });

  return router;
}

module.exports = { createListHeaderApi, WRITE_LIMIT };
