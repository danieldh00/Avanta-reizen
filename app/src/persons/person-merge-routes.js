/**
 * Mogelijke dubbelen afhandelen (`/app/deelnemers/:id/samenvoegen/` en `…/niet-dubbel/`, recht
 * `deelnemers.wijzigen`): een persoon met `duplicate_of` samenvoegen met die oorspronkelijke persoon, of de markering
 * weghalen. Bij samenvoegen kiest kantoor per afwijkend NAW-veld welke waarde blijft; per bijzonder blok alleen wie het
 * recht op dat blok heeft (anders worden alleen lege velden aangevuld). Waarden van blokken komen hier nooit op het
 * scherm: daarvoor is *Toon* op de deelnemerspagina.
 */
const express = require('express');
const { routePath } = require('../route-path');
const { html, raw } = require('../site/html');
const { FIELDS } = require('../booking/fields');
const { roleHasRight } = require('../crm/rights');
const { PLAIN_FIELDS, BLOCKS, BLOCK_RIGHTS } = require('./persons');
const { BLOCK_INFO } = require('./person-routes');
const { renderCrmPage, renderAlert, formatDateTime } = require('../crm/layout');

/** Keuzes per blok bij samenvoegen. */
const BLOCK_CHOICES = {
  fill: 'Aanvullen: bestaande waarden houden, lege velden van het dubbel overnemen',
  keep: 'Alleen de bestaande gegevens houden',
  remove: 'De gegevens van het dubbel overnemen',
};

/** Korte omschrijving per blokkeuze in het auditlog. */
const BLOCK_CHOICE_AUDIT = { fill: 'aangevuld', keep: 'bestaande gehouden', remove: 'van het dubbel overgenomen' };

/** Acties voor het auditlog; per blok met gegevens op het dubbel één regel met de keuze (nooit de waarden). */
const MERGE_ACTION_LABELS = {
  'deelnemer.samengevoegd': 'Deelnemers samengevoegd (dubbel verwijderd)',
  'deelnemer.geen-dubbel': 'Deelnemer: markering mogelijk dubbel weggehaald',
  ...Object.fromEntries(Object.keys(BLOCKS).flatMap((block) => Object.entries(BLOCK_CHOICE_AUDIT).map(([choice, text]) => [
    `deelnemer.samengevoegd.${BLOCK_INFO[block].slug}.${choice}`, `Samenvoegen: ${BLOCK_INFO[block].label.toLowerCase()} ${text}`,
  ]))),
};

/** Labels van de formuliervelden op naam. */
const LABELS = Object.fromEntries(FIELDS.map((field) => [field.name, field.label]));

/**
 * Of twee NAW-waarden verschillen (hoofdletterongevoelig, witruimte samengevoegd).
 * @param {*} first Eerste waarde.
 * @param {*} second Tweede waarde.
 * @returns {boolean} Waar als ze verschillen.
 */
function differs(first, second) {
  const normalize = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  return normalize(first) !== normalize(second);
}

/**
 * Leest de keuzes uit het formulier; alleen bekende waarden, blokken zonder recht altijd `fill`.
 * @param {object} body Ingezonden velden.
 * @param {string} role Rol van de gebruiker.
 * @returns {{plain: Record<string, string>, blocks: Record<string, string>}} Keuzes.
 */
function readChoices(body, role) {
  const plain = Object.fromEntries(PLAIN_FIELDS.map((name) => [name, body[`veld_${name}`] === 'remove' ? 'remove' : 'keep']));
  const blocks = Object.fromEntries(Object.keys(BLOCKS).map((block) => {
    const choice = String(body[`blok_${block}`] || 'fill');
    return [block, roleHasRight(role, BLOCK_RIGHTS[block]) && Object.hasOwn(BLOCK_CHOICES, choice) ? choice : 'fill'];
  }));
  return { plain, blocks };
}

/**
 * Maakt de routes voor samenvoegen en "geen dubbel".
 * @param {{db: object, auth: object, persons: object}} options Database, sessie- en rechtenlaag en de personen.
 * @returns {express.Router} Router.
 */
function createPersonMergeRoutes(options) {
  const { db, auth, persons } = options;
  const router = express.Router();
  const canEdit = [auth.requireGlobalRight('deelnemers'), auth.requireRight('deelnemers.wijzigen')];

  /**
   * 404-pagina binnen het CRM.
   * @param {object} req Express-verzoek.
   * @param {object} res Express-antwoord.
   * @returns {void}
   */
  const notFound = (req, res) => res.status(404).send(renderCrmPage({
    title: 'Niet gevonden', user: req.user, csrf: req.session.csrf, path: '/app/deelnemers/',
    body: html`<p>Deze deelnemer bestaat niet of is geen mogelijk dubbel. <a href="/app/deelnemers/">Naar de deelnemers</a></p>`,
  }));

  /**
   * Zoekt het dubbel uit de URL en de persoon waarvan het een dubbel is.
   * @param {{query: Function}} client Database of transactie-client.
   * @param {string} id Id uit de URL.
   * @param {{lock?: boolean}} [mode] Rijen vergrendelen.
   * @returns {Promise<({duplicate: object, original: object}|null)>} Beide personen, of null.
   */
  const findPair = async (client, id, mode = {}) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const duplicate = await persons.findPerson(client, id);
      // Zelfverwijzing nooit samenvoegen: dan zou de blijvende persoon worden verwijderd.
      if (!duplicate || !duplicate.duplicate_of || duplicate.duplicate_of === duplicate.id) return null;
      if (mode.lock) {
        // Beide rijen in één query in vaste volgorde vergrendelen, zodat twee gelijktijdige samenvoegingen van
        // personen die naar elkaar verwijzen elkaar niet in een deadlock houden.
        await client.query('SELECT id FROM persons WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE', [[duplicate.id, duplicate.duplicate_of]]);
        const locked = await persons.findPerson(client, id);
        // Markering intussen veranderd: opnieuw, met het nieuwe paar.
        if (!locked || locked.duplicate_of !== duplicate.duplicate_of) continue;
        const original = await persons.findPerson(client, locked.duplicate_of);
        return original ? { duplicate: locked, original } : null;
      }
      const original = await persons.findPerson(client, duplicate.duplicate_of);
      return original ? { duplicate, original } : null;
    }
    return null;
  };

  /**
   * De vergelijkingspagina.
   * @param {object} req Express-verzoek.
   * @param {{duplicate: object, original: object}} pair Beide personen.
   * @param {string} [error] Foutmelding.
   * @returns {Promise<string>} HTML-pagina.
   */
  const renderMerge = async (req, pair, error) => {
    const { duplicate, original } = pair;
    const counts = await db.query(
      'SELECT person_id, count(*)::int AS total FROM bookings WHERE person_id = ANY($1::int[]) GROUP BY person_id',
      [[original.id, duplicate.id]],
    );
    const bookingsOf = (id) => (counts.find((row) => row.person_id === id) || { total: 0 }).total;
    const name = (person) => `${person.first_names} ${person.last_name} (#${person.id})`;
    return renderCrmPage({
      title: 'Samenvoegen',
      user: req.user,
      csrf: req.session.csrf,
      path: '/app/deelnemers/',
      body: html`<p><a href="/app/deelnemers/${duplicate.id}/">Terug naar het dubbel</a></p>
        ${renderAlert(error)}
        <p><strong>${name(duplicate)}</strong> (${bookingsOf(duplicate.id)} aanmelding(en), aangemaakt ${formatDateTime(duplicate.created_at)})
          wordt samengevoegd met <strong><a href="/app/deelnemers/${original.id}/">${name(original)}</a></strong>
          (${bookingsOf(original.id)} aanmelding(en)). Aanmeldingen en toestemmingen gaan mee; het dubbel wordt daarna verwijderd.</p>
        <form class="form" method="post" action="/app/deelnemers/${duplicate.id}/samenvoegen/">
          <input type="hidden" name="_csrf" value="${req.session.csrf}">
          <input type="hidden" name="met" value="${original.id}">
          <h2>Gegevens</h2>
          <div class="crm-table-wrap"><table class="crm-table">
            <thead><tr><th scope="col">Veld</th><th scope="col">Blijft (#${original.id})</th><th scope="col">Dubbel (#${duplicate.id})</th></tr></thead>
            <tbody>${PLAIN_FIELDS.map((field) => {
    if (!differs(original[field], duplicate[field])) return html`<tr><th scope="row">${LABELS[field]}</th><td colspan="2">${original[field] || '–'}</td></tr>`;
    // Standaard de ingevulde waarde van wie blijft; is die leeg, dan die van het dubbel.
    const takeDuplicate = !original[field];
    return html`<tr><th scope="row">${LABELS[field]}</th>
      <td><label class="choice"><input type="radio" name="veld_${field}" value="keep"${takeDuplicate ? '' : raw(' checked')}> <span>${original[field] || '–'}</span></label></td>
      <td><label class="choice"><input type="radio" name="veld_${field}" value="remove"${takeDuplicate ? raw(' checked') : ''}> <span>${duplicate[field] || '–'}</span></label></td></tr>`;
  })}</tbody>
          </table></div>
          <h2>Bijzondere gegevens</h2>
          <p>De inhoud staat hier niet; bekijk die zo nodig met <em>Toon</em> op de pagina van elke deelnemer.</p>
          ${Object.keys(BLOCKS).map((block) => {
    const info = BLOCK_INFO[block];
    const state = html`blijft: ${original[block] ? 'ingevuld' : 'leeg'}, dubbel: ${duplicate[block] ? 'ingevuld' : 'leeg'}`;
    if (!roleHasRight(req.user.role, BLOCK_RIGHTS[block])) {
      return html`<fieldset><legend>${info.label}</legend><p>${state}. Zonder recht op deze gegevens worden alleen lege velden aangevuld.</p></fieldset>`;
    }
    return html`<fieldset><legend>${info.label}</legend><p>${state}.</p>
      ${Object.entries(BLOCK_CHOICES).map(([value, label]) => html`<label class="choice"><input type="radio" name="blok_${block}" value="${value}"${value === 'fill' ? raw(' checked') : ''}> <span>${label}</span></label>`)}
    </fieldset>`;
  })}
          <div><button class="btn" type="submit">Samenvoegen</button> <a href="/app/deelnemers/${duplicate.id}/">Annuleren</a></div>
        </form>`,
    });
  };

  router.get(routePath('/deelnemers/:id(\\d{1,9})/samenvoegen/'), ...canEdit, async (req, res, next) => {
    try {
      const pair = await findPair(db, req.params.id);
      if (!pair) return notFound(req, res);
      return res.send(await renderMerge(req, pair));
    } catch (error) {
      return next(error);
    }
  });

  router.post(routePath('/deelnemers/:id(\\d{1,9})/samenvoegen/'), ...canEdit, auth.checkCsrf, async (req, res, next) => {
    try {
      const choices = readChoices(req.body, req.user.role);
      const outcome = await db.transaction(async (client) => {
        const pair = await findPair(client, req.params.id, { lock: true });
        if (!pair) return { status: 'weg' };
        // Het formulier hoort bij dit paar: is de markering intussen veranderd, dan niet blind samenvoegen.
        if (String(pair.original.id) !== String(req.body.met || '')) return { status: 'gewijzigd', pair };
        await persons.mergePersons(client, pair.original, pair.duplicate, choices);
        await auth.audit(req, { userId: req.user.id, action: 'deelnemer.samengevoegd', entity: 'persons', entityId: pair.original.id }, client);
        // Blokken van het dubbel worden op de server geopend, ook voor wie geen recht op dat blok heeft (dan alleen
        // aanvullen): leg per blok met gegevens vast wat ermee gebeurd is.
        for (const block of Object.keys(BLOCKS).filter((name) => pair.duplicate[name])) {
          await auth.audit(req, { userId: req.user.id, action: `deelnemer.samengevoegd.${BLOCK_INFO[block].slug}.${choices.blocks[block]}`, entity: 'persons', entityId: pair.original.id }, client);
        }
        return { status: 'ok', keepId: pair.original.id };
      });
      if (outcome.status === 'weg') return notFound(req, res);
      if (outcome.status === 'gewijzigd') return res.status(409).send(await renderMerge(req, outcome.pair, 'De markering is intussen gewijzigd. Controleer de keuzes en voeg opnieuw samen.'));
      return res.redirect(303, `/app/deelnemers/${outcome.keepId}/?opgeslagen=samengevoegd`);
    } catch (error) {
      return next(error);
    }
  });

  router.post(routePath('/deelnemers/:id(\\d{1,9})/niet-dubbel/'), ...canEdit, auth.checkCsrf, async (req, res, next) => {
    try {
      const rows = await db.transaction(async (client) => {
        const updated = await client.query('UPDATE persons SET duplicate_of = NULL, updated_at = now() WHERE id = $1 AND duplicate_of IS NOT NULL RETURNING id', [Number(req.params.id)]);
        if (updated.length) await auth.audit(req, { userId: req.user.id, action: 'deelnemer.geen-dubbel', entity: 'persons', entityId: req.params.id }, client);
        return updated;
      });
      if (!rows.length) return notFound(req, res);
      return res.redirect(303, `/app/deelnemers/${req.params.id}/?opgeslagen=1`);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createPersonMergeRoutes, readChoices, MERGE_ACTION_LABELS };
