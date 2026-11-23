/**
 * Foto's kiezen uit de fotobibliotheek op een bewerkscherm (reistypes en landen, reizen). Een zoekformulier (GET, op
 * zoektekst en land) en daaronder een formulier (POST) met de foto's als keuzerondjes of vinkjes. Werkt zonder
 * JavaScript. De server controleert de gekozen id's opnieuw en vergrendelt de foto bij het opslaan (`lockMediaForUse`).
 */
const { html, raw } = require('../site/html');
const { searchPatterns } = require('../persons/person-routes');
const { mediaUrl } = require('./library');

/** Aantal foto's per pagina in de kiezer. */
const PICKER_PAGE_SIZE = 24;

/**
 * Leest het filter van de kiezer uit de querystring (`foto_q`, `foto_land`, `foto_pagina`).
 * @param {object} query `req.query`.
 * @param {{id: number}[]} countries Alle landen.
 * @param {(number|null)} [defaultCountryId] Land als er nog niets gekozen is (bijv. het land zelf).
 * @returns {{text: string, patterns: string[], countryId: (number|null), page: number, chosen: boolean}} Filter.
 */
function pickerFilter(query, countries, defaultCountryId = null) {
  const { text, patterns } = searchPatterns(query.foto_q);
  const landText = typeof query.foto_land === 'string' ? query.foto_land : undefined;
  let countryId = defaultCountryId;
  if (landText !== undefined) {
    countryId = /^\d{1,9}$/.test(landText) && countries.some((country) => country.id === Number(landText)) ? Number(landText) : null;
  }
  const page = Math.min(Math.max(Number.parseInt(query.foto_pagina, 10) || 1, 1), 1000);
  return { text, patterns, countryId, page, chosen: landText !== undefined };
}

/**
 * Haalt een pagina foto's voor de kiezer op.
 * @param {object} library Fotobibliotheek (`createMediaLibrary`).
 * @param {object} filter Uit `pickerFilter`.
 * @returns {Promise<{photos: object[], hasMore: boolean}>} Foto's en of er een volgende pagina is.
 */
async function pickerPhotos(library, filter) {
  const rows = await library.list({ countryId: filter.countryId, patterns: filter.patterns, limit: PICKER_PAGE_SIZE + 1, offset: (filter.page - 1) * PICKER_PAGE_SIZE });
  return { photos: rows.slice(0, PICKER_PAGE_SIZE), hasMore: rows.length > PICKER_PAGE_SIZE };
}

/**
 * De kiezer: zoekformulier en formulier met foto's.
 * @param {{pageUrl: string, action: string, csrf: string, countries: object[], filter: object, photos: object[],
 *   hasMore: boolean, multiple?: boolean, allowNone?: boolean, button: string, anchor?: string, extraFields?: object}} picker
 *   Adres van de pagina (voor het zoeken), adres om op te slaan, CSRF-token, landen, filter, foto's, of er meer zijn,
 *   meerdere kiezen (vinkjes), "geen foto" tonen, tekst van de knop, anker van het blok en extra velden in het formulier.
 * @returns {object} HTML.
 */
function renderPhotoPicker(picker) {
  const anchor = picker.anchor || 'foto';
  const { filter } = picker;
  const query = (page) => new URLSearchParams({
    ...(filter.text ? { foto_q: filter.text } : {}),
    foto_land: filter.countryId ? String(filter.countryId) : '',
    ...(page > 1 ? { foto_pagina: String(page) } : {}),
  }).toString();
  const type = picker.multiple ? 'checkbox' : 'radio';
  return html`<form class="crm-search" method="get" action="${picker.pageUrl}#${anchor}" role="search">
      <label for="${anchor}-q">Zoek een foto</label>
      <input id="${anchor}-q" name="foto_q" type="search" value="${filter.text}" maxlength="100">
      <label for="${anchor}-land" class="visually-hidden">Land</label>
      <select id="${anchor}-land" name="foto_land"><option value="">Alle landen</option>${picker.countries.map((country) => html`<option value="${country.id}"${country.id === filter.countryId ? raw(' selected') : ''}>${country.name}</option>`)}</select>
      <button class="btn btn--small" type="submit">Zoeken</button>
    </form>
    <form method="post" action="${picker.action}">
      <input type="hidden" name="_csrf" value="${picker.csrf}">
      ${picker.extraFields || ''}
      ${picker.photos.length ? html`<ul class="media-grid media-grid--pick">${picker.photos.map((photo) => html`<li class="media-grid__item">
          <label class="media-pick">
            <input type="${type}" name="media_id" value="${photo.id}">
            <img src="${mediaUrl(photo, 400)}" alt="${photo.alt_text}" loading="lazy" width="${photo.width || 400}" height="${photo.height || 300}">
            <span class="media-grid__title">${photo.title || photo.local_name}</span>
            <span class="media-grid__meta">${photo.countries.length ? photo.countries.join(', ') : 'Geen land'}</span>
          </label>
        </li>`)}</ul>` : html`<p>Geen foto's gevonden. Upload foto's in de <a href="/app/fotobibliotheek/">fotobibliotheek</a> of zoek in alle landen.</p>`}
      <p>${filter.page > 1 ? html`<a href="${picker.pageUrl}?${query(filter.page - 1)}#${anchor}">Vorige foto's</a> ` : ''}${picker.hasMore ? html`<a href="${picker.pageUrl}?${query(filter.page + 1)}#${anchor}">Volgende foto's</a>` : ''}</p>
      <div class="crm-actions">
        ${picker.photos.length ? html`<button class="btn btn--small" type="submit">${picker.button}</button>` : ''}
        ${picker.allowNone ? html`<button class="btn btn--small btn--outline" type="submit" name="geen" value="1">Geen foto</button>` : ''}
      </div>
    </form>`;
}

module.exports = { pickerFilter, pickerPhotos, renderPhotoPicker, PICKER_PAGE_SIZE };
