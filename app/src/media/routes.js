// @ts-check
/**
 * Fotobibliotheek in het CRM (`/app/fotobibliotheek/`, recht `media`): foto's per land bekijken en zoeken, meerdere
 * foto's tegelijk uploaden (multipart via `busboy`, met vaste grenzen) en per foto titel, alt-tekst, bijschrift,
 * fotograaf en landen wijzigen, zien waar een foto gebruikt wordt en een ongebruikte upload verwijderen. Bovenaan staan
 * de landen als mappen met het aantal foto's. Uploads worden op inhoud gecontroleerd en zonder metadata als WebP opgeslagen
 * (`media/images.js`). Elke upload en wijziging komt in de auditlog.
 */
const express = require('express');
const { routePath } = require('../route-path');
const Busboy = require('busboy');
const { html, raw } = require('../site/html');
const { searchPatterns } = require('../persons/person-routes');
const { renderCrmPage, renderAlert, formatDateTime } = require('../crm/layout');
const { createRateLimiter } = require('../security/rate-limit');
const { createMediaLibrary, linkImportedMedia, mediaUrl, TEXT_LIMITS } = require('./library');
const { ImageError, MAX_UPLOAD_BYTES } = require('./images');

/** Basispad van de bibliotheek. */
const BASE = '/app/fotobibliotheek/';

/** Aantal foto's per pagina. */
const PAGE_SIZE = 48;

/** Maximaal aantal bestanden per upload. */
const MAX_FILES = 10;

/** Maximaal aantal geüploade foto's per gebruiker per uur. */
const UPLOADS_PER_HOUR = 200;

/** Maximaal aantal uploads dat tegelijk verwerkt wordt (geheugen en processor). */
const MAX_PARALLEL_UPLOADS = 2;

/** Acties voor het auditlog (zie `ACTION_LABELS` in `crm/users.js`). */
const MEDIA_ACTION_LABELS = {
  'media.geupload': 'Foto geüpload naar de fotobibliotheek',
  'media.gewijzigd': 'Foto in de fotobibliotheek gewijzigd',
  'media.verwijderd': 'Foto uit de fotobibliotheek verwijderd',
  'media.gekoppeld': 'Foto\'s uit de import automatisch aan landen gekoppeld',
};

/**
 * Leest een multipart-formulier met foto's binnen vaste grenzen. Velden komen in `fields` (herhaalde velden als lijst),
 * bestanden als buffer. Een te groot bestand krijgt `truncated: true` en geen inhoud. Het veld `_csrf` moet vóór de
 * bestanden komen (zo staat het in het formulier) en wordt meteen gecontroleerd: klopt het niet, of komt er eerder een
 * bestand, dan stopt het lezen direct met status 403, zonder de rest van de upload te bufferen.
 * @param {any} req Express-verzoek.
 * @param {(token: string) => boolean} tokenValid Controleert het CSRF-token (en de herkomst).
 * @returns {Promise<{fields: any, files: {filename: string, buffer: (Buffer|null), truncated: boolean}[], tooMany: boolean}>} Inhoud.
 */
function readMultipart(req, tokenValid) {
  return new Promise((resolve, reject) => {
    let busboy;
    try {
      busboy = Busboy({ headers: req.headers, limits: { files: MAX_FILES, fileSize: MAX_UPLOAD_BYTES, fields: 10, fieldSize: 1024, parts: MAX_FILES + 10 } });
    } catch (error) {
      reject(Object.assign(error, { status: 400 }));
      return;
    }
    const fields = {};
    const files = [];
    let tooMany = false;
    let tokenOk = false;
    let stopped = false;
    const refuse = () => {
      if (stopped) return;
      stopped = true;
      req.unpipe(busboy);
      busboy.removeAllListeners('close');
      reject(Object.assign(new Error('CSRF-token ontbreekt of klopt niet'), { status: 403 }));
    };
    busboy.on('field', (name, value) => {
      if (name === '_csrf' && !tokenOk) {
        if (!tokenValid(value)) return refuse();
        tokenOk = true;
      }
      if (Object.hasOwn(fields, name)) fields[name] = [].concat(fields[name], value);
      else fields[name] = value;
      return undefined;
    });
    busboy.on('file', (name, stream, info) => {
      if (!tokenOk) {
        stream.resume();
        refuse();
        return;
      }
      if (name !== 'foto') {
        stream.resume();
        return;
      }
      const chunks = [];
      const entry = { filename: String(info.filename || ''), buffer: null, truncated: false };
      files.push(entry);
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('limit', () => { entry.truncated = true; });
      stream.on('end', () => { entry.buffer = entry.truncated ? null : Buffer.concat(chunks); });
    });
    busboy.on('filesLimit', () => { tooMany = true; });
    busboy.on('partsLimit', () => { tooMany = true; });
    busboy.on('error', (error) => reject(Object.assign(error, { status: 400 })));
    // Een afgebroken upload mag de teller van lopende uploads niet laten hangen.
    req.on('close', () => { if (!req.complete) reject(Object.assign(new Error('upload afgebroken'), { status: 400 })); });
    busboy.on('close', () => (tokenOk ? resolve : refuse)({ fields, files: files.filter((file) => file.filename || file.buffer?.length || file.truncated), tooMany }));
    req.pipe(busboy);
  });
}

/**
 * De melding na een upload waarvan een deel niet lukte.
 * @param {number} stored Aantal opgeslagen foto's.
 * @param {string[]} problems Meldingen per bestand.
 * @returns {string} Melding.
 */
function partialUploadMessage(stored, problems) {
  const prefix = stored ? `${stored} ${stored === 1 ? 'foto' : 'foto\'s'} geüpload. Niet gelukt: ` : 'Niet gelukt: ';
  return prefix + problems.join(' ');
}

/**
 * Het adres van de reis om na de upload naar terug te gaan: alleen een vast pad binnen het CRM (geen open redirect).
 * @param {*} value Veld `terug` uit het formulier.
 * @returns {string} Pad van de reis, of leeg.
 */
function tripReturnPath(value) {
  return typeof value === 'string' && /^\/app\/reizen\/\d{1,9}\/$/.test(value) ? value : '';
}

/**
 * Maakt de routes van de fotobibliotheek.
 * @param {{db: any, auth: any, library?: any, mediaDir?: string, now?: () => number,
 *   limits?: {uploadsPerHour?: number, maxParallelUploads?: number, linksPerMinute?: number}}} options
 *   Database, sessie- en rechtenlaag, de fotobibliotheek (of de map met bestanden om er een te maken) en (voor tests)
 *   de klok en andere grenzen.
 * @returns {express.Router} Router.
 */
function createMediaRoutes(options) {
  const { db, auth } = options;
  const library = options.library || createMediaLibrary({ db, mediaDir: options.mediaDir });
  const router = express.Router();
  const guard = auth.requireRight('media');
  const uploadsPerHour = options.limits?.uploadsPerHour ?? UPLOADS_PER_HOUR;
  const maxParallelUploads = options.limits?.maxParallelUploads ?? MAX_PARALLEL_UPLOADS;
  const uploadLimiter = createRateLimiter({ limit: uploadsPerHour, windowMs: 60 * 60 * 1000, now: options.now });
  // Automatisch koppelen vergelijkt alle open foto's met alle reizen: hoogstens een paar keer per minuut per gebruiker.
  const linkLimiter = createRateLimiter({ limit: options.limits?.linksPerMinute ?? 3, windowMs: 60 * 1000, now: options.now });
  let runningUploads = 0;

  /**
   * 404-pagina binnen het CRM.
   * @param {any} req Express-verzoek.
   * @param {any} res Express-antwoord.
   * @returns {void}
   */
  const notFound = (req, res) => res.status(404).send(renderCrmPage({
    title: 'Niet gevonden', user: req.user, csrf: req.session.csrf, path: BASE, body: html`<p>Deze foto bestaat niet. <a href="${BASE}">Naar de fotobibliotheek</a></p>`,
  }));

  /**
   * De keuzelijst met landen (meerdere kiezen).
   * @param {{id: number, name: string}[]} countries Alle landen.
   * @param {number[]} selected Gekozen id's.
   * @param {string} id Id van het veld.
   * @returns {any} HTML.
   */
  const countrySelect = (countries, selected, id) => html`<select id="${id}" name="land" multiple size="8">${countries.map((country) => html`<option value="${country.id}"${selected.includes(country.id) ? raw(' selected') : ''}>${country.name}</option>`)}</select>`;

  /**
   * De overzichtspagina: uploadformulier, filter en raster met foto's.
   * @param {any} req Express-verzoek.
   * @param {{error?: string, notice?: string, status?: number}} [state] Melding na een upload.
   * @returns {Promise<string>} HTML.
   */
  const renderList = async (req, state = {}) => {
    const { countries, without } = await library.folders();
    const landParam = String(req.query.land || '');
    const withoutCountry = landParam === 'zonder';
    const countryId = /^\d{1,9}$/.test(landParam) && countries.some((country) => country.id === Number(landParam)) ? Number(landParam) : null;
    const { text, patterns } = searchPatterns(req.query.q);
    const page = Math.min(Math.max(Number.parseInt(req.query.pagina, 10) || 1, 1), 10000);
    const rows = await library.list({ countryId, withoutCountry, patterns, limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE });
    const items = rows.slice(0, PAGE_SIZE);
    const query = (extra) => new URLSearchParams({ ...(text ? { q: text } : {}), ...(withoutCountry ? { land: 'zonder' } : countryId ? { land: String(countryId) } : {}), ...extra }).toString();
    return renderCrmPage({
      title: 'Fotobibliotheek',
      user: req.user,
      csrf: req.session.csrf,
      path: BASE,
      body: html`${state.notice ? html`<p class="notice" role="status">${state.notice}</p>` : ''}
        ${renderAlert(state.error)}
        <details class="crm-block media-upload"${state.error ? raw(' open') : ''}>
          <summary><strong>Foto's uploaden</strong></summary>
          <form class="form" method="post" action="${BASE}uploaden/" enctype="multipart/form-data">
            <input type="hidden" name="_csrf" value="${req.session.csrf}">
            <div class="field"><span class="field__label"><label for="veld-upload-land">Land (optioneel, meerdere met Ctrl of Cmd)</label></span>
              ${countrySelect(countries, countryId ? [countryId] : [], 'veld-upload-land')}</div>
            <div class="field"><span class="field__label"><label for="veld-foto">Foto's (JPEG, PNG of WebP, maximaal ${MAX_FILES} per keer en ${MAX_UPLOAD_BYTES / 1024 / 1024} MB per foto)</label></span>
              <input id="veld-foto" name="foto" type="file" accept="image/jpeg,image/png,image/webp" multiple required></div>
            <p class="field__help">Locatie- en cameragegevens (EXIF) worden verwijderd; de foto wordt verkleind en als WebP opgeslagen.</p>
            <div><button class="btn" type="submit">Uploaden</button></div>
          </form>
        </details>
        <nav class="media-folders" aria-label="Landen">
          <ul>
            <li><a href="${BASE}"${!countryId && !withoutCountry ? raw(' aria-current="page"') : ''}>Alle foto's</a></li>
            <li><a href="${BASE}?land=zonder"${withoutCountry ? raw(' aria-current="page"') : ''}>Zonder land <span class="media-folders__count">${without}</span></a></li>
            ${countries.filter((country) => country.count || country.id === countryId).map((country) => html`<li><a href="${BASE}?land=${country.id}"${country.id === countryId ? raw(' aria-current="page"') : ''}>${country.name} <span class="media-folders__count">${country.count}</span></a></li>`)}
          </ul>
        </nav>
        ${withoutCountry ? html`<form class="media-autolink" method="post" action="${BASE}koppelen/">
          <input type="hidden" name="_csrf" value="${req.session.csrf}">
          <p>Foto's uit de import zonder land kunnen automatisch de landen krijgen van de reizen en landpagina's waarin ze staan. Foto's die al een land hebben blijven zoals ze zijn.</p>
          <button class="btn btn--small" type="submit">Automatisch koppelen via de reizen</button>
        </form>` : ''}
        <form class="crm-search" method="get" action="${BASE}" role="search">
          <label for="veld-q">Zoek op titel, alt-tekst, bijschrift of fotograaf</label>
          <input id="veld-q" name="q" type="search" value="${text}" maxlength="100">
          <label for="veld-land" class="visually-hidden">Land</label>
          <select id="veld-land" name="land"><option value="">Alle landen</option><option value="zonder"${withoutCountry ? raw(' selected') : ''}>Zonder land</option>${countries.map((country) => html`<option value="${country.id}"${country.id === countryId ? raw(' selected') : ''}>${country.name}</option>`)}</select>
          <button class="btn btn--small" type="submit">Zoeken</button>
        </form>
        ${items.length ? html`<ul class="media-grid">${items.map((item) => html`<li class="media-grid__item">
            <a href="${BASE}${item.id}/"><img src="${mediaUrl(item, 400)}" alt="${item.alt_text}" loading="lazy" width="${item.width || 400}" height="${item.height || 300}"></a>
            <span class="media-grid__title"><a href="${BASE}${item.id}/">${item.title || item.local_name}</a></span>
            <span class="media-grid__meta">${item.countries.length ? item.countries.join(', ') : 'Geen land'}</span>
          </li>`)}</ul>` : html`<p>Geen foto's gevonden.</p>`}
        <p>${page > 1 ? html`<a href="${BASE}?${query({ pagina: String(page - 1) })}">Vorige</a> ` : ''}${rows.length > PAGE_SIZE ? html`<a href="${BASE}?${query({ pagina: String(page + 1) })}">Volgende</a>` : ''}</p>`,
    });
  };

  router.get('/fotobibliotheek/', guard, async (req, res, next) => {
    try {
      const count = Number.parseInt(req.query.geupload, 10);
      let notice = Number.isInteger(count) && count > 0 && count <= MAX_FILES ? `${count} ${count === 1 ? 'foto' : 'foto\'s'} geüpload.` : '';
      if (req.query.verwijderd === '1') notice = 'De foto is verwijderd.';
      const linked = Number.parseInt(req.query.gekoppeld, 10);
      if (Number.isInteger(linked) && linked >= 0 && linked <= 1_000_000) notice = linked ? `${linked} ${linked === 1 ? 'foto heeft' : 'foto\'s hebben'} automatisch een land gekregen.` : 'Er waren geen foto\'s om automatisch te koppelen.';
      return res.send(await renderList(req, { notice }));
    } catch (error) {
      return next(error);
    }
  });

  /**
   * Slaat de bestanden van een upload op in de bibliotheek, elk met een regel in het auditlog. Een te groot bestand of
   * een bestand dat geen bruikbare foto is, wordt overgeslagen met een melding; een andere fout breekt de upload af.
   * @param {any} req Express-verzoek (gebruiker, audit).
   * @param {any[]} files Bestanden uit `readMultipart`.
   * @param {string[]} countryIds Gekozen landen.
   * @returns {Promise<{stored: number, problems: string[]}>} Aantal opgeslagen foto's en de meldingen per bestand.
   */
  const storeFiles = async (req, files, countryIds) => {
    const problems = [];
    let stored = 0;
    for (const file of files) {
      const label = file.filename.split(/[\\/]/).pop().slice(0, 120) || 'zonder naam';
      if (file.truncated || !file.buffer) {
        problems.push(`${label}: het bestand is groter dan ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
        continue;
      }
      try {
        await library.storeUpload({
          buffer: file.buffer,
          filename: file.filename,
          userId: req.user.id,
          countryIds,
          audit: (client, mediaId) => auth.audit(req, { userId: req.user.id, action: 'media.geupload', entity: 'media', entityId: mediaId }, client),
        });
        stored++;
      } catch (error) {
        if (!(error instanceof ImageError)) throw error;
        problems.push(`${label}: ${error.message}`);
      }
    }
    return { stored, problems };
  };

  router.post('/fotobibliotheek/uploaden/', guard, async (req, res, next) => {
    if (!req.is('multipart/form-data')) return res.status(415).type('text').send('Verwacht een formulier met bestanden.');
    if (Number(req.get('content-length') || 0) > MAX_FILES * MAX_UPLOAD_BYTES + 64 * 1024) {
      return res.status(413).type('text').send('De upload is te groot.');
    }
    // Herkomst vooraf (goedkoop); het token zelf wordt gecontroleerd zodra het in de upload binnenkomt.
    if (!auth.csrfValid(req, req.session?.csrf)) return res.status(403).type('text').send('Verzoek geweigerd. Laad de pagina opnieuw en probeer het nog eens.');
    // Al aan de uurgrens: niet eerst de hele upload inlezen (de teller gaat hier niet omhoog).
    const userKey = `user:${req.user.id}`;
    if (uploadLimiter.isBlocked(userKey)) return res.status(429).set('Retry-After', '3600').type('text').send(`Je kunt maximaal ${uploadsPerHour} foto's per uur uploaden. Probeer het later opnieuw.`);
    if (runningUploads >= maxParallelUploads) return res.status(503).set('Retry-After', '10').type('text').send('Er worden al foto\'s verwerkt. Probeer het over een paar seconden opnieuw.');
    runningUploads++;
    try {
      const form = await readMultipart(req, (token) => auth.csrfValid(req, token));
      req.body = form.fields;
      const fail = async (status, error) => res.status(status).send(await renderList(req, { error }));
      if (form.tooMany) return await fail(413, `Upload maximaal ${MAX_FILES} foto's tegelijk.`);
      if (!form.files.length) return await fail(422, 'Kies een of meer foto\'s.');
      // Alle bestanden van deze upload in één keer (zonder await ertussen) tellen, zodat de grens ook bij gelijktijdige uploads geldt.
      const withinLimit = form.files.map(() => uploadLimiter.hit(userKey)).every(Boolean);
      if (!withinLimit) return await fail(429, `Je kunt maximaal ${uploadsPerHour} foto's per uur uploaden. Probeer het later opnieuw.`);
      const countryIds = [].concat(form.fields.land || []);
      const { stored, problems } = await storeFiles(req, form.files, countryIds);
      if (problems.length) return await fail(422, partialUploadMessage(stored, problems));
      const back = tripReturnPath(form.fields.terug);
      if (back) return res.redirect(303, `${back}?geupload=${stored}#fotos`);
      return res.redirect(303, `${BASE}?geupload=${stored}`);
    } catch (error) {
      if (error.status === 403) return res.status(403).set('Connection', 'close').type('text').send('Verzoek geweigerd. Laad de pagina opnieuw en probeer het nog eens.');
      if (error.status === 400) return res.status(400).type('text').send('Het formulier kon niet gelezen worden.');
      return next(error);
    } finally {
      runningUploads--;
    }
  });

  /**
   * De pagina van één foto met het wijzigformulier.
   * @param {any} req Express-verzoek.
   * @param {any} item Foto uit `library.get`.
   * @param {{error?: string, notice?: string}} [state] Meldingen.
   * @returns {Promise<string>} HTML.
   */
  const renderItem = async (req, item, state = {}) => {
    const [countries, places] = await Promise.all([library.countries(), library.usage(db, item)]);
    const variantWidths = Object.keys(item.variants || {}).map(Number).sort((left, right) => left - right);
    const facts = [
      ['Afmetingen', item.width && item.height ? `${item.width} × ${item.height} px` : 'onbekend'],
      ['Varianten', variantWidths.length ? variantWidths.map((width) => `${width} px`).join(', ') : 'alleen het origineel'],
      ['Bron', item.source === 'upload' ? 'geüpload' : 'import van de huidige site'],
      ['Toegevoegd', item.source === 'upload' ? html`${formatDateTime(item.created_at)}${item.uploaded_by_name ? html` door ${item.uploaded_by_name}` : ''}` : '–'],
      ['Adres', html`<code>${mediaUrl(item)}</code>`],
    ];
    const field = (name, label, max, type = 'input') => html`<div class="field"><span class="field__label"><label for="veld-${name}">${label}</label></span>
      ${type === 'textarea' ? html`<textarea id="veld-${name}" name="${name}" rows="3" maxlength="${max}">${item[name]}</textarea>` : html`<input id="veld-${name}" name="${name}" type="text" value="${item[name]}" maxlength="${max}">`}</div>`;
    return renderCrmPage({
      title: item.title || 'Foto',
      user: req.user,
      csrf: req.session.csrf,
      path: BASE,
      body: html`<p><a href="${BASE}">Naar de fotobibliotheek</a></p>
        ${state.notice ? html`<p class="notice" role="status">${state.notice}</p>` : ''}
        ${renderAlert(state.error)}
        <div class="crm-columns">
          <section>
            <img class="media-preview" src="${mediaUrl(item, 800)}" alt="${item.alt_text}" width="${item.width || 800}" height="${item.height || 600}">
            <dl class="crm-facts">${facts.map(([label, value]) => html`<dt>${label}</dt><dd>${value}</dd>`)}</dl>
          </section>
          <section>
            <form class="form crm-narrow" method="post" action="${BASE}${item.id}/">
              <input type="hidden" name="_csrf" value="${req.session.csrf}">
              ${field('title', 'Titel', TEXT_LIMITS.title)}
              ${field('alt_text', 'Alt-tekst (wat staat er op de foto, voor schermlezers en zoekmachines)', TEXT_LIMITS.alt_text)}
              ${field('caption', 'Bijschrift', TEXT_LIMITS.caption, 'textarea')}
              ${field('photographer', 'Fotograaf', TEXT_LIMITS.photographer)}
              <div class="field"><span class="field__label"><label for="veld-land">Landen (meerdere met Ctrl of Cmd)</label></span>
                ${countrySelect(countries, item.country_ids, 'veld-land')}</div>
              <div><button class="btn" type="submit">Opslaan</button></div>
            </form>
            <h2>Gebruikt in</h2>
            ${places.length ? html`<ul class="media-usage">${places.map((place) => html`<li>${place.kind}: ${place.href ? html`<a href="${place.href}">${place.title}</a>` : place.title}</li>`)}</ul>` : html`<p>Deze foto wordt nergens gebruikt.</p>`}
            ${item.source !== 'upload' ? html`<p class="field__help">Deze foto komt uit de import van de huidige site en kan hier niet verwijderd worden.</p>`
              : places.length ? html`<p class="field__help">Verwijderen kan pas als de foto nergens meer gebruikt wordt.</p>`
              : html`<form method="post" action="${BASE}${item.id}/verwijderen/">
                <input type="hidden" name="_csrf" value="${req.session.csrf}">
                <button class="btn btn--outline" type="submit">Foto verwijderen</button>
              </form>`}
          </section>
        </div>`,
    });
  };

  router.get(routePath('/fotobibliotheek/:id(\\d{1,9})/'), guard, async (req, res, next) => {
    try {
      const item = await library.get(req.params.id);
      if (!item) return notFound(req, res);
      return res.send(await renderItem(req, item, { notice: req.query.opgeslagen === '1' ? 'De foto is opgeslagen.' : '' }));
    } catch (error) {
      return next(error);
    }
  });

  router.post(routePath('/fotobibliotheek/:id(\\d{1,9})/'), guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const saved = await library.update(req.params.id, { ...req.body, countryIds: req.body.land }, (client) => auth.audit(req, {
        userId: req.user.id, action: 'media.gewijzigd', entity: 'media', entityId: req.params.id,
      }, client));
      if (!saved) return notFound(req, res);
      return res.redirect(303, `${BASE}${Number(req.params.id)}/?opgeslagen=1`);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/fotobibliotheek/koppelen/', guard, auth.checkCsrf, async (req, res, next) => {
    if (!linkLimiter.hit(`user:${req.user.id}`)) return res.status(429).set('Retry-After', '60').type('text').send('Probeer het over een minuut opnieuw.');
    try {
      const result = await db.transaction(async (client) => {
        const outcome = await linkImportedMedia(client);
        if (outcome.links) await auth.audit(req, { userId: req.user.id, action: 'media.gekoppeld', entity: 'media' }, client);
        return outcome;
      });
      return res.redirect(303, `${BASE}?land=zonder&gekoppeld=${result.linked}`);
    } catch (error) {
      return next(error);
    }
  });

  router.post(routePath('/fotobibliotheek/:id(\\d{1,9})/verwijderen/'), guard, auth.checkCsrf, async (req, res, next) => {
    try {
      const outcome = await library.remove(req.params.id, (client) => auth.audit(req, {
        userId: req.user.id, action: 'media.verwijderd', entity: 'media', entityId: req.params.id,
      }, client));
      if (outcome.status === 'weg') return notFound(req, res);
      if (outcome.status === 'ok') return res.redirect(303, `${BASE}?verwijderd=1`);
      const item = await library.get(req.params.id);
      if (!item) return notFound(req, res);
      const message = outcome.status === 'import' ? 'Een foto uit de import kan niet verwijderd worden.' : 'Deze foto wordt nog gebruikt en kan niet verwijderd worden.';
      return res.status(409).send(await renderItem(req, item, { error: message }));
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createMediaRoutes, readMultipart, MEDIA_ACTION_LABELS, MAX_FILES, UPLOADS_PER_HOUR };
