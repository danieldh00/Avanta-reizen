/**
 * De blokeditor van het CRM, gedeeld door pagina's (`page-routes.js`) en blogberichten (`post-routes.js`, CMS-pakket I):
 * de velden van een blok, de sectie *Blokken* op het bewerkscherm, het scherm om een foto uit de bibliotheek te kiezen
 * en de routes om blokken toe te voegen, te wijzigen, te verplaatsen, te kopiëren en te verwijderen en om een foto of
 * kopfoto te kiezen. Werkt zonder JavaScript: elke actie is een eigen formulier met CSRF-token en de versie van het
 * concept. Wat per soort verschilt (opslag, bewerkscherm, meldingen) geeft de aanroeper mee.
 */
const { routePath } = require('../route-path');
const { html, raw } = require('../site/html');
const { renderCrmPage, renderAlert } = require('../crm/layout');
const { lockMediaForUse } = require('../media/library');
const { pickerFilter, pickerPhotos, renderPhotoPicker } = require('../media/picker');
const {
  BLOCK_TYPES, STYLE_OPTIONS, MAX_BLOCKS, MAX_GALLERY_IMAGES, newBlock, newBlockId, validateBlockForm, blockSummary, isDefaultStyle,
} = require('./blocks');

/**
 * Een veld met label, hulptekst en fout.
 * @param {{id: string, label: string, control: object, help?: string, error?: string}} field Veld.
 * @returns {object} HTML.
 */
function fieldRow(field) {
  return html`<div class="field"><span class="field__label"><label for="${field.id}">${field.label}</label></span>
    ${field.control}${field.error ? html`<span class="field__error" id="${field.id}-fout">${field.error}</span>` : ''}
    ${field.help ? html`<span class="field__help">${field.help}</span>` : ''}</div>`;
}

/**
 * Attributen voor een veld met een fout.
 * @param {string} id Id van het veld.
 * @param {string} [error] Fout.
 * @returns {object} HTML-attributen.
 */
function invalidAttributes(id, error) {
  return error ? html` aria-invalid="true" aria-describedby="${id}-fout"` : '';
}

/**
 * Het invoerelement van één blokveld.
 * @param {object} field Velddefinitie uit `BLOCK_TYPES`.
 * @param {{name: string, id: string, value: *, error?: string}} control Naam in het formulier, id, huidige waarde en
 *   eventuele foutmelding.
 * @param {object} [options] Keuzes voor velden met een bron (`source`): `{types, countries, faq}` als `[waarde, naam][]`.
 * @returns {object} HTML.
 */
function fieldControl(field, { name, id, value, error }, options = {}) {
  const invalid = invalidAttributes(id, error);
  if (field.kind === 'source') {
    const choices = options[field.source] || [];
    const known = !value || choices.some(([key]) => key === value);
    return html`<select id="${id}" name="${name}"${invalid}><option value="">${field.empty}</option>${choices.map(([key, label]) => html`<option value="${key}"${value === key ? raw(' selected') : ''}>${label}</option>`)}${known ? '' : html`<option value="${value}" selected>${value} (bestaat niet meer)</option>`}</select>`;
  }
  if (field.kind === 'select') {
    return html`<select id="${id}" name="${name}"${invalid}>${Object.entries(field.choices).map(([key, label]) => html`<option value="${key}"${value === key ? raw(' selected') : ''}>${label}</option>`)}</select>`;
  }
  if (field.kind === 'richtext') {
    return html`<textarea id="${id}" name="${name}" rows="14" class="cms-richtext"${invalid}>${value}</textarea>`;
  }
  if (field.kind === 'textarea') {
    return html`<textarea id="${id}" name="${name}" rows="4" maxlength="${field.max}"${field.required ? raw(' required') : ''}${invalid}>${value}</textarea>`;
  }
  return html`<input id="${id}" name="${name}" type="text" value="${value}" maxlength="${field.max}"${field.required ? raw(' required') : ''}${invalid}>`;
}

/** Uitleg bij opgemaakte tekst. */
const RICHTEXT_HELP = 'Typ de tekst zoals hij op de site komt: Enter begint een nieuwe alinea, Shift+Enter een nieuwe regel. Kopjes, vet, cursief, lijsten en links maak je met de knoppen boven het vak; met HTML zie en wijzig je de code. Andere opmaak, scripts en stijlen verdwijnen bij het opslaan.';

/** Uitleg per soort veld. */
const FIELD_HELP = {
  richtext: RICHTEXT_HELP,
  link: 'Een adres op deze site (bijv. /contact/), https://…, mailto: of tel:.',
  youtube: 'Plak het adres van de video, bijv. https://www.youtube.com/watch?v=… of https://youtu.be/…',
};

/**
 * De velden en stijlopties van een blok in het formulier.
 * @param {object} block Blok.
 * @param {object} errors Fouten per veldnaam.
 * @param {string} photoUrl Adres van het fotoscherm van dit blok.
 * @param {object} options Keuzes voor velden met een bron (zie `fieldControl`).
 * @returns {object} HTML.
 */
function blockFields(block, errors, photoUrl, options) {
  const definition = BLOCK_TYPES[block.type];
  const prefix = `blok-${block.id}`;
  const rows = definition.fields.map((field) => {
    if (field.kind === 'image') {
      const photo = block.data[field.name];
      return html`<div class="field"><span class="field__label">${field.label}</span>
        ${photo ? html`<img class="media-preview media-preview--small" src="${photo.url}" alt="${photo.alt}" width="400" height="300">` : html`<p>Nog geen foto gekozen.</p>`}
        <a class="btn btn--small btn--outline" href="${photoUrl}">${photo ? 'Andere foto kiezen' : 'Foto kiezen'}</a></div>`;
    }
    if (field.kind === 'images') {
      const photos = block.data[field.name] || [];
      return html`<fieldset class="cms-repeat"><legend>${field.label} (${String(photos.length)} van ${String(field.max)})</legend>
        ${photos.length ? html`<ul class="cms-photo-list">${photos.map((photo, index) => html`<li class="cms-photo-list__item">
          <img src="${photo.url}" alt="${photo.alt}" width="120" height="90" loading="lazy">
          <label>Volgorde <input type="number" name="f_${field.name}_${index}_volgorde" value="${index + 1}" min="1" max="${field.max}" step="1"></label>
          <label><input type="checkbox" name="f_${field.name}_weg" value="${index}"> Weghalen</label>
        </li>`)}</ul>` : html`<p>Nog geen foto's.</p>`}
        ${photos.length < field.max ? html`<p><a class="btn btn--small btn--outline" href="${photoUrl}">Foto's toevoegen</a></p>` : ''}
        <span class="field__help">Wijzig de volgorde met de nummers en sla het blok op.</span>
      </fieldset>`;
    }
    if (field.kind === 'repeat') {
      const values = block.data[field.name] || [];
      return html`${Array.from({ length: field.count }, (_, index) => html`<fieldset class="cms-repeat"><legend>${field.label} ${index + 1}</legend>
        ${field.fields.map((sub) => {
          const name = `f_${field.name}_${index}_${sub.name}`;
          const value = values[index] ? values[index][sub.name] : (sub.kind === 'select' ? Object.keys(sub.choices)[0] : '');
          return fieldRow({ id: `${prefix}-${name}`, label: sub.label, error: errors[name], control: fieldControl(sub, { name, id: `${prefix}-${name}`, value, error: errors[name] }) });
        })}
      </fieldset>`)}`;
    }
    const name = `f_${field.name}`;
    return fieldRow({
      id: `${prefix}-${name}`,
      label: field.label,
      error: errors[name],
      help: FIELD_HELP[field.kind] || '',
      control: fieldControl(field, { name, id: `${prefix}-${name}`, value: block.data[field.name], error: errors[name] }, options),
    });
  });
  const styleRows = Object.entries(STYLE_OPTIONS).map(([name, option]) => fieldRow({
    id: `${prefix}-s_${name}`,
    label: option.label,
    control: html`<select id="${prefix}-s_${name}" name="s_${name}">${Object.entries(option.choices).map(([key, label]) => html`<option value="${key}"${block.style[name] === key ? raw(' selected') : ''}>${label}</option>`)}</select>`,
  }));
  return html`${rows}
    <details class="cms-style"${isDefaultStyle(block.style) ? '' : raw(' open')}><summary>Opmaak (huisstijl)</summary><div class="cms-style__grid">${styleRows}</div></details>`;
}

/**
 * Het fotoveld van een blok: het eerste veld van de soort `image` (één foto) of `images` (galerij).
 * @param {(object|undefined)} block Blok.
 * @returns {(object|null)} Velddefinitie, of null als het blok geen foto's heeft.
 */
function photoFieldOf(block) {
  return block ? BLOCK_TYPES[block.type].fields.find((field) => field.kind === 'image' || field.kind === 'images') || null : null;
}

/**
 * Leest de gekozen foto uit het formulier van de kiezer.
 * @param {object} body Ingezonden velden.
 * @returns {{none: boolean, mediaId: (string|null), valid: boolean}} Keuze.
 */
function chosenPhoto(body) {
  const none = body.geen === '1';
  const mediaId = none ? null : body.media_id;
  return { none, mediaId, valid: none || (typeof mediaId === 'string' && /^\d{1,9}$/.test(mediaId)) };
}

/**
 * Maakt de blokeditor voor één soort inhoud (pagina's of blogberichten).
 * @param {object} config Instellingen:
 *   - `base`: basispad van het scherm (bijv. `/app/paginas/`);
 *   - `route`: hetzelfde pad binnen de CRM-router (bijv. `/paginas/`);
 *   - `guard`: middleware die het recht controleert; `auth`: sessie- en rechtenlaag (`checkCsrf`);
 *   - `library`: de fotobibliotheek;
 *   - `store`: opslag met `changeDraft(id, version, change, context)`;
 *   - `editableState(item)`: de stand die je bewerkt (met `title`, `imageUrl`, `blocks`);
 *   - `imageFromMedia(media)`: een foto uit de bibliotheek als waarde van een blok of kopfoto;
 *   - `load(req, res)`: haalt het item uit de URL op of stuurt een 404 (geeft dan null);
 *   - `notFound(req, res)`: stuurt een 404;
 *   - `contextFor(req)`: gebruiker en audit voor een wijziging van het concept;
 *   - `finish(req, res, outcome, next)`: verwerkt de uitkomst (zie `page-routes.js`);
 *   - `renderEditor(req, item, state)`: het bewerkscherm (voor een blok met fouten);
 *   - `allowType(type, item)`: of een soort blok bij dit item mag (geeft een foutmelding of leeg);
 *   - `coverLabel`: naam van de kopfoto op het fotoscherm (bijv. "Kopfoto").
 * @returns {{renderBlocksSection: Function, addRoutes: Function}} De sectie *Blokken* en de routes.
 */
function createBlockEditor(config) {
  const { base, route, guard, auth, library, store, editableState } = config;
  const coverLabel = config.coverLabel || 'Kopfoto';

  /**
   * De sectie *Blokken* op het bewerkscherm: elk blok met zijn velden en acties, en het formulier om een blok toe te
   * voegen.
   * @param {{item: object, hidden: object, options: object, state: object, openBlock: string, typeOptions: object, homeTypes?: boolean}} section
   *   Het item (met `id`), de verborgen velden van elk formulier, de keuzes voor velden met een bron, de stand van het
   *   bewerkscherm (`blockErrors`), het blok dat open staat, de keuzes voor de soort blok en of de homepage-secties
   *   meedoen (uitleg).
   * @returns {object} HTML.
   */
  const renderBlocksSection = (section) => {
    const { item, hidden, options, state, openBlock, typeOptions } = section;
    const { blocks } = editableState(item);
    const itemUrl = `${base}${item.id}/`;
    const positionOptions = html`<option value="">Aan het eind</option><option value="begin">Bovenaan</option>${blocks.map((block, index) => html`<option value="${block.id}">Na blok ${index + 1} (${BLOCK_TYPES[block.type].label})</option>`)}`;
    return html`<section id="blokken">
      <h2>Blokken</h2>
      ${blocks.length ? '' : html`<p>Nog geen blokken. Voeg hieronder het eerste blok toe.</p>`}
      ${blocks.map((stored, index) => {
        const failed = state.blockErrors && state.blockErrors.id === stored.id;
        const block = failed ? state.blockErrors.block : stored;
        const blockUrl = `${itemUrl}blokken/${block.id}/`;
        return html`<details class="crm-block cms-block-edit" id="blok-${block.id}"${openBlock === block.id || blocks.length === 1 ? raw(' open') : ''}>
          <summary><strong>${String(index + 1)}. ${BLOCK_TYPES[block.type].label}</strong> <span class="cms-block-edit__summary">${blockSummary(stored)}</span></summary>
          <form class="form" method="post" action="${blockUrl}">
            ${hidden}
            ${blockFields(block, failed ? state.blockErrors.errors : {}, `${blockUrl}foto/`, options)}
            <div><button class="btn btn--small" type="submit">Blok opslaan in concept</button></div>
          </form>
          <form class="crm-actions cms-block-edit__actions" method="post" action="${blockUrl}actie/">
            ${hidden}
            ${index > 0 ? html`<button class="btn btn--small btn--outline" type="submit" name="actie" value="omhoog">Omhoog</button>` : ''}
            ${index < blocks.length - 1 ? html`<button class="btn btn--small btn--outline" type="submit" name="actie" value="omlaag">Omlaag</button>` : ''}
            ${blocks.length < MAX_BLOCKS ? html`<button class="btn btn--small btn--outline" type="submit" name="actie" value="kopieren">Kopiëren</button>` : ''}
            <button class="btn btn--small btn--outline" type="submit" name="actie" value="verwijderen">Verwijderen</button>
          </form>
        </details>`;
      })}
      ${blocks.length < MAX_BLOCKS ? html`<form class="crm-block form cms-add-block" method="post" action="${itemUrl}blokken/nieuw/">
        ${hidden}
        <h3>Blok toevoegen</h3>
        <div class="cms-add-block__fields">
          ${fieldRow({ id: 'nieuw-type', label: 'Soort blok', control: html`<select id="nieuw-type" name="type">${typeOptions}</select>` })}
          ${fieldRow({ id: 'nieuw-na', label: 'Plaats', control: html`<select id="nieuw-na" name="na">${positionOptions}</select>` })}
        </div>
        <ul class="cms-type-help">${Object.values(BLOCK_TYPES).filter((definition) => !definition.homeOnly || section.homeTypes).map((definition) => html`<li><strong>${definition.label}</strong>: ${definition.help}</li>`)}</ul>
        <div><button class="btn btn--small" type="submit">Toevoegen</button></div>
      </form>` : html`<p class="field__help">Het maximum is ${MAX_BLOCKS} blokken.</p>`}
    </section>`;
  };

  /**
   * Het scherm om een foto te kiezen (voor een afbeeldingsblok of de kopfoto).
   * @param {object} req Express-verzoek.
   * @param {object} item Pagina of bericht.
   * @param {{title: string, pageUrl: string, current: (object|null), allowNone: boolean, multiple?: boolean, error?: string}} screen
   *   Titel, adres van het scherm, huidige foto, of "geen foto" mag en of je er meer tegelijk kiest (galerij).
   * @returns {Promise<string>} HTML.
   */
  const renderPhotoScreen = async (req, item, screen) => {
    const countries = await library.countries();
    const filter = pickerFilter(req.query, countries, null);
    const { photos, hasMore } = await pickerPhotos(library, filter);
    return renderCrmPage({
      title: screen.title,
      user: req.user,
      csrf: req.session.csrf,
      path: base,
      body: html`<p><a href="${base}${item.id}/">Terug naar ${editableState(item).title}</a></p>
        ${renderAlert(screen.error)}
        ${screen.current ? html`<p>Nu gekozen:</p><img class="media-preview media-preview--small" src="${screen.current.url}" alt="${screen.current.alt || ''}" width="400" height="300">` : ''}
        <section class="crm-block" id="foto">
          ${renderPhotoPicker({
            pageUrl: screen.pageUrl, action: screen.pageUrl, csrf: req.session.csrf, countries, filter, photos, hasMore, allowNone: screen.allowNone, multiple: Boolean(screen.multiple), button: screen.multiple ? 'Deze foto\'s toevoegen' : 'Deze foto gebruiken',
            extraFields: html`<input type="hidden" name="versie" value="${item.draft_version}">`,
          })}
        </section>`,
    });
  };

  /**
   * Registreert de routes van de blokeditor op de router.
   * @param {object} router Express-router.
   * @returns {void}
   */
  const addRoutes = (router) => {
    const itemRoute = `${route}:id(\\d{1,9})/`;
    const blockRoute = `${itemRoute}blokken/:blockId(b[0-9a-f]{12})/`;

    router.post(routePath(`${itemRoute}blokken/nieuw/`), guard, auth.checkCsrf, async (req, res, next) => {
      try {
        const block = newBlock(typeof req.body.type === 'string' ? req.body.type : '');
        if (block && config.allowType) {
          const item = await config.load(req, res);
          if (!item) return undefined;
          const refusal = config.allowType(block.type, item);
          if (refusal) return await config.finish(req, res, { status: 'fout', message: refusal }, { notice: 1 });
        }
        let addedId = '';
        const outcome = block ? await store.changeDraft(req.params.id, req.body.versie, async (state) => {
          const after = typeof req.body.na === 'string' ? req.body.na : '';
          let index = state.blocks.length;
          if (after === 'begin') index = 0;
          else if (after) {
            const position = state.blocks.findIndex((item) => item.id === after);
            if (position < 0) return { status: 'blok-weg' };
            index = position + 1;
          }
          state.blocks.splice(index, 0, block);
          addedId = block.id;
          return undefined;
        }, config.contextFor(req)) : { status: 'fout', message: 'Kies een soort blok.' };
        return await config.finish(req, res, outcome, { notice: 5, block: addedId, anchor: `blok-${addedId}` });
      } catch (error) {
        return next(error);
      }
    });

    router.post(routePath(blockRoute), guard, auth.checkCsrf, async (req, res, next) => {
      try {
        let failed = null;
        const outcome = await store.changeDraft(req.params.id, req.body.versie, async (state) => {
          const index = state.blocks.findIndex((item) => item.id === req.params.blockId);
          if (index < 0) return { status: 'blok-weg' };
          const { block, errors } = validateBlockForm(state.blocks[index], req.body);
          if (Object.keys(errors).length) {
            failed = { id: block.id, block, errors };
            return { errors };
          }
          state.blocks[index] = block;
          return undefined;
        }, config.contextFor(req));
        return await config.finish(req, res, outcome, {
          notice: 1,
          block: req.params.blockId,
          anchor: `blok-${req.params.blockId}`,
          onError: (item) => config.renderEditor(req, item, { error: 'Controleer de velden van het blok.', blockErrors: failed }),
        });
      } catch (error) {
        return next(error);
      }
    });

    router.post(routePath(`${blockRoute}actie/`), guard, auth.checkCsrf, async (req, res, next) => {
      try {
        const action = typeof req.body.actie === 'string' ? req.body.actie : '';
        if (!['omhoog', 'omlaag', 'kopieren', 'verwijderen'].includes(action)) {
          return await config.finish(req, res, { status: 'fout', message: 'Onbekende actie.' }, { notice: 1 });
        }
        let focus = req.params.blockId;
        const outcome = await store.changeDraft(req.params.id, req.body.versie, async (state) => {
          const index = state.blocks.findIndex((item) => item.id === req.params.blockId);
          if (index < 0) return { status: 'blok-weg' };
          const [block] = state.blocks.splice(index, 1);
          if (action === 'omhoog') state.blocks.splice(Math.max(0, index - 1), 0, block);
          if (action === 'omlaag') state.blocks.splice(Math.min(state.blocks.length, index + 1), 0, block);
          if (action === 'kopieren') {
            const copy = { ...structuredClone(block), id: newBlockId() };
            state.blocks.splice(index, 0, block, copy);
            focus = copy.id;
          }
          return undefined;
        }, config.contextFor(req));
        if (action === 'verwijderen') return await config.finish(req, res, outcome, { notice: 6, anchor: 'blokken' });
        return await config.finish(req, res, outcome, { notice: action === 'kopieren' ? 5 : 1, block: focus, anchor: `blok-${focus}` });
      } catch (error) {
        return next(error);
      }
    });

    router.get(routePath(`${itemRoute}kopfoto/`), guard, async (req, res, next) => {
      try {
        const item = await config.load(req, res);
        if (!item) return undefined;
        const current = editableState(item);
        return res.send(await renderPhotoScreen(req, item, {
          title: `${coverLabel} kiezen`, pageUrl: `${base}${item.id}/kopfoto/`, current: current.imageUrl ? { url: current.imageUrl } : null, allowNone: Boolean(current.imageUrl),
        }));
      } catch (error) {
        return next(error);
      }
    });

    router.post(routePath(`${itemRoute}kopfoto/`), guard, auth.checkCsrf, async (req, res, next) => {
      try {
        const choice = chosenPhoto(req.body);
        const outcome = choice.valid ? await store.changeDraft(req.params.id, req.body.versie, async (state, client) => {
          if (choice.none) {
            state.imageUrl = null;
            state.imageMediaId = null;
            return undefined;
          }
          const media = await lockMediaForUse(client, choice.mediaId);
          if (!media) return { status: 'foto-weg' };
          const image = config.imageFromMedia(media);
          state.imageUrl = image.url;
          state.imageMediaId = media.id;
          return undefined;
        }, config.contextFor(req)) : { status: 'fout', message: 'Kies een foto.' };
        return await config.finish(req, res, outcome, { notice: 1, anchor: 'kopfoto' });
      } catch (error) {
        return next(error);
      }
    });

    router.get(routePath(`${blockRoute}foto/`), guard, async (req, res, next) => {
      try {
        const item = await config.load(req, res);
        if (!item) return undefined;
        const block = editableState(item).blocks.find((entry) => entry.id === req.params.blockId);
        const field = photoFieldOf(block);
        if (!field) return config.notFound(req, res);
        const multiple = field.kind === 'images';
        return res.send(await renderPhotoScreen(req, item, {
          title: multiple ? 'Foto\'s toevoegen aan de galerij' : 'Foto voor het blok kiezen',
          pageUrl: `${base}${item.id}/blokken/${block.id}/foto/`,
          current: multiple ? null : block.data[field.name],
          allowNone: !multiple && Boolean(block.data[field.name]),
          multiple,
        }));
      } catch (error) {
        return next(error);
      }
    });

    router.post(routePath(`${blockRoute}foto/`), guard, auth.checkCsrf, async (req, res, next) => {
      try {
        const none = req.body.geen === '1';
        const ids = none ? [] : [].concat(req.body.media_id || []);
        const valid = none || (ids.length > 0 && ids.length <= MAX_GALLERY_IMAGES && ids.every((id) => typeof id === 'string' && /^\d{1,9}$/.test(id)));
        const outcome = valid ? await store.changeDraft(req.params.id, req.body.versie, async (state, client) => {
          const block = state.blocks.find((entry) => entry.id === req.params.blockId);
          const field = photoFieldOf(block);
          if (!field) return { status: 'blok-weg' };
          if (field.kind === 'image') {
            if (none) {
              block.data[field.name] = null;
              return undefined;
            }
            if (ids.length !== 1) return { status: 'fout', message: 'Kies één foto.' };
            const media = await lockMediaForUse(client, ids[0]);
            if (!media) return { status: 'foto-weg' };
            block.data[field.name] = config.imageFromMedia(media);
            return undefined;
          }
          if (none) return { status: 'fout', message: 'Kies een of meer foto\'s.' };
          const images = block.data[field.name];
          for (const id of [...new Set(ids)]) {
            const media = await lockMediaForUse(client, id);
            if (!media) return { status: 'foto-weg' };
            if (!images.some((image) => image.mediaId === media.id)) images.push(config.imageFromMedia(media));
          }
          if (images.length > field.max) return { status: 'fout', message: `Een galerij heeft hoogstens ${field.max} foto's.` };
          return undefined;
        }, config.contextFor(req)) : { status: 'fout', message: 'Kies een foto.' };
        return await config.finish(req, res, outcome, { notice: 1, block: req.params.blockId, anchor: `blok-${req.params.blockId}` });
      } catch (error) {
        return next(error);
      }
    });
  };

  return { renderBlocksSection, addRoutes };
}

module.exports = { createBlockEditor, fieldRow, invalidAttributes, fieldControl, blockFields, photoFieldOf, chosenPhoto, RICHTEXT_HELP, FIELD_HELP };
